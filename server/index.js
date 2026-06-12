// SCRIBZO — main server: express static hosting + socket.io events
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Room } = require('./game');
const { POWERUPS, dailyChallenge } = require('./powerups');
const { topicList } = require('./words');
const filter = require('./filter');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/daily', (req, res) => res.json(dailyChallenge()));

app.get('/healthz', (req, res) => res.send('ok'));

// ICE config: STUN always; TURN relay if env vars are set (fixes strict-NAT video failures)
app.get('/api/ice', (req, res) => {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];
  if (process.env.TURN_URLS && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URLS.split(','),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }
  res.json({ iceServers });
});

// keep-alive: ping ourselves every 14 min so Render's free tier never sleeps
if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(() => {
    fetch(`${process.env.RENDER_EXTERNAL_URL}/healthz`).catch(() => {});
  }, 14 * 60 * 1000);
}

const rooms = new Map(); // roomId -> Room

const crypto = require('crypto');
function makeRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    // crypto-strong randomness so codes can't be predicted
    id = Array.from(crypto.randomBytes(5)).map(b => chars[b % chars.length]).join('');
  } while (rooms.has(id));
  return id;
}

function findPublicRoom() {
  for (const room of rooms.values()) {
    if (!room.settings.isPrivate && !room.locked && room.state === 'lobby' &&
        room.players.size < room.settings.maxPlayers) {
      return room;
    }
  }
  return null;
}

// stale-room sweeper: destroy rooms that are empty or inactive for 30+ minutes
const ROOM_TTL_MS = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.isEmpty() || now - room.lastActivity > ROOM_TTL_MS) {
      room.clearTimer();
      io.to(id).emit('room-closed', { message: 'room expired — make a new one!' });
      io.in(id).disconnectSockets(true);
      rooms.delete(id);
    }
  }
}, 60 * 1000);

