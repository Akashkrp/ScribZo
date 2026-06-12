// ============ SCRIBZO game room — rounds, scoring, coins, AI judge ============
const { getRandomWords } = require('./words');
const { similarity, judgeTurn } = require('./judge');
const { POWERUPS, dailyChallenge } = require('./powerups');

const PICK_TIME = 15;
const REVEAL_TIME = 7;
const COINS_CORRECT = 15;
const COINS_DRAWER_PER_GUESS = 8;
const CHALLENGE_BONUS_COINS = 20;

class Room {
  constructor(id, io, settings = {}) {
    this.id = id;
    this.io = io;
    this.players = new Map(); // socketId -> player
    this.hostId = null;
    this.state = 'lobby'; // lobby | picking | drawing | reveal | gameover
    this.settings = {
      rounds: settings.rounds || 3,
      drawTime: settings.drawTime || 80,
      maxPlayers: settings.maxPlayers || 8,
      isPrivate: settings.isPrivate !== false,
      topic: settings.topic || 'mix'
    };
    this.round = 0;
    this.turnOrder = [];
    this.turnIndex = -1;
    this.drawerId = null;
    this.word = null;
    this.wordChoices = [];
    this.usedWords = new Set();
    this.hintIndices = new Set();
    this.timer = null;
    this.timeLeft = 0;
    this.frozen = 0;            // seconds of freeze remaining
    this.guessedThisTurn = new Set();
    this.guessLog = new Map();  // playerId -> { text, sim } best near-miss
    this.turnStartTime = 0;
    this.drawHistory = [];
    this.challengeAccepted = false;
    this.challenge = dailyChallenge();
    this.locked = false;            // once a game starts, room is never matchmade again
    this.lastActivity = Date.now(); // for stale-room cleanup
    this.kickedTokens = new Set();  // kicked players can't rejoin
  }

  touch() { this.lastActivity = Date.now(); }

  // ---------- players ----------
  addPlayer(socket, name, avatar, token) {
    if (this.players.size >= this.settings.maxPlayers) return { error: 'room is full, sadge' };
    if (token && this.kickedTokens.has(token)) return { error: 'you were kicked from this room 💀' };
    name = String(name || '').trim().slice(0, 16) || 'anon';
    avatar = String(avatar || '🐸').slice(0, 8);
    const player = {
      id: socket.id, name, avatar, token: token || socket.id,
      score: 0, coins: 30, guessed: false, connected: true
    };
    this.players.set(socket.id, player);
    if (!this.hostId) this.hostId = socket.id;
    return { player };
  }

  // ---------- reconnection ----------
  // disconnect = grace period, not removal; the player can rejoin with their token
  markDisconnected(socketId) {
    const player = this.players.get(socketId);
    if (!player) return null;
    player.connected = false;
    player.disconnectedAt = Date.now();
    const connectedCount = [...this.players.values()].filter(p => p.connected).length;
    if (this.state !== 'lobby' && connectedCount < 2) {
      this.endGame('not enough players 😢');
      return player;
    }
    if (socketId === this.drawerId && (this.state === 'drawing' || this.state === 'picking')) {
      this.io.to(this.id).emit('system-message', { text: 'the artist lost connection! skipping…', type: 'warn' });
      this.nextTurn();
    } else if (this.state === 'drawing') {
      this.checkAllGuessed();
    }
    return player;
  }

  rejoin(socket, token) {
    if (this.kickedTokens.has(token)) return { error: 'kicked' };
    let old = null;
    for (const p of this.players.values()) {
      if (p.token === token && !p.connected) { old = p; break; }
    }
    if (!old) return { error: 'nothing to rejoin' };
    const oldId = old.id;
    this.players.delete(oldId);
    old.id = socket.id;
    old.connected = true;
    this.players.set(socket.id, old);
    // rebind every reference to the old socket id
    this.turnOrder = this.turnOrder.map(id => (id === oldId ? socket.id : id));
    if (this.drawerId === oldId) this.drawerId = socket.id;
    if (this.hostId === oldId) this.hostId = socket.id;
    if (this.guessedThisTurn.delete(oldId)) this.guessedThisTurn.add(socket.id);
    const g = this.guessLog.get(oldId);
    if (g) { this.guessLog.delete(oldId); this.guessLog.set(socket.id, g); }
    return { player: old };
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
    this.guessedThisTurn.delete(socketId);
    this.guessLog.delete(socketId);
    this.turnOrder = this.turnOrder.filter(id => id !== socketId);
    if (this.hostId === socketId) this.hostId = this.players.keys().next().value || null;
    if (this.state !== 'lobby' && this.players.size < 2) {
      this.endGame('not enough players 😢');
      return;
    }
    if (socketId === this.drawerId && (this.state === 'drawing' || this.state === 'picking')) {
      this.io.to(this.id).emit('system-message', { text: 'the artist rage quit! skipping…', type: 'warn' });
      this.nextTurn();
    } else if (this.state === 'drawing') {
      this.checkAllGuessed();
    }
  }

