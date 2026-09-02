/**
 * @file phaser/mobile.js
 * @description The five things a game meets on a phone and nowhere else: the device is held the
 *   wrong way, the picture runs under a notch or a home bar, the screen dims halfway through a
 *   level, the browser offers to put the game on the home screen, and a hit can be felt as well
 *   as seen. Each one is a different browser API with a different failure, and each one is
 *   answered here so a game asks for it in one line and gets a documented `false` where the
 *   device cannot do it.
 *
 *   THE ORIENTATION PROMPT IS DOM, INSIDE THE FRAME. It mounts in the same element boot.js wraps
 *   around the canvas, so it travels into full screen with the picture, and it is styled by
 *   /lib/aimeat-phaser/mobile.css on the Atelier tokens rather than by anything written here.
 *   Whether it shows is a media query the browser re-answers on its own; this module only listens
 *   for the change and adds or removes one class.
 *
 *   THE LOCK IS ASKED FOR, NEVER RELIED ON. screen.orientation.lock() is refused outside full
 *   screen on every browser that has it, and absent entirely on iOS, so the prompt is the real
 *   answer and the lock is the shortcut taken when full screen makes it available. A refusal is a
 *   warning in the console, not a broken game.
 *
 *   THE SAFE AREA IS MEASURED, NOT GUESSED. env(safe-area-inset-*) has no JavaScript reader, so
 *   the four values are put on a probe element as padding and read back off its computed style.
 *   The probe is built once, kept, and taken away by destroy(). A page with no viewport-fit=cover
 *   reads four zeroes, which is the honest answer for that page.
 *
 *   THE WAKE LOCK COMES BACK BY ITSELF. The browser releases it whenever the tab is hidden and
 *   does not re-acquire it, so a player who takes a call would come back to a dimming screen. A
 *   visibility listener asks again, and only while the game still wants it.
 *
 *   THE INSTALL PROMPT IS CAUGHT AT LOAD. beforeinstallprompt fires once, early, and often before
 *   any game code runs, so the listener is registered when this module loads rather than when
 *   mobile() is called. It stores one event and nothing else; there is no timer and no loop.
 * @structure the module-level install capture · probe() · mobile(handle, opts) returning
 *   orientation / safeArea / keepAwake / install / vibrate / destroy
 * @usage
 *   const m = AIMEAT.phaser.mobile(handle);
 *   m.orientation('landscape'); m.keepAwake(true);
 *   const { canInstall, prompt } = m.install();
 * @version-history
 *   v1.1.0 — 2026-09-02 — Initial: the orientation prompt, the measured safe area, the wake lock
 *     that survives a hidden tab, the captured install prompt and vibrate.
 */

/** The words on the prompt. English, like every other string this library ships. */
const PROMPT_TITLE = 'Turn your phone';
const PROMPT_LANDSCAPE = 'This game is played with the phone on its side.';
const PROMPT_PORTRAIT = 'This game is played with the phone upright.';

/** The deferred install event, caught whenever the browser offers it. */
/** @type {any} */
let installEvent = null;

/**
 * One passive listener for the life of the page. It fires at most once per visit, stores the event
 * the browser hands over, and stops the browser's own banner so the game can choose the moment.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    installEvent = ev;
  });
  window.addEventListener('appinstalled', function () {
    installEvent = null;
  });
}

/** The phone-rotating mark on the prompt. SVG, never an emoji: this interface carries none. */
const ICON_ROTATE = 'M7 3h6a2 2 0 0 1 2 2v6h-2V5H7v14h3v2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm12.5 '
  + '9.5 2.5 3-2.5 3v-2h-4a2 2 0 0 1-2-2v-2h2v2h4v-2z';

/**
 * @param {string} path
 * @returns {SVGElement}
 */
function icon(path) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '40');
  svg.setAttribute('height', '40');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const shape = document.createElementNS(ns, 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('fill', 'currentColor');
  svg.appendChild(shape);
  return svg;
}

