/**
 * @file assets/preview.js
 * @description The manifest as a screen: what is in this app's library, at what size, in what
 *   languages, and what is broken.
 *
 *   IT IS THE ANSWER TO "WHAT DO WE ACTUALLY HAVE". A manifest is JSON, and JSON does not show that
 *   two coins are the same coin, that the music is 4 MB, or that the Finnish menu is missing three
 *   lines. A gallery does, in one look.
 *
 *   IT DRESSES IN WHATEVER THE PAGE IS WEARING. Every element is built with the Atelier kit's el()
 *   when the kit is on the page and with plain DOM when it is not, and every class is .ak-assets*,
 *   styled entirely from the --ak-* tokens. On a page with the kit it matches the app around it; on
 *   a page without, the tokens' own fallbacks stand in.
 *
 *   THE MOTION IS FINITE AND ASKED FOR. A sprite strip plays through ONCE when a pointer rests on
 *   it and then stops on its first frame; a sound plays when a person presses its button, which is
 *   also the gesture a browser requires before any audio at all. Nothing loops, nothing autoplays,
 *   and an idle gallery is doing nothing. Under reduced motion the strip does not move at all.
 *
 *   IT DRAWS THE PICTURES, so the browser loads them: that is what a gallery is. The only other
 *   network call is check(), and only when the caller asks for it with { check: true }.
 * @structure builder() (Atelier's el, or a local one) · icons · formatting · the sections
 *   (images, atlases, audio, fonts, files, texts) · preview(target, library, opts)
 * @usage
 *   const gallery = AIMEAT.assets.preview('#library', lib, { check: true });
 *   gallery.refresh();
 *   gallery.destroy();
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial: the gallery, the frames strip on hover, the audio rows, the
 *     side-by-side texts table, the font specimens and the missing-file marks.
 */
import { refuse } from './manifest.js';
import { languages, textKeys } from './texts.js';

/** How long one frame of a sprite strip is held while the strip plays through. */
const FRAME_MS = 90;

/** The specimen line a font is shown with: letters, numbers, and enough of both to judge by. */
const SPECIMEN = 'The quick brown fox jumps 0123456789';

/**
 * The element builder: the Atelier kit's, so a gallery inside a kit app is built by the same code
 * as everything around it, and an identical local one when the kit is absent.
 * @returns {(tag: string, attrs?: any, kids?: any) => HTMLElement}
 */
function builder() {
  const root = typeof window !== 'undefined' ? /** @type {any} */ (window).AIMEAT : null;
  if (root && root.atelier && typeof root.atelier.el === 'function') return root.atelier.el;
  return function (tag, attrs, kids) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const name of Object.keys(attrs)) {
        const value = attrs[name];
        if (value == null || value === false) continue;
        if (name === 'text') { node.textContent = String(value); continue; }
        if (name === 'on') {
          for (const type of Object.keys(value)) node.addEventListener(type, value[type]);
          continue;
        }
        if (name === 'vars') {
          for (const key of Object.keys(value)) node.style.setProperty(key, String(value[key]));
          continue;
        }
        if (name === 'children') continue;
        node.setAttribute(name, value === true ? '' : String(value));
      }
      if (attrs.children != null) put(node, attrs.children);
    }
    if (kids != null) put(node, kids);
    return node;
  };
}

/**
 * Append a string, a node, or an array of either.
 * @param {Node} parent
 * @param {any} kids
 */
function put(parent, kids) {
  const list = Array.isArray(kids) ? kids : [kids];
  for (const kid of list) {
    if (kid == null || kid === false) continue;
    parent.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
}

/** Whether this viewer has asked for less movement, through the system or through the kit. */
function lessMotion() {
  try {
    const root = document.documentElement;
    if (root && root.getAttribute('data-ak-motion') === 'less') return true;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    /* no matchMedia (a very old browser, a test harness): the strip may move */
    return false;
  }
}

/**
 * An inline SVG icon. There are two, both controls: play and pause.
 * @param {string} name
 * @returns {SVGElement}
 */
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', name === 'pause'
    ? 'M4 3h3v10H4zM9 3h3v10H9z'
    : 'M5 3l8 5-8 5z');
  svg.appendChild(path);
  return svg;
}

/**
 * Bytes as a person reads them.
 * @param {number} bytes
 * @returns {string}
 */
