/**
 * @file phaser/net.js
 * @description Two people playing the same game, over the node's own realtime rooms. This is the
 *   glue every multiplayer game here would otherwise write again: find or make the room, join it,
 *   keep a list of who is in it, decide which of them is the host, and get one player's input to
 *   the others often enough to play and rarely enough to arrive.
 *
 *   IT BROADCASTS INPUT AND STATE, NEVER FRAMES. What goes on the wire is "this player is holding
 *   left and jump" and, from the host, "here is where everything is". Each peer runs its own copy
 *   of the game on those inputs. A game that tries to send positions every frame is what the
 *   node's rate limit is there to stop, and what makes a match unplayable on a phone.
 *
 *   INPUT IS THROTTLED AND CHANGE-GATED. sendInput() sends at most one packet per `rate` (30ms by
 *   default) and only when the input DIFFERS from the last one sent, so a player holding right for
 *   ten seconds costs one packet. A change that lands inside the window is not dropped: it is held
 *   and sent as the window closes, which is what keeps the last input of a press from going
 *   missing. sendState() has its own, slower window for the host's snapshots.
 *
 *   THERE IS NO TRUSTED SENDER. The room's broadcast carries exactly the payload the sender
 *   passed, and nothing the server vouches for, so the sender's id travels INSIDE the payload and
 *   is worth what the sender is worth. Treat a peer id as a label, never as an authority: the host
 *   decides what is true about the shared world, which is the whole point of electing one.
 *
 *   THE HOST IS THE LOWEST PEER ID PRESENT. Every peer sorts the same list of ids the same way and
 *   reaches the same answer with no election traffic at all, and when the host leaves the next id
 *   up takes over on its own.
 *
 *   EVERY HANDLER IS REGISTERED BEFORE connect(). The realtime client dispatches 'joined' the
 *   moment the socket answers, so a handler added after the connect call misses the message that
 *   tells it who it is. That is the documented trap in the realtime pack, and it is why the whole
 *   wiring happens in one place here.
 * @structure PACKET kinds · realtimeClass / sessionToken · net(spec) returning connect / leave /
 *   peers / sendInput / sendState / send / isHost / id / destroy
 * @usage
 *   const link = AIMEAT.phaser.net({ room: 'ridge-1', app: 'ridge',
 *     onPeer: (p, joined) => console.log(p.name, joined), onInput: (id, i) => remote[id] = i });
 *   await link.connect();
 *   // in update(): link.sendInput({ l: c.left, r: c.right, j: c.jump });
 * @version-history
 *   v1.1.0 — 2026-09-02 — Initial: find-or-create rooms, lowest-id host election, the throttled
 *     change-gated input channel and the piggybacked latency echo.
 */
import { NODE_URL } from '../_core/config.js';

/** What a packet is for. One letter, because this is the field sent most often on the wire. */
const INPUT = 'i';
const STATE = 's';
const MESSAGE = 'm';

/** How often input goes out, and how often the host's snapshots do, when nobody says otherwise. */
const INPUT_RATE = 30;
const STATE_RATE = 100;

/** How long a join is given before it is called a failure and said so in words. */
const JOIN_MS = 12000;

/** The realtime client the page loaded, or null when it did not. */
function realtimeClass() {
  const root = typeof window !== 'undefined' ? /** @type {any} */ (window) : null;
  return root && typeof root.AimeatRealtime === 'function' ? root.AimeatRealtime : null;
}

/**
 * The signed-in session's token. A room belongs to an account, so there is no guest path here:
 * without a token the socket has nothing to present and the node refuses it.
 * @returns {string|null}
 */
function sessionToken() {
  const root = typeof window !== 'undefined' ? /** @type {any} */ (window).AIMEAT : null;
  const auth = root && root.auth;
  if (!auth || typeof auth.getSession !== 'function') return null;
  try {
    const s = auth.getSession();
    return (s && s.jwt) || null;
  } catch (err) {
    console.warn('[aimeat-phaser] auth.getSession failed, so there is no room to join:', err);
    return null;
  }
}

/** The lowest id in a list, compared as text so every peer sorts it the same way. */
function lowest(ids) {
  let best = null;
  for (const id of ids) {
    const s = String(id);
    if (best === null || s < best) best = s;
  }
  return best;
}

/**
 * @typedef {object} NetSpec
 * @property {string} room   the room's NAME. Peers that ask for the same name in the same app
 *   converge on one room, whichever of them arrives first.
 * @property {string} app    the app type the room is filed under, which is what keeps two
 *   different games from meeting in a room that happens to share a name.
 * @property {string} [name] what this player is called in the room. Default 'player'.
 * @property {number} [rate] milliseconds between input packets. Default 30.
 * @property {(peer: { id: string, name: string }, joined: boolean) => void} [onPeer]
 * @property {(peerId: string, input: any) => void} [onInput]
 * @property {(peerId: string, state: any) => void} [onState]
 * @property {(peerId: string, msg: any) => void} [onMessage]
 * @property {(reason: { code?: number, reason?: string }) => void} [onClose]
 */