/**
 * @typedef {object} SafeArea
 * @property {number} top
 * @property {number} right
 * @property {number} bottom
 * @property {number} left
 */

/**
 * @typedef {object} InstallOffer
 * @property {boolean} canInstall  has the browser offered, and has nobody taken it yet?
 * @property {() => Promise<'accepted'|'dismissed'|'unavailable'>} prompt
 */

/**
 * @typedef {object} MobileOptions
 * @property {'landscape'|'portrait'|'any'} [orientation]  ask for it at once
 * @property {boolean} [keepAwake]                          ask for it at once
 * @property {string} [title]     the prompt's heading. Default 'Turn your phone'.
 * @property {string} [hint]      the line under it. Default depends on the orientation asked for.
 */

/**
 * @typedef {object} MobileHandle
 * @property {(want: 'landscape'|'portrait'|'any') => void} orientation
 * @property {() => SafeArea} safeArea
 * @property {(on: boolean) => Promise<boolean>} keepAwake
 * @property {() => InstallOffer} install
 * @property {(ms: number) => boolean} vibrate
 * @property {() => void} destroy
 */

/**
 * The phone half of a game.
 * @param {any} handle  the handle boot.js's game() returned. Its `frame` is where the prompt
 *   mounts, so the prompt goes full screen with the picture.
 * @param {MobileOptions} [opts]
 * @returns {MobileHandle}
 */
