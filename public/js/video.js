// ============ WebRTC video chat (P2P mesh, Google Meet style) ============
const VideoChat = (() => {
  const ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  let socket = null;
  let localStream = null;
  let camOn = false;
  let micOn = true;
  const peers = new Map();      // peerId -> RTCPeerConnection
  const peerNames = new Map();  // peerId -> name
  const strip = document.getElementById('video-strip');

  function init(sock) {
    socket = sock;

    // The peer who turns their camera on initiates offers to everyone,
    // so we don't offer back here (avoids offer glare).
    socket.on('video-peer-joined', () => {});

    socket.on('video-peer-left', ({ peerId }) => {
      closePeer(peerId);
    });

    socket.on('video-offer', async ({ from, offer }) => {
      // someone wants to send us video — accept even if our cam is off
      const pc = getOrCreatePeer(from);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('video-answer', { to: from, answer });
    });

    socket.on('video-answer', async ({ from, answer }) => {
      const pc = peers.get(from);
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('video-ice', async ({ from, candidate }) => {
      const pc = peers.get(from);
      if (pc && candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { /* ignore */ }
      }
    });

    socket.on('video-state', ({ peerId, camOn: on, micOn: mic }) => {
      const tile = document.getElementById(`vt-${peerId}`);
      if (!tile) return;
      tile.querySelector('.vt-cam-off')?.classList.toggle('hidden', on);
      const micEl = tile.querySelector('.vt-mic');
      if (micEl) micEl.textContent = mic ? '🎙️' : '🔇';
    });
  }

  function getOrCreatePeer(peerId) {
    if (peers.has(peerId)) return peers.get(peerId);
    const pc = new RTCPeerConnection(ICE_CONFIG);
    peers.set(peerId, pc);

    if (localStream) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('video-ice', { to: peerId, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      addTile(peerId, peerNames.get(peerId) || 'player', e.streams[0], false);
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) closePeer(peerId);
    };

    return pc;
  }

  async function connectToPeer(peerId, isInitiator) {
    const pc = getOrCreatePeer(peerId);
    // ensure our current tracks are attached (handles renegotiation)
    if (localStream) {
      const sending = pc.getSenders().map(s => s.track);
      localStream.getTracks().forEach(t => {
        if (!sending.includes(t)) pc.addTrack(t, localStream);
      });
    }
    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('video-offer', { to: peerId, offer });
    }
  }

  // called when new players join the room — if we're live, offer to them
  function refreshPeers(playerIds) {
    if (!camOn) return;
    for (const pid of playerIds) {
      if (pid !== socket.id && !peers.has(pid)) connectToPeer(pid, true);
    }
  }

  function closePeer(peerId) {
    const pc = peers.get(peerId);
    if (pc) { pc.close(); peers.delete(peerId); }
    document.getElementById(`vt-${peerId}`)?.remove();
    updateStripVisibility();
  }

  // ---- tiles ----
  function addTile(id, name, stream, isLocal) {
    let tile = document.getElementById(`vt-${id}`);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'video-tile';
      tile.id = `vt-${id}`;
      tile.innerHTML = `
        <video autoplay playsinline ${isLocal ? 'muted' : ''}></video>
        <div class="vt-cam-off hidden">📷❌</div>
        <span class="vt-mic">🎙️</span>
        <span class="vt-name">${escapeHtml(name)}${isLocal ? ' (you)' : ''}</span>`;
      strip.appendChild(tile);
    }
    const video = tile.querySelector('video');
    if (video.srcObject !== stream) video.srcObject = stream;
    updateStripVisibility();
  }

  function updateStripVisibility() {
    strip.classList.toggle('hidden', strip.children.length === 0);
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // ---- public controls ----
  async function turnOnCamera(myName, playerIds) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 } },
        audio: true
      });
    } catch (err) {
      throw new Error('Camera/mic access denied. Check browser permissions!');
    }
    camOn = true;
    micOn = true;
    addTile('local', myName, localStream, true);
    socket.emit('video-join');
    socket.emit('video-state', { camOn, micOn });
    // proactively connect to everyone already in the room
    for (const pid of playerIds) {
      if (pid !== socket.id) await connectToPeer(pid, true);
    }
  }

  function turnOffCamera() {
    camOn = false;
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      // stop sending, but keep connections alive so we still SEE others
      for (const pc of peers.values()) {
        pc.getSenders().forEach(s => { if (s.track) pc.removeTrack(s); });
      }
      localStream = null;
    }
    document.getElementById('vt-local')?.remove();
    socket.emit('video-state', { camOn: false, micOn });
    socket.emit('video-leave');
    updateStripVisibility();
  }

  function toggleMic() {
    if (!localStream) return micOn;
    micOn = !micOn;
    localStream.getAudioTracks().forEach(t => { t.enabled = micOn; });
    socket.emit('video-state', { camOn, micOn });
    const micEl = document.querySelector('#vt-local .vt-mic');
    if (micEl) micEl.textContent = micOn ? '🎙️' : '🔇';
    return micOn;
  }

  function setPeerName(peerId, name) { peerNames.set(peerId, name); }

  function isCamOn() { return camOn; }

  return { init, turnOnCamera, turnOffCamera, toggleMic, setPeerName, isCamOn, closePeer, refreshPeers };
})();
