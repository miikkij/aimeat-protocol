/**
 * @file phaser/settings.js
 * @description The settings page a game needs and nobody wants to write twice: volumes,
 *   fullscreen, touch controls, less motion and the key bindings, as DOM beside the canvas
 *   rather than as another in-canvas menu.
 *
 *   IT IS DOM ON PURPOSE. A slider, a switch and a rebind button are controls the browser and
 *   every assistive technology already understand; drawing them into a canvas would cost the
 *   labels, the focus ring, the keyboard and the screen reader in exchange for looking uniform.
 *   So the game is the canvas and the settings are a page, and they share one set of tokens.
 *
 *   THE ATELIER KIT CARRIES IT WHEN THE PAGE HAS ONE. Sections come from window.AIMEAT.atelier
 *   when the app loaded the kit; without it the same class names are written by hand and
 *   aimeat-phaser/settings.css dresses them off the same --ak-* contract. Either way the panel
 *   looks like the app around it.
 *
 *   EVERY CHANGE LANDS IMMEDIATELY AND IS REMEMBERED. There is no Save button, because a volume
 *   slider you have to confirm is a volume slider that lies to you: the bus takes the value on
 *   the drag and saves.settings() keeps it for next time, under the same field names the bus's
 *   own settings() reports so an app can hand the whole record straight back to audio.apply().
 *
 *   THE PANEL ASKS; IT NEVER GUESSES. Volumes and mute are read from the bus, the bindings from
 *   controls.bindings(), and the store is the fallback for whatever was not given. The one thing
 *   it cannot read back is the touch overlay — controls.showTouch(on) only sets — so that switch
 *   remembers its own last answer instead of calling the setter to find out and hiding the pad.
 * @structure settingsPanel(spec) → { el, refresh, destroy }
 * @usage  const panel = AIMEAT.phaser.settingsPanel({ target: '#settings', audio: bus,
 *           controls: pad, saves: store, game: handle });
 * @version-history
 *   v1.1.0 — 2026-09-02 — The defaults are the bus's own (master 1, sfx 1), and a stored touch or
 *     motion choice is applied on build, not only shown.
 *   v1.0.0 — 2026-09-02 — Initial (wish-phaser4-design-book-page).
 */
import { el, clear, resolve, uid, setMotion } from '../atelier/dom.js';

/** The sections, in the order they are drawn when the caller names none. */
const ALL_SECTIONS = ['audio', 'display', 'controls', 'motion'];

/**
 * The actions and their words, in the order controls.js reports them. The ids mirror that
 * module's own ACTIONS list; when a controls state is given the TABLE is built from
 * controls.bindings() instead, so a game that adds an action still shows it.
 */
const ACTION_WORDS = {
  left: 'Move left',
  right: 'Move right',
  up: 'Move up',
  down: 'Move down',
  jump: 'Jump',
  action: 'Action',
  pause: 'Pause',
};

/**
 * What a fresh install sounds and behaves like. The volumes are 0..1 as the bus takes them, and
 * the scheme mirrors DEFAULT_SCHEME in controls.js — the reset button has to know the floor, and
 * that module does not publish it.
 */
const DEFAULTS = {
  // The same three the audio bus starts from (audio.js), so Reset lands where a fresh bus does.
  master: 1,
  music: 0.6,
  sfx: 1,
  muted: false,
  touch: false,
  keys: {
    left: ['LEFT', 'A'],
    right: ['RIGHT', 'D'],
    up: ['UP', 'W'],
    down: ['DOWN', 'S'],
    jump: ['SPACE', 'UP', 'W'],
    action: ['X', 'K', 'ENTER'],
    pause: ['ESC', 'P'],
  },
};

/** Browser key names that are not their own Phaser key name. */
const KEY_NAMES = {
  ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', ArrowUp: 'UP', ArrowDown: 'DOWN',
  ' ': 'SPACE', Spacebar: 'SPACE', Enter: 'ENTER', Tab: 'TAB',
  Backspace: 'BACKSPACE', Shift: 'SHIFT', Control: 'CTRL', Alt: 'ALT',
};

/** Phaser spells the digits out. */
const DIGIT_NAMES = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];

/** The mark on the root that says the viewer asked for less motion (the Atelier kit's own). */
const MOTION_ATTR = 'data-ak-motion';

/**
 * A key press as the name controls.rebind() takes.
 * @param {KeyboardEvent} ev
 * @returns {string}
 */
