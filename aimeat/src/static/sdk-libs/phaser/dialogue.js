/**
 * @file phaser/dialogue.js
 * @description The dialogue box for a Phaser 4 game, on the page's own tokens: the speaker's name
 *   on a tab, a portrait, the line typed out letter by letter, a page mark when the line is longer
 *   than the box, a next mark when it is done, and a list of answers when the character asked
 *   something. say() resolves when the player has read the line and ask() with the answer they
 *   picked, so a conversation is written as the awaits it is. The scripted moment around it (a
 *   camera pan, a fade, a line, a branch, all skippable) is cutscene() in ./cutscene.js, which
 *   speaks through this box.
 *
 *   ONE PRESS MEANS ONE THING. While a line is still typing, advance reveals the rest of it; once
 *   it is on screen, advance turns the page; on the last page it closes the line, or picks the
 *   answer under the cursor. The same rule for the action button, the jump button and a tap on
 *   the box, so a player never learns two sets of gestures.
 *
 *   INPUT IS THE CONTROLS STATE, READ ON THE EDGE. The handle reads opts.controls once per frame
 *   (its own update(), or the scene's update event when opts.auto is not false) and keeps its own
 *   held flags across every frame, open box or not. That is what makes a press that revealed a
 *   line not also pick the answer that then appeared under the same finger, and what stops a key
 *   already held when a box opens from counting as a press.
 *
 *   THE WORDS CAN COME FROM AN ASSETS LIBRARY. With opts.library (AIMEAT.assets.library), a text is
 *   first looked up as a key in the player's language and falls back to the literal when the
 *   library has no such key, so say('guide', 'intro.hello') and say('guide', 'Hello there') both
 *   work and an app can move from one to the other line by line. Answer labels and the speaker's
 *   name (as speaker.<id>) take the same road.
 *
 *   EVERYTHING ENDS. The typewriter is a chain of one-shot timers that stops at the last letter,
 *   a page mark is drawn once and holds, and the box arrives and leaves with one short tween
 *   each; hide() settles whatever line is pending and a scene shutdown destroys the lot. Under
 *   less motion the typewriter shows a whole page at once and the box cuts in and out.
 * @structure fill() · pauseAfter() · pages() · cap() · dialogue(scene, opts) → handle (say / ask /
 *   skip / advance / hide / update / destroy, open, el); the box is drawn by ./dialogue-draw.js
 * @usage
 *   const talk = AIMEAT.phaser.dialogue(this, { controls: pad, library: lib });
 *   await talk.say('guide', 'You made it to the ridge.');
 *   const road = await talk.ask('guide', 'Which way?', [{ label: 'High', value: 'high' }, { label: 'Low', value: 'low' }]);
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the box (typewriter, pages, questions, portraits, the
 *     assets-library lookup); cutscene() started here and moved to ./cutscene.js under the
 *     800-line rule.
 */
import { reducedMotion } from '../atelier/dom.js';
import { look, ms, curve } from './tokens.js';
import { panel } from './dialogue-draw.js';

/** The typewriter's pauses, as multiples of the per-letter rate: a sentence end, a clause, a break. */
const PAUSE_END = 7;
const PAUSE_MID = 3;
const PAUSE_LINE = 4;

/** The variable form a text may carry: {n}, {name}. */
const VAR_RE = /\{(\w+)\}/g;

/**
 * Put the variables into a literal. A name with no value is left as written, so a missing one
 * shows up as {n} rather than as the word "undefined".
 * @param {string} text
 * @param {Record<string, any>} [vars]
 * @returns {string}
 */
function fill(text, vars) {
  const value = String(text == null ? '' : text);
  if (!vars) return value;
  return value.replace(VAR_RE, function (whole, name) {
    return vars[name] == null ? whole : String(vars[name]);
  });
}

/**
 * How long the typewriter rests after a letter, as a multiple of its rate. Punctuation pauses only
 * when it ends a word, so "3.14" and "e.g." type straight through.
 * @param {string} ch
 * @param {string} next
 * @returns {number}
 */
function pauseAfter(ch, next) {
  if (ch === '\n') return PAUSE_LINE;
  const endsWord = next === '' || next === ' ' || next === '\n';
  if (!endsWord) return 1;
  if (ch === '.' || ch === '!' || ch === '?') return PAUSE_END;
  if (ch === ',' || ch === ';' || ch === ':') return PAUSE_MID;
  return 1;
}

