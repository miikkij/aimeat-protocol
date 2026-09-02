/**
 * @file assets/library.js
 * @description The store around one manifest: load it, read it, add to it, save it, and prove its
 *   files are really there before a game ships.
 *
 *   ONE MEMORY KEY PER APP. The manifest is a record, not a row per sprite: the node allows
 *   1024 kB per value and 1000 keys per person, so a key per file would spend a person's whole
 *   allowance on one game's art. save() writes it PUBLIC, which is what lets a player who is
 *   signed out read it through AIMEAT.data.getPublic(ownerGhii, key), where ownerGhii is the GHII
 *   of whoever published the game ('alice@node-id'), not the player's own.
 *
 *   IT WORKS WITH NOTHING ELSE ON THE PAGE. Without the data library, load() falls back to a
 *   manifest the app passed inline, and to an empty library after that; it never throws for a
 *   missing library, because a game that cannot boot without a login is a game nobody plays. save()
 *   is the one call that needs the data library, and it says so in words.
 *
 *   NOTHING FETCHES ON ITS OWN. check() is the only network call in this file and it happens when
 *   the app asks. It answers with the files that are actually missing and the status each address
 *   gave, so a broken manifest is found before a player finds it.
 * @structure the AIMEAT handles · budget guard · library(spec) building
 *   load/get/set/save/add/url/has/list/toPack/t/lang/check/onChange/destroy
 * @usage
 *   const lib = AIMEAT.assets.library({ app: 'ridge' });
 *   await lib.load();
 *   const report = await lib.check();
 *   preloadPack(this, lib.toPack());
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial: the one-key store, the public save, add() after an upload,
 *     the Phaser pack hand-over, the text lookup and check().
 */
import { manifest, rows, files, addressOf, kindOf, withEntry, absolute, refuse, MANIFEST_SPEC } from './manifest.js';
import { detectLang, lookup } from './texts.js';

/** How much of a value the node keeps: 1024 kB. Past this, the write is refused rather than lost. */
const VALUE_LIMIT = 1024 * 1024;

/** Where a manifest is big enough to be worth saying so, before it is big enough to be refused. */
const VALUE_WARN = Math.round(VALUE_LIMIT * 0.75);

/** How many addresses check() has in the air at once. Enough to be quick, few enough to be polite. */
const CHECK_PARALLEL = 6;

/** The memory library, when the page loaded one. */
function dataLib() {
  const root = typeof window !== 'undefined' ? /** @type {any} */ (window).AIMEAT : null;
  return root && root.data ? root.data : null;
}

/**
 * @typedef {object} LibrarySpec
 * @property {string} app                  the app these files belong to
 * @property {string} [key]                the memory key. Default: app + '.assets'
 * @property {string} [lang]               the language texts are read in. Default: the platform's
 * @property {any} [manifest]              a manifest to use when there is no data library and no
 *   stored record: an app can ship its own and still get every operation here
 */

/**
 * Probe one address. HEAD is the cheap question; a server that will not answer HEAD is asked with
 * GET instead, because a 405 says nothing about whether the file exists.
 * @param {string} url
 * @returns {Promise<number>} the status, or 0 when the request itself did not complete
 */
async function probe(url) {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (head.status !== 405 && head.status !== 501) return head.status;
  } catch {
    /* HEAD was refused outright (CORS, offline): GET below is the second and last question */
  }
  try {
    const got = await fetch(url, { method: 'GET' });
    // The body is not wanted, and leaving it unread holds the connection open.
    if (got.body && typeof got.body.cancel === 'function') await got.body.cancel();
    return got.status;
  } catch {
    return 0;
  }
}

/**
 * The asset store for one app.
 *
 * @param {LibrarySpec} spec
 * @returns {any}
 */
