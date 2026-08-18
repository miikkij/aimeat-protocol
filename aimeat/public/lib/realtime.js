/**
 * @file realtime.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AimeatRealtime — browser client for AIMEAT P2P realtime rooms (WS rooms +
 *   WebRTC data channels + Yjs CRDT sync) and SharedClock (network-synced timeline).
 * @version-history
 *   v1.2.0 — 2026-07-19 — constructor also accepts an options object ({ session } or
 *     { baseUrl, token }); positional (baseUrl, token) unchanged — existing apps unaffected
 *   v1.1.0 — 2026-07-18 — SharedClock added (extracted from the Band Jam pattern)
 *   v1.0.0 — 2026-03-03 — initial WS rooms + WebRTC + Yjs client
 *
 * Usage:
 *   const rt = new AimeatRealtime('https://node.example.com', token);
 *   // or equivalently: new AimeatRealtime({ session })   (uses session.jwt + page origin)
 *   const room = await rt.createRoom({ app_type: 'whiteboard', name: 'My Board' });
 *   rt.connect(room.id, 'Alice');
 *   rt.on('peer-joined', (msg) => console.log('New peer:', msg.nick));
 *   rt.broadcast({ draw: { x: 10, y: 20 } });
 *
 * WebRTC P2P (optional, for low-latency data/audio):
 *   rt.on('peer-joined', (msg) => rt.connectPeer(msg.peerId));
 *   rt.on('peer-data', ({ peerId, data }) => handleData(data));
 *   rt.sendToPeer(peerId, { note: 'C4', velocity: 0.8 });
 *
 * Yjs CRDT (optional, for collaborative state):
 *   const Y = await import('https://cdn.jsdelivr.net/npm/yjs/+esm');
 *   const ydoc = new Y.Doc();
 *   rt.syncDoc('shared-state', ydoc);
 */
class AimeatRealtime {
  /**
   * @param {string|object} baseUrl — AIMEAT node URL (e.g. https://node.example.com), OR an
   *   options object: { session } (uses session.jwt + the page origin) or { baseUrl, token }.
   * @param {string} [token] — JWT auth token (positional form)
   */
  constructor(baseUrl, token) {
    // Tolerant object form — the positional (baseUrl, token) path below is unchanged.
    if (baseUrl && typeof baseUrl === 'object') {
      const opts = baseUrl;
      const sess = opts.session || null;
      token = token || opts.token || (sess && sess.jwt) || null;
      baseUrl = opts.baseUrl || opts.nodeUrl || (typeof location !== 'undefined' ? location.origin : '');
    }
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.ws = null;
    this.peerId = null;
    this.roomId = null;
    this.peers = new Map();
    this._handlers = {};
    // WebRTC state
    this._peerConnections = new Map(); // peerId → { pc, dataChannel, iceServers }
    this._iceServers = null;
    // Yjs state
    this._yjsDocs = new Map(); // docId → Y.Doc
  }

  // ── HTTP API ──