export function mobile(handle, opts) {
  const o = opts || /** @type {MobileOptions} */ ({});
  const frame = handle && handle.frame ? handle.frame
    : (typeof document !== 'undefined' ? document.body : null);
  const doc = frame ? (frame.ownerDocument || document) : null;
  let dead = false;

  /* ── The orientation prompt ────────────────────────────────────────────────────────────── */

  /** @type {'landscape'|'portrait'|'any'} */
  let wanted = 'any';
  /** @type {HTMLElement|null} */
  let prompt = null;
  /** @type {MediaQueryList|null} */
  let query = null;
  /** @type {(() => void)|null} */
  let onTurn = null;

  /** Build the prompt once. It stays in the frame, hidden, until the device is the wrong way. */
  function buildPrompt() {
    if (prompt || !doc || !frame) return;
    prompt = doc.createElement('div');
    prompt.className = 'ak-orient';
    prompt.setAttribute('role', 'status');
    // Announced when it appears, silent when it goes: a screen reader gets the instruction once.
    prompt.setAttribute('aria-live', 'polite');

    const card = doc.createElement('div');
    card.className = 'ak-orient__card';
    card.appendChild(icon(ICON_ROTATE));

    const title = doc.createElement('p');
    title.className = 'ak-orient__title';
    title.textContent = o.title || PROMPT_TITLE;
    card.appendChild(title);

    const hint = doc.createElement('p');
    hint.className = 'ak-orient__hint';
    card.appendChild(hint);

    prompt.appendChild(card);
    frame.appendChild(prompt);
  }

  /** Is the device the way the game asked for? */
  function correct() {
    if (wanted === 'any') return true;
    const portrait = query ? query.matches : false;
    return wanted === 'portrait' ? portrait : !portrait;
  }

  /** Show or hide the prompt, and keep its hint matching what was asked for. */
  function paint() {
    if (dead || !prompt) return;
    const ok = correct();
    prompt.classList.toggle('is-shown', !ok);
    const hint = prompt.querySelector('.ak-orient__hint');
    if (hint) {
      hint.textContent = o.hint
        || (wanted === 'portrait' ? PROMPT_PORTRAIT : PROMPT_LANDSCAPE);
    }
  }

  /**
   * Ask the browser to hold the device this way. It grants this only in full screen, and only
   * where the API exists at all, so the refusal is expected and the prompt is what actually
   * carries the instruction.
   */
  function tryLock() {
    const screenAny = typeof screen !== 'undefined' ? /** @type {any} */ (screen) : null;
    const api = screenAny && screenAny.orientation;
    if (!api || typeof api.lock !== 'function' || wanted === 'any') return;
    if (!doc || !doc.fullscreenElement) return;
    try {
      const asked = api.lock(wanted);
      if (asked && typeof asked.catch === 'function') {
        asked.catch(function (err) {
          console.warn('[aimeat-phaser] the browser would not lock the orientation, so the prompt '
            + 'is doing the asking:', err);
        });
      }
    } catch (err) {
      console.warn('[aimeat-phaser] screen.orientation.lock was refused outright:', err);
    }
  }

  /**
   * Say which way up this game is played. 'any' takes the prompt away and releases the lock.
   * @param {'landscape'|'portrait'|'any'} want
   * @returns {void}
   */
  function orientation(want) {
    if (dead) return;
    wanted = want === 'landscape' || want === 'portrait' ? want : 'any';
    buildPrompt();
    if (!query && typeof matchMedia === 'function') {
      query = matchMedia('(orientation: portrait)');
      onTurn = function () { paint(); tryLock(); };
      // 'change' on a MediaQueryList is the modern door; addListener is the one Safari kept for
      // years. Whichever exists is used, and destroy() removes the same one.
      if (typeof query.addEventListener === 'function') query.addEventListener('change', onTurn);
      else if (typeof (/** @type {any} */ (query).addListener) === 'function') {
        /** @type {any} */ (query).addListener(onTurn);
      }
    }
    if (wanted === 'any') {
      const screenAny = typeof screen !== 'undefined' ? /** @type {any} */ (screen) : null;
      if (screenAny && screenAny.orientation && typeof screenAny.orientation.unlock === 'function') {
        try {
          screenAny.orientation.unlock();
        } catch (err) {
          console.warn('[aimeat-phaser] the orientation lock could not be released:', err);
        }
      }
    }
    paint();
    tryLock();
  }

  /* ── The safe area ─────────────────────────────────────────────────────────────────────── */

  /** @type {HTMLElement|null} */
  let gauge = null;

  /**
   * The four insets, in CSS pixels. Read through a probe because env() has no JavaScript reader:
   * the four values go on as padding and come back off the computed style.
   * @returns {SafeArea}
   */
  function safeArea() {
    const zero = { top: 0, right: 0, bottom: 0, left: 0 };
    if (dead || !doc) return zero;
    if (!gauge) {
      gauge = doc.createElement('div');
      gauge.setAttribute('aria-hidden', 'true');
      gauge.className = 'ak-safe-probe';
      (doc.body || doc.documentElement).appendChild(gauge);
    }
    const style = getComputedStyle(gauge);
    const read = function (name) {
      const n = parseFloat(style.getPropertyValue(name));
      return isFinite(n) ? n : 0;
    };
    return {
      top: read('padding-top'),
      right: read('padding-right'),
      bottom: read('padding-bottom'),
      left: read('padding-left'),
    };
  }

  /* ── The wake lock ─────────────────────────────────────────────────────────────────────── */

  /** @type {any} the sentinel, while one is held. */
  let sentinel = null;
  let awake = false;
  /** @type {(() => void)|null} */
  let onVisible = null;

  /** Ask for the lock. Resolves false where the API is absent or the browser refuses. */
  function acquire() {
    const nav = typeof navigator !== 'undefined' ? /** @type {any} */ (navigator) : null;
    if (!nav || !nav.wakeLock || typeof nav.wakeLock.request !== 'function') {
      return Promise.resolve(false);
    }
    return nav.wakeLock.request('screen').then(
      function (got) {
        sentinel = got;
        // The browser drops the lock on its own when the tab hides; forgetting the sentinel here
        // is what makes the re-acquire below ask for a fresh one instead of holding a dead handle.
        if (got && typeof got.addEventListener === 'function') {
          got.addEventListener('release', function () { sentinel = null; });
        }
        return true;
      },
      function (err) {
        console.warn('[aimeat-phaser] the screen wake lock was refused:', err);
        return false;
      },
    );
  }

  /**
   * Keep the screen on while the game is being played, or stop.
   * @param {boolean} on
   * @returns {Promise<boolean>} whether the lock is held now
   */
  function keepAwake(on) {
    if (dead) return Promise.resolve(false);
    awake = !!on;
    if (!awake) {
      if (sentinel && typeof sentinel.release === 'function') {
        try {
          sentinel.release();
        } catch (err) {
          console.warn('[aimeat-phaser] the wake lock would not release:', err);
        }
      }
      sentinel = null;
      return Promise.resolve(false);
    }
    if (!onVisible && doc) {
      onVisible = function () {
        if (dead || !awake || doc.hidden || sentinel) return;
        acquire();
      };
      doc.addEventListener('visibilitychange', onVisible);
    }
    return acquire();
  }

  /* ── The install offer and the buzz ────────────────────────────────────────────────────── */

  /**
   * What the browser has offered about putting this game on the home screen. `prompt()` shows the
   * browser's own dialog, which may only be called from a real gesture and only once per offer.
   * @returns {InstallOffer}
   */
  function install() {
    return {
      canInstall: !!installEvent,
      prompt() {
        const ev = installEvent;
        if (!ev || typeof ev.prompt !== 'function') {
          return Promise.resolve(/** @type {'unavailable'} */ ('unavailable'));
        }
        // The event is spent whether the person accepts or not, so it is dropped before the
        // dialog rather than after: a second call would otherwise be refused by the browser.
        installEvent = null;
        try {
          ev.prompt();
        } catch (err) {
          console.warn('[aimeat-phaser] the install prompt was refused:', err);
          return Promise.resolve(/** @type {'unavailable'} */ ('unavailable'));
        }
        return Promise.resolve(ev.userChoice).then(
          function (choice) {
            return choice && choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
          },
          function (err) {
            console.warn('[aimeat-phaser] the install prompt gave no answer:', err);
            return 'dismissed';
          },
        );
      },
    };
  }

  /**
   * A short buzz where the device has one. Returns whether anything happened, so a game can pair
   * the buzz with something visible rather than relying on it.
   * @param {number} ms
   * @returns {boolean}
   */
  function vibrate(ms) {
    const n = typeof ms === 'number' && isFinite(ms) ? Math.max(1, Math.min(1000, ms)) : 20;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
    try {
      return !!navigator.vibrate(n);
    } catch (err) {
      console.warn('[aimeat-phaser] vibrate was refused:', err);
      return false;
    }
  }

  /* ── The end ───────────────────────────────────────────────────────────────────────────── */

  /** Every listener removed, every element taken out, the lock released. */
  function destroy() {
    if (dead) return;
    dead = true;
    if (query && onTurn) {
      if (typeof query.removeEventListener === 'function') query.removeEventListener('change', onTurn);
      else if (typeof (/** @type {any} */ (query).removeListener) === 'function') {
        /** @type {any} */ (query).removeListener(onTurn);
      }
    }
    query = null;
    onTurn = null;
    if (onVisible && doc) doc.removeEventListener('visibilitychange', onVisible);
    onVisible = null;
    awake = false;
    if (sentinel && typeof sentinel.release === 'function') {
      try {
        sentinel.release();
      } catch (err) {
        console.warn('[aimeat-phaser] the wake lock would not release on the way out:', err);
      }
    }
    sentinel = null;
    if (prompt && prompt.parentNode) prompt.parentNode.removeChild(prompt);
    prompt = null;
    if (gauge && gauge.parentNode) gauge.parentNode.removeChild(gauge);
    gauge = null;
  }

  if (o.orientation) orientation(o.orientation);
  if (o.keepAwake) keepAwake(true);

  return {
    orientation: orientation,
    safeArea: safeArea,
    keepAwake: keepAwake,
    install: install,
    vibrate: vibrate,
    destroy: destroy,
  };
}
