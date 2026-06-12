// ============ SCRIBZO voice & video (P2P mesh) ============
// Camera and mic are fully independent: voice-only, video-only, or both.
const VideoChat = (() => {
  let ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };
  // server may add a TURN relay (fixes video for strict-NAT / mobile-carrier users)
  fetch('/api/ice').then(r => r.json()).then(cfg => {
    if (cfg && cfg.iceServers) ICE_CONFIG = cfg;
  }).catch(() => {});

  let socket = null;
  let myName = 'me';
  let camOn = false;
  let micOn = false;
  let videoTrack = null;
  let audioTrack = null;
  let localStream = new MediaStream();
  const peers = new Map();      // peerId -> RTCPeerConnection
  const peerNames = new Map();
  const strip = document.getElementById('video-strip');

  function init(sock) {
    socket = sock;

    socket.on('video-peer-joined', () => {}); // joiner initiates; nothing to do

    socket.on('video-peer-left', ({ peerId }) => closePeer(peerId));

    socket.on('video-offer', async ({ from, offer }) => {
      const pc = getOrCreatePeer(from);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('video-answer', { to: from, answer });
    });

    socket.on('video-answer', async ({ from, answer }) => {
      const pc = peers.get(from);
      if (pc && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on('video-ice', async ({ from, candidate }) => {
      const pc = peers.get(from);
      if (pc && candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { /* ignore */ }
      }
    });

    socket.on('video-state', ({ peerId, camOn: cam, micOn: mic }) => {
      const tile = document.getElementById(`vt-${peerId}`);
      if (!tile) return;
      tile.querySelector('.vt-cam-off')?.classList.toggle('hidden', cam);
      const micEl = tile.querySelector('.vt-mic');
      if (micEl) micEl.textContent = mic ? '🎙️' : '🔇';
    });
  }

  // ---------- peers ----------
  function getOrCreatePeer(peerId) {
    if (peers.has(peerId)) return peers.get(peerId);
    const pc = new RTCPeerConnection(ICE_CONFIG);
    peers.set(peerId, pc);

    attachLocalTracks(pc);

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('video-ice', { to: peerId, candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      addTile(peerId, peerNames.get(peerId) || 'player', e.streams[0], false);
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) closePeer(peerId);
    };
    return pc;
  }

  function attachLocalTracks(pc) {
    const sending = pc.getSenders().map(s => s.track).filter(Boolean);
    for (const t of localStream.getTracks()) {
      if (!sending.includes(t)) pc.addTrack(t, localStream);
    }
  }

  async function renegotiate(peerId, pc) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('video-offer', { to: peerId, offer });
    } catch (e) { /* glare — remote offer will land instead */ }
  }

  async function broadcastTracks(playerIds) {
    socket.emit('video-join');
    for (const pid of playerIds) {
      if (pid === socket.id) continue;
      const existed = peers.has(pid);
      const pc = getOrCreatePeer(pid);
      if (existed) attachLocalTracks(pc);
      await renegotiate(pid, pc);
    }
  }

  function removeTrackEverywhere(track) {
    if (!track) return;
    track.stop();
    localStream.removeTrack(track);
    for (const pc of peers.values()) {
      const sender = pc.getSenders().find(s => s.track === track);
      if (sender) pc.removeTrack(sender);
    }
  }

  function closePeer(peerId) {
    const pc = peers.get(peerId);
    if (pc) { pc.close(); peers.delete(peerId); }
    document.getElementById(`vt-${peerId}`)?.remove();
    updateStrip();
  }

  // ---------- tiles ----------
  function addTile(id, name, stream, isLocal) {
    let tile = document.getElementById(`vt-${id}`);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'video-tile';
      tile.id = `vt-${id}`;
      tile.innerHTML = `
        <video autoplay playsinline ${isLocal ? 'muted' : ''}></video>
        <div class="vt-cam-off hidden">📷❌</div>
        <span class="vt-mic">🔇</span>
        <span class="vt-name">${escapeHtml(name)}${isLocal ? ' (u)' : ''}</span>`;
      strip.appendChild(tile);
    }
    const video = tile.querySelector('video');
    if (video.srcObject !== stream) video.srcObject = stream;
    updateStrip();
  }

  function updateLocalTile() {
    const hasAnything = camOn || micOn;
    if (!hasAnything) {
      document.getElementById('vt-local')?.remove();
      updateStrip();
      return;
    }
    addTile('local', myName, localStream, true);
    const tile = document.getElementById('vt-local');
    tile.querySelector('.vt-cam-off').classList.toggle('hidden', camOn);
    tile.querySelector('.vt-mic').textContent = micOn ? '🎙️' : '🔇';
  }

  function updateStrip() { strip.classList.toggle('hidden', strip.children.length === 0); }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function emitState() { socket.emit('video-state', { camOn, micOn }); }

  // ---------- public: independent toggles ----------
  async function toggleCam(name, playerIds) {
    myName = name || myName;
    if (camOn) {
      removeTrackEverywhere(videoTrack);
      videoTrack = null;
      camOn = false;
      updateLocalTile();
      emitState();
      return false;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 } }
      });
    } catch (e) {
      throw new Error('camera blocked — check browser permissions!');
    }
    videoTrack = stream.getVideoTracks()[0];
    localStream.addTrack(videoTrack);
    camOn = true;
    updateLocalTile();
    await broadcastTracks(playerIds);
    emitState();
    return true;
  }

  async function toggleMic(name, playerIds) {
    myName = name || myName;
    if (micOn) {
      removeTrackEverywhere(audioTrack);
      audioTrack = null;
      micOn = false;
      updateLocalTile();
      emitState();
      return false;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      throw new Error('mic blocked — check browser permissions!');
    }
    audioTrack = stream.getAudioTracks()[0];
    localStream.addTrack(audioTrack);
    micOn = true;
    updateLocalTile();
    await broadcastTracks(playerIds);
    emitState();
    return true;
  }

  // full teardown — stops sending AND receiving (used when leaving a game)
  function shutdown() {
    removeTrackEverywhere(videoTrack);
    removeTrackEverywhere(audioTrack);
    videoTrack = null;
    audioTrack = null;
    camOn = false;
    micOn = false;
    for (const id of [...peers.keys()]) closePeer(id);
    strip.innerHTML = '';
    updateStrip();
    socket.emit('video-leave');
    emitState();
  }

  // when new players join mid-session: if we're live, offer to them
  function refreshPeers(playerIds) {
    if (!camOn && !micOn) return;
    for (const pid of playerIds) {
      if (pid !== socket.id && !peers.has(pid)) {
        const pc = getOrCreatePeer(pid);
        renegotiate(pid, pc);
      }
    }
  }

  function setPeerName(peerId, name) { peerNames.set(peerId, name); }
  function isCamOn() { return camOn; }
  function isMicOn() { return micOn; }

  return { init, toggleCam, toggleMic, shutdown, refreshPeers, setPeerName, isCamOn, isMicOn };
})();