  async createRoom({ app_type, name, max_peers, is_public, tags }) {
    const res = await fetch(`${this.baseUrl}/v1/realtime/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify({ app_type, name, max_peers, is_public, tags }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error?.message || 'Failed to create room');
    return json.data;
  }

  async listRooms({ app_type, tag } = {}) {
    const params = new URLSearchParams();
    if (app_type) params.set('app_type', app_type);
    if (tag) params.set('tag', tag);
    const qs = params.toString() ? `?${params}` : '';

    const res = await fetch(`${this.baseUrl}/v1/realtime/rooms${qs}`, {
      headers: { 'Authorization': `Bearer ${this.token}` },
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error?.message || 'Failed to list rooms');
    return json.data.rooms ?? json.data;
  }

  async getRoom(roomId) {
    const res = await fetch(`${this.baseUrl}/v1/realtime/rooms/${roomId}`, {
      headers: { 'Authorization': `Bearer ${this.token}` },
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error?.message || 'Failed to get room');
    return json.data;
  }

  async deleteRoom(roomId) {
    const res = await fetch(`${this.baseUrl}/v1/realtime/rooms/${roomId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${this.token}` },
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error?.message || 'Failed to delete room');
    return json.data;
  }

  async getIceServers() {
    const res = await fetch(`${this.baseUrl}/v1/realtime/ice-servers`, {
      headers: { 'Authorization': `Bearer ${this.token}` },
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error?.message || 'Failed to get ICE servers');
    return json.data.ice_servers;
  }

  // ── WebSocket connection ──

  connect(roomId, nick = 'anonymous') {
    if (this.ws) this.disconnect();

    this.roomId = roomId;
    const protocol = this.baseUrl.startsWith('https') ? 'wss' : 'ws';
    const host = this.baseUrl.replace(/^https?:\/\//, '');
    const url = `${protocol}://${host}/v1/realtime/ws?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(this.token)}&nick=${encodeURIComponent(nick)}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => this._emit('open', {});

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this._handleMessage(msg);
      } catch { /* ignore malformed */ }
    };

    this.ws.onclose = (event) => {
      this.peerId = null;
      this.peers.clear();
      this._emit('close', { code: event.code, reason: event.reason });
    };

    this.ws.onerror = (event) => {
      this._emit('error', { error: event });
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.peerId = null;
      this.peers.clear();
    }
    this._closeAllPeerConnections();
    this._yjsDocs.clear();
  }

  // ── Messaging ──

  broadcast(payload) {
    this._send({ type: 'broadcast', payload });
  }

  signal(toPeerId, payload) {
    this._send({ type: 'signal', to: toPeerId, payload });
  }

  presence(state) {
    this._send({ type: 'presence', state });
  }

  yjsSync(docId, update) {
    // update should be a base64-encoded Yjs update
    this._send({ type: 'yjs-sync', docId, update });
  }

  leave() {
    this._send({ type: 'leave' });
    this.disconnect();
  }

  // ── WebRTC P2P ──