export function library(spec) {
  const s = spec || /** @type {LibrarySpec} */ ({});
  if (typeof s.app !== 'string' || !s.app.trim()) {
    refuse('library() needs `app`: the name of the app whose assets these are.');
  }
  const app = s.app.trim();
  const key = s.key || (app + '.assets');
  const inline = s.manifest || null;

  let current = manifest({ app: app, version: 1 });
  let language = s.lang ? String(s.lang).slice(0, 2) : detectLang();
  let alive = true;
  /** @type {Array<(man: any) => void>} */
  let listeners = [];

  /** Tell whoever is watching that the manifest changed. One bad listener never stops the rest. */
  function announce() {
    for (const cb of listeners.slice()) {
      try { cb(current); } catch (err) { console.warn('[aimeat-assets] an onChange listener threw:', err); }
    }
  }

  /** Take a manifest in, whatever shape it arrived in, and make it this library's. */
  function adopt(value) {
    current = manifest(Object.assign({}, value, { app: value && value.app ? value.app : app }));
    announce();
    return current;
  }

  const store = {
    /** The memory key this library reads and writes. */
    key: key,

    /** The app these assets belong to. */
    app: app,

    /**
     * Read the manifest: the stored record when the data library is on the page, the manifest the
     * app passed inline otherwise, and an empty library when there is neither. It never throws, so
     * a game boots for a player who is signed out and for a page with no AIMEAT libraries at all.
     * @returns {Promise<any>}
     */
    async load() {
      const data = dataLib();
      if (data && typeof data.get === 'function') {
        try {
          const stored = await data.get(key);
          if (stored && typeof stored === 'object') {
            if (stored.spec && stored.spec !== MANIFEST_SPEC) {
              console.warn('[aimeat-assets] "' + key + '" says it is ' + stored.spec + ', not '
                + MANIFEST_SPEC + '. Reading it anyway; save() will rewrite it in this shape.');
            }
            return adopt(stored);
          }
        } catch (err) {
          console.warn('[aimeat-assets] "' + key + '" did not load, carrying on with what is on '
            + 'the page:', err);
        }
      }
      if (inline) {
        try { return adopt(inline); } catch (err) {
          console.warn('[aimeat-assets] the inline manifest was refused:', err);
        }
      }
      return current;
    },

    /** The manifest as it stands, already validated and frozen. @returns {any} */
    get() { return current; },

    /**
     * Replace the manifest. It goes through the same validation as manifest(), so a record built by
     * hand cannot slip past the data: URI refusal or the key rules.
     * @param {any} value
     * @returns {any}
     */
    set(value) { return adopt(value); },

    /**
     * Write the manifest to memory, PUBLIC, so the game's players read it signed out with
     * AIMEAT.data.getPublic(ownerGhii, key). `ownerGhii` there is the GHII of the person who
     * published the game ('alice@node-id'), which the app knows and the player does not have to.
     * @returns {Promise<any>}
     */
    async save() {
      const data = dataLib();
      if (!data || typeof data.set !== 'function') {
        refuse('save() needs the memory library. Add '
          + '<script src="/v1/libs/aimeat-data.js"></script> to the page (after aimeat-auth.js). '
          + 'Everything else in this library works without it.');
      }
      const size = JSON.stringify(current).length;
      if (size > VALUE_LIMIT) {
        refuse('the manifest is ' + Math.round(size / 1024) + ' kB and a memory value holds 1024 kB. '
          + 'Nothing was written. Split the app into two manifests (one per chapter, say), or move '
          + 'the long texts into their own record.');
      }
      if (size > VALUE_WARN) {
        console.warn('[aimeat-assets] the manifest is ' + Math.round(size / 1024) + ' kB of the '
          + '1024 kB a memory value holds. Time to think about splitting it.');
      }
      return data.set(key, current, { visibility: 'public' });
    },

    /**
     * Write one entry, after an upload put the file somewhere a player can read it.
     *
     * The whole sequence, which is the only one this library asks an app to remember:
     *   const put = await AIMEAT.assets.upload(blob, { app: 'ridge', kind: 'images' });
     *   lib.add('images', 'hero', { file: put.url, w: 32, h: 40, bytes: put.bytes });
     *   await lib.save();
     *
     * @param {string} kind   'images' | 'atlases' | 'audio' | 'fonts' | 'tilemaps' | 'videos'
     * @param {string} entryKey
     * @param {any} meta      the entry, as manifest() describes it for that kind
     * @returns {any} the new manifest
     */
    add(kind, entryKey, meta) {
      current = withEntry(current, kind, entryKey, meta);
      announce();
      return current;
    },

    /**
     * The address of one named file, resolved against the manifest's base and the node.
     * @param {string} name
     * @returns {string|null} null when nothing in the manifest carries that key
     */
    url(name) { return addressOf(current, name); },

    /**
     * Is this key in the manifest at all.
     * @param {string} name
     * @returns {boolean}
     */
    has(name) { return kindOf(current, name) !== null; },

    /**
     * One row per key, for a table or a picker.
     * @param {string} [kind]  one group, or every group when omitted
     * @returns {import('./manifest.js').AssetRow[]}
     */
    list(kind) { return rows(current, kind); },

    /**
     * The manifest as a Phaser resource pack, in the shape AIMEAT.phaser.pack() and preloadPack()
     * both read: images without a frame strip stay images, images WITH one become spritesheets,
     * atlases stay atlases, audio keeps its mp3 and ogg pair, tilemaps are Tiled JSON, and a font
     * that carries `data` becomes a bitmap font. Every address is already resolved.
     * @returns {any}
     */
    toPack() {
      const man = current;
      /** @type {Record<string, string>} */
      const images = {};
      /** @type {Record<string, any>} */
      const spritesheets = {};
      for (const name of Object.keys(man.images)) {
        const entry = man.images[name];
        const url = absolute(entry.file, man.base);
        if (entry.frames) {
          spritesheets[name] = {
            url: url,
            frameWidth: entry.frames.frameWidth,
            frameHeight: entry.frames.frameHeight,
          };
        } else {
          images[name] = url;
        }
      }
      /** @type {Record<string, any>} */
      const atlases = {};
      for (const name of Object.keys(man.atlases)) {
        atlases[name] = {
          texture: absolute(man.atlases[name].texture, man.base),
          data: absolute(man.atlases[name].data, man.base),
        };
      }
      /** @type {Record<string, string[]>} */
      const audio = {};
      for (const name of Object.keys(man.audio)) {
        audio[name] = man.audio[name].files.map(function (one) { return absolute(one, man.base); });
      }
      /** @type {Record<string, string>} */
      const tilemaps = {};
      for (const name of Object.keys(man.tilemaps)) {
        tilemaps[name] = absolute(man.tilemaps[name].file, man.base);
      }
      /** @type {Record<string, any>} */
      const bitmapFonts = {};
      for (const name of Object.keys(man.fonts)) {
        const entry = man.fonts[name];
        if (!entry.data) continue;
        bitmapFonts[name] = {
          texture: absolute(entry.file, man.base),
          data: absolute(entry.data, man.base),
        };
      }
      return {
        id: man.app,
        base: absolute(man.base || './', ''),
        images: images,
        spritesheets: spritesheets,
        atlases: atlases,
        audio: audio,
        tilemaps: tilemaps,
        json: {},
        bitmapFonts: bitmapFonts,
      };
    },

    /**
     * One text, in the library's language, with {var} filled in and English behind it.
     * @param {string} name
     * @param {Record<string, any>} [vars]
     * @returns {string}
     */
    t(name, vars) { return lookup(current.texts, language, name, vars); },

    /**
     * Read or set the language texts come back in. Setting it tells onChange listeners, so a
     * gallery or a menu redraws in the new language without being asked twice.
     * @param {string} [code]
     * @returns {string}
     */
    lang(code) {
      if (code == null) return language;
      const next = String(code).slice(0, 2);
      if (next !== language) {
        language = next;
        announce();
      }
      return language;
    },

    /**
     * Ask every address in the manifest whether it is there. This is the one call in this library
     * that reaches the network by itself, and it happens because the app asked.
     *
     * `ok` is every key whose files all answered. `missing` is one row per file that did not, with
     * the status the address gave (0 when the request never completed at all).
     *
     * @returns {Promise<{ ok: string[], missing: Array<{ key: string, url: string, status: number }> }>}
     */
    async check() {
      const list = files(current);
      /** @type {Array<{ key: string, url: string, status: number }>} */
      const missing = [];
      /** @type {Record<string, boolean>} */
      const broken = {};
      /** @type {Record<string, boolean>} */
      const seen = {};
      let next = 0;

      const worker = async function () {
        while (next < list.length) {
          const item = list[next];
          next += 1;
          seen[item.key] = true;
          const status = await probe(item.url);
          if (status < 200 || status >= 400) {
            broken[item.key] = true;
            missing.push({ key: item.key, url: item.url, status: status });
          }
        }
      };
      const crew = [];
      for (let i = 0; i < Math.min(CHECK_PARALLEL, list.length); i++) crew.push(worker());
      await Promise.all(crew);

      const ok = Object.keys(seen).filter(function (name) { return !broken[name]; });
      return { ok: ok, missing: missing };
    },

    /**
     * Watch the manifest. The callback runs on set(), add(), load() and a language change.
     * @param {(man: any) => void} fn
     * @returns {() => void} stop watching
     */
    onChange(fn) {
      if (typeof fn !== 'function' || !alive) return function () { /* nothing to stop */ };
      listeners.push(fn);
      return function () {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },

    /** Drop every listener. The manifest stays readable; nothing is left running. */
    destroy() {
      alive = false;
      listeners = [];
    },
  };

  return store;
}