function size(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' kB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * The line under a thumbnail: size in pixels, frames, weight in bytes, licence.
 * @param {any} row
 * @returns {string}
 */
function facts(row) {
  const parts = [];
  if (row.w && row.h) parts.push(row.w + '×' + row.h);
  if (row.frames) parts.push(row.frames + ' frames');
  if (row.bytes) parts.push(size(row.bytes));
  if (row.licence) parts.push(row.licence);
  return parts.join(' · ');
}

/**
 * One picture. Without a frame strip it is an <img>; with one it is a box that plays the strip
 * through once while a pointer rests on it.
 * @param {any} ctx     the gallery's shared state
 * @param {any} row
 * @returns {HTMLElement}
 */
function imageCard(ctx, row) {
  const el = ctx.el;
  let thumb;
  if (row.frames > 1) {
    thumb = el('div', {
      class: 'ak-assets__thumb ak-assets__thumb--strip',
      vars: { '--aka-strip': 'url("' + encodeURI(row.url) + '")', '--aka-frames': String(row.frames) },
      role: 'img',
      'aria-label': row.key + ', ' + row.frames + ' frames',
    });
    if (!ctx.still) {
      const play = function () {
        if (thumb.dataset.running === '1') return;
        thumb.dataset.running = '1';
        let frame = 0;
        const timer = setInterval(function () {
          frame += 1;
          if (frame >= row.frames) {
            clearInterval(timer);
            ctx.timers.delete(timer);
            thumb.dataset.running = '';
            frame = 0;
          }
          thumb.style.setProperty('--aka-frame', String(frame));
        }, FRAME_MS);
        ctx.timers.add(timer);
      };
      thumb.addEventListener('mouseenter', play);
      thumb.addEventListener('focus', play);
    }
  } else {
    thumb = el('img', {
      class: 'ak-assets__thumb',
      src: row.url,
      alt: row.key,
      loading: 'lazy',
      decoding: 'async',
    });
  }

  const card = el('figure', { class: 'ak-assets__card', tabindex: '0' }, [
    el('div', { class: 'ak-assets__frame' }, thumb),
    el('figcaption', { class: 'ak-assets__caption' }, [
      el('span', { class: 'ak-assets__key', text: row.key }),
      el('span', { class: 'ak-assets__facts', text: facts(row) }),
    ]),
  ]);
  ctx.marks.push({ key: row.key, node: card });
  return card;
}

/**
 * One sound: its name, what it weighs, and a button that plays it. The <audio> element is made on
 * the press, which is both the cheap way and the way a browser allows sound at all.
 * @param {any} ctx
 * @param {any} row
 * @returns {HTMLElement}
 */
function audioRow(ctx, row) {
  const el = ctx.el;
  const button = el('button', {
    type: 'button',
    class: 'ak-assets__play',
    'aria-label': 'Play ' + row.key,
  }, icon('play'));

  button.addEventListener('click', function () {
    if (ctx.playing && ctx.playing.button === button) {
      ctx.playing.audio.pause();
      return;
    }
    if (ctx.playing) ctx.playing.audio.pause();
    const audio = new Audio(row.url);
    const stop = function () {
      button.replaceChildren(icon('play'));
      button.setAttribute('aria-label', 'Play ' + row.key);
      if (ctx.playing && ctx.playing.button === button) ctx.playing = null;
    };
    audio.addEventListener('ended', stop);
    audio.addEventListener('pause', stop);
    audio.addEventListener('error', function () {
      stop();
      row.node.classList.add('is-missing');
    });
    ctx.playing = { audio: audio, button: button };
    button.replaceChildren(icon('pause'));
    button.setAttribute('aria-label', 'Pause ' + row.key);
    const started = audio.play();
    if (started && typeof started.catch === 'function') started.catch(stop);
  });

  const node = el('li', { class: 'ak-assets__row' }, [
    button,
    el('span', { class: 'ak-assets__key', text: row.key }),
    el('span', { class: 'ak-assets__facts', text: facts(row) }),
  ]);
  row.node = node;
  ctx.marks.push({ key: row.key, node: node });
  return node;
}

/**
 * A font, shown as the sentence it will be read in. The file itself is NOT loaded here: a specimen
 * asks for the family by name, and the app's own stylesheet is what puts it on the page.
 * @param {any} ctx
 * @param {string} key
 * @param {any} entry
 * @returns {HTMLElement}
 */
function fontRow(ctx, key, entry) {
  const el = ctx.el;
  const weights = Array.isArray(entry.weights) && entry.weights.length
    ? entry.weights.join(', ')
    : '';
  const node = el('li', { class: 'ak-assets__row ak-assets__row--font' }, [
    el('span', { class: 'ak-assets__key', text: key }),
    el('span', {
      class: 'ak-assets__specimen',
      vars: { '--aka-family': entry.family },
      text: SPECIMEN,
    }),
    el('span', {
      class: 'ak-assets__facts',
      text: [entry.family, weights, entry.data ? 'bitmap' : ''].filter(Boolean).join(' · '),
    }),
  ]);
  ctx.marks.push({ key: key, node: node });
  return node;
}

/**
 * A plain row for the kinds that have nothing to show but their address: atlases, tilemaps, videos.
 * @param {any} ctx
 * @param {any} row
 * @param {string} [extra]
 * @returns {HTMLElement}
 */
function fileRow(ctx, row, extra) {
  const el = ctx.el;
  const node = el('li', { class: 'ak-assets__row' }, [
    el('span', { class: 'ak-assets__key', text: row.key }),
    el('span', { class: 'ak-assets__file', text: row.file }),
    el('span', { class: 'ak-assets__facts', text: [facts(row), extra].filter(Boolean).join(' · ') }),
  ]);
  ctx.marks.push({ key: row.key, node: node });
  return node;
}

/**
 * A section with a heading and a count, or nothing at all when the group is empty. An empty section
 * is a row of noise in a gallery whose whole job is to show what is there.
 * @param {any} ctx
 * @param {string} title
 * @param {number} count
 * @param {HTMLElement} body
 * @returns {HTMLElement}
 */
function section(ctx, title, count, body) {
  const el = ctx.el;
  return el('section', { class: 'ak-assets__section' }, [
    el('h3', { class: 'ak-assets__head' }, [
      el('span', { text: title }),
      el('span', { class: 'ak-assets__count', text: String(count) }),
    ]),
    body,
  ]);
}

/**
 * The texts, every language beside every other. A blank cell is a gap in that language, and the
 * gap is the point of showing them side by side.
 * @param {any} ctx
 * @param {any} texts
 * @returns {HTMLElement|null}
 */
function textsTable(ctx, texts) {
  const el = ctx.el;
  const langs = languages(texts);
  const keys = textKeys(texts);
  if (!keys.length) return null;

  const head = el('tr', {}, [el('th', { scope: 'col', text: 'key' })].concat(
    langs.map(function (lang) { return el('th', { scope: 'col', text: lang }); }),
  ));
  const body = keys.map(function (key) {
    const cells = [el('th', { scope: 'row', class: 'ak-assets__key', text: key })];
    for (const lang of langs) {
      const value = texts[lang] ? texts[lang][key] : null;
      cells.push(el('td', {
        class: value == null ? 'ak-assets__cell is-gap' : 'ak-assets__cell',
        text: value == null ? '' : value,
      }));
    }
    return el('tr', {}, cells);
  });

  return el('table', { class: 'ak-assets__table' }, [
    el('thead', {}, head),
    el('tbody', {}, body),
  ]);
}

/**
 * Build the whole gallery from the manifest as it stands.
 * @param {any} ctx
 * @returns {HTMLElement}
 */
function build(ctx) {
  const el = ctx.el;
  const man = ctx.library.get();
  ctx.marks = [];

  /** @type {HTMLElement[]} */
  const sections = [];
  const images = ctx.library.list('images');
  if (images.length) {
    sections.push(section(ctx, 'Images', images.length,
      el('div', { class: 'ak-assets__grid' }, images.map(function (row) {
        return imageCard(ctx, row);
      }))));
  }

  const atlases = ctx.library.list('atlases');
  if (atlases.length) {
    sections.push(section(ctx, 'Atlases', atlases.length,
      el('ul', { class: 'ak-assets__rows' }, atlases.map(function (row) {
        const frames = man.atlases[row.key].frames;
        return fileRow(ctx, row, frames && frames.length ? frames.length + ' frames' : '');
      }))));
  }

  const audio = ctx.library.list('audio');
  if (audio.length) {
    sections.push(section(ctx, 'Audio', audio.length,
      el('ul', { class: 'ak-assets__rows' }, audio.map(function (row) {
        return audioRow(ctx, row);
      }))));
  }

  const fonts = Object.keys(man.fonts || {});
  if (fonts.length) {
    sections.push(section(ctx, 'Fonts', fonts.length,
      el('ul', { class: 'ak-assets__rows' }, fonts.map(function (key) {
        return fontRow(ctx, key, man.fonts[key]);
      }))));
  }

  for (const kind of ['tilemaps', 'videos']) {
    const rows = ctx.library.list(kind);
    if (!rows.length) continue;
    sections.push(section(ctx, kind === 'tilemaps' ? 'Tilemaps' : 'Videos', rows.length,
      el('ul', { class: 'ak-assets__rows' }, rows.map(function (row) {
        return fileRow(ctx, row);
      }))));
  }

  const table = textsTable(ctx, man.texts);
  if (table) {
    sections.push(section(ctx, 'Texts', textKeys(man.texts).length, table));
  }

  if (!sections.length) {
    sections.push(el('p', { class: 'ak-assets__empty', text: 'Nothing in this library yet.' }));
  }

  return el('div', { class: 'ak-assets' }, [
    el('header', { class: 'ak-assets__bar' }, [
      el('h2', { class: 'ak-assets__title', text: ctx.title || man.app }),
      el('p', {
        class: 'ak-assets__summary',
        text: [man.meta.count + ' files', size(man.meta.bytes), 'v' + man.version]
          .filter(Boolean).join(' · '),
      }),
    ]),
    el('div', { class: 'ak-assets__body' }, sections),
  ]);
}

/**
 * Show a library on screen.
 *
 * @param {string|HTMLElement} target   a selector or the element to draw into
 * @param {any} library                 what AIMEAT.assets.library() returned
 * @param {{ check?: boolean, title?: string }} [opts]  `check: true` asks every address whether it
 *   is there and marks the ones that are not; without it the gallery makes no requests of its own
 *   beyond the pictures it draws
 * @returns {{ el: HTMLElement, refresh: () => Promise<void>, destroy: () => void }}
 */
export function preview(target, library, opts) {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) refuse('preview() could not find "' + target + '" on the page.');
  if (!library || typeof library.get !== 'function') {
    refuse('preview() takes the object AIMEAT.assets.library() returned.');
  }
  const o = opts || {};

  const ctx = {
    el: builder(),
    library: library,
    title: o.title || '',
    still: lessMotion(),
    /** @type {Set<any>} */
    timers: new Set(),
    /** @type {Array<{ key: string, node: HTMLElement }>} */
    marks: [],
    /** @type {any} */
    playing: null,
  };

  let node = build(ctx);
  /** @type {any} */ (host).appendChild(node);

  /** Stop anything this gallery started, before it is rebuilt or thrown away. */
  function quiet() {
    for (const timer of ctx.timers) clearInterval(timer);
    ctx.timers.clear();
    if (ctx.playing) {
      ctx.playing.audio.pause();
      ctx.playing = null;
    }
  }

  /** Put the missing-file marks on, from a check report. */
  function mark(report) {
    /** @type {Record<string, boolean>} */
    const broken = {};
    for (const row of report.missing) broken[row.key] = true;
    for (const item of ctx.marks) {
      item.node.classList.toggle('is-missing', broken[item.key] === true);
    }
  }

  /** Ask the library which files are really there, and mark what is not. */
  async function runCheck() {
    try {
      mark(await library.check());
    } catch (err) {
      console.warn('[aimeat-assets] the file check did not finish:', err);
    }
  }

  const gallery = {
    /** The element the gallery lives in, so an app can place it, hide it or measure it. */
    el: node,

    /**
     * Draw it again from the manifest as it now stands. With `check: true` it also asks every
     * address whether it is there and marks what is not.
     * @returns {Promise<void>}
     */
    async refresh() {
      quiet();
      const next = build(ctx);
      node.replaceWith(next);
      node = next;
      gallery.el = next;
      if (o.check) await runCheck();
    },

    /** Take it off the page and leave nothing running. */
    destroy() {
      quiet();
      stopWatching();
      if (node.parentNode) node.parentNode.removeChild(node);
    },
  };

  // The gallery follows the manifest: add() or set() redraws it, and so does a language change.
  const stopWatching = typeof library.onChange === 'function'
    ? library.onChange(function () { void gallery.refresh(); })
    : function () { /* a library with no onChange is a manifest that will not move */ };

  if (o.check) void runCheck();

  return gallery;
}
