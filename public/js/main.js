// ============ SCRIBZO main: screens, lobby, ticker, video buttons ============
(() => {
  const $ = (id) => document.getElementById(id);
  const socket = io();

  const AVATARS = ['🐸', '😈', '🦊', '🐼', '🦄', '🐙', '🦖', '👽', '🤖', '🍕', '🌚', '🔥', '💀', '🦋', '🐢', '🍄', '🧃', '🪩'];
  let avatarIdx = Math.floor(Math.random() * AVATARS.length);
  let myName = '';
  let currentPlayers = [];
  let isHost = false;
  let mySettings = { rounds: 3, drawTime: 80, topic: 'mix' };

  Canvas.init((d) => socket.emit('draw', d));
  GameUI.init(socket);
  VideoChat.init(socket);

  // ---------- screens / toast ----------
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(`screen-${name}`).classList.add('active');
    if (name === 'game') setTimeout(() => Canvas.resize(), 50);
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    $('toast-zone').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  // ---------- home ----------
  const avatarDisplay = $('avatar-display');
  const renderAvatar = () => { avatarDisplay.textContent = AVATARS[avatarIdx]; };
  renderAvatar();
  $('avatar-prev').onclick = () => { avatarIdx = (avatarIdx - 1 + AVATARS.length) % AVATARS.length; renderAvatar(); };
  $('avatar-next').onclick = () => { avatarIdx = (avatarIdx + 1) % AVATARS.length; renderAvatar(); };
  avatarDisplay.onclick = () => { avatarIdx = (avatarIdx + 1) % AVATARS.length; renderAvatar(); };

  function getName() {
    const name = $('input-name').value.trim();
    if (!name) {
      showError('drop ur name first 💀');
      $('input-name').focus();
      return null;
    }
    myName = name;
    return name;
  }

  function showError(msg) {
    const el = $('home-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
  }

  $('btn-quick-play').onclick = () => {
    const name = getName();
    if (name) socket.emit('quick-play', { name, avatar: AVATARS[avatarIdx] });
  };
  $('btn-create-room').onclick = () => {
    const name = getName();
    if (name) socket.emit('create-room', { name, avatar: AVATARS[avatarIdx], settings: { isPrivate: true } });
  };
  $('btn-show-join').onclick = () => {
    $('join-box').classList.toggle('hidden');
    $('input-room-code').focus();
  };
  $('btn-join-room').onclick = joinByCode;
  $('input-room-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinByCode(); });
  $('input-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-quick-play').click(); });

  function joinByCode() {
    const name = getName();
    const code = $('input-room-code').value.trim();
    if (!code) return showError('enter the room code!');
    if (name) socket.emit('join-room', { roomId: code, name, avatar: AVATARS[avatarIdx] });
  }

  // ---------- lobby ----------
  function renderLobby(players) {
    currentPlayers = players;
    const box = $('lobby-players');
    box.innerHTML = '';
    players.forEach(p => {
      const el = document.createElement('div');
      el.className = 'lobby-player';
      el.innerHTML = `<span class="av">${p.avatar}</span>
        <span class="nm">${GameUI.esc(p.name)}${p.id === socket.id ? ' (u)' : ''}</span>
        ${p.isHost ? '<span class="host-tag">HOST</span>' : ''}`;
      box.appendChild(el);
    });
    $('btn-start-game').classList.toggle('hidden', !isHost);
    $('lobby-hint').classList.toggle('hidden', isHost);
    $('settings-note').textContent = isHost ? '(u are the host)' : '(host controls)';
    document.querySelectorAll('#lobby-settings .chip').forEach(c => { c.disabled = !isHost; });
  }

  $('room-code-pill').onclick = () => {
    navigator.clipboard.writeText($('lobby-room-code').textContent)
      .then(() => toast('code copied 📋 send it to the gc'));
  };

  function bindChips(groupId, key, parse = parseInt) {
    $(groupId).querySelectorAll('.chip').forEach(c => {
      c.onclick = () => {
        if (!isHost) return;
        $(groupId).querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        mySettings[key] = parse(c.dataset.val);
        socket.emit('update-settings', mySettings);
      };
    });
  }
  bindChips('chips-rounds', 'rounds');
  bindChips('chips-time', 'drawTime');

  function buildTopicChips(topics) {
    const box = $('chips-topic');
    if (box.children.length) return;
    const emoji = { mix: '🎲', classic: '🎨', anime: '⛩️', movies: '🎬', engineering: '⚙️', startups: '🦄', cricket: '🏏', memes: '💀' };
    topics.forEach(t => {
      const c = document.createElement('button');
      c.className = 'chip' + (t === 'mix' ? ' active' : '');
      c.dataset.val = t;
      c.textContent = `${emoji[t] || '✦'} ${t}`;
      box.appendChild(c);
    });
    bindChips('chips-topic', 'topic', (v) => v);
  }

  $('btn-start-game').onclick = () => socket.emit('start-game');

  // lobby chat
  $('lobby-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('lobby-chat-input');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat-message', { text });
    input.value = '';
  });

  // ---------- game buttons: independent cam & mic ----------
  function refreshAVButtons() {
    const camBtn = $('btn-toggle-video');
    const micBtn = $('btn-toggle-mic');
    camBtn.textContent = VideoChat.isCamOn() ? '📹' : '📷';
    camBtn.classList.toggle('live', VideoChat.isCamOn());
    micBtn.textContent = VideoChat.isMicOn() ? '🎙️' : '🔇';
    micBtn.classList.toggle('live', VideoChat.isMicOn());
  }

  $('btn-toggle-video').onclick = async () => {
    const btn = $('btn-toggle-video');
    try {
      btn.disabled = true;
      const on = await VideoChat.toggleCam(myName, currentPlayers.map(p => p.id));
      toast(on ? "camera on 🎥 don't be weird" : 'camera off');
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      refreshAVButtons();
    }
  };

  $('btn-toggle-mic').onclick = async () => {
    const btn = $('btn-toggle-mic');
    try {
      btn.disabled = true;
      const on = await VideoChat.toggleMic(myName, currentPlayers.map(p => p.id));
      toast(on ? 'mic on 🎙️' : 'muted 🤐');
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      refreshAVButtons();
    }
  };

  $('btn-leave').onclick = () => {
    if (confirm('leave the game?')) {
      VideoChat.shutdown(); // kill all audio/video before leaving
      location.reload();
    }
  };

  $('btn-back-lobby').onclick = () => {
    VideoChat.shutdown(); // no ghost voices in the lobby
    refreshAVButtons();
    GameUI.hideModals();
    showScreen('lobby');
    renderLobby(currentPlayers);
  };

  // ---------- socket: room lifecycle ----------
  socket.on('room-joined', ({ roomId, players, isHost: host, settings, state, powerups, challenge, topics }) => {
    isHost = host;
    mySettings = { rounds: settings.rounds, drawTime: settings.drawTime, topic: settings.topic };
    $('lobby-room-code').textContent = roomId;
    GameUI.setPowerups(powerups);
    buildTopicChips(topics);
    $('db-text').textContent = `${challenge.emoji} ${challenge.title} — ${challenge.desc}`;
    syncChipUI(settings);
    if (state === 'lobby') {
      showScreen('lobby');
      renderLobby(players);
    } else {
      showScreen('game');
      GameUI.renderPlayers(players);
      currentPlayers = players;
    }
  });

  socket.on('join-error', ({ message }) => showError(message));

  socket.on('player-joined', ({ players, newPlayer }) => {
    currentPlayers = players;
    isHost = players.find(p => p.id === socket.id)?.isHost || false;
    if ($('screen-lobby').classList.contains('active')) renderLobby(players);
    else GameUI.renderPlayers(players);
    VideoChat.refreshPeers(players.map(p => p.id));
    toast(`${newPlayer.avatar} ${newPlayer.name} pulled up!`);
  });

  socket.on('player-left', ({ players, playerName }) => {
    currentPlayers = players;
    isHost = players.find(p => p.id === socket.id)?.isHost || false;
    if ($('screen-lobby').classList.contains('active')) renderLobby(players);
    else GameUI.renderPlayers(players);
    toast(`${playerName} dipped 💨`);
  });

  socket.on('settings-updated', (settings) => {
    mySettings = { rounds: settings.rounds, drawTime: settings.drawTime, topic: settings.topic };
    syncChipUI(settings);
  });

  function syncChipUI(settings) {
    document.querySelectorAll('#chips-rounds .chip').forEach(c =>
      c.classList.toggle('active', parseInt(c.dataset.val) === settings.rounds));
    document.querySelectorAll('#chips-time .chip').forEach(c =>
      c.classList.toggle('active', parseInt(c.dataset.val) === settings.drawTime));
    document.querySelectorAll('#chips-topic .chip').forEach(c =>
      c.classList.toggle('active', c.dataset.val === settings.topic));
  }

  socket.on('round-start', () => {
    if (!$('screen-game').classList.contains('active')) showScreen('game');
  });
  socket.on('turn-start', ({ players }) => {
    currentPlayers = players;
    if (!$('screen-game').classList.contains('active')) showScreen('game');
  });

  socket.on('disconnect', () => toast('connection lost… 🔌'));

  socket.on('room-closed', ({ message }) => {
    toast(message || 'room closed');
    setTimeout(() => location.reload(), 1500);
  });

  // ---------- PWA: service worker + install button ----------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    $('btn-install').classList.remove('hidden');
  });
  $('btn-install').onclick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      toast('scribzo installed 📲 welcome home');
      $('btn-install').classList.add('hidden');
    }
    installPrompt = null;
  };
  window.addEventListener('appinstalled', () => $('btn-install').classList.add('hidden'));

  // fetch today's challenge for the home banner (before joining any room)
  fetch('/api/daily').then(r => r.json()).then(ch => {
    $('db-text').textContent = `${ch.emoji} ${ch.title} — ${ch.desc}`;
  }).catch(() => { $('db-text').textContent = 'join a room to find out 👀'; });
})();
