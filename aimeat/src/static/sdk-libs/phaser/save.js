/**
 * @file phaser/save.js
 * @description ONE memory key per player, for a Phaser game on this node. `saves(spec)` returns a
 *   small store holding the whole save file: the player's name, their settings, every level's
 *   unlock/stars/best, the recent session scores and an inventory bag. It is one record because the
 *   node's budget says so: 1024 kB per value and 1000 keys per principal, so a key per score would
 *   fill a person's whole allowance inside a year of playing.
 *
 *   GUEST IS THE FLOOR. A page with no AIMEAT on it still gets a working store: the state lives in
 *   localStorage under 'ak.phaser.<key>' and every method behaves the same. Nothing here throws
 *   because the person is signed out, and nothing here asks them to sign in.
 *
 *   THE GUEST FILE IS NOT LOST AT SIGN-IN. The first load after a person signs in merges what they
 *   played as a guest into what the node holds: the higher best wins, unlocked levels are unioned,
 *   stars and per-level bests take the higher of the two. The guest copy is then cleared, so the
 *   merge happens exactly once.
 *
 *   THE LEADERBOARD IS A SECOND, PUBLIC RECORD. The save itself stays private. A small subset of it
 *   (name, best, level, updated by default) is written to the public key '<app>.score', which is
 *   what `leaderboard()` reads back across players. What goes in that subset is the app's choice
 *   through `spec.public`, so a game never publishes more of a save than it meant to.
 * @structure helpers (the AIMEAT handles, guest storage, state shaping, version gating, merging) ·
 *   saves(spec) building load/get/set/save/levels/score/settings/isGuest/onChange/leaderboard/destroy
 * @usage
 *   const store = AIMEAT.phaser.saves({ app: 'ridge', version: 2, defaults: { best: 0 } });
 *   const state = await store.load();
 *   store.levels.unlock('2-1');
 *   if (store.levels.best('2-1', 4200)) store.score(4200);
 *   const top = await store.leaderboard({ limit: 10 });
 * @version-history
 *   v1.1.0 - 2026-09-02 - The public row's level falls back to the count of unlocked levels, which
 *     the library maintains, instead of a field nothing set.
 *   v1.0.0 - 2026-09-02 - Initial: the one-key save store, guest mode, the sign-in merge, the
 *     public score subset and the leaderboard read.
 */

/** Where a guest's save file lives in the browser. */
const GUEST_PREFIX = 'ak.phaser.';

/** How long a burst of writes is collected before one goes out. */
const DEBOUNCE_MS = 300;

/** How many finished session scores a save file keeps. Old ones are worth less than the budget. */
const SCORES_KEPT = 20;

/**
 * @typedef {Object} LevelRecord
 * @property {boolean} unlocked  Whether the player may enter this level.
 * @property {number} stars      Best star rating earned, 0 upward.
 * @property {number} best       Best score on this level.
 */

/**
 * The save file. The six named fields are always present; `spec.defaults` adds whatever else the
 * game keeps, and the store never removes a field it did not put there.
 * @typedef {{ version: number, profile: { name: string }, settings: Record<string, any>,
 *   levels: Record<string, LevelRecord>, scores: number[], inventory: Record<string, any>,
 *   [k: string]: any }} SaveState
 */

/**
 * One row of the public board.
 * @typedef {{ owner: string, name: string, best: number, level: any, updated: string }} BoardRow
 */

/**
 * What `saves()` was given. Only `app` and `version` are required.
 * @typedef {Object} SaveSpec
 * @property {string} app                        The app's key prefix, for example 'ridge'.
 * @property {string} [key]                      The private key. Default: app + '.save'.
 * @property {number} version                    The shape's version, for the migration gate.
 * @property {Record<string, any>} [defaults]     Extra fields a fresh save starts with.
 * @property {(old: any, fromVersion: number) => any} [migrate]  Older shape to this one.
 * @property {(state: SaveState) => Record<string, any>} [public]  The public subset.
 * @property {'auto'} [storage]                  Reserved. Only 'auto' is understood today.
 */

/** The memory library, when the page loaded one. */
function dataLib() {
  const root = typeof window !== 'undefined' ? /** @type {any} */ (window).AIMEAT : null;
  return root && root.data ? root.data : null;
}

