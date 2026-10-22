/**
 * @file realtime.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AimeatRealtime — browser client for AIMEAT P2P realtime rooms (WS rooms +
 *   WebRTC data channels + Yjs CRDT sync) and SharedClock (network-synced timeline).
 * @version-history
 *   v1.5.0 — 2026-10-22 — What Band Jam had to build itself, for every realtime app. A broadcast or a
 *     signal whose JSON is over FRAME_LIMIT (10 000 characters; the relay refuses frames over 16 KB) is
 *     sent as 'part' frames and joined again on the other side before any handler sees it. pace(n)
 *     keeps broadcasts and signals under n frames a second (the relay drops a peer's frames over 50 a
 *     second) by queueing instead of dropping. SharedClock measures every peer's clock offset
 *     (measure(rt): clock-ping / clock-pong signals, the shortest round trip wins), converts a peer's
 *     t0 to this clock (adopt(payload, fromPeerId)), and schedules steps ahead of time
 *     (schedule(cb, { lookahead, audio }): each step once, early enough to place it on an
 *     AudioContext with AIMEAT.audio.play(..., { when })).
 *   v1.4.0 — 2026-10-09 — connect() no longer puts the session token in the socket URL, where reverse
 *     proxies logged it (secrets audit 2026-10-09, d3): it POSTs /v1/ws/ticket for a single-use
 *     ticket and connects with ?ticket=. connect() now returns a promise (it never rejects); frames
 *     sent while the ticket is fetched are queued like frames sent while the socket opens.
 *   v1.3.0 — 2026-09-13 — Frames sent while the socket is still opening are queued and sent on open
 *     instead of dropped, and a 'joined' handler registered after the join is called with it. The
 *     usage example below had shown connect() before on() and broadcast(), the order that lost both.
 *   v1.2.0 — 2026-07-19 — constructor also accepts an options object ({ session } or
 *     { baseUrl, token }); positional (baseUrl, token) unchanged — existing apps unaffected
 *   v1.1.0 — 2026-07-18 — SharedClock added (extracted from the Band Jam pattern)
 *   v1.0.0 — 2026-03-03 — initial WS rooms + WebRTC + Yjs client
 *
 * Usage (handlers first, then connect; a late 'joined' handler still gets the join):
 *   const rt = new AimeatRealtime('https://node.example.com', token);
 *   // or equivalently: new AimeatRealtime({ session })   (uses session.jwt + page origin)
 *   const room = await rt.createRoom({ app_type: 'whiteboard', name: 'My Board' });
 *   rt.on('joined', (msg) => console.log('In the room as', msg.peerId));
 *   rt.on('peer-joined', (msg) => console.log('New peer:', msg.nick));
 *   rt.connect(room.id, 'Alice');
 *   rt.broadcast({ draw: { x: 10, y: 20 } });   // queued until the socket opens
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
    // The last 'joined' frame of the live socket, handed to a 'joined' handler registered after it
    // arrived; and the frames sent while the socket was still opening, sent once it opens.
    this._lastJoined = null;
    this._outbox = [];
    // connect() counter and "fetching the socket ticket" flag: a frame sent meanwhile is queued, and
    // a ticket that arrives after disconnect() or a newer connect() opens nothing.
    this._attempt = 0;
    this._opening = false;
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

  /**
   * Join a room. The session token never goes in the socket URL, which reverse proxies log: with a
   * token, the client first POSTs /v1/ws/ticket for a single-use 60-second ticket and connects with
   * ?ticket=. Without a token (anonymous mode) it connects bare. Returns a promise that resolves once
   * the socket is being opened; it never rejects, a failure arrives as 'error' and 'close' events.
   * Frames sent before the socket opens are queued, as before.
   */
  connect(roomId, nick = 'anonymous') {
    if (this.ws || this._opening) this.disconnect();

    this.roomId = roomId;
    this._lastJoined = null;
    this._outbox = [];
    const attempt = ++this._attempt;
    this._opening = true;
    const protocol = this.baseUrl.startsWith('https') ? 'wss' : 'ws';
    const host = this.baseUrl.replace(/^https?:\/\//, '');
    const base = `${protocol}://${host}/v1/realtime/ws?room=${encodeURIComponent(roomId)}&nick=${encodeURIComponent(nick)}`;

    const ticket = this.token ? this._socketTicket() : Promise.resolve(null);
    return ticket.then((t) => {
      if (attempt !== this._attempt) return; // disconnect() or a newer connect() came first
      this._opening = false;
      this._open(t ? `${base}&ticket=${encodeURIComponent(t)}` : base);
    }, (err) => {
      if (attempt !== this._attempt) return;
      this._opening = false;
      this._outbox = [];
      this._emit('error', { error: err });
      this._emit('close', { code: 4401, reason: err && err.message ? err.message : 'ticket refused' });
    });
  }

  /** POST /v1/ws/ticket: a single-use ticket for the realtime socket, minted with the session token. */
  async _socketTicket() {
    const res = await fetch(`${this.baseUrl}/v1/ws/ticket`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ socket: 'realtime' }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !json.ok) throw new Error((json && json.error && json.error.message) || `Socket ticket refused (HTTP ${res.status})`);
    return json.data.ticket;
  }

  _open(url) {
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      // What the app sent before the socket finished opening goes out now, in order.
      const queued = this._outbox.splice(0);
      for (const m of queued) this._send(m);
      this._emit('open', {});
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this._handleMessage(msg);
      } catch { /* ignore malformed */ }
    };

    this.ws.onclose = (event) => {
      this.peerId = null;
      this.peers.clear();
      this._lastJoined = null;
      this._outbox = [];
      this._emit('close', { code: event.code, reason: event.reason });
    };

    this.ws.onerror = (event) => {
      this._emit('error', { error: event });
    };
  }

  disconnect() {
    // A connect() still waiting for its ticket opens nothing once this has run.
    this._attempt++;
    this._opening = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.peerId = null;
      this.peers.clear();
    }
    this._lastJoined = null;
    this._outbox = [];
    if (this._paceTimer) { clearTimeout(this._paceTimer); this._paceTimer = null; }
    this._paceQueue = [];
    this._parts = new Map();
    this._closeAllPeerConnections();
    this._yjsDocs.clear();
  }

  // ── Messaging ──

  broadcast(payload) {
    const parts = this._chunk(payload);
    if (parts) { for (const p of parts) this._send({ type: 'broadcast', payload: p }); return; }
    this._send({ type: 'broadcast', payload });
  }

  signal(toPeerId, payload) {
    const parts = this._chunk(payload);
    if (parts) { for (const p of parts) this._send({ type: 'signal', to: toPeerId, payload: p }); return; }
    this._send({ type: 'signal', to: toPeerId, payload });
  }

  /**
   * Keep broadcasts and signals under `perSecond` frames a second: the relay drops a peer's frames
   * over 50 a second, so a burst (a big song split in parts, a held key) waits its turn instead.
   * 0 turns pacing off (the default: a game sending every frame wants them now or never).
   */
  pace(perSecond) {
    this._paceMs = perSecond > 0 ? 1000 / perSecond : 0;
    return this;
  }

  // A payload too big for one relay frame → 'part' frames ({type:'part', mid, i, n, s}); null when it fits.
  _chunk(payload) {
    let text;
    try { text = JSON.stringify(payload); } catch { return null; }
    if (typeof text !== 'string' || text.length <= AimeatRealtime.FRAME_LIMIT) return null;
    const n = Math.ceil(text.length / AimeatRealtime.FRAME_LIMIT);
    if (n > AimeatRealtime.MAX_PARTS) {
      this._emit('error', { type: 'error', code: 'MESSAGE_TOO_LARGE', message: 'A frame of ' + text.length + ' characters is more than ' + AimeatRealtime.MAX_PARTS + ' parts.' });
      return [];
    }
    const mid = Math.random().toString(36).slice(2, 10);
    const out = [];
    for (let i = 0; i < n; i++) out.push({ type: 'part', mid, i, n, s: text.slice(i * AimeatRealtime.FRAME_LIMIT, (i + 1) * AimeatRealtime.FRAME_LIMIT) });
    return out;
  }

  // A 'part' frame: kept until its frame is whole, then the whole frame (or null while waiting).
  _join(from, p) {
    if (!this._parts) this._parts = new Map();
    const now = Date.now();
    for (const [k, v] of this._parts) if (now - v.at > 30000) this._parts.delete(k);
    if (typeof p.mid !== 'string' || !Number.isInteger(p.i) || !Number.isInteger(p.n) || p.n < 1
      || p.n > AimeatRealtime.MAX_PARTS || p.i < 0 || p.i >= p.n || typeof p.s !== 'string') return null;
    const key = from + ':' + p.mid;
    let e = this._parts.get(key);
    if (!e) { e = { at: now, n: p.n, got: 0, chunks: new Array(p.n) }; this._parts.set(key, e); }
    if (e.n !== p.n || e.chunks[p.i] !== undefined) return null;
    e.chunks[p.i] = p.s; e.got++;
    if (e.got < e.n) return null;
    this._parts.delete(key);
    try { return JSON.parse(e.chunks.join('')); } catch { return null; }
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
    // 'joined' arrives the moment the socket opens, so a handler written after connect() used to
    // wait for a frame that had already gone by. The live socket's join is handed to it now.
    if (event === 'joined' && this._lastJoined) {
      try { handler(this._lastJoined); } catch { /* ignore handler errors */ }
    }
    return this;
  }

  off(event, handler) {
    if (!this._handlers[event]) return this;
    this._handlers[event] = this._handlers[event].filter(h => h !== handler);
    return this;
  }

  // ── Internal ──

  _send(msg) {
    if (this._paceMs && this.ws && this.ws.readyState === WebSocket.OPEN && (msg.type === 'broadcast' || msg.type === 'signal')) {
      this._paced(msg);
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else if ((this._opening || (this.ws && this.ws.readyState === WebSocket.CONNECTING)) && this._outbox.length < 200) {
      // Sent before the socket opened (or while its ticket is being fetched): kept and sent on open
      // instead of dropped in silence.
      this._outbox.push(msg);
    }
  }

  // Paced sending: one frame per _paceMs, the rest in order behind it (at most 400 waiting).
  _paced(msg) {
    if (!this._paceQueue) this._paceQueue = [];
    if (this._paceQueue.length >= 400) { this._emit('error', { type: 'error', code: 'RATE_LIMITED', message: 'More than 400 frames are waiting to be sent.' }); return; }
    this._paceQueue.push(msg);
    const pump = () => {
      this._paceTimer = null;
      while (this._paceQueue.length) {
        const now = Date.now();
        if ((this._nextSendAt || 0) > now) { this._paceTimer = setTimeout(pump, this._nextSendAt - now); return; }
        const m = this._paceQueue.shift();
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { this._paceQueue.length = 0; return; }
        this.ws.send(JSON.stringify(m));
        this._nextSendAt = Math.max(now, this._nextSendAt || 0) + this._paceMs;
      }
    };
    if (!this._paceTimer) pump();
  }

  _handleMessage(msg) {
    // A frame that came in parts is handled once it is whole, as the frame it was.
    if ((msg.type === 'broadcast' || msg.type === 'signal') && msg.payload && msg.payload.type === 'part') {
      const whole = this._join(msg.from, msg.payload);
      if (!whole) return;
      msg = { ...msg, payload: whole };
    }
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
        this._lastJoined = msg;
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
 *   rt.on('broadcast', ({ from, payload }) => {
 *     if (payload.type === 'sync-request' && clock.playing) rt.broadcast(clock.syncState());
 *     if (payload.type === 'sync-state' || payload.type === 'transport') clock.adopt(payload, from);
 *     if (payload.type === 'bpm') clock.setBpm(payload.bpm);
 *   });
 *
 * Two machines' clocks disagree by tens or hundreds of ms. clock.measure(rt) pings every peer
 * (clock-ping / clock-pong signals, the shortest round trip wins) so adopt(payload, from) turns the
 * sender's t0 into this machine's. To play in time, schedule a little ahead on the audio clock:
 *
 *   clock.measure(rt);
 *   clock.schedule((n, atMs, atAudio) => AIMEAT.audio.play('drums', n % 4 ? 'hihat' : 'kick', { when: atAudio }),
 *     { audio: AIMEAT.audio.context });
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
    this._offsets = new Map();          // peerId → { off, rtt }: their clock minus mine
    this._sched = null;
  }

  // ── Clock offsets ──

  /**
   * Measure this machine's clock against every peer in `rt` (an AimeatRealtime): on join, on each
   * new peer, and again every `every` ms (default 15 s). Answers the peers' pings too.
   */
  measure(rt, opts = {}) {
    if (this._rt) return this;
    this._rt = rt;
    const pingAll = (times) => { for (const id of rt.peers.keys()) this.ping(id, times); };
    this._onSignal = (msg) => {
      const p = msg && msg.payload;
      if (!p || !msg.from) return;
      if (p.type === 'clock-ping' && typeof p.t === 'number') rt.signal(msg.from, { type: 'clock-pong', t1: p.t, t2: this._now() });
      else if (p.type === 'clock-pong' && typeof p.t1 === 'number' && typeof p.t2 === 'number') this._pong(msg.from, p.t1, p.t2);
    };
    this._onJoined = () => pingAll(5);
    this._onPeerJoined = (msg) => { if (msg && msg.peerId) this.ping(msg.peerId, 5); };
    this._onPeerLeft = (msg) => { if (msg && msg.peerId) this._offsets.delete(msg.peerId); };
    rt.on('signal', this._onSignal);
    rt.on('joined', this._onJoined);
    rt.on('peer-joined', this._onPeerJoined);
    rt.on('peer-left', this._onPeerLeft);
    if (typeof setInterval === 'function') this._pingTimer = setInterval(() => pingAll(2), opts.every || 15000);
    return this;
  }

  /** Send `times` clock pings to one peer, 150 ms apart. */
  ping(peerId, times = 3) {
    if (!this._rt) return;
    for (let i = 0; i < times; i++) {
      const send = () => this._rt && this._rt.signal(peerId, { type: 'clock-ping', t: this._now() });
      if (i === 0 || typeof setTimeout !== 'function') send(); else setTimeout(send, i * 150);
    }
  }

  _pong(peerId, t1, t2) {
    const now = this._now();
    const rtt = now - t1;
    if (!(rtt >= 0 && rtt < 10000)) return;
    const off = t2 - (t1 + now) / 2;
    const cur = this._offsets.get(peerId);
    if (!cur || rtt <= cur.rtt * 1.2) this._offsets.set(peerId, { off: cur && rtt > cur.rtt ? (cur.off + off) / 2 : off, rtt: cur ? Math.min(rtt, cur.rtt) : rtt });
  }

  /** A peer's clock minus this one, in ms (0 until measured). */
  offsetOf(peerId) { const o = this._offsets.get(peerId); return o ? o.off : 0; }
  /** The shortest round trip to a peer, in ms (null until measured). */
  rttOf(peerId) { const o = this._offsets.get(peerId); return o ? o.rtt : null; }
  /** An instant on a peer's clock, on this machine's. */
  toLocal(t, peerId) { return peerId ? t - this.offsetOf(peerId) : t; }

  // ── Steps on the clock ──

  /** Absolute step n (not wrapped to the bar) → the local ms it starts at. */
  stepTime(n) { return this.t0 == null ? null : this.t0 + n * this.stepMs(); }
  /** The absolute step at a local instant (fractional), or null before start. */
  stepAt(t = this._now()) { return this.t0 == null ? null : (t - this.t0) / this.stepMs(); }

  /**
   * Call cb(n, atMs, atAudio) once for every absolute step n, `lookahead` ms before it starts
   * (default 120; 1600 while the tab is hidden, whose timers fire about once a second). With
   * opts.audio (an AudioContext), atAudio is that step on its clock, for play(..., { when }).
   * cb null stops scheduling. A tempo change or a new t0 re-plans from the next step.
   */
  schedule(cb, opts = {}) {
    if (this._sched) { clearInterval(this._sched.timer); this._sched = null; }
    if (!cb || typeof setInterval !== 'function') return this;
    const sc = { cb, opts, next: null, key: '' };
    sc.timer = setInterval(() => this._tick(sc), opts.interval || 25);
    this._sched = sc;
    this._tick(sc);
    return this;
  }

  _tick(sc) {
    if (!this.playing || this.t0 == null) { sc.next = null; sc.last = null; return; }
    const key = this.t0 + ':' + this.bpm;
    const now = this._now();
    const hidden = typeof document !== 'undefined' && document.hidden;
    const ahead = sc.opts.lookahead != null ? sc.opts.lookahead : (hidden ? 1600 : 120);
    if (sc.key !== key) { sc.key = key; sc.next = null; }   // a new anchor or tempo: plan again
    if (sc.next === null) {
      const from = Math.max(0, Math.ceil(this.stepAt(now) - 0.05));   // nothing before step 0
      // A tempo change keeps the step count running (setBpm re-anchors): carry on right after the
      // last step already placed instead of placing it twice. A new start begins where the clock is.
      sc.next = sc.last != null && sc.last + 1 >= from - 2 && sc.last + 1 <= from + 8 ? sc.last + 1 : from;
    }
    for (let guard = 0; guard < 256; guard++) {
      const at = this.stepTime(sc.next);
      if (at > now + ahead) break;
      if (at >= now - 40) {
        const audio = sc.opts.audio;
        const atAudio = audio ? audio.currentTime + Math.max(0, (at - now) / 1000) : null;
        try { sc.cb(sc.next, at, atAudio); } catch { /* a step's error does not stop the clock */ }
      }
      sc.last = sc.next;
      sc.next++;
    }
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

  /**
   * Adopt a peer's transport/sync-state (only takes t0/bpm you're given). With the sender's peer id,
   * its t0 is turned into this machine's clock (measure() first).
   */
  adopt(payload = {}, fromPeerId) {
    if (payload.bpm) this.bpm = payload.bpm;
    if (payload.t0 != null) this.t0 = this.toLocal(payload.t0, fromPeerId);
    if ('transportPlaying' in payload) this.playing = !!payload.transportPlaying;
    else if ('state' in payload) this.playing = payload.state === 'play';
    if (this.playing) this._ensureTimer();
  }

  /** Register a callback fired once per step transition with the step index. */
  onStep(cb) { this._cbs.push(cb); this._ensureTimer(); return this; }

  /** Build the broadcast payloads (send these via rt.broadcast). */
  transport(state) { return { type: 'transport', state, t0: this.t0, bpm: this.bpm }; }
  syncState() { return { type: 'sync-state', t0: this.t0, bpm: this.bpm, transportPlaying: this.playing }; }

  /** Stop the internal tickers and the measuring (call on teardown). */
  destroy() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._sched) { clearInterval(this._sched.timer); this._sched = null; }
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
    if (this._rt) {
      this._rt.off('signal', this._onSignal); this._rt.off('joined', this._onJoined);
      this._rt.off('peer-joined', this._onPeerJoined); this._rt.off('peer-left', this._onPeerLeft);
      this._rt = null;
    }
    this._cbs = [];
  }

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

// The relay refuses frames over 16 KB: a payload's JSON over FRAME_LIMIT characters goes in parts
// (escaping inside a part can grow it, hence the margin), at most MAX_PARTS of them.
AimeatRealtime.FRAME_LIMIT = 10000;
AimeatRealtime.MAX_PARTS = 200;

// Export for both ESM and script tag usage
if (typeof globalThis !== 'undefined') {
  globalThis.AimeatRealtime = AimeatRealtime;
  globalThis.SharedClock = SharedClock;
}