  // ---------- flow ----------
  startGame() {
    if (this.players.size < 2) return { error: 'need at least 2 players bestie' };
    this.locked = true; // privacy: no strangers can ever be quick-matched into this room
    this.round = 1;
    for (const p of this.players.values()) { p.score = 0; p.guessed = false; }
    this.beginRound();
    return {};
  }

  beginRound() {
    this.turnOrder = [...this.players.keys()];
    this.turnIndex = -1;
    this.io.to(this.id).emit('round-start', { round: this.round, totalRounds: this.settings.rounds });
    this.nextTurn();
  }

  nextTurn() {
    this.clearTimer();
    this.turnIndex++;
    if (this.turnIndex >= this.turnOrder.length) {
      this.round++;
      if (this.round > this.settings.rounds) return this.endGame();
      return this.beginRound();
    }
    this.drawerId = this.turnOrder[this.turnIndex];
    const drawerPlayer = this.players.get(this.drawerId);
    if (!drawerPlayer || !drawerPlayer.connected) return this.nextTurn();

    this.state = 'picking';
    this.word = null;
    this.hintIndices = new Set();
    this.guessedThisTurn = new Set();
    this.guessLog = new Map();
    this.drawHistory = [];
    this.frozen = 0;
    this.challengeAccepted = false;
    for (const p of this.players.values()) p.guessed = false;

    this.wordChoices = getRandomWords(3, this.usedWords, this.settings.topic);
    const drawer = this.players.get(this.drawerId);

    this.io.to(this.id).emit('turn-start', {
      drawerId: this.drawerId,
      drawerName: drawer.name,
      round: this.round,
      totalRounds: this.settings.rounds,
      players: this.getPlayerList()
    });
    this.io.to(this.drawerId).emit('pick-word', {
      choices: this.wordChoices,
      time: PICK_TIME,
      challenge: this.challenge
    });

    this.timeLeft = PICK_TIME;
    this.startTimer(() => {
      this.selectWord(this.wordChoices[Math.floor(Math.random() * this.wordChoices.length)]);
    });
  }

  selectWord(word, acceptChallenge = false) {
    if (this.state !== 'picking') return;
    this.clearTimer();
    this.word = word;
    this.usedWords.add(word);
    this.state = 'drawing';
    this.turnStartTime = Date.now();
    this.challengeAccepted = !!acceptChallenge;

    this.io.to(this.drawerId).emit('word-assigned', { word });
    this.io.to(this.id).emit('drawing-start', {
      drawerId: this.drawerId,
      maskedWord: this.maskWord(),
      time: this.settings.drawTime,
      challenge: this.challengeAccepted ? this.challenge : null
    });
    if (this.challengeAccepted) {
      this.io.to(this.id).emit('system-message', {
        text: `${this.players.get(this.drawerId).name} accepted the daily challenge: ${this.challenge.emoji} ${this.challenge.title}! 2x points on the line`,
        type: 'info'
      });
    }

    this.timeLeft = this.settings.drawTime;
    this.startTimer(() => this.endTurn('time'), () => this.maybeRevealHint());
  }

  maskWord() {
    if (!this.word) return '';
    return this.word.split('').map((ch, i) =>
      ch === ' ' ? ' ' : (this.hintIndices.has(i) ? ch : '_')
    ).join('');
  }

  maybeRevealHint() {
    if (!this.word) return;
    const letters = this.word.replace(/ /g, '').length;
    const maxHints = Math.max(1, Math.floor(letters / 3));
    const hintTimes = [];
    for (let i = 1; i <= maxHints; i++) {
      hintTimes.push(Math.floor(this.settings.drawTime * (1 - i / (maxHints + 1))));
    }
    if (hintTimes.includes(this.timeLeft)) {
      const unrevealed = [];
      this.word.split('').forEach((ch, i) => {
        if (ch !== ' ' && !this.hintIndices.has(i)) unrevealed.push(i);
      });
      if (unrevealed.length > 1) {
        this.hintIndices.add(unrevealed[Math.floor(Math.random() * unrevealed.length)]);
        this.io.to(this.id).emit('hint-update', { maskedWord: this.maskWord() });
      }
    }
  }