/** The signed-in session, or null for a guest. Never throws, whatever the auth library does. */
function currentSession() {
  const root = typeof window !== 'undefined' ? /** @type {any} */ (window).AIMEAT : null;
  const auth = root && root.auth;
  if (!auth || typeof auth.getSession !== 'function') return null;
  try {
    return auth.getSession() || null;
  } catch (err) {
    console.warn('[aimeat-phaser] auth.getSession failed, continuing as a guest:', err);
    return null;
  }
}

/** A number, or 0 for anything that is not one. */
function num(v) {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

/** A fresh save file for this spec. */
function baseState(spec) {
  return /** @type {SaveState} */ (Object.assign({
    version: spec.version,
    profile: { name: '' },
    settings: {},
    levels: {},
    scores: [],
    inventory: {},
  }, spec.defaults || {}));
}

/** Put back any of the six named fields a stored file is missing. */
function normalize(state, spec) {
  const s = /** @type {SaveState} */ (state && typeof state === 'object' ? state : {});
  if (typeof s.version !== 'number') s.version = spec.version;
  if (!s.profile || typeof s.profile !== 'object') s.profile = { name: '' };
  if (typeof s.profile.name !== 'string') s.profile.name = '';
  if (!s.settings || typeof s.settings !== 'object') s.settings = {};
  if (!s.levels || typeof s.levels !== 'object') s.levels = {};
  if (!Array.isArray(s.scores)) s.scores = [];
  if (!s.inventory || typeof s.inventory !== 'object') s.inventory = {};
  return s;
}

/**
 * The version gate. An older file goes through `migrate`; a newer one is kept exactly as it is and
 * says so, because a build that downgrades a save silently is how a player loses a season.
 * @param {any} stored
 * @param {SaveSpec} spec
 * @returns {SaveState|null}
 */
function applyVersion(stored, spec) {
  if (!stored || typeof stored !== 'object') return null;
  const from = typeof stored.version === 'number' ? stored.version : 0;
  if (from === spec.version) return stored;
  if (from > spec.version) {
    console.warn('[aimeat-phaser] the save is version ' + from + ' and this build expects '
      + spec.version + '. Keeping it untouched.');
    return stored;
  }
  if (typeof spec.migrate === 'function') {
    let next;
    try {
      next = spec.migrate(stored, from);
    } catch (err) {
      console.warn('[aimeat-phaser] migrate() failed, keeping the stored save as it is:', err);
      next = null;
    }
    if (next && typeof next === 'object') {
      const out = Object.assign({}, next);
      out.version = spec.version;
      return /** @type {SaveState} */ (out);
    }
  }
  const kept = Object.assign({}, stored);
  kept.version = spec.version;
  return /** @type {SaveState} */ (kept);
}

/** Merge two level maps: unlocked is a union, stars and best take the higher. */
function mergeLevels(remote, guest) {
  const out = /** @type {Record<string, LevelRecord>} */ (Object.assign({}, remote || {}));
  const from = guest || {};
  for (const id in from) {
    const g = from[id] || {};
    const r = out[id] || { unlocked: false, stars: 0, best: 0 };
    out[id] = {
      unlocked: !!(r.unlocked || g.unlocked),
      stars: Math.max(num(r.stars), num(g.stars)),
      best: Math.max(num(r.best), num(g.best)),
    };
  }
  return out;
}

/**
 * Fold a guest file into the file the node holds. The node's copy is the base, because that is the
 * one the player has been building on other devices; the guest copy only ever raises a number or
 * opens a level.
 * @param {SaveState} remote
 * @param {SaveState} guest
 * @returns {SaveState}
 */
function mergeGuest(remote, guest) {
  const out = /** @type {SaveState} */ (Object.assign({}, guest, remote));
  out.profile = { name: remote.profile.name || guest.profile.name || '' };
  out.settings = Object.assign({}, guest.settings, remote.settings);
  out.inventory = Object.assign({}, guest.inventory, remote.inventory);
  out.levels = mergeLevels(remote.levels, guest.levels);
  out.best = Math.max(num(remote.best), num(guest.best));
  const scores = remote.scores.concat(guest.scores).filter(function (n) { return typeof n === 'number'; });
  scores.sort(function (a, b) { return b - a; });
  out.scores = scores.slice(0, SCORES_KEPT);
  return out;
}

/** The default public subset: enough for a board row and nothing else. */
function defaultPublic(state) {
  return {
    name: state.profile.name || '',
    best: num(state.best),
    // The level a board row shows: the app's own `state.level` when it keeps one, else how many
    // levels this player has unlocked, which the library does maintain.
    level: state.level != null ? state.level
      : Object.keys(state.levels || {}).filter(function (k) { return state.levels[k] && state.levels[k].unlocked; }).length,
    updated: new Date().toISOString(),
  };
}

/**
 * Build the save store for one game.
 *
 * @param {SaveSpec} spec
 * @returns {{
 *   load: () => Promise<SaveState>,
 *   get: () => SaveState,
 *   set: (patch: Record<string, any>) => SaveState,
 *   save: () => Promise<void>,
 *   levels: {
 *     unlock: (id: any) => boolean,
 *     isUnlocked: (id: any) => boolean,
 *     stars: (id: any, n?: number) => any,
 *     best: (id: any, score: number) => boolean,
 *     get: (id: any) => LevelRecord|null,
 *   },
 *   score: { (add?: number): number, reset: () => number },
 *   settings: (patch?: Record<string, any>) => Record<string, any>,
 *   isGuest: () => boolean,
 *   onChange: (fn: (state: SaveState) => void) => (() => void),
 *   leaderboard: (opts?: { limit?: number }) => Promise<BoardRow[]>,
 *   destroy: () => void,
 * }}
 */
export function saves(spec) {
  if (!spec || typeof spec.app !== 'string' || !spec.app) {
    throw new Error('saves({ app }) needs the app key prefix, for example "ridge"');
  }
  if (typeof spec.version !== 'number') {
    throw new Error('saves({ version }) needs a number, so an older save can be migrated');
  }
  const key = spec.key || (spec.app + '.save');
  const publicKey = spec.app + '.score';
  const guestKey = GUEST_PREFIX + key;
  const toPublic = typeof spec.public === 'function' ? spec.public : defaultPublic;

  /** @type {SaveState} */
  let state = baseState(spec);
  /** @type {((state: SaveState) => void)[]} */
  let listeners = [];
  /** @type {any} */
  let timer = null;
  /** @type {{ promise: Promise<void>, resolve: () => void }|null} */
  let pending = null;
  let lastPublic = '';
  let sessionScore = 0;
  let destroyed = false;

  // ── The guest copy ────────────────────────────────────────────────────────────────────────

  function readGuest() {
    try {
      const raw = localStorage.getItem(guestKey);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('[aimeat-phaser] the guest save could not be read:', err);
      return null;
    }
  }

  function writeGuest() {
    try {
      localStorage.setItem(guestKey, JSON.stringify(state));
    } catch (err) {
      console.warn('[aimeat-phaser] the guest save could not be written:', err);
    }
  }

  function clearGuest() {
    try {
      localStorage.removeItem(guestKey);
    } catch (err) {
      console.warn('[aimeat-phaser] the guest save could not be cleared:', err);
    }
  }

  // ── Change reporting ──────────────────────────────────────────────────────────────────────

  function emit() {
    for (const fn of listeners.slice()) {
      try {
        fn(state);
      } catch (err) {
        console.warn('[aimeat-phaser] a saves onChange listener threw:', err);
      }
    }
  }

  /** Something in the state moved: tell the listeners and schedule the write. */
  function touch() {
    emit();
    save();
  }

  // ── Writing ───────────────────────────────────────────────────────────────────────────────

  async function writeNow() {
    writeGuest();
    const d = dataLib();
    if (!d || !currentSession()) return;
    try {
      await d.set(key, state, { visibility: 'private' });
    } catch (err) {
      console.warn('[aimeat-phaser] the save could not be written to the node:', err);
      return;
    }
    let subset;
    try {
      subset = toPublic(state);
    } catch (err) {
      console.warn('[aimeat-phaser] the public subset could not be built:', err);
      return;
    }
    if (!subset || typeof subset !== 'object') return;
    // `updated` moves on every call, so it is left out of the comparison: otherwise every save
    // would publish a new board row even when the score had not changed.
    const compared = Object.assign({}, subset);
    delete compared.updated;
    const fingerprint = JSON.stringify(compared);
    if (fingerprint === lastPublic) return;
    try {
      await d.set(publicKey, subset, { visibility: 'public' });
      lastPublic = fingerprint;
    } catch (err) {
      console.warn('[aimeat-phaser] the public score could not be written:', err);
    }
  }

  async function flush() {
    timer = null;
    const waiting = pending;
    pending = null;
    await writeNow();
    if (waiting) waiting.resolve();
  }

  /**
   * Save. Calls inside 300 ms collapse into one write, and every caller gets the same promise, so
   * a scene may call this on each pickup without a request per pickup.
   * @returns {Promise<void>}
   */
  function save() {
    if (destroyed) return Promise.resolve();
    if (!pending) {
      /** @type {() => void} */
      let settle = function () { /* replaced below, before the timer can fire */ };
      const promise = new Promise(function (resolve) { settle = /** @type {any} */ (resolve); });
      pending = { promise: promise, resolve: function () { settle(); } };
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
    return pending.promise;
  }

  // ── Loading ───────────────────────────────────────────────────────────────────────────────

  /**
   * Read the save file. A guest reads the browser copy; a signed-in player reads the node and, the
   * first time after playing as a guest, gets the two folded together.
   * @returns {Promise<SaveState>}
   */
  async function load() {
    const guestRaw = readGuest();
    if (!currentSession()) {
      state = normalize(applyVersion(guestRaw, spec) || baseState(spec), spec);
      emit();
      return state;
    }
    let remote = null;
    const d = dataLib();
    if (d) {
      try {
        remote = await d.get(key);
      } catch (err) {
        console.warn('[aimeat-phaser] the save could not be read from the node:', err);
      }
    }
    let next = applyVersion(remote, spec);
    let merged = false;
    if (guestRaw) {
      const guest = normalize(applyVersion(guestRaw, spec) || baseState(spec), spec);
      next = next ? mergeGuest(normalize(next, spec), guest) : guest;
      clearGuest();
      merged = true;
    }
    state = normalize(next || baseState(spec), spec);
    emit();
    if (merged) save();
    return state;
  }

  // ── Levels ────────────────────────────────────────────────────────────────────────────────

  /** @returns {LevelRecord} */
  function ensureLevel(id) {
    const k = String(id);
    let rec = state.levels[k];
    if (!rec || typeof rec !== 'object') {
      rec = { unlocked: false, stars: 0, best: 0 };
      state.levels[k] = rec;
    }
    if (typeof rec.unlocked !== 'boolean') rec.unlocked = !!rec.unlocked;
    rec.stars = num(rec.stars);
    rec.best = num(rec.best);
    return rec;
  }

  const levels = {
    /** Open a level. Returns true when it was closed until now. */
    unlock(id) {
      const rec = ensureLevel(id);
      if (rec.unlocked) return false;
      rec.unlocked = true;
      touch();
      return true;
    },
    /** May the player enter this level? */
    isUnlocked(id) {
      const rec = state.levels[String(id)];
      return !!(rec && rec.unlocked);
    },
    /**
     * Read the star rating with one argument, or record a better one with two. Recording returns
     * true when the rating improved.
     * @param {any} id
     * @param {number} [n]
     * @returns {number|boolean}
     */
    stars(id, n) {
      if (n === undefined) {
        const rec = state.levels[String(id)];
        return rec ? num(rec.stars) : 0;
      }
      const rec = ensureLevel(id);
      const want = Math.max(0, Math.floor(num(n)));
      if (want <= rec.stars) return false;
      rec.stars = want;
      touch();
      return true;
    },
    /** Record a score on this level. Returns true when it beat what was there. */
    best(id, score) {
      const rec = ensureLevel(id);
      const want = num(score);
      if (want <= rec.best) return false;
      rec.best = want;
      touch();
      return true;
    },
    /** This level's record, or null when the player has never reached it. */
    get(id) {
      const rec = state.levels[String(id)];
      return rec ? { unlocked: !!rec.unlocked, stars: num(rec.stars), best: num(rec.best) } : null;
    },
  };

  // ── Score ─────────────────────────────────────────────────────────────────────────────────

  /**
   * The running score for this session. Called with a number it adds and returns the new total,
   * raising the all-time best when the total passes it; called with nothing it just reports.
   * @param {number} [add]
   * @returns {number}
   */
  function score(add) {
    if (typeof add === 'number' && isFinite(add) && add !== 0) {
      sessionScore += add;
      if (sessionScore > num(state.best)) {
        state.best = sessionScore;
        touch();
      }
    }
    return sessionScore;
  }

  /**
   * End the run: the session score is filed under `scores` (the best kept, the rest dropped) and
   * the accumulator goes back to zero. Returns the score that was just filed.
   * @returns {number}
   */
  score.reset = function () {
    const finished = sessionScore;
    sessionScore = 0;
    if (finished > 0) {
      state.scores = state.scores.concat([finished])
        .sort(function (a, b) { return b - a; })
        .slice(0, SCORES_KEPT);
      touch();
    }
    return finished;
  };

  // ── The rest of the surface ───────────────────────────────────────────────────────────────

  /** The state as it stands. It is the live object, so read it and write through `set`. */
  function get() {
    return state;
  }

  /**
   * Merge fields into the save and write it.
   * @param {Record<string, any>} patch
   * @returns {SaveState}
   */
  function set(patch) {
    if (patch && typeof patch === 'object') {
      state = normalize(Object.assign(state, patch), spec);
      touch();
    }
    return state;
  }

  /**
   * Read the settings with no argument, or merge into them with one. The value returned is a copy,
   * so settings change through this call and stay saved.
   * @param {Record<string, any>} [patch]
   * @returns {Record<string, any>}
   */
  function settings(patch) {
    if (patch && typeof patch === 'object') {
      state.settings = Object.assign({}, state.settings, patch);
      touch();
    }
    return Object.assign({}, state.settings);
  }

  /** Is this save file living in the browser only? */
  function isGuest() {
    return !currentSession();
  }

  /**
   * Hear about every change to the save.
   * @param {(state: SaveState) => void} fn
   * @returns {() => void} stop listening
   */
  function onChange(fn) {
    if (typeof fn !== 'function') return function () { /* nothing was registered */ };
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (f) { return f !== fn; });
    };
  }

  /**
   * The public board, best first. Reads every player's '<app>.score' record through the memory
   * search. A page with no memory library gets an empty list rather than an error, because a board
   * is decoration and a game is not.
   * @param {{ limit?: number }} [opts]
   * @returns {Promise<BoardRow[]>}
   */
  async function leaderboard(opts) {
    const d = dataLib();
    if (!d || typeof d.search !== 'function') return [];
    const limit = Math.max(1, Math.floor(num(opts && opts.limit) || 10));
    let res;
    try {
      res = await d.search(publicKey, { visibility: 'public' });
    } catch (err) {
      console.warn('[aimeat-phaser] the leaderboard could not be read:', err);
      return [];
    }
    const rows = Array.isArray(res) ? res : (res && Array.isArray(res.results) ? res.results : []);
    /** @type {BoardRow[]} */
    const out = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      // The search matches on content, so a record that merely mentions the app is filtered out
      // here by its key.
      if (row.key && row.key !== publicKey) continue;
      const v = row.value && typeof row.value === 'object' ? row.value : {};
      out.push({
        owner: row.owner_gaii || row.ownerGaii || v.owner || '',
        name: typeof v.name === 'string' ? v.name : '',
        best: num(v.best),
        level: v.level != null ? v.level : null,
        updated: v.updated || row.updated_at || '',
      });
    }
    out.sort(function (a, b) { return b.best - a.best; });
    return out.slice(0, limit);
  }

  /** Stop. A pending write is sent first, so nothing the player just did is dropped. */
  function destroy() {
    if (destroyed) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
      flush().catch(function (err) {
        console.warn('[aimeat-phaser] the final save failed:', err);
      });
    }
    destroyed = true;
    listeners = [];
  }

  return {
    load: load,
    get: get,
    set: set,
    save: save,
    levels: levels,
    score: score,
    settings: settings,
    isGuest: isGuest,
    onChange: onChange,
    leaderboard: leaderboard,
    destroy: destroy,
  };
}