/**
 * @typedef {object} NetHandle
 * @property {() => Promise<{ id: string, room: string, isHost: boolean }>} connect
 * @property {() => void} leave
 * @property {() => Array<{ id: string, name: string, latency?: number }>} peers
 * @property {(input: any) => boolean} sendInput
 * @property {(state: any, opts?: { every?: number }) => boolean} sendState
 * @property {(msg: any) => boolean} send
 * @property {() => boolean} isHost
 * @property {() => string|null} id
 * @property {() => void} destroy
 */

/**
 * The multiplayer link for one game.
 * @param {NetSpec} spec
 * @returns {NetHandle}
 */
export function net(spec) {
  const s = spec || /** @type {NetSpec} */ ({});
  const rate = Math.max(10, typeof s.rate === 'number' && isFinite(s.rate) ? s.rate : INPUT_RATE);
  const nick = s.name || 'player';

  /** @type {any} the realtime client, once connect() has made one. */
  let rt = null;
  /** @type {string|null} */
  let me = null;
  /** @type {string|null} */
  let roomId = null;
  /** @type {string|null} the host as it stands, so a change is announced once rather than asked. */
  let host = null;
  let dead = false;

  /** Everyone in the room INCLUDING this player, because the host election needs the full list. */
  /** @type {Map<string, { id: string, name: string, latency?: number }>} */
  const roster = new Map();

  /** The last packet we saw from anyone, echoed back so that peer can measure its round trip. */
  /** @type {[string, number]|null} */
  let echo = null;

  /** The two send windows. Each keeps what it could not send yet and a timer to send it with.
   *  `hasHeld` is a flag rather than a null check, because null is a value a caller may send. */
  const inputWindow = { last: '', at: 0, timer: 0, held: /** @type {any} */ (null), hasHeld: false };
  const stateWindow = { at: 0, timer: 0, held: /** @type {any} */ (null), hasHeld: false, every: STATE_RATE };

  /** @type {Array<[string, (msg: any) => void]>} every handler registered, so destroy() can undo it. */
  const wired = [];

  /**
   * Call one of the spec's handlers without letting it take the socket down with it.
   * @param {string} which
   * @param {any[]} args
   */
  function tell(which, args) {
    const fn = /** @type {any} */ (s)[which];
    if (typeof fn !== 'function') return;
    try {
      fn.apply(null, args);
    } catch (err) {
      console.warn('[aimeat-phaser] the net ' + which + ' handler threw:', err);
    }
  }

  /** Who the host is now. Every peer runs this over the same roster and gets the same answer, so
   *  the election costs no traffic and a host leaving needs no hand-over. */
  function elect() {
    host = lowest(Array.from(roster.keys()));
  }

  /**
   * Put one packet on the wire. Every packet carries the sender's own id and clock, plus the last
   * stamp we saw from someone else so they can measure the round trip without a ping of their own.
   * @param {string} kind
   * @param {any} data
   * @returns {boolean} whether it went
   */
  function put(kind, data) {
    if (dead || !rt || !me) return false;
    /** @type {any} */
    const packet = { k: kind, f: me, t: Date.now(), d: data };
    if (echo) packet.e = echo;
    rt.broadcast(packet);
    return true;
  }

  /**
   * A packet has arrived. The sender's id is the one INSIDE the payload, which is the sender's
   * own word for it; there is no trusted field to compare it against, so it is used as a label
   * and nothing more.
   * @param {any} msg
   */
  function onBroadcast(msg) {
    const p = msg && msg.payload;
    if (!p || typeof p !== 'object' || typeof p.f !== 'string') return;
    if (p.f === me) return;

    // Their clock, kept so our next packet can hand it back to them.
    if (typeof p.t === 'number') echo = [p.f, p.t];
    // Our clock, handed back to us: the round trip, measured with no extra traffic at all.
    if (Array.isArray(p.e) && p.e[0] === me && typeof p.e[1] === 'number') {
      const known = roster.get(p.f);
      if (known) known.latency = Math.max(0, Date.now() - p.e[1]);
    }

    if (p.k === INPUT) { tell('onInput', [p.f, p.d]); return; }
    if (p.k === STATE) { tell('onState', [p.f, p.d]); return; }
    if (p.k === MESSAGE) tell('onMessage', [p.f, p.d]);
  }

  /**
   * Register every handler the link needs. Called BEFORE connect(), always: 'joined' arrives on
   * the first message and a handler added after the call never sees it.
   * @param {(ok: { id: string, room: string, isHost: boolean }) => void} ready
   * @param {(err: Error) => void} refuse
   */
  function wire(ready, refuse) {
    const add = function (event, fn) {
      rt.on(event, fn);
      wired.push([event, fn]);
    };

    add('joined', function (msg) {
      me = msg && msg.peerId ? String(msg.peerId) : null;
      roomId = (msg && msg.roomId) || roomId;
      roster.clear();
      if (me) roster.set(me, { id: me, name: nick });
      const existing = (msg && msg.peers) || [];
      for (const p of existing) {
        if (!p || !p.peerId) continue;
        roster.set(String(p.peerId), { id: String(p.peerId), name: p.nick || 'player' });
      }
      elect();
      if (!me) {
        refuse(new Error('The room answered without saying which peer we are, so there is nobody '
          + 'to send input as. Try joining again.'));
        return;
      }
      ready({ id: me, room: String(roomId), isHost: host === me });
    });

    add('peer-joined', function (msg) {
      if (!msg || !msg.peerId) return;
      const peer = { id: String(msg.peerId), name: msg.nick || 'player' };
      roster.set(peer.id, peer);
      elect();
      tell('onPeer', [peer, true]);
    });

    add('peer-left', function (msg) {
      if (!msg || !msg.peerId) return;
      const id = String(msg.peerId);
      const peer = roster.get(id) || { id: id, name: 'player' };
      roster.delete(id);
      elect();
      tell('onPeer', [peer, false]);
    });

    add('peer-presence', function (msg) {
      if (!msg || !msg.peerId) return;
      const known = roster.get(String(msg.peerId));
      if (known && msg.state && typeof msg.state.name === 'string') known.name = msg.state.name;
    });

    add('broadcast', onBroadcast);

    add('close', function (msg) {
      roster.clear();
      host = null;
      tell('onClose', [msg || {}]);
    });

    add('error', function (msg) {
      console.warn('[aimeat-phaser] the room reported an error:', msg);
    });
  }

  /**
   * Find the room by name inside this app, or make it. Concurrent creators converge because
   * everyone picks the LOWEST matching id rather than the newest.
   * @returns {Promise<string>}
   */
  function findRoom() {
    return rt.listRooms({ app_type: s.app }).then(function (rooms) {
      const matching = (rooms || []).filter(function (r) { return r && r.name === s.room; });
      if (matching.length) {
        return String(lowest(matching.map(function (r) { return r.id; })));
      }
      return rt.createRoom({ app_type: s.app, name: s.room, is_public: true })
        .then(function (made) { return String(made.id); });
    });
  }

  /**
   * Join the room, making it if nobody has yet. Resolves once the room has said who we are.
   * @returns {Promise<{ id: string, room: string, isHost: boolean }>}
   */
  function connect() {
    if (dead) return Promise.reject(new Error('This net link was destroyed. Make a new one.'));
    if (rt && me) return Promise.resolve({ id: me, room: String(roomId), isHost: host === me });

    const Realtime = realtimeClass();
    if (!Realtime) {
      return Promise.reject(new Error('Multiplayer needs the realtime library, which this page has '
        + 'not loaded. Add this line before the game runs:\n'
        + '  <script src="' + NODE_URL + '/lib/realtime.js"></script>'));
    }
    const token = sessionToken();
    if (!token) {
      return Promise.reject(new Error('A room belongs to an account, so multiplayer needs somebody '
        + 'signed in. Include aimeat-auth.js and call AIMEAT.auth.login() before connecting.'));
    }
    if (!s.room || !s.app) {
      return Promise.reject(new Error('net() needs both a room name and an app type: two games '
        + 'must not meet in a room that happens to share a name.'));
    }

    rt = new Realtime(NODE_URL, token);

    return findRoom().then(function (found) {
      roomId = found;
      return new Promise(function (ok, fail) {
        let settled = false;
        const timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          fail(new Error('The room at ' + NODE_URL + ' did not answer within '
            + Math.round(JOIN_MS / 1000) + ' seconds. The node may be unreachable from here, or the '
            + 'sign-in may have expired.'));
        }, JOIN_MS);
        // Everything is wired before connect(), because 'joined' is the first message back.
        wire(
          function (info) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            ok(info);
          },
          function (err) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fail(err);
          },
        );
        rt.connect(roomId, nick);
      });
    });
  }

  /**
   * This player's input, at most once per `rate` and only when it has changed. A change inside the
   * window is held and sent as the window closes, so the last input of a press always lands.
   * @param {any} input  anything JSON can carry. Keep it small: it goes out thirty times a second.
   * @returns {boolean} whether a packet went now
   */
  function sendInput(input) {
    if (dead || !rt || !me) return false;
    const text = JSON.stringify(input === undefined ? null : input);
    if (text === inputWindow.last) return false;

    const now = Date.now();
    const since = now - inputWindow.at;
    if (since >= rate) {
      inputWindow.last = text;
      inputWindow.at = now;
      inputWindow.hasHeld = false;
      inputWindow.held = null;
      return put(INPUT, input);
    }

    inputWindow.held = input;
    inputWindow.hasHeld = true;
    if (inputWindow.timer) return false;
    inputWindow.timer = setTimeout(function () {
      inputWindow.timer = 0;
      if (dead || !inputWindow.hasHeld) return;
      const held = inputWindow.held;
      inputWindow.hasHeld = false;
      inputWindow.held = null;
      inputWindow.last = JSON.stringify(held === undefined ? null : held);
      inputWindow.at = Date.now();
      put(INPUT, held);
    }, rate - since);
    return false;
  }

  /**
   * A snapshot of the shared world. This is the host's channel: every peer may call it, but only
   * one peer's answer can be true, and isHost() says which. Snapshots are throttled by time and
   * not gated on change, because a snapshot's job is to correct drift that nothing announced.
   * @param {any} state
   * @param {{ every?: number }} [opts]  the window, in milliseconds. Default 100.
   * @returns {boolean} whether a packet went now
   */
  function sendState(state, opts) {
    if (dead || !rt || !me) return false;
    if (opts && typeof opts.every === 'number' && isFinite(opts.every)) {
      stateWindow.every = Math.max(20, opts.every);
    }
    const now = Date.now();
    const since = now - stateWindow.at;
    if (since >= stateWindow.every) {
      stateWindow.at = now;
      stateWindow.hasHeld = false;
      stateWindow.held = null;
      return put(STATE, state);
    }
    stateWindow.held = state;
    stateWindow.hasHeld = true;
    if (stateWindow.timer) return false;
    stateWindow.timer = setTimeout(function () {
      stateWindow.timer = 0;
      if (dead || !stateWindow.hasHeld) return;
      const held = stateWindow.held;
      stateWindow.hasHeld = false;
      stateWindow.held = null;
      stateWindow.at = Date.now();
      put(STATE, held);
    }, stateWindow.every - since);
    return false;
  }

  /**
   * One message, now: a chat line, a ready flag, a rematch offer. Not throttled, because a message
   * is something a person did rather than something a frame produced.
   * @param {any} msg
   * @returns {boolean}
   */
  function send(msg) {
    return put(MESSAGE, msg);
  }

  /** Everyone else in the room, with a round-trip figure where one has been measured. */
  function peers() {
    /** @type {Array<{ id: string, name: string, latency?: number }>} */
    const out = [];
    for (const peer of roster.values()) {
      if (peer.id === me) continue;
      out.push(peer.latency === undefined
        ? { id: peer.id, name: peer.name }
        : { id: peer.id, name: peer.name, latency: peer.latency });
    }
    return out;
  }

  /** Is this peer the one whose word is final? The lowest id present, and nothing else. */
  function isHost() {
    return !!me && host === me;
  }

  /** This peer's id, or null before the room has answered. */
  function id() {
    return me;
  }

  /** Both windows emptied, so nothing is sent after the link is meant to be quiet. */
  function stopWindows() {
    if (inputWindow.timer) clearTimeout(inputWindow.timer);
    if (stateWindow.timer) clearTimeout(stateWindow.timer);
    inputWindow.timer = 0;
    stateWindow.timer = 0;
    inputWindow.held = null;
    stateWindow.held = null;
    inputWindow.hasHeld = false;
    stateWindow.hasHeld = false;
  }

  /** Leave the room, keeping the handle usable: connect() joins again. */
  function leave() {
    stopWindows();
    roster.clear();
    host = null;
    me = null;
    if (rt && typeof rt.leave === 'function') rt.leave();
  }

  /** Leave, unregister every handler, and refuse to be used again. */
  function destroy() {
    if (dead) return;
    dead = true;
    stopWindows();
    if (rt) {
      for (const pair of wired) rt.off(pair[0], pair[1]);
      if (typeof rt.disconnect === 'function') rt.disconnect();
    }
    wired.length = 0;
    roster.clear();
    host = null;
    me = null;
    rt = null;
  }

  return {
    connect: connect,
    leave: leave,
    peers: peers,
    sendInput: sendInput,
    sendState: sendState,
    send: send,
    isHost: isHost,
    id: id,
    destroy: destroy,
  };
}