  /**
   * Establish a WebRTC data channel with a specific peer.
   * Uses the AIMEAT signaling channel for ICE/SDP exchange.
   * @param {string} remotePeerId — The peer to connect to
   * @param {object} [opts] — Options: { audio: boolean, video: boolean }
   * @returns {Promise<RTCDataChannel>}
   */
  async connectPeer(remotePeerId, opts = {}) {
    if (!this.peerId) throw new Error('Not connected to a room');
    if (this._peerConnections.has(remotePeerId)) return this._peerConnections.get(remotePeerId).dataChannel;

    const iceServers = await this._getIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    const entry = { pc, dataChannel: null, iceServers };
    this._peerConnections.set(remotePeerId, entry);

    // ICE candidates → send via signaling
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signal(remotePeerId, { type: 'ice-candidate', candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this._cleanupPeerConnection(remotePeerId);
      }
    };

    // Audio/video tracks (if requested)
    if (opts.audio || opts.video) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: !!opts.audio,
          video: !!opts.video,
        });
        for (const track of stream.getTracks()) {
          pc.addTrack(track, stream);
        }
      } catch { /* user may deny — continue without media */ }
    }

    pc.ontrack = (event) => {
      this._emit('peer-track', { peerId: remotePeerId, track: event.track, streams: event.streams });
    };

    // Create data channel (initiator side)
    const dc = pc.createDataChannel('aimeat-data', { ordered: false });
    entry.dataChannel = dc;
    this._setupDataChannel(dc, remotePeerId);

    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signal(remotePeerId, { type: 'offer', sdp: pc.localDescription });

    return dc;
  }

  /**
   * Send data to a specific peer via WebRTC data channel.
   * Falls back to WebSocket broadcast if no P2P connection exists.
   * @param {string} peerId
   * @param {*} data — JSON-serializable data
   */
  sendToPeer(peerId, data) {
    const entry = this._peerConnections.get(peerId);
    if (entry && entry.dataChannel && entry.dataChannel.readyState === 'open') {
      entry.dataChannel.send(JSON.stringify(data));
    } else {
      // Fallback: signal via WebSocket
      this.signal(peerId, { type: 'data', payload: data });
    }
  }

  /**
   * Close WebRTC connection with a specific peer.
   */
  disconnectPeer(peerId) {
    this._cleanupPeerConnection(peerId);
  }

  // ── Yjs CRDT Sync ──

  /**
   * Attach a Yjs Y.Doc to the room for CRDT-based collaborative editing.
   * Updates are synced via WebSocket to all peers.
   * @param {string} docId — Unique document identifier
   * @param {object} ydoc — A Y.Doc instance
   */
  syncDoc(docId, ydoc) {
    if (!ydoc || typeof ydoc.on !== 'function') {
      throw new Error('syncDoc requires a valid Y.Doc instance');
    }

    this._yjsDocs.set(docId, ydoc);

    // Listen for local updates → broadcast to peers
    const updateHandler = (update, origin) => {
      if (origin === 'remote') return; // don't re-broadcast remote updates
      const b64 = this._uint8ToBase64(update);
      this.yjsSync(docId, b64);
    };
    ydoc.on('update', updateHandler);

    // Store handler ref for cleanup
    if (!ydoc._aimeatHandlers) ydoc._aimeatHandlers = {};
    ydoc._aimeatHandlers[docId] = updateHandler;

    // Request full state from peers (awareness)
    this._send({ type: 'yjs-sync', docId, update: null, requestState: true });
  }

  /**
   * Stop syncing a Yjs document.
   */
  unsyncDoc(docId) {
    const ydoc = this._yjsDocs.get(docId);
    if (ydoc && ydoc._aimeatHandlers && ydoc._aimeatHandlers[docId]) {
      ydoc.off('update', ydoc._aimeatHandlers[docId]);
      delete ydoc._aimeatHandlers[docId];
    }
    this._yjsDocs.delete(docId);
  }

  // ── Events ──

  /**
   * Register an event handler.
   * Events: open, close, error, joined, peer-joined, peer-left,
   *         peer-presence, signal, broadcast, yjs-sync
   */
  on(event, handler) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(handler);
    return this;
  }

  off(event, handler) {
    if (!this._handlers[event]) return this;
    this._handlers[event] = this._handlers[event].filter(h => h !== handler);
    return this;
  }

  // ── Internal ──

  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'joined':
        this.peerId = msg.peerId;
        this.roomId = msg.roomId;
        this.peers.clear();
        if (msg.peers) {
          for (const p of msg.peers) {
            this.peers.set(p.peerId, { nick: p.nick, state: p.state });
          }
        }
        this._emit('joined', msg);
        break;

      case 'peer-joined':
        this.peers.set(msg.peerId, { nick: msg.nick, state: msg.state || {} });
        this._emit('peer-joined', msg);
        break;

      case 'peer-left':
        this.peers.delete(msg.peerId);
        this._cleanupPeerConnection(msg.peerId);
        this._emit('peer-left', msg);
        break;

      case 'peer-presence':
        if (this.peers.has(msg.peerId)) {
          this.peers.get(msg.peerId).state = msg.state;
        }
        this._emit('peer-presence', msg);
        break;

      case 'signal':
        // Handle WebRTC signaling messages
        if (msg.payload && msg.payload.type) {
          this._handleSignaling(msg.from, msg.payload);
        }
        this._emit('signal', msg);
        break;

      case 'broadcast':
        this._emit('broadcast', msg);
        break;

      case 'yjs-sync':
        this._handleYjsSync(msg);
        this._emit('yjs-sync', msg);
        break;

      case 'error':
        this._emit('error', msg);
        break;

      default:
        break;
    }
  }

  _emit(event, data) {
    const handlers = this._handlers[event];
    if (handlers) {
      for (const h of handlers) {
        try { h(data); } catch { /* ignore handler errors */ }
      }
    }
  }

  // ── WebRTC internals ──

  async _getIceServers() {
    if (this._iceServers) return this._iceServers;
    try {
      this._iceServers = await this.getIceServers();
    } catch {
      this._iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }
    return this._iceServers;
  }

  async _handleSignaling(fromPeerId, payload) {
    if (payload.type === 'offer') {
      await this._handleOffer(fromPeerId, payload);
    } else if (payload.type === 'answer') {
      await this._handleAnswer(fromPeerId, payload);
    } else if (payload.type === 'ice-candidate') {
      await this._handleIceCandidate(fromPeerId, payload);
    } else if (payload.type === 'data') {
      // Fallback data via signaling
      this._emit('peer-data', { peerId: fromPeerId, data: payload.payload });
    }
  }

  async _handleOffer(fromPeerId, payload) {
    const iceServers = await this._getIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    const entry = { pc, dataChannel: null, iceServers };
    this._peerConnections.set(fromPeerId, entry);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signal(fromPeerId, { type: 'ice-candidate', candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this._cleanupPeerConnection(fromPeerId);
      }
    };

    pc.ontrack = (event) => {
      this._emit('peer-track', { peerId: fromPeerId, track: event.track, streams: event.streams });
    };

    // Handle incoming data channel from initiator
    pc.ondatachannel = (event) => {
      entry.dataChannel = event.channel;
      this._setupDataChannel(event.channel, fromPeerId);
    };

    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.signal(fromPeerId, { type: 'answer', sdp: pc.localDescription });
  }

  async _handleAnswer(fromPeerId, payload) {
    const entry = this._peerConnections.get(fromPeerId);
    if (entry && entry.pc) {
      await entry.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    }
  }

  async _handleIceCandidate(fromPeerId, payload) {
    const entry = this._peerConnections.get(fromPeerId);
    if (entry && entry.pc) {
      try {
        await entry.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch { /* ignore failed candidates */ }
    }
  }

  _setupDataChannel(dc, peerId) {
    dc.onopen = () => {
      this._emit('peer-connected', { peerId });
    };
    dc.onclose = () => {
      this._emit('peer-disconnected', { peerId });
    };
    dc.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this._emit('peer-data', { peerId, data });
      } catch {
        this._emit('peer-data', { peerId, data: event.data });
      }
    };
  }

  _cleanupPeerConnection(peerId) {
    const entry = this._peerConnections.get(peerId);
    if (entry) {
      if (entry.dataChannel) {
        try { entry.dataChannel.close(); } catch {}
      }
      if (entry.pc) {
        try { entry.pc.close(); } catch {}
      }
      this._peerConnections.delete(peerId);
    }
  }

  _closeAllPeerConnections() {
    for (const peerId of this._peerConnections.keys()) {
      this._cleanupPeerConnection(peerId);
    }
  }

  // ── Yjs internals ──

  _handleYjsSync(msg) {
    const ydoc = this._yjsDocs.get(msg.docId);
    if (!ydoc) return;

    if (msg.requestState) {
      // Peer is requesting full state — send our state vector
      try {
        const Y = ydoc.constructor; // Access Y module via the doc's constructor
        if (Y.encodeStateAsUpdate) {
          const state = Y.encodeStateAsUpdate(ydoc);
          const b64 = this._uint8ToBase64(state);
          this.yjsSync(msg.docId, b64);
        }
      } catch { /* Y module not available */ }
      return;
    }

    if (msg.update && msg.from !== this.peerId) {
      try {
        const update = this._base64ToUint8(msg.update);
        const Y = ydoc.constructor;
        if (Y.applyUpdate) {
          Y.applyUpdate(ydoc, update, 'remote');
        }
      } catch { /* invalid update — ignore */ }
    }
  }

  _uint8ToBase64(uint8) {
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    return btoa(binary);
  }

  _base64ToUint8(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

/**
 * SharedClock — a network-synced timeline clock for realtime apps.
 *
 * Every peer derives the SAME step from one anchor: `t0` (the unix-ms instant of
 * "step 0") plus a tempo. This is the reusable core that sequencer/jam/animation
 * apps kept re-implementing (Band Jam among them): the t0 math, the "don't let the
 * beat jump on a tempo change" re-anchor, and the sync handshake payloads.
 *
 * Not tied to music — `steps`/`subdiv` are just a division of a repeating bar; use
 * it for any looped shared timeline. Pair it with AimeatRealtime broadcasts:
 *
 *   const clock = new SharedClock({ bpm: 120, steps: 16 });
 *   clock.onStep((step) => { ... play or draw this step ... });
 *   // leader:  rt.broadcast(clock.start());      // {type:'transport',state:'play',t0,bpm}
 *   // joiner:  rt.broadcast({ type: 'sync-request' });
 *   rt.on('broadcast', ({ payload }) => {
 *     if (payload.type === 'sync-request' && clock.playing) rt.broadcast(clock.syncState());
 *     if (payload.type === 'sync-state' || payload.type === 'transport') clock.adopt(payload);
 *     if (payload.type === 'bpm') clock.setBpm(payload.bpm);
 *   });
 */
class SharedClock {
  /** @param {{bpm?:number, steps?:number, subdiv?:number, now?:()=>number}} [opts] */
  constructor(opts = {}) {
    this.bpm = opts.bpm || 120;
    this.steps = opts.steps || 16;      // steps per repeating bar
    this.subdiv = opts.subdiv || 4;     // steps per beat (4 = 16th notes)
    this._now = opts.now || (() => Date.now());
    this.t0 = null;                     // unix ms of step 0
    this.playing = false;
    this._lastStep = -1;
    this._timer = null;
    this._cbs = [];
  }

  /** ms per step at the current tempo. */
  stepMs() { return 60000 / this.bpm / this.subdiv; }

  /** Current step index (0..steps-1), or -1 if stopped / before t0. */
  step() {
    if (!this.playing || this.t0 == null) return -1;
    const elapsed = this._now() - this.t0;
    if (elapsed < 0) return -1;
    return ((Math.floor(elapsed / this.stepMs()) % this.steps) + this.steps) % this.steps;
  }

  /** Start (or restart) the clock at `t0`. Returns a `transport` payload to broadcast. */
  start(t0 = this._now()) {
    this.t0 = t0;
    this.playing = true;
    this._lastStep = -1;
    this._ensureTimer();
    return this.transport('play');
  }

  /** Stop. Returns a `transport` payload to broadcast. */
  stop() {
    this.playing = false;
    this._lastStep = -1;
    return this.transport('stop');
  }

  /** Change tempo WITHOUT making the current step jump (re-anchors t0). */
  setBpm(bpm) {
    if (!bpm || bpm === this.bpm) { this.bpm = bpm || this.bpm; return; }
    const cur = this.step();
    this.bpm = bpm;
    if (cur >= 0 && this.t0 != null) this.t0 = this._now() - cur * this.stepMs();
  }

  /** Adopt a peer's transport/sync-state (only takes t0/bpm you're given). */
  adopt(payload = {}) {
    if (payload.bpm) this.bpm = payload.bpm;
    if (payload.t0 != null) this.t0 = payload.t0;
    if ('transportPlaying' in payload) this.playing = !!payload.transportPlaying;
    else if ('state' in payload) this.playing = payload.state === 'play';
    if (this.playing) this._ensureTimer();
  }

  /** Register a callback fired once per step transition with the step index. */
  onStep(cb) { this._cbs.push(cb); this._ensureTimer(); return this; }

  /** Build the broadcast payloads (send these via rt.broadcast). */
  transport(state) { return { type: 'transport', state, t0: this.t0, bpm: this.bpm }; }
  syncState() { return { type: 'sync-state', t0: this.t0, bpm: this.bpm, transportPlaying: this.playing }; }

  /** Stop the internal ticker (call on teardown). */
  destroy() { if (this._timer) { clearInterval(this._timer); this._timer = null; } this._cbs = []; }

  _ensureTimer() {
    if (this._timer || typeof setInterval !== 'function') return;
    // 8ms poll → detect step transitions crisply without a callback per frame
    this._timer = setInterval(() => {
      if (!this.playing || this.t0 == null) return;
      const s = this.step();
      if (s !== this._lastStep) { this._lastStep = s; for (const cb of this._cbs) { try { cb(s); } catch { /* ignore */ } } }
    }, 8);
  }
}

// Export for both ESM and script tag usage
if (typeof globalThis !== 'undefined') {
  globalThis.AimeatRealtime = AimeatRealtime;
  globalThis.SharedClock = SharedClock;
}