/**
 * Wrapped lines grouped into pages of the box's height.
 * @param {string[]} lines
 * @param {number} perPage
 * @returns {string[]}
 */
function pages(lines, perPage) {
  const out = [];
  for (let i = 0; i < lines.length; i += perPage) out.push(lines.slice(i, i + perPage).join('\n'));
  return out.length ? out : [''];
}

/** @param {any} s @returns {string} */
function cap(s) {
  const str = String(s == null ? '' : s);
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * @typedef {object} SpeakerSpec
 * @property {string} [name]         what the tab shows. Default: the library's text for
 *   'speaker.<id>' when it has one, otherwise the id with its first letter capitalised.
 * @property {string|number} [tone]  'accent' | 'ok' | 'warn' | 'err' | 'ch1'..'ch4', or a colour number
 * @property {string|false} [portrait]  a texture key; false for no portrait; absent for a disc with
 *   the initial
 */

/**
 * @typedef {object} DialogueOptions
 * @property {any} [controls]    the state from controls(scene): up, down, action and jump are read
 * @property {boolean} [auto]    read the controls on the scene's update event. Default true.
 * @property {any} [library]     an AIMEAT.assets library: t(key, vars) answers in the player's language
 * @property {Record<string, SpeakerSpec>} [speakers]
 * @property {'bottom'|'top'} [position]  Default 'bottom'.
 * @property {number} [rate]     milliseconds per letter. Default: the look's pace over 8. 0 shows a
 *   page at once.
 * @property {number} [lines]    lines per page. Default 3.
 * @property {number} [fontSize] the body face size. Default 18.
 * @property {boolean} [portrait]  false leaves the portrait column out altogether
 * @property {number} [depth]    Default 940: above the HUD, under its toast.
 * @property {any} [theme]       a theme handle. Default: read off the element the game booted into.
 */

/**
 * @typedef {object} LineOptions
 * @property {Record<string, any>} [vars]  values for {name} in the text and the answer labels
 * @property {string} [name]               the tab's text for this line only
 * @property {string|false} [portrait]     a texture key for this line only, or false
 * @property {string|number} [tone]
 * @property {number} [rate]
 */

/**
 * @typedef {object} Choice
 * @property {string} label   shown; looked up in the library like a line
 * @property {any} value      what ask() resolves with
 */

/**
 * @typedef {object} DialogueHandle
 * @property {any} el              the container the box is drawn in
 * @property {boolean} open        is a line on screen; pause your own input while it is
 * @property {(speaker: string, text: string, opts?: LineOptions) => Promise<void>} say
 * @property {(speaker: string, text: string, choices: Choice[], opts?: LineOptions) => Promise<any>} ask
 * @property {() => void} skip     reveal the rest of the line now
 * @property {() => void} advance  what the action button does: reveal, turn the page, close or pick
 * @property {() => void} hide     close the box; a pending say resolves, a pending ask resolves null
 * @property {() => void} update   read the controls once; call per frame when auto is false
 * @property {() => void} destroy
 */

/**
 * The dialogue box for one scene.
 *
 * @param {any} scene
 * @param {DialogueOptions} [opts]
 * @returns {DialogueHandle}
 */
export function dialogue(scene, opts) {
  const o = opts || /** @type {DialogueOptions} */ ({});
  const th = o.theme || look(scene);
  const still = reducedMotion();
  const pace = ms(th.motion, 200);
  const rate = typeof o.rate === 'number' && isFinite(o.rate) ? Math.max(0, o.rate) : Math.max(10, Math.round(pace / 8));
  const lib = o.library && typeof o.library.t === 'function' ? o.library : null;
  const speakers = o.speakers || {};
  const pad = o.controls || null;

  /** @type {any} the line on screen: speaker, text, pages, page, shown, typing, choices, index, rate, resolve */
  let current = null;
  /** @type {any[]} lines waiting their turn */
  const queue = [];
  /** @type {any} the typewriter's one pending timer */
  let timer = null;
  let visible = false;
  let dead = false;
  const held = { act: false, up: false, down: false };

  const view = panel(scene, th, {
    position: o.position, depth: o.depth, fontSize: o.fontSize, lines: o.lines,
    portrait: o.portrait, still: still, pace: pace, ease: curve(th),
  }, { plate: onPlate, row: onRow });

  /**
   * The library's text for a key, or null when it has none: the literal then stands.
   * @param {string} key
   * @param {Record<string, any>} [vars]
   * @returns {string|null}
   */
  function tr(key, vars) {
    if (!lib) return null;
    let got;
    try {
      got = lib.t(key, vars);
    } catch (err) {
      console.warn('[aimeat-phaser] the library could not look up "' + key + '":', err);
      return null;
    }
    return typeof got === 'string' && got !== key ? got : null;
  }

  /**
   * A text as the player reads it: the library's version when it has one, the literal otherwise.
   * @param {any} text
   * @param {Record<string, any>} [vars]
   * @returns {string}
   */
  function words(text, vars) {
    const key = text == null ? '' : String(text);
    return tr(key, vars) || fill(key, vars);
  }

  /**
   * How the box dresses for a speaker on one line.
   * @param {any} speaker
   * @param {LineOptions} lo
   */
  function lookOf(speaker, lo) {
    const id = speaker == null ? '' : String(speaker);
    const sp = speakers[id] || /** @type {SpeakerSpec} */ ({});
    const name = lo.name || sp.name || (id ? tr('speaker.' + id) || cap(id) : '');
    const portrait = lo.portrait !== undefined ? lo.portrait : sp.portrait;
    return {
      name: name,
      tone: lo.tone != null ? lo.tone : sp.tone,
      texture: typeof portrait === 'string' ? portrait : '',
      portrait: portrait !== false,
      initial: name.charAt(0),
    };
  }

  function cancelTimer() {
    if (!timer) return;
    timer.remove(false);
    timer = null;
  }

  /** Put a line on screen. The box is sized for its answers from the start, so nothing jumps. */
  function open(entry) {
    current = entry;
    view.speaker(lookOf(entry.speaker, entry.opts));
    view.layout(entry.choices ? entry.choices.length : 0);
    entry.pages = pages(view.wrap(entry.text), view.lines);
    entry.page = 0;
    startPage();
    if (!visible) {
      visible = true;
      view.show(true);
    }
  }

  /** Begin typing the current page, or show it whole under less motion or at rate 0. */
  function startPage() {
    const cur = current;
    if (!cur) return;
    cancelTimer();
    cur.typing = true;
    cur.shown = 0;
    view.mark(null);
    if (still || cur.rate <= 0) {
      reveal();
      return;
    }
    view.text('');
    tick();
  }

  /** One letter, then one timer for the next. The chain ends with the page. */
  function tick() {
    timer = null;
    const cur = current;
    if (!cur || !cur.typing) return;
    const page = cur.pages[cur.page];
    cur.shown += 1;
    view.text(page.slice(0, cur.shown));
    if (cur.shown >= page.length) {
      finishPage();
      return;
    }
    const ch = page.charAt(cur.shown - 1);
    const next = page.charAt(cur.shown);
    timer = scene.time.delayedCall(cur.rate * pauseAfter(ch, next), tick);
  }

  /** The whole page at once. */
  function reveal() {
    const cur = current;
    if (!cur) return;
    cancelTimer();
    const page = cur.pages[cur.page];
    cur.shown = page.length;
    view.text(page);
    finishPage();
  }

  /** The page is on screen: mark what comes next, or offer the answers. */
  function finishPage() {
    const cur = current;
    if (!cur) return;
    cur.typing = false;
    if (cur.page < cur.pages.length - 1) {
      view.mark('more');
      return;
    }
    if (cur.choices) {
      view.rows(cur.choices.map(function (c) { return c.label; }));
      cur.index = view.select(cur.index);
      return;
    }
    view.mark('next');
  }

  /** Is the current line waiting on an answer? */
  function asking() {
    const cur = current;
    return !!(cur && cur.choices && !cur.typing && cur.page === cur.pages.length - 1);
  }

  /** What the action button does. */
  function advance() {
    const cur = current;
    if (!cur || dead) return;
    if (cur.typing) {
      reveal();
      return;
    }
    if (cur.page < cur.pages.length - 1) {
      cur.page += 1;
      startPage();
      return;
    }
    if (cur.choices) {
      settle(cur.choices[cur.index] ? cur.choices[cur.index].value : null);
      return;
    }
    settle(undefined);
  }

  /** The line is done: hand its value back, and show the next one or take the box away. */
  function settle(value) {
    const cur = current;
    if (!cur) return;
    current = null;
    cancelTimer();
    view.mark(null);
    view.rows([]);
    if (queue.length) open(queue.shift());
    else close();
    cur.resolve(value);
  }

  function close() {
    if (!visible) return;
    visible = false;
    view.show(false);
  }

  /**
   * @param {any} speaker
   * @param {any} text
   * @param {Choice[]|null} choices
   * @param {LineOptions} [lineOpts]
   * @returns {Promise<any>}
   */
  function enqueue(speaker, text, choices, lineOpts) {
    const lo = lineOpts || {};
    return new Promise(function (resolve) {
      if (dead) {
        resolve(choices ? null : undefined);
        return;
      }
      const entry = {
        speaker: speaker,
        opts: lo,
        text: words(text, lo.vars),
        pages: [''],
        page: 0,
        shown: 0,
        typing: false,
        choices: choices,
        index: 0,
        rate: typeof lo.rate === 'number' && isFinite(lo.rate) ? Math.max(0, lo.rate) : rate,
        resolve: resolve,
      };
      if (current) queue.push(entry);
      else open(entry);
    });
  }

  /** A tap on the plate. While answers are showing, only a row is a pick. */
  function onPlate() {
    if (asking()) return;
    advance();
  }

  /**
   * @param {number} i
   * @param {'over'|'down'} kind
   */
  function onRow(i, kind) {
    const cur = current;
    if (!asking() || dead) return;
    cur.index = view.select(i);
    if (kind === 'down') settle(cur.choices[cur.index] ? cur.choices[cur.index].value : null);
  }

  /** Read the controls once. The edges are found here, whatever the app does with the state. */
  function update() {
    const c = pad;
    const act = !!(c && (c.action || c.jump));
    const up = !!(c && c.up);
    const down = !!(c && c.down);
    const actEdge = act && !held.act;
    const upEdge = up && !held.up;
    const downEdge = down && !held.down;
    held.act = act;
    held.up = up;
    held.down = down;
    const cur = current;
    if (!cur || dead) return;
    if (asking()) {
      if (upEdge) cur.index = view.select(cur.index - 1);
      if (downEdge) cur.index = view.select(cur.index + 1);
    }
    if (actEdge) advance();
  }

  const onResize = function () {
    if (dead) return;
    const cur = current;
    view.layout(cur && cur.choices ? cur.choices.length : 0);
    if (!cur) return;
    cur.pages = pages(view.wrap(cur.text), view.lines);
    cur.page = Math.min(cur.page, cur.pages.length - 1);
    reveal();
  };
  if (scene.scale && typeof scene.scale.on === 'function') scene.scale.on('resize', onResize);
  if (o.auto !== false && pad && scene.events) scene.events.on('update', update);

  function destroy() {
    if (dead) return;
    dead = true;
    cancelTimer();
    if (scene.events) {
      scene.events.off('update', update);
      scene.events.off('shutdown', destroy);
    }
    if (scene.scale && typeof scene.scale.off === 'function') scene.scale.off('resize', onResize);
    const pending = queue.splice(0);
    const cur = current;
    current = null;
    view.destroy();
    if (cur) cur.resolve(cur.choices ? null : undefined);
    for (const e of pending) e.resolve(e.choices ? null : undefined);
  }
  if (scene.events && typeof scene.events.once === 'function') scene.events.once('shutdown', destroy);

  return {
    el: view.root,

    get open() { return !!current; },

    /**
     * One line. Resolves when the player has read it and moved on.
     * @param {string} speaker
     * @param {string} text
     * @param {LineOptions} [lineOpts]
     * @returns {Promise<void>}
     */
    say(speaker, text, lineOpts) {
      return enqueue(speaker, text, null, lineOpts);
    },

    /**
     * A question. Resolves with the value of the answer picked; with no answers to offer it
     * behaves as say().
     * @param {string} speaker
     * @param {string} text
     * @param {Choice[]} choices
     * @param {LineOptions} [lineOpts]
     * @returns {Promise<any>}
     */
    ask(speaker, text, choices, lineOpts) {
      const lo = lineOpts || {};
      const list = (Array.isArray(choices) ? choices : [])
        .filter(function (c) { return c && typeof c === 'object'; })
        .map(function (c) {
          return { label: words(c.label == null ? c.value : c.label, lo.vars), value: c.value };
        });
      return enqueue(speaker, text, list.length ? list : null, lo);
    },

    skip() {
      if (current && current.typing) reveal();
    },

    advance: advance,

    hide() {
      for (const e of queue.splice(0)) e.resolve(e.choices ? null : undefined);
      if (current) settle(current.choices ? null : undefined);
      else close();
    },

    update: update,
    destroy: destroy,
  };
}