function phaserKey(ev) {
  const named = KEY_NAMES[ev.key];
  if (named) return named;
  if (/^[0-9]$/.test(ev.key)) return DIGIT_NAMES[Number(ev.key)];
  return String(ev.key).toUpperCase();
}

/**
 * The keys bound to one action, as something a person can read.
 * @param {string[]|undefined} keys
 * @returns {string}
 */
function keyLabel(keys) {
  return keys && keys.length ? keys.join(' / ') : 'Unbound';
}

/**
 * The Atelier kit, when this page has it. Everything here works without it.
 * @returns {any|null}
 */
function kit() {
  const ns = /** @type {any} */ (window).AIMEAT;
  return ns && ns.atelier ? ns.atelier : null;
}

/**
 * A titled block: the kit's section when the kit is here, the same markup when it is not.
 * @param {HTMLElement} host
 * @param {string} title
 * @returns {HTMLElement} the body to fill
 */
function block(host, title) {
  const K = kit();
  if (K && typeof K.section === 'function') {
    const made = K.section({ target: host, title: title });
    return made.body;
  }
  const body = el('div', { class: 'ak-section__body' });
  host.appendChild(el('section', { class: 'ak-root ak-section' }, [
    el('h2', { class: 'ak-section__title', text: title }),
    body,
  ]));
  return body;
}

/**
 * The settings page.
 *
 * @param {{
 *   target: Element|string,
 *   audio?: any, controls?: any, saves?: any, game?: any,
 *   sections?: Array<'audio'|'display'|'controls'|'motion'>,
 * }} spec
 * @returns {{ el: HTMLElement, refresh: () => void, destroy: () => void }}
 */
