// ============ SCRIBZO game UI: rounds, chat, power-ups, AI judge ============
const GameUI = (() => {
  const $ = (id) => document.getElementById(id);

  let socket = null;
  let isDrawer = false;
  let drawTimeTotal = 80;
  let powerupDefs = {};
  let activeChallenge = null;
  let myCoins = 30;

  // ---------- init ----------
  function init(sock) {
    socket = sock;
    buildToolbar();
    bindChat();
    bindSocketEvents();
  }

  function setPowerups(defs) { powerupDefs = defs; buildPowerupBar(); }

  // ---------- toolbar ----------
  function buildToolbar() {
    const row = $('color-row');
    Canvas.COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'color-swatch' + (i === 0 ? ' active' : '');
      b.style.background = c;
      b.onclick = () => {
        row.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        Canvas.setColor(c);
        if (Canvas.getStyle() === 'rainbow') setPenStyle('normal'); // picking a color exits rainbow
        setTool('pen');
      };
      row.appendChild(b);
    });

    $('size-dots').querySelectorAll('.size-dot').forEach(b => {
      b.onclick = () => {
        if (b.classList.contains('locked')) return;
        $('size-dots').querySelectorAll('.size-dot').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        Canvas.setSize(parseInt(b.dataset.size));
      };
    });

    $('tool-pen').onclick = () => setTool('pen');
    $('tool-fill').onclick = () => setTool('fill');
    $('tool-eraser').onclick = () => setTool('eraser');
    $('tool-undo').onclick = () => { Canvas.undoLocal(); socket.emit('undo-canvas'); };
    $('tool-clear').onclick = () => { Canvas.reset(); socket.emit('clear-canvas'); };
  }

  function setTool(t) {
    Canvas.setTool(t);
    ['pen', 'fill', 'eraser'].forEach(x => $(`tool-${x}`).classList.toggle('active', x === t));
  }

  function setPenStyle(style) {
    Canvas.setStyle(style);
    document.querySelectorAll('.powerup-btn[data-pen]').forEach(b =>
      b.classList.toggle('on', b.dataset.pen === style));
  }

  // ---------- power-ups ----------
  function buildPowerupBar() {
    const drawerRow = $('powerup-row');
    const guesserRow = $('guesser-powerups');
    drawerRow.innerHTML = '';
    guesserRow.innerHTML = '';
    for (const [type, def] of Object.entries(powerupDefs)) {
      const b = document.createElement('button');
      b.className = 'powerup-btn';
      b.title = def.desc;
      b.innerHTML = `${def.emoji} ${def.label} <span class="pu-cost">🪙${def.cost}</span>`;
      if (type === 'glow') b.dataset.pen = 'glow';
      if (type === 'rainbow') b.dataset.pen = 'rainbow';
      b.onclick = () => activatePowerup(type, b);
      (def.who === 'any' ? guesserRow : drawerRow).appendChild(b);
      if (def.who === 'any') {
        const b2 = b.cloneNode(true);
        b2.onclick = () => activatePowerup(type, b2);
        drawerRow.appendChild(b2);
      }
    }
  }

  function activatePowerup(type, btn) {
    // pens toggle off for free if already on
    if ((type === 'glow' || type === 'rainbow') && Canvas.getStyle() === type) {
      setPenStyle('normal');
      return;
    }
    socket.emit('use-powerup', { type });
    btn.dataset.pending = type;
  }

  function updateGuesserPowerups(visible) {
    $('guesser-powerups').classList.toggle('hidden', isDrawer || !visible);
  }

  // ---------- chat ----------
  function bindChat() {
    $('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('chat-input');
      const text = input.value.trim();
      if (!text) return;
      socket.emit('chat-message', { text });
      input.value = '';
    });
  }

  function addChat(html, cls = '', boxId = 'chat-messages') {
    const box = $(boxId);
    const el = document.createElement('div');
    el.className = `chat-msg ${cls}`;
    el.innerHTML = html;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    while (box.children.length > 150) box.removeChild(box.firstChild);
  }

  const esc = (s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

  // ---------- masked word display ----------
  // multi-word answers: show a clear "•" between words + letter counts, e.g.  _ a _ • _ _  (3·2)
  function formatMasked(masked) {
    const words = masked.split(' ').filter(w => w.length);
    const shown = words.map(w => w.split('').join(' ')).join('  •  ');
    if (words.length > 1) {
      return `${shown}  <small style="opacity:.55;letter-spacing:1px">(${words.map(w => w.length).join('·')})</small>`;
    }
    return shown;
  }

  // ---------- sounds (tiny WebAudio synth, no files needed) ----------
  let audioCtx = null;
  function beep(freq, start, dur, type = 'triangle', gain = 0.12) {
    const t = audioCtx.currentTime + start;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t);
    o.stop(t + dur);
  }
  function playSound(kind) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      if (kind === 'correct-me') {        // you guessed it — happy arpeggio
        [523, 659, 784, 1047].forEach((f, i) => beep(f, i * 0.09, 0.22));
      } else if (kind === 'correct-other') { // someone else got it — soft ding
        beep(880, 0, 0.15, 'sine', 0.07);
      } else if (kind === 'win') {        // game over fanfare
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => beep(f, i * 0.13, 0.3));
      }
    } catch (e) { /* audio blocked — no big deal */ }
  }

  // ---------- players & coins ----------
  function renderPlayers(players) {
    const ranked = [...players].sort((a, b) => b.score - a.score);
    const panel = $('players-panel');
    panel.innerHTML = '';
    ranked.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'player-row' + (p.guessed ? ' guessed' : '') + (p.isDrawing ? ' drawing' : '');
      row.innerHTML = `
        <span class="p-rank">#${i + 1}</span>
        <span class="p-av">${p.avatar}</span>
        <div class="p-info">
          <div class="p-name">${esc(p.name)} ${p.id === socket.id ? '<span class="you">(u)</span>' : ''}</div>
          <div class="p-sub">${p.score} pts · 🪙${p.coins}</div>
        </div>
        <span class="p-badge">${p.isDrawing ? '✏️' : (p.guessed ? '✅' : '')}${p.isHost ? '👑' : ''}</span>`;
      panel.appendChild(row);
      VideoChat.setPeerName(p.id, p.name);
      if (p.id === socket.id && p.coins !== myCoins) {
        myCoins = p.coins;
        $('coin-count').textContent = myCoins;
        $('coin-pill').classList.remove('flash');
        void $('coin-pill').offsetWidth;
        $('coin-pill').classList.add('flash');
      } else if (p.id === socket.id) {
        $('coin-count').textContent = p.coins;
      }
    });
  }

  // ---------- timer ----------
  function updateTimer(timeLeft) {
    $('timer-text').textContent = Math.max(0, timeLeft);
    const box = $('timer-box');
    box.classList.toggle('danger', timeLeft <= 10 && timeLeft > 0);

    // speedrun challenge: drawer's hands off after first 20s
    if (isDrawer && activeChallenge?.id === 'speedrun' && drawTimeTotal - timeLeft >= 20) {
      Canvas.setCanDraw(false);
    }
  }

  // ---------- modals / overlay ----------
  function showModal(id) {
    $('modal-backdrop').classList.remove('hidden');
    ['modal-pick-word', 'modal-turn-end', 'modal-game-over'].forEach(m =>
      $(m).classList.toggle('hidden', m !== id));
  }
  function hideModals() { $('modal-backdrop').classList.add('hidden'); }

  function overlay(html) {
    $('canvas-overlay').classList.remove('hidden');
    $('overlay-content').innerHTML = html;
  }
  function hideOverlay() { $('canvas-overlay').classList.add('hidden'); }

  // ---------- socket events ----------
  function bindSocketEvents() {
    socket.on('round-start', ({ round, totalRounds }) => {
      $('round-badge').textContent = `RND ${round}/${totalRounds}`;
      addChat(`🌀 round ${round} — lock in`, 'sys-info');
    });

    socket.on('turn-start', ({ drawerId, drawerName, round, totalRounds, players }) => {
      hideModals();
      isDrawer = drawerId === socket.id;
      activeChallenge = null;
      Canvas.reset();
      Canvas.setCanDraw(false);
      Canvas.setMode(null);
      setPenStyle('normal');
      $('toolbar').classList.add('hidden');
      $('challenge-banner').classList.add('hidden');
      $('size-mega').classList.add('hidden');
      $('round-badge').textContent = `RND ${round}/${totalRounds}`;
      $('word-display').textContent = 'picking…';
      $('word-display').classList.remove('is-word');
      updateGuesserPowerups(false);
      renderPlayers(players);
      if (!isDrawer) overlay(`<span style="font-size:2.4rem">🤔</span><br>${esc(drawerName)} is picking a word…`);
    });

    socket.on('pick-word', ({ choices, challenge }) => {
      const box = $('word-choices');
      box.innerHTML = '';
      $('challenge-opt-text').textContent =
        `${challenge.emoji} accept "${challenge.title}" (${challenge.desc}) — 2x points + 🪙20`;
      $('challenge-check').checked = false;
      choices.forEach(w => {
        const b = document.createElement('button');
        b.className = 'word-choice';
        b.textContent = w;
        b.onclick = () => {
          socket.emit('select-word', { word: w, acceptChallenge: $('challenge-check').checked });
          hideModals();
        };
        box.appendChild(b);
      });
      showModal('modal-pick-word');
    });

    socket.on('word-assigned', ({ word }) => {
      const wd = $('word-display');
      wd.textContent = word;
      wd.classList.add('is-word');
    });

    socket.on('drawing-start', ({ drawerId, maskedWord, time, challenge }) => {
      hideModals();
      hideOverlay();
      drawTimeTotal = time;
      isDrawer = drawerId === socket.id;
      activeChallenge = challenge || null;
      Canvas.setCanDraw(isDrawer);
      Canvas.setMode(isDrawer && challenge ? challenge.id : null);
      $('toolbar').classList.toggle('hidden', !isDrawer);
      updateGuesserPowerups(true);

      const banner = $('challenge-banner');
      if (challenge) {
        banner.textContent = `${challenge.emoji} CHALLENGE RUN: ${challenge.desc}`;
        banner.classList.remove('hidden');
      } else {
        banner.classList.add('hidden');
      }

      if (!isDrawer) {
        $('word-display').innerHTML = formatMasked(maskedWord);
        $('word-display').classList.remove('is-word');
      }
      Canvas.resize();
    });

    socket.on('hint-update', ({ maskedWord }) => {
      if (!isDrawer) $('word-display').innerHTML = formatMasked(maskedWord);
    });

    socket.on('timer', ({ timeLeft }) => updateTimer(timeLeft));

    socket.on('time-frozen', ({ by, seconds }) => {
      addChat(`🧊 ${esc(by)} froze time for ${seconds}s!`, 'sys-info');
      $('timer-box').classList.add('frozen');
      $('freeze-fx').classList.remove('hidden');
      setTimeout(() => {
        $('timer-box').classList.remove('frozen');
        $('freeze-fx').classList.add('hidden');
      }, seconds * 1000);
    });

    socket.on('powerup-used', ({ type, emoji, label, playerId, playerName, players }) => {
      addChat(`${emoji} ${esc(playerName)} used ${esc(label)}!`, 'sys-info');
      renderPlayers(players);
      if (playerId === socket.id) {
        if (type === 'glow') setPenStyle('glow');
        if (type === 'rainbow') setPenStyle('rainbow');
        if (type === 'megabrush') {
          const mega = $('size-mega');
          mega.classList.remove('hidden', 'locked');
          mega.click();
        }
      }
    });

    socket.on('canvas-sync', ({ history }) => Canvas.syncHistory(history));
    socket.on('draw', (d) => Canvas.applyEvent(d));
    socket.on('clear-canvas', () => Canvas.reset());

    socket.on('chat-message', ({ playerName, text, whisper }) => {
      const html = `<span class="cm-name">${esc(playerName)}:</span> ${esc(text)}`;
      addChat(html, whisper ? 'whisper' : '');
      addChat(html, whisper ? 'whisper' : '', 'lobby-chat-messages');
    });

    socket.on('system-message', ({ text, type }) => addChat(esc(text), `sys-${type || 'info'}`));

    socket.on('player-guessed', ({ playerId, playerName, points, players }) => {
      addChat(`🎉 ${esc(playerName)} got it! +${points}`, 'sys-correct');
      renderPlayers(players);
      if (playerId === socket.id) {
        playSound('correct-me');
        confettiBurst(30);
      } else {
        playSound('correct-other');
      }
    });

    socket.on('turn-end', ({ word, reason, players, aiJudge }) => {
      Canvas.setCanDraw(false);
      $('toolbar').classList.add('hidden');
      $('challenge-banner').classList.add('hidden');
      updateGuesserPowerups(false);
      $('turn-end-title').textContent =
        reason === 'all-guessed' ? 'EVERYONE ATE 🔥' : "TIME'S UP ⏰";
      $('revealed-word').textContent = word;

      const judgeBox = $('ai-judge-box');
      if (aiJudge) {
        let html = `<div class="aj-title">🤖 AI JUDGE VERDICT</div><div>${esc(aiJudge.verdict)}</div>`;
        if (aiJudge.awards.length) {
          html += aiJudge.awards.map(a =>
            `<div class="aj-award">🎯 ${esc(a.playerName || '?')} said "${esc(a.guess)}" — close enough! +${a.points} pts +🪙${a.coins}</div>`
          ).join('');
        } else {
          html += `<div class="aj-award">nobody was even close 💀 no partial credit</div>`;
        }
        judgeBox.innerHTML = html;
        judgeBox.classList.remove('hidden');
        addChat(`🤖 ${esc(aiJudge.verdict)}`, 'sys-judge');
      } else {
        judgeBox.classList.add('hidden');
      }

      const box = $('turn-scores');
      box.innerHTML = '';
      [...players].sort((a, b) => b.score - a.score).forEach(p => {
        const row = document.createElement('div');
        row.className = 'turn-score-row';
        row.innerHTML = `<span>${p.avatar} ${esc(p.name)}</span>
          <span class="${p.guessed || p.isDrawing ? 'pts-pos' : 'pts-zero'}">${p.score} pts</span>`;
        box.appendChild(row);
      });
      renderPlayers(players);
      showModal('modal-turn-end');
    });

    socket.on('game-over', ({ leaderboard, message }) => {
      Canvas.setCanDraw(false);
      $('toolbar').classList.add('hidden');
      renderLeaderboard(leaderboard);
      if (message) addChat(esc(message), 'sys-warn');
      showModal('modal-game-over');
      playSound('win');
      confettiBurst(120);
    });
  }

  // ---------- leaderboard ----------
  function renderLeaderboard(ranked) {
    const podium = $('podium');
    podium.innerHTML = '';
    const order = [1, 0, 2];
    const cls = ['second', 'first', 'third'];
    const medals = ['🥈', '🥇', '🥉'];
    order.forEach((idx, vi) => {
      const p = ranked[idx];
      if (!p) return;
      const spot = document.createElement('div');
      spot.className = `podium-spot ${cls[vi]}`;
      spot.innerHTML = `
        <div class="pd-av">${p.avatar}</div>
        <div class="pd-name">${esc(p.name)}</div>
        <div class="pd-score">${p.score} pts</div>
        <div class="pd-block">${medals[vi]}</div>`;
      podium.appendChild(spot);
    });

    const ranks = $('final-ranks');
    ranks.innerHTML = '';
    ranked.slice(3).forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'final-rank-row';
      row.innerHTML = `<span>#${i + 4}</span><span>${p.avatar} ${esc(p.name)}</span>
        <span class="fr-score">${p.score} pts</span>`;
      ranks.appendChild(row);
    });
  }

  // ---------- confetti ----------
  function confettiBurst(count) {
    const colors = ['#ff5d8f', '#9b5de5', '#3a86ff', '#06d6a0', '#ffd23f', '#ff8c42'];
    for (let i = 0; i < count; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      const size = 6 + Math.random() * 9;
      c.style.cssText = `left:${Math.random() * 100}vw;width:${size}px;height:${size}px;
        background:${colors[Math.floor(Math.random() * colors.length)]};
        animation-duration:${2 + Math.random() * 2}s;animation-delay:${Math.random() * 0.5}s`;
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 5000);
    }
  }

  return { init, setPowerups, renderPlayers, addChat, hideModals, esc };
})();