io.on('connection', (socket) => {
  let currentRoom = null;

  const joinRoom = (room, name, avatar, token) => {
    const result = room.addPlayer(socket, filter.clean(String(name || '')), avatar, token);
    if (result.error) {
      socket.emit('join-error', { message: result.error });
      return false;
    }
    currentRoom = room;
    room.touch();
    socket.join(room.id);
    socket.emit('room-joined', {
      roomId: room.id,
      players: room.getPlayerList(),
      isHost: room.hostId === socket.id,
      settings: room.settings,
      state: room.state,
      powerups: POWERUPS,
      challenge: dailyChallenge(),
      topics: ['mix', ...topicList()]
    });
    socket.to(room.id).emit('player-joined', {
      players: room.getPlayerList(),
      newPlayer: { name, avatar }
    });
    // late joiner during a game: sync state
    if (room.state === 'drawing') {
      socket.emit('drawing-start', {
        drawerId: room.drawerId,
        maskedWord: room.maskWord(),
        time: room.timeLeft
      });
      socket.emit('canvas-sync', { history: room.drawHistory });
    }
    return true;
  };

  socket.on('create-room', ({ name, avatar, settings, token }) => {
    const room = new Room(makeRoomId(), io, settings);
    rooms.set(room.id, room);
    joinRoom(room, name, avatar, token);
  });

  // rate-limit code guesses: max 5 attempts per 10s per connection (anti brute-force)
  let joinAttempts = [];
  socket.on('join-room', ({ roomId, name, avatar, token }) => {
    const now = Date.now();
    joinAttempts = joinAttempts.filter(t => now - t < 10000);
    if (joinAttempts.length >= 5) {
      return socket.emit('join-error', { message: 'too many attempts — chill for a sec 🧊' });
    }
    joinAttempts.push(now);
    const room = rooms.get((roomId || '').toUpperCase().trim());
    if (!room) return socket.emit('join-error', { message: "Room not found. Check the code!" });
    joinRoom(room, name, avatar, token);
  });

  socket.on('quick-play', ({ name, avatar, token }) => {
    let room = findPublicRoom();
    if (!room) {
      room = new Room(makeRoomId(), io, { isPrivate: false });
      rooms.set(room.id, room);
    }
    joinRoom(room, name, avatar, token);
  });

  // ---------- reconnection ----------
  socket.on('rejoin-room', ({ token }) => {
    if (!token || currentRoom) return;
    for (const room of rooms.values()) {
      const result = room.rejoin(socket, token);
      if (result.error) continue;
      currentRoom = room;
      room.touch();
      socket.join(room.id);
      socket.emit('room-joined', {
        roomId: room.id,
        players: room.getPlayerList(),
        isHost: room.hostId === socket.id,
        settings: room.settings,
        state: room.state,
        powerups: POWERUPS,
        challenge: dailyChallenge(),
        topics: ['mix', ...topicList()]
      });
      if (room.state === 'drawing') {
        socket.emit('drawing-start', {
          drawerId: room.drawerId,
          maskedWord: room.maskWord(),
          time: room.timeLeft,
          challenge: room.challengeAccepted ? room.challenge : null
        });
        socket.emit('canvas-sync', { history: room.drawHistory });
        const me = room.players.get(socket.id);
        if (me && (me.guessed || socket.id === room.drawerId)) {
          socket.emit('word-assigned', { word: room.word });
        }
      }
      io.to(room.id).emit('players-updated', { players: room.getPlayerList() });
      socket.to(room.id).emit('system-message', {
        text: `${result.player.name} reconnected 🔌`, type: 'info'
      });
      return;
    }
    socket.emit('rejoin-failed');
  });

  // ---------- moderation ----------
  socket.on('kick-player', ({ playerId }) => {
    if (!currentRoom || currentRoom.hostId !== socket.id || playerId === socket.id) return;
    const target = currentRoom.players.get(playerId);
    if (!target) return;
    currentRoom.kickedTokens.add(target.token);
    currentRoom.removePlayer(playerId);
    io.to(playerId).emit('kicked', { message: 'the host kicked you 💀' });
    io.sockets.sockets.get(playerId)?.leave(currentRoom.id);
    io.to(currentRoom.id).emit('player-left', {
      players: currentRoom.getPlayerList(), playerName: target.name
    });
    io.to(currentRoom.id).emit('video-peer-left', { peerId: playerId });
  });

  socket.on('report-player', ({ playerId }) => {
    if (!currentRoom) return;
    const target = currentRoom.players.get(playerId);
    const reporter = currentRoom.players.get(socket.id);
    if (!target || !reporter) return;
    // shows up in Render logs — review there
    console.log(`[REPORT] room=${currentRoom.id} reporter="${reporter.name}" target="${target.name}" at=${new Date().toISOString()}`);
    socket.emit('system-message', { text: 'report logged 🫡 thanks for keeping it clean', type: 'info' });
  });

  socket.on('update-settings', (settings) => {
    if (!currentRoom || currentRoom.hostId !== socket.id || currentRoom.state !== 'lobby') return;
    currentRoom.settings.rounds = Math.min(10, Math.max(1, settings.rounds || 3));
    currentRoom.settings.drawTime = Math.min(180, Math.max(30, settings.drawTime || 80));
    if (typeof settings.topic === 'string') currentRoom.settings.topic = settings.topic;
    io.to(currentRoom.id).emit('settings-updated', currentRoom.settings);
  });

  socket.on('start-game', () => {
    if (!currentRoom || currentRoom.hostId !== socket.id) return;
    const result = currentRoom.startGame();
    if (result.error) socket.emit('system-message', { text: result.error, type: 'warn' });
  });

  socket.on('select-word', ({ word, acceptChallenge }) => {
    if (!currentRoom || currentRoom.drawerId !== socket.id) return;
    if (currentRoom.wordChoices.includes(word)) currentRoom.selectWord(word, acceptChallenge);
  });

  socket.on('use-powerup', ({ type }) => {
    if (!currentRoom) return;
    const result = currentRoom.usePowerUp(socket.id, type);
    if (result.error) socket.emit('system-message', { text: result.error, type: 'warn' });
  });

  // ---------- drawing relay ----------
  socket.on('draw', (data) => {
    if (!currentRoom || currentRoom.drawerId !== socket.id || currentRoom.state !== 'drawing') return;
    currentRoom.touch();
    currentRoom.drawHistory.push(data);
    socket.to(currentRoom.id).emit('draw', data);
  });

  socket.on('clear-canvas', () => {
    if (!currentRoom || currentRoom.drawerId !== socket.id) return;
    currentRoom.drawHistory = [];
    socket.to(currentRoom.id).emit('clear-canvas');
  });

  socket.on('undo-canvas', () => {
    if (!currentRoom || currentRoom.drawerId !== socket.id) return;
    // remove last stroke (from last 'start' to end)
    const hist = currentRoom.drawHistory;
    let i = hist.length - 1;
    while (i >= 0 && !['start', 'fill', 'circle'].includes(hist[i].type)) i--;
    if (i >= 0) currentRoom.drawHistory = hist.slice(0, i);
    io.to(currentRoom.id).emit('canvas-sync', { history: currentRoom.drawHistory });
  });

  // ---------- chat / guessing ----------
  socket.on('chat-message', ({ text }) => {
    if (!currentRoom) return;
    const player = currentRoom.players.get(socket.id);
    if (!player) return;
    currentRoom.touch();
    const result = currentRoom.handleGuess(socket.id, text);
    if (!result) return;
    if (result.type === 'correct') return; // broadcast handled in room
    if (result.type === 'close') {
      socket.emit('system-message', { text: `"${text}" is sooo close! 👀`, type: 'close' });
      return;
    }
    // hide chat from guessers if sender already guessed (anti-cheat)
    const payload = { playerId: socket.id, playerName: player.name, avatar: player.avatar, text: filter.clean(text) };
    if (player.guessed && currentRoom.state === 'drawing') {
      for (const [id, p] of currentRoom.players) {
        if (p.guessed || id === currentRoom.drawerId) io.to(id).emit('chat-message', { ...payload, whisper: true });
      }
    } else {
      io.to(currentRoom.id).emit('chat-message', payload);
    }
  });

  // ---------- WebRTC signaling ----------
  socket.on('video-join', () => {
    if (!currentRoom) return;
    socket.to(currentRoom.id).emit('video-peer-joined', { peerId: socket.id });
  });

  socket.on('video-leave', () => {
    if (!currentRoom) return;
    socket.to(currentRoom.id).emit('video-peer-left', { peerId: socket.id });
  });

  socket.on('video-offer', ({ to, offer }) => {
    io.to(to).emit('video-offer', { from: socket.id, offer });
  });

  socket.on('video-answer', ({ to, answer }) => {
    io.to(to).emit('video-answer', { from: socket.id, answer });
  });

  socket.on('video-ice', ({ to, candidate }) => {
    io.to(to).emit('video-ice', { from: socket.id, candidate });
  });

  socket.on('video-state', ({ camOn, micOn }) => {
    if (!currentRoom) return;
    socket.to(currentRoom.id).emit('video-state', { peerId: socket.id, camOn, micOn });
  });

  // ---------- disconnect: 60s grace window for reconnection ----------
  const GRACE_MS = 60 * 1000;
  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = currentRoom;
    currentRoom = null;
    const player = room.markDisconnected(socket.id);
    socket.to(room.id).emit('players-updated', { players: room.getPlayerList() });
    socket.to(room.id).emit('video-peer-left', { peerId: socket.id });
    if (!player) return;
    socket.to(room.id).emit('system-message', {
      text: `${player.name} lost connection… 60s to come back`, type: 'warn'
    });
    const token = player.token;
    setTimeout(() => {
      if (!rooms.has(room.id)) return;
      const p = [...room.players.values()].find(x => x.token === token);
      if (p && !p.connected) {
        room.removePlayer(p.id);
        io.to(room.id).emit('player-left', { players: room.getPlayerList(), playerName: p.name });
        if (room.isEmpty()) {
          room.clearTimer();
          rooms.delete(room.id);
        }
      }
    }, GRACE_MS + 15000);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎨 SCRIBZO running at http://localhost:${PORT}`);
});
