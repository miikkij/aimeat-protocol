// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/tunnel/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-tunnel.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/_core/config.js
  function cfg() {
    return window.__AIMEAT_SDK_CFG__ || { nodeId: "", baseUrl: "" };
  }
  function resolveNodeUrl() {
    const meta = document.querySelector('meta[name="aimeat-node"]');
    if (meta) return (meta.getAttribute("content") || "").replace(/\/$/, "");
    if (location.protocol === "http:" || location.protocol === "https:") return location.origin;
    return cfg().baseUrl;
  }
  var NODE_URL = resolveNodeUrl();
  var APEX_URL = cfg().baseUrl;
  var NODE_ID = cfg().nodeId;
  var HEARTBEAT_MS = cfg().heartbeatMs || 3e4;

  // src/static/sdk-libs/_core/session.js
  function getSession(libLabel) {
    const auth = window.AIMEAT && window.AIMEAT.auth;
    if (!auth) {
      throw new Error("AIMEAT.auth is required. Include aimeat-auth.js before " + (libLabel || "this library"));
    }
    const s = auth.getSession();
    if (!s) throw new Error("Not logged in. Call AIMEAT.auth.login() first.");
    return s;
  }
  function authFetch(path, opts, libLabel) {
    return getSession(libLabel).fetch(path, opts);
  }
  function makeSession(libLabel) {
    return {
      getSession: () => getSession(libLabel),
      authFetch: (path, opts) => authFetch(path, opts, libLabel)
    };
  }

  // src/static/sdk-libs/_core/namespace.js
  function namespace() {
    if (!window.AIMEAT) window.AIMEAT = {};
    return window.AIMEAT;
  }
  function attach(key, value) {
    const ns = namespace();
    ns[key] = value;
    return ns;
  }

  // src/static/sdk-libs/tunnel/index.js
  var { getSession: getSession2 } = makeSession("aimeat-tunnel.js");
  function uuid() {
    return crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      return (c === "x" ? r : r & 3 | 8).toString(16);
    });
  }
  function TunnelClient(opts) {
    this._opts = Object.assign({
      heartbeatIntervalMs: HEARTBEAT_MS,
      reconnect: true,
      reconnectBaseMs: 1e3,
      reconnectMaxMs: 6e4,
      reconnectJitter: true,
      maxReconnectAttempts: Infinity,
      requestTimeoutMs: 3e4,
      onRequest: null,
      // async (msg) => response_payload
      onMailbox: null,
      // (items) => void
      onDeliveryReceipt: null,
      // (receipt) => void
      onStatusChange: null,
      // (status: 'connecting'|'online'|'degraded'|'offline') => void
      onError: null
      // (error) => void
    }, opts || {});
    this._ws = null;
    this._status = "offline";
    this._heartbeatTimer = null;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._pendingResponses = /* @__PURE__ */ new Map();
    this._closed = false;
    this._lastHeartbeatAck = 0;
    this._serverConfig = null;
  }
  TunnelClient.prototype._setStatus = function(status) {
    if (this._status !== status) {
      this._status = status;
      if (this._opts.onStatusChange) {
        try {
          this._opts.onStatusChange(status);
        } catch (e) {
          console.error("[aimeat-tunnel] onStatusChange error:", e);
        }
      }
    }
  };
  TunnelClient.prototype.connect = function() {
    if (this._closed) return;
    this._setStatus("connecting");
    var session = getSession2();
    var wsUrl = NODE_URL.replace(/^http/, "ws") + "/v1/personal/tunnel?token=" + encodeURIComponent(session.jwt);
    var self = this;
    try {
      this._ws = new WebSocket(wsUrl);
    } catch (e) {
      this._setStatus("offline");
      if (this._opts.onError) this._opts.onError(e);
      this._scheduleReconnect();
      return;
    }
    this._ws.onopen = function() {
      self._reconnectAttempts = 0;
      self._lastHeartbeatAck = Date.now();
      self._setStatus("online");
      self._startHeartbeat();
    };
    this._ws.onmessage = function(event) {
      try {
        var msg = JSON.parse(event.data);
        self._handleMessage(msg);
      } catch (e) {
        console.error("[aimeat-tunnel] Invalid message:", e);
      }
    };
    this._ws.onclose = function() {
      self._cleanup();
      self._setStatus("offline");
      if (!self._closed) {
        self._scheduleReconnect();
      }
    };
    this._ws.onerror = function(err) {
      if (self._opts.onError) self._opts.onError(err);
    };
  };
  TunnelClient.prototype._handleMessage = function(msg) {
    switch (msg.type) {
      case "welcome":
        this._handleWelcome(msg);
        break;
      case "request":
        this._handleRequest(msg);
        break;
      case "heartbeat_ack":
        this._lastHeartbeatAck = Date.now();
        break;
      case "mailbox_sync":
        this._handleMailboxSync(msg);
        break;
      case "delivery_receipt":
        if (this._opts.onDeliveryReceipt && msg.payload) {
          try {
            this._opts.onDeliveryReceipt(JSON.parse(msg.payload));
          } catch {
          }
        }
        break;
      case "response": {
        var pending = this._pendingResponses.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this._pendingResponses.delete(msg.id);
          pending.resolve(msg);
        }
        break;
      }
      default:
        console.warn("[aimeat-tunnel] Unknown message type:", msg.type);
    }
  };
  TunnelClient.prototype._handleWelcome = function(msg) {
    if (!msg.payload) return;
    try {
      this._serverConfig = JSON.parse(msg.payload);
      if (this._serverConfig.heartbeat_interval_ms) {
        this._opts.heartbeatIntervalMs = this._serverConfig.heartbeat_interval_ms;
        if (this._heartbeatTimer) this._startHeartbeat();
      }
      if (this._serverConfig.reconnect_hint) {
        var hint = this._serverConfig.reconnect_hint;
        if (hint.base_ms) this._opts.reconnectBaseMs = hint.base_ms;
        if (hint.max_ms) this._opts.reconnectMaxMs = hint.max_ms;
        if (hint.jitter !== void 0) this._opts.reconnectJitter = hint.jitter;
      }
    } catch (e) {
      console.error("[aimeat-tunnel] Welcome parse error:", e);
    }
  };
  TunnelClient.prototype._handleRequest = async function(msg) {
    if (!this._opts.onRequest) {
      this._sendResponse(msg.id, null);
      return;
    }
    try {
      var result = await this._opts.onRequest({
        id: msg.id,
        from: msg.from,
        to: msg.to,
        payload: msg.payload ? JSON.parse(msg.payload) : null,
        timestamp: msg.timestamp
      });
      this._sendResponse(msg.id, result);
    } catch (e) {
      console.error("[aimeat-tunnel] onRequest handler error:", e);
      this._sendResponse(msg.id, { error: e.message || "Handler error" });
    }
  };
  TunnelClient.prototype._sendResponse = function(requestId, payload) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    this._ws.send(JSON.stringify({
      type: "response",
      id: requestId,
      payload: payload != null ? JSON.stringify(payload) : null,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    }));
  };
  TunnelClient.prototype._handleMailboxSync = function(msg) {
    if (!msg.payload) return;
    try {
      var data = JSON.parse(msg.payload);
      var items = data.mailbox_items || [];
      if (this._opts.onMailbox && items.length > 0) {
        this._opts.onMailbox(items.map(function(item) {
          return {
            id: item.id,
            type: item.type,
            from: item.from,
            to: item.to,
            payload: item.payload ? JSON.parse(item.payload) : null,
            created_at: item.created_at
          };
        }));
      }
      if (items.length > 0) {
        var itemIds = items.map(function(i) {
          return i.id;
        });
        this._send({
          type: "mailbox_ack",
          id: uuid(),
          payload: JSON.stringify(itemIds),
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    } catch (e) {
      console.error("[aimeat-tunnel] Mailbox sync error:", e);
    }
  };
  TunnelClient.prototype._startHeartbeat = function() {
    this._stopHeartbeat();
    var self = this;
    var interval = this._opts.heartbeatIntervalMs;
    this._heartbeatTimer = setInterval(function() {
      if (!self._ws || self._ws.readyState !== WebSocket.OPEN) return;
      var sinceLast = Date.now() - self._lastHeartbeatAck;
      if (sinceLast > interval * 3) {
        console.warn("[aimeat-tunnel] Heartbeat ack timeout (" + sinceLast + "ms), reconnecting...");
        self._ws.close(4e3, "heartbeat_timeout");
        return;
      }
      self._send({
        type: "heartbeat",
        id: uuid(),
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }, interval);
  };
  TunnelClient.prototype._stopHeartbeat = function() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  };
  TunnelClient.prototype._scheduleReconnect = function() {
    if (this._closed || !this._opts.reconnect) return;
    if (this._reconnectAttempts >= this._opts.maxReconnectAttempts) {
      console.error("[aimeat-tunnel] Max reconnect attempts reached (" + this._opts.maxReconnectAttempts + ")");
      if (this._opts.onError) this._opts.onError(new Error("Max reconnect attempts reached"));
      return;
    }
    var base = this._opts.reconnectBaseMs;
    var max = this._opts.reconnectMaxMs;
    var attempt = this._reconnectAttempts;
    var delay = Math.min(base * Math.pow(2, attempt), max);
    if (this._opts.reconnectJitter) {
      var jitter = delay * 0.25 * (Math.random() * 2 - 1);
      delay = Math.max(base, delay + jitter);
    }
    var self = this;
    this._reconnectAttempts++;
    console.log("[aimeat-tunnel] Reconnecting in " + Math.round(delay) + "ms (attempt " + this._reconnectAttempts + ")");
    this._reconnectTimer = setTimeout(function() {
      self._reconnectTimer = null;
      self.connect();
    }, delay);
  };
  TunnelClient.prototype._send = function(msg) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(msg));
    }
  };
  TunnelClient.prototype.sendRequest = function(payload, timeoutMs) {
    var self = this;
    var timeout = timeoutMs || this._opts.requestTimeoutMs;
    var id = uuid();
    return new Promise(function(resolve, reject) {
      if (!self._ws || self._ws.readyState !== WebSocket.OPEN) {
        return reject(new Error("Tunnel not connected"));
      }
      var timer = setTimeout(function() {
        self._pendingResponses.delete(id);
        reject(new Error("Request timeout (" + timeout + "ms)"));
      }, timeout);
      self._pendingResponses.set(id, { resolve, timer });
      self._send({
        type: "request",
        id,
        payload: JSON.stringify(payload),
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
  };
  TunnelClient.prototype._cleanup = function() {
    this._stopHeartbeat();
    for (var entry of this._pendingResponses.values()) {
      clearTimeout(entry.timer);
      entry.resolve(null);
    }
    this._pendingResponses.clear();
  };
  TunnelClient.prototype.close = function() {
    this._closed = true;
    this._cleanup();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      this._send({
        type: "disconnect",
        id: uuid(),
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      try {
        this._ws.close(1e3, "client_close");
      } catch {
      }
      this._ws = null;
    }
    this._setStatus("offline");
  };
  TunnelClient.prototype.isOnline = function() {
    return this._status === "online";
  };
  TunnelClient.prototype.getStatus = function() {
    return this._status;
  };
  TunnelClient.prototype.getReconnectAttempts = function() {
    return this._reconnectAttempts;
  };
  TunnelClient.prototype.getServerConfig = function() {
    return this._serverConfig;
  };
  var tunnel = {
    // Create and connect a tunnel client
    connect: function(opts) {
      var client = new TunnelClient(opts);
      client.connect();
      return client;
    },
    // Create without auto-connecting
    create: function(opts) {
      return new TunnelClient(opts);
    },
    // Version
    version: "1.0.0"
  };
  attach("tunnel", tunnel);
})();