  // ---------- guessing ----------
  handleGuess(socketId, text) {
    const player = this.players.get(socketId);
    if (!player) return null;
    const clean = text.trim();
    if (!clean) return null;

    if (this.state !== 'drawing' || socketId === this.drawerId || player.guessed) {
      return { type: 'chat' };
    }

    const sim = similarity(clean, this.word);

    if (sim === 1) {
      player.guessed = true;
      this.guessedThisTurn.add(socketId);
      const points = this.computePoints();
      player.score += points;
      player.coins += COINS_CORRECT;
      const drawer = this.players.get(this.drawerId);
      if (drawer) {
        const mult = this.challengeAccepted ? 2 : 1;
        drawer.score += Math.floor(points / 4) * mult;
        drawer.coins += COINS_DRAWER_PER_GUESS;
        if (this.challengeAccepted && this.guessedThisTurn.size === 1) {
          drawer.coins += CHALLENGE_BONUS_COINS;
        }
      }
      this.io.to(this.id).emit('player-guessed', {
        playerId: socketId, playerName: player.name,
        points, players: this.getPlayerList()
      });
      this.io.to(socketId).emit('word-assigned', { word: this.word });
      this.checkAllGuessed();
      return { type: 'correct' };
    }

    // track best near-miss for the AI judge
    const prev = this.guessLog.get(socketId);
    if (!prev || sim > prev.sim) this.guessLog.set(socketId, { text: clean, sim });

    if (sim >= 0.75) return { type: 'close' };
    return { type: 'chat' };
  }

  computePoints() {
    const elapsed = (Date.now() - this.turnStartTime) / 1000;
    const ratio = Math.max(0, 1 - elapsed / this.settings.drawTime);
    return 200 + Math.floor(300 * ratio) + Math.max(0, 50 - this.guessedThisTurn.size * 10);
  }

  checkAllGuessed() {
    const guessers = [...this.players.values()].filter(p => p.id !== this.drawerId && p.connected);
    if (guessers.length > 0 && guessers.every(p => p.guessed)) {
      this.endTurn('all-guessed');
    }
  }

  // ---------- power-ups ----------
  usePowerUp(socketId, type) {
    const def = POWERUPS[type];
    const player = this.players.get(socketId);
    if (!def || !player || this.state !== 'drawing') return { error: 'not now!' };
    if (def.who === 'drawer' && socketId !== this.drawerId) return { error: 'drawer-only power-up!' };
    if (player.coins < def.cost) return { error: `need ${def.cost} coins, you have ${player.coins} 😭` };

    player.coins -= def.cost;

    if (type === 'freeze') {
      this.frozen += 5;
      this.io.to(this.id).emit('time-frozen', { by: player.name, seconds: 5 });
    } else if (type === 'undoboost') {
      for (let k = 0; k < 3; k++) {
        let i = this.drawHistory.length - 1;
        while (i >= 0 && !['start', 'fill', 'circle'].includes(this.drawHistory[i].type)) i--;
        if (i < 0) break;
        this.drawHistory = this.drawHistory.slice(0, i);
      }
      this.io.to(this.id).emit('canvas-sync', { history: this.drawHistory });
    }

    this.io.to(this.id).emit('powerup-used', {
      type, emoji: def.emoji, label: def.label,
      playerId: socketId, playerName: player.name,
      players: this.getPlayerList()
    });
    return { ok: true };
  }

  // ---------- turn end + AI judge ----------
  endTurn(reason) {
    this.clearTimer();
    this.state = 'reveal';

    let aiJudge = null;
    if (this.guessedThisTurn.size === 0 && reason === 'time' && this.word) {
      const { verdict, awards } = judgeTurn(this.word, this.guessLog, this.drawHistory);
      for (const a of awards) {
        const p = this.players.get(a.playerId);
        if (p) {
          p.score += a.points;
          p.coins += a.coins;
          a.playerName = p.name;
        }
      }
      aiJudge = { verdict: verdict.text, awards };
    }

    this.io.to(this.id).emit('turn-end', {
      word: this.word,
      reason,
      players: this.getPlayerList(),
      aiJudge
    });
    this.timeLeft = REVEAL_TIME;
    this.startTimer(() => this.nextTurn());
  }

  endGame(message) {
    this.clearTimer();
    const ranked = this.getPlayerList().sort((a, b) => b.score - a.score);
    this.io.to(this.id).emit('game-over', { leaderboard: ranked, message });
    this.state = 'lobby';
    this.round = 0;
    this.drawerId = null;
    this.word = null;
    this.usedWords = new Set();
  }

  // ---------- timer ----------
  startTimer(onDone, onTick) {
    this.clearTimer();
    this.io.to(this.id).emit('timer', { timeLeft: this.timeLeft });
    this.timer = setInterval(() => {
      if (this.frozen > 0) { this.frozen--; return; } // clock is frozen
      this.timeLeft--;
      this.io.to(this.id).emit('timer', { timeLeft: this.timeLeft });
      if (onTick) onTick();
      if (this.timeLeft <= 0) {
        this.clearTimer();
        onDone();
      }
    }, 1000);
  }

  clearTimer() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  // ---------- helpers ----------
  getPlayerList() {
    return [...this.players.values()].map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, score: p.score, coins: p.coins,
      guessed: p.guessed, isHost: p.id === this.hostId, isDrawing: p.id === this.drawerId,
      connected: p.connected
    }));
  }

  isEmpty() { return this.players.size === 0; }
}

module.exports = { Room };