export function settingsPanel(spec) {
  const s = spec || /** @type {any} */ ({});
  const sections = s.sections && s.sections.length ? s.sections : ALL_SECTIONS;
  const root = el('div', { class: 'ak-root akp-settings' });
  resolve(s.target, document.body).appendChild(root);

  /** Everything that can re-read itself from the game when refresh() is called. */
  /** @type {Array<() => void>} */
  const readers = [];
  /** The one-shot key listener a rebind installs, so destroy() can take it back. */
  /** @type {((ev: KeyboardEvent) => void)|null} */
  let capturing = null;
  /** controls.showTouch() only SETS, so the switch remembers its own answer. */
  let touchOn = false;
  let gone = false;

  // ── Reading and writing the game ─────────────────────────────────────────────────────────────

  /** @returns {Record<string, any>} whatever the store is holding, or nothing */
  function stored() {
    const store = s.saves;
    if (!store || typeof store.settings !== 'function') return {};
    const kept = store.settings();
    return kept && typeof kept === 'object' ? kept : {};
  }

  /**
   * Keep one field, under the name the audio bus's own settings() uses, so an app can hand the
   * whole record back to audio.apply() without translating anything.
   * @param {string} key
   * @param {any} value
   * @returns {void}
   */
  function persist(key, value) {
    const store = s.saves;
    if (!store || typeof store.settings !== 'function') return;
    const patch = {};
    patch[key] = value;
    store.settings(patch);
  }

  /**
   * @param {string} name  master | music | sfx
   * @returns {number} 0..1
   */
  function readLevel(name) {
    const bus = s.audio;
    if (bus && typeof bus[name] === 'function') {
      const v = bus[name]();
      if (typeof v === 'number' && isFinite(v)) return v;
    }
    const kept = stored();
    return typeof kept[name] === 'number' ? kept[name] : DEFAULTS[name];
  }

  /**
   * @param {string} name
   * @param {number} value 0..1
   * @returns {void}
   */
  function writeLevel(name, value) {
    const bus = s.audio;
    if (bus && typeof bus[name] === 'function') bus[name](value);
    persist(name, value);
  }

  /** @returns {boolean} */
  function readMute() {
    const bus = s.audio;
    if (bus && typeof bus.mute === 'function') return !!bus.mute();
    const kept = stored();
    return kept.muted != null ? !!kept.muted : DEFAULTS.muted;
  }

  /** @param {boolean} on @returns {void} */
  function writeMute(on) {
    const bus = s.audio;
    if (bus && typeof bus.mute === 'function') bus.mute(on);
    persist('muted', on);
  }

  /** @returns {boolean} */
  function readFullscreen() {
    return !!document.fullscreenElement;
  }

  /** @param {boolean} on @returns {void} */
  function writeFullscreen(on) {
    const handle = s.game;
    if (!handle) return;
    if (on && typeof handle.fullscreen === 'function') handle.fullscreen();
    else if (!on && typeof handle.exitFullscreen === 'function') handle.exitFullscreen();
  }

  /** @returns {boolean} */
  function readTouch() {
    return touchOn;
  }

  /** @param {boolean} on @returns {void} */
  function writeTouch(on) {
    touchOn = !!on;
    const c = s.controls;
    if (c && typeof c.showTouch === 'function') c.showTouch(touchOn);
    persist('touch', touchOn);
  }

  /** @returns {boolean} */
  function readLessMotion() {
    return document.documentElement.getAttribute(MOTION_ATTR) === 'less';
  }

  /** @param {boolean} on @returns {void} */
  function writeLessMotion(on) {
    const K = kit();
    const set = K && typeof K.setMotion === 'function' ? K.setMotion : setMotion;
    set(on ? 'less' : 'auto');
    persist('motion', on ? 'less' : 'auto');
  }

  /**
   * The scheme as it stands: the controls state is the authority, the store is the fallback for a
   * panel built before the game, and the mirrored default is the floor.
   * @returns {Record<string, string[]>} action → Phaser key names
   */
  function readKeys() {
    const c = s.controls;
    if (c && typeof c.bindings === 'function') return c.bindings();
    const kept = stored().keys;
    return kept && typeof kept === 'object' ? kept : DEFAULTS.keys;
  }

  /**
   * Point one action at one key. A rebind REPLACES the whole list for that action, because the
   * person pressed one key and expects that key to be the answer; the multi-key defaults come
   * back with Reset to defaults.
   * @param {string} action
   * @param {string[]} keys
   * @returns {void}
   */
  function writeKeys(action, keys) {
    const c = s.controls;
    if (c && typeof c.rebind === 'function') c.rebind(action, keys);
    const next = Object.assign({}, readKeys());
    next[action] = keys;
    persist('keys', next);
  }

  // ── The controls ─────────────────────────────────────────────────────────────────────────────

  /**
   * One slider, labelled, with its own live read-out. Values are shown as whole percent and
   * handed to the bus as 0..1.
   * @param {HTMLElement} host
   * @param {string} label
   * @param {string} name
   * @returns {void}
   */
  function slider(host, label, name) {
    const id = uid('akp-set');
    const out = el('output', { class: 'akp-settings__value', for: id });
    const input = /** @type {HTMLInputElement} */ (el('input', {
      id: id, type: 'range', min: '0', max: '100', step: '1',
      class: 'ak-input akp-settings__range',
      on: {
        input: function () {
          const pct = Number(input.value);
          out.textContent = pct + '%';
          writeLevel(name, pct / 100);
        },
      },
    }));
    host.appendChild(el('div', { class: 'ak-form__field akp-settings__row' }, [
      el('label', { class: 'ak-form__label', for: id, text: label }),
      el('div', { class: 'akp-settings__control' }, [input, out]),
    ]));
    const read = function () {
      const pct = Math.round(Math.max(0, Math.min(1, readLevel(name))) * 100);
      input.value = String(pct);
      out.textContent = pct + '%';
    };
    readers.push(read);
    read();
  }

  /**
   * One switch, on the kit's toggle class so it reads as a switch in every look.
   * @param {HTMLElement} host
   * @param {string} label
   * @param {() => boolean} read
   * @param {(on: boolean) => void} write
   * @param {string} [hint]
   * @returns {void}
   */
  function toggle(host, label, read, write, hint) {
    const id = uid('akp-set');
    const input = /** @type {HTMLInputElement} */ (el('input', {
      id: id, type: 'checkbox', class: 'ak-toggle',
      on: { change: function () { write(input.checked); } },
    }));
    host.appendChild(el('div', { class: 'ak-form__field ak-form__field--inline akp-settings__row' }, [
      input,
      el('label', { class: 'ak-form__label', for: id, text: label }),
      hint ? el('p', { class: 'ak-form__hint', text: hint }) : null,
    ]));
    const sync = function () { input.checked = read(); };
    readers.push(sync);
    sync();
  }

  /**
   * The key bindings, one row per action the game actually has, each with its own Rebind button.
   * Pressing Rebind arms a ONE-SHOT keydown listener: the next key is taken, the listener is gone
   * whatever happens, and Escape leaves the binding as it was.
   * @param {HTMLElement} host
   * @returns {void}
   */
  function bindingTable(host) {
    const scheme = readKeys();
    const actions = Object.keys(scheme);
    const body = el('tbody');
    host.appendChild(el('table', { class: 'akp-settings__keys' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { scope: 'col', text: 'Action' }),
        el('th', { scope: 'col', text: 'Key' }),
        el('th', { scope: 'col', class: 'ak-sr-only', text: 'Change' }),
      ])),
      body,
    ]));

    /** @type {Record<string, HTMLElement>} */
    const cells = {};
    for (const action of actions) {
      const words = ACTION_WORDS[action] || action;
      const cell = el('td', { class: 'akp-settings__key' });
      cells[action] = cell;
      const button = el('button', {
        type: 'button', class: 'ak-btn ak-btn--ghost', 'data-ak-noguard': true,
        'aria-label': 'Change the key for ' + words,
        on: { click: function () { capture(action, button); } },
      }, 'Rebind');
      body.appendChild(el('tr', {}, [
        el('th', { scope: 'row', text: words }),
        cell,
        el('td', {}, button),
      ]));
    }

    const read = function () {
      const now = readKeys();
      for (const action of actions) cells[action].textContent = keyLabel(now[action]);
    };
    readers.push(read);
    read();
  }

  /**
   * Take the next key for one action.
   * @param {string} action
   * @param {HTMLElement} button
   * @returns {void}
   */
  function capture(action, button) {
    if (capturing) window.removeEventListener('keydown', capturing, true);
    button.classList.add('akp-settings__listening');
    button.textContent = 'Press a key';
    const listener = function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      window.removeEventListener('keydown', listener, true);
      capturing = null;
      button.classList.remove('akp-settings__listening');
      button.textContent = 'Rebind';
      if (ev.key === 'Escape') return;
      writeKeys(action, [phaserKey(ev)]);
      api.refresh();
    };
    capturing = listener;
    window.addEventListener('keydown', listener, true);
  }

  // ── The page ─────────────────────────────────────────────────────────────────────────────────

  /** Draw every asked-for section. @returns {void} */
  function build() {
    clear(root);
    readers.length = 0;
    touchOn = !!stored().touch;
    // What the store remembers is applied, not only shown: the overlay and the motion switch
    // follow the stored choice, so a reload lands where the person left it.
    if (s.controls && typeof s.controls.showTouch === 'function' && stored().touch != null) s.controls.showTouch(touchOn);
    if (stored().motion === 'less' && !readLessMotion()) writeLessMotion(true);

    for (const name of sections) {
      if (name === 'audio') {
        const body = block(root, 'Sound');
        slider(body, 'Overall volume', 'master');
        slider(body, 'Music', 'music');
        slider(body, 'Effects', 'sfx');
        toggle(body, 'Mute everything', readMute, writeMute);
      } else if (name === 'display') {
        const body = block(root, 'Display');
        toggle(body, 'Fullscreen', readFullscreen, writeFullscreen,
          'The game fills the screen until you leave it.');
      } else if (name === 'controls') {
        const body = block(root, 'Controls');
        toggle(body, 'On-screen buttons', readTouch, writeTouch,
          'Show the touch controls over the game.');
        bindingTable(body);
      } else if (name === 'motion') {
        const body = block(root, 'Motion');
        toggle(body, 'Less motion', readLessMotion, writeLessMotion,
          'Menus and scene changes stop moving; the game itself is unchanged.');
      }
    }

    root.appendChild(el('div', { class: 'akp-settings__bar' }, el('button', {
      type: 'button', class: 'ak-btn ak-btn--ghost', 'data-ak-noguard': true,
      on: { click: resetAll },
    }, 'Reset to defaults')));
  }

  /** Put every setting back where it started, through the same doors a person would use. */
  function resetAll() {
    writeLevel('master', DEFAULTS.master);
    writeLevel('music', DEFAULTS.music);
    writeLevel('sfx', DEFAULTS.sfx);
    writeMute(DEFAULTS.muted);
    writeTouch(DEFAULTS.touch);
    writeLessMotion(false);
    for (const action in DEFAULTS.keys) writeKeys(action, DEFAULTS.keys[action].slice());
    api.refresh();
  }

  // Fullscreen can be left with the browser's own key, and the switch has to follow that rather
  // than sit there claiming the game is still full screen.
  const onFullscreenChange = function () { api.refresh(); };
  document.addEventListener('fullscreenchange', onFullscreenChange);

  const api = {
    el: root,

    /** Re-read every control from the game. Nothing is rebuilt, so a focused control keeps focus. */
    refresh() {
      for (const read of readers) read();
    },

    destroy() {
      if (gone) return;
      gone = true;
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (capturing) { window.removeEventListener('keydown', capturing, true); capturing = null; }
      readers.length = 0;
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };

  build();
  return api;
}
