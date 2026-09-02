// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/assets/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-assets.js (with a per-node config prelude).
"use strict";
(() => {
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

  // src/static/sdk-libs/_core/config.js
  function cfg() {
    return window.__AIMEAT_SDK_CFG__ || { nodeId: "", baseUrl: "" };
  }
  function resolveNodeUrl() {
    const meta = document.querySelector('meta[name="aimeat-node"]');
    if (meta) return (meta.getAttribute("content") || "").replace(/\/$/, "");
    if (location.protocol === "http:" || location.protocol === "https:") return location.origin;
    if (typeof self !== "undefined" && typeof self.origin === "string" && self.origin.indexOf("http") === 0) {
      return self.origin;
    }
    return cfg().baseUrl;
  }
  var NODE_URL = resolveNodeUrl();
  var APEX_URL = cfg().baseUrl;
  var NODE_ID = cfg().nodeId;
  var HEARTBEAT_MS = cfg().heartbeatMs || 3e4;

  // src/static/sdk-libs/assets/manifest.js
  var MANIFEST_SPEC = "aimeat.assets.manifest/v1";
  var KINDS = ["images", "atlases", "audio", "fonts", "tilemaps", "videos"];
  var KEY_RE = /^[a-z0-9]+(?:[-./][a-z0-9]+)*$/;
  var SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
  function refuse(message) {
    throw new Error("[aimeat-assets] " + message);
  }
  function checkKey(kind, key) {
    if (typeof key !== "string" || !key) refuse("a " + kind + " entry has no key. A key is the name a scene draws with.");
    if (!KEY_RE.test(key)) {
      refuse("the " + kind + ' key "' + key + '" is not an address. Use lowercase letters, digits and dashes (dots and slashes separate parts), for example "' + slug(key) + '". A key is what your code names for years while the file behind it is replaced.');
    }
  }
  function slug(value) {
    const out = String(value).toLowerCase().replace(/[^a-z0-9./]+/g, "-").replace(/^-+|-+$/g, "");
    return out || "asset";
  }
  function checkAddress(value, where) {
    if (typeof value !== "string" || !value.trim()) {
      refuse(where + " needs an address. Upload the file first, then put the address it answered with here.");
    }
    const address = value.trim();
    if (address.slice(0, 5).toLowerCase() === "data:") {
      refuse(where + " is a data: URI, and the manifest will not carry one. The record is ONE memory value with 1024 kB to spend, and a base64 blob spends it on every load forever. Upload the file (AIMEAT.assets.upload) and put its /v1/pub/<owner>/<key> address here instead.");
    }
    return address;
  }
  function pageRoot() {
    return typeof location !== "undefined" && location.href ? location.href : "http://localhost/";
  }
  function absolute(address, base) {
    const value = String(address == null ? "" : address).trim();
    if (!value) return "";
    if (SCHEME_RE.test(value)) return value;
    if (value.charAt(0) === "/") return new URL(value, NODE_URL || pageRoot()).href;
    const b = String(base == null ? "" : base).trim();
    if (!b) return new URL(value, pageRoot()).href;
    const root = SCHEME_RE.test(b) ? b : new URL(b, b.charAt(0) === "/" ? NODE_URL || pageRoot() : pageRoot()).href;
    return new URL(value, root).href;
  }
  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const name of Object.keys(value)) deepFreeze(value[name]);
    return Object.freeze(value);
  }
  function num(value) {
    return typeof value === "number" && isFinite(value) && value > 0 ? value : 0;
  }
  function common(from, into) {
    if (num(from.bytes)) into.bytes = num(from.bytes);
    if (typeof from.licence === "string" && from.licence) into.licence = from.licence;
    if (typeof from.source === "string" && from.source) into.source = from.source;
    if (Array.isArray(from.tags) && from.tags.length) into.tags = from.tags.map(String);
    return into;
  }
  function buildImages(src) {
    const out = {};
    for (const key of Object.keys(src || {})) {
      checkKey("images", key);
      const from = typeof src[key] === "string" ? { file: src[key] } : src[key] || {};
      const entry = { file: checkAddress(from.file, "images." + key + ".file") };
      if (num(from.w)) entry.w = num(from.w);
      if (num(from.h)) entry.h = num(from.h);
      if (from.frames) {
        const f = from.frames;
        const frameWidth = num(f.frameWidth);
        const frameHeight = num(f.frameHeight);
        if (!frameWidth || !frameHeight) {
          refuse("images." + key + ".frames needs frameWidth and frameHeight in pixels. Without them nothing can tell where one frame ends and the next begins.");
        }
        entry.frames = { frameWidth, frameHeight, count: num(f.count) || 1 };
      }
      out[key] = common(from, entry);
    }
    return out;
  }
  function buildAtlases(src) {
    const out = {};
    for (const key of Object.keys(src || {})) {
      checkKey("atlases", key);
      const from = src[key] || {};
      const entry = {
        texture: checkAddress(from.texture, "atlases." + key + ".texture"),
        data: checkAddress(from.data, "atlases." + key + ".data")
      };
      if (Array.isArray(from.frames) && from.frames.length) entry.frames = from.frames.map(String);
      out[key] = common(from, entry);
    }
    return out;
  }
  function buildAudio(src) {
    const out = {};
    for (const key of Object.keys(src || {})) {
      checkKey("audio", key);
      const raw = src[key];
      const from = typeof raw === "string" || Array.isArray(raw) ? { files: raw } : raw || {};
      const list = Array.isArray(from.files) ? from.files : [from.files];
      const files2 = list.map(function(one, i) {
        return checkAddress(one, "audio." + key + ".files[" + i + "]");
      });
      if (!files2.length) refuse("audio." + key + " has no files.");
      const entry = { files: files2 };
      if (from.kind === "sfx" || from.kind === "music") entry.kind = from.kind;
      if (num(from.duration)) entry.duration = num(from.duration);
      out[key] = common(from, entry);
    }
    return out;
  }
  function buildFonts(src) {
    const out = {};
    for (const key of Object.keys(src || {})) {
      checkKey("fonts", key);
      const from = src[key] || {};
      const entry = { file: checkAddress(from.file, "fonts." + key + ".file") };
      entry.family = typeof from.family === "string" && from.family ? from.family : key;
      if (Array.isArray(from.weights) && from.weights.length) entry.weights = from.weights.slice();
      if (from.data != null) entry.data = checkAddress(from.data, "fonts." + key + ".data");
      out[key] = common(from, entry);
    }
    return out;
  }
  function buildFiles(src, kind, defaultFormat) {
    const out = {};
    for (const key of Object.keys(src || {})) {
      checkKey(kind, key);
      const from = typeof src[key] === "string" ? { file: src[key] } : src[key] || {};
      const entry = { file: checkAddress(from.file, kind + "." + key + ".file") };
      const format = typeof from.format === "string" && from.format ? from.format : defaultFormat;
      if (format) entry.format = format;
      out[key] = common(from, entry);
    }
    return out;
  }
  function buildTexts(src) {
    const out = { en: {} };
    for (const lang of Object.keys(src || {})) {
      const dict = src[lang];
      if (!dict || typeof dict !== "object" || Array.isArray(dict)) {
        refuse("texts." + lang + " has to be a dictionary of key to sentence.");
      }
      const words = {};
      for (const key of Object.keys(dict)) {
        const value = dict[key];
        if (value == null) continue;
        if (typeof value === "object") {
          refuse("texts." + lang + "." + key + ' is an object. A text is one sentence; nest by naming the key "menu.start" rather than by nesting the dictionary.');
        }
        words[key] = String(value);
      }
      out[String(lang).slice(0, 5)] = words;
    }
    return out;
  }
  function manifest(spec) {
    const s = spec || /** @type {ManifestSpec} */
    {};
    if (typeof s.app !== "string" || !s.app.trim()) {
      refuse("a manifest needs `app`: the name of the app these files belong to.");
    }
    const base = s.base == null || s.base === "" ? "" : checkAddress(s.base, "base");
    const built = {
      spec: MANIFEST_SPEC,
      app: s.app.trim(),
      version: s.version == null ? 1 : s.version,
      base: base && base.charAt(base.length - 1) !== "/" ? base + "/" : base,
      images: buildImages(s.images),
      atlases: buildAtlases(s.atlases),
      audio: buildAudio(s.audio),
      fonts: buildFonts(s.fonts),
      tilemaps: buildFiles(s.tilemaps, "tilemaps", "tiled"),
      videos: buildFiles(s.videos, "videos"),
      texts: buildTexts(s.texts),
      meta: { updated: "", bytes: 0, count: 0 }
    };
    let count = 0;
    let bytes = 0;
    for (const kind of KINDS) {
      const group = (
        /** @type {Record<string, any>} */
        built[kind]
      );
      for (const key of Object.keys(group)) {
        const entry = group[key];
        count += kind === "audio" ? entry.files.length : kind === "atlases" ? 2 : 1;
        if (entry.data && kind === "fonts") count += 1;
        bytes += num(entry.bytes);
      }
    }
    const askedMeta = s.meta || {};
    built.meta = {
      updated: typeof askedMeta.updated === "string" && askedMeta.updated ? askedMeta.updated : (/* @__PURE__ */ new Date()).toISOString(),
      bytes: bytes || num(askedMeta.bytes),
      count
    };
    return deepFreeze(built);
  }
  function rows(man, kind) {
    const out = [];
    if (!man) return out;
    const wanted = kind ? [kind] : KINDS;
    for (const group of wanted) {
      const entries = man[group] || {};
      for (const key of Object.keys(entries)) {
        const entry = entries[key];
        const file = group === "audio" ? entry.files[0] : group === "atlases" ? entry.texture : entry.file;
        out.push({
          key,
          kind: group,
          file,
          url: absolute(file, man.base),
          bytes: num(entry.bytes),
          w: num(entry.w),
          h: num(entry.h),
          frames: entry.frames && entry.frames.count ? entry.frames.count : 0,
          licence: entry.licence || ""
        });
      }
    }
    return out;
  }
  function files(man) {
    const out = [];
    if (!man) return out;
    const put2 = function(key, kind, address) {
      const url = absolute(address, man.base);
      if (url) out.push({ key, kind, url });
    };
    for (const key of Object.keys(man.images || {})) put2(key, "images", man.images[key].file);
    for (const key of Object.keys(man.atlases || {})) {
      put2(key, "atlases", man.atlases[key].texture);
      put2(key, "atlases", man.atlases[key].data);
    }
    for (const key of Object.keys(man.audio || {})) {
      for (const one of man.audio[key].files) put2(key, "audio", one);
    }
    for (const key of Object.keys(man.fonts || {})) {
      put2(key, "fonts", man.fonts[key].file);
      if (man.fonts[key].data) put2(key, "fonts", man.fonts[key].data);
    }
    for (const key of Object.keys(man.tilemaps || {})) put2(key, "tilemaps", man.tilemaps[key].file);
    for (const key of Object.keys(man.videos || {})) put2(key, "videos", man.videos[key].file);
    return out;
  }
  function addressOf(man, key) {
    if (!man || !key) return null;
    if (man.images && man.images[key]) return absolute(man.images[key].file, man.base);
    if (man.atlases && man.atlases[key]) return absolute(man.atlases[key].texture, man.base);
    if (man.audio && man.audio[key]) return absolute(man.audio[key].files[0], man.base);
    if (man.fonts && man.fonts[key]) return absolute(man.fonts[key].file, man.base);
    if (man.tilemaps && man.tilemaps[key]) return absolute(man.tilemaps[key].file, man.base);
    if (man.videos && man.videos[key]) return absolute(man.videos[key].file, man.base);
    return null;
  }
  function kindOf(man, key) {
    if (!man || !key) return null;
    for (const kind of KINDS) {
      if (man[kind] && man[kind][key]) return kind;
    }
    return null;
  }
  function withEntry(man, kind, key, entry) {
    if (KINDS.indexOf(kind) < 0) {
      refuse('"' + kind + '" is not a kind of asset. The kinds are ' + KINDS.join(", ") + ".");
    }
    const next = {
      app: man.app,
      version: man.version,
      base: man.base,
      texts: man.texts,
      meta: {}
    };
    for (const group of KINDS) next[group] = Object.assign({}, man[group]);
    next[kind] = Object.assign({}, next[kind]);
    next[kind][key] = entry;
    return manifest(next);
  }

  // src/static/sdk-libs/assets/texts.js
  var VAR_RE = /\{(\w+)\}/g;
  function detectLang() {
    try {
      const root = (
        /** @type {any} */
        window.AIMEAT
      );
      if (root && root.atelier && root.atelier.i18n && typeof root.atelier.i18n.lang === "function") {
        const kit = root.atelier.i18n.lang();
        if (kit) return String(kit).slice(0, 2);
      }
      if (root && root.auth && typeof root.auth.getLang === "function") {
        const auth = root.auth.getLang();
        if (auth) return String(auth).slice(0, 2);
      }
      const stored = localStorage.getItem("aimeat-lang");
      if (stored) return stored.slice(0, 2);
    } catch {
    }
    if (typeof navigator !== "undefined" && navigator.language) return navigator.language.slice(0, 2);
    return "en";
  }
  function fill(text, vars) {
    const value = String(text == null ? "" : text);
    if (!vars) return value;
    return value.replace(VAR_RE, function(whole, name) {
      return vars[name] == null ? whole : String(vars[name]);
    });
  }
  function lookup(texts, lang, key, vars) {
    const all = texts || {};
    const here = all[lang];
    const found = here && here[key] != null ? here[key] : all.en && all.en[key] != null ? all.en[key] : key;
    return fill(found, vars);
  }
  function languages(texts) {
    const names = Object.keys(texts || {});
    const rest = names.filter(function(name) {
      return name !== "en";
    }).sort();
    return names.indexOf("en") >= 0 ? ["en"].concat(rest) : rest;
  }
  function textKeys(texts) {
    const seen = {};
    for (const lang of Object.keys(texts || {})) {
      for (const key of Object.keys(texts[lang] || {})) seen[key] = true;
    }
    return Object.keys(seen).sort();
  }

  // src/static/sdk-libs/assets/library.js
  var VALUE_LIMIT = 1024 * 1024;
  var VALUE_WARN = Math.round(VALUE_LIMIT * 0.75);
  var CHECK_PARALLEL = 6;
  function dataLib() {
    const root = typeof window !== "undefined" ? (
      /** @type {any} */
      window.AIMEAT
    ) : null;
    return root && root.data ? root.data : null;
  }
  async function probe(url) {
    try {
      const head = await fetch(url, { method: "HEAD" });
      if (head.status !== 405 && head.status !== 501) return head.status;
    } catch {
    }
    try {
      const got = await fetch(url, { method: "GET" });
      if (got.body && typeof got.body.cancel === "function") await got.body.cancel();
      return got.status;
    } catch {
      return 0;
    }
  }
  function library(spec) {
    const s = spec || /** @type {LibrarySpec} */
    {};
    if (typeof s.app !== "string" || !s.app.trim()) {
      refuse("library() needs `app`: the name of the app whose assets these are.");
    }
    const app = s.app.trim();
    const key = s.key || app + ".assets";
    const inline = s.manifest || null;
    let current = manifest({ app, version: 1 });
    let language = s.lang ? String(s.lang).slice(0, 2) : detectLang();
    let alive = true;
    let listeners = [];
    function announce() {
      for (const cb of listeners.slice()) {
        try {
          cb(current);
        } catch (err) {
          console.warn("[aimeat-assets] an onChange listener threw:", err);
        }
      }
    }
    function adopt(value) {
      current = manifest(Object.assign({}, value, { app: value && value.app ? value.app : app }));
      announce();
      return current;
    }
    const store = {
      /** The memory key this library reads and writes. */
      key,
      /** The app these assets belong to. */
      app,
      /**
       * Read the manifest: the stored record when the data library is on the page, the manifest the
       * app passed inline otherwise, and an empty library when there is neither. It never throws, so
       * a game boots for a player who is signed out and for a page with no AIMEAT libraries at all.
       * @returns {Promise<any>}
       */
      async load() {
        const data = dataLib();
        if (data && typeof data.get === "function") {
          try {
            const stored = await data.get(key);
            if (stored && typeof stored === "object") {
              if (stored.spec && stored.spec !== MANIFEST_SPEC) {
                console.warn('[aimeat-assets] "' + key + '" says it is ' + stored.spec + ", not " + MANIFEST_SPEC + ". Reading it anyway; save() will rewrite it in this shape.");
              }
              return adopt(stored);
            }
          } catch (err) {
            console.warn('[aimeat-assets] "' + key + '" did not load, carrying on with what is on the page:', err);
          }
        }
        if (inline) {
          try {
            return adopt(inline);
          } catch (err) {
            console.warn("[aimeat-assets] the inline manifest was refused:", err);
          }
        }
        return current;
      },
      /** The manifest as it stands, already validated and frozen. @returns {any} */
      get() {
        return current;
      },
      /**
       * Replace the manifest. It goes through the same validation as manifest(), so a record built by
       * hand cannot slip past the data: URI refusal or the key rules.
       * @param {any} value
       * @returns {any}
       */
      set(value) {
        return adopt(value);
      },
      /**
       * Write the manifest to memory, PUBLIC, so the game's players read it signed out with
       * AIMEAT.data.getPublic(ownerGhii, key). `ownerGhii` there is the GHII of the person who
       * published the game ('alice@node-id'), which the app knows and the player does not have to.
       * @returns {Promise<any>}
       */
      async save() {
        const data = dataLib();
        if (!data || typeof data.set !== "function") {
          refuse('save() needs the memory library. Add <script src="/v1/libs/aimeat-data.js"><\/script> to the page (after aimeat-auth.js). Everything else in this library works without it.');
        }
        const size2 = JSON.stringify(current).length;
        if (size2 > VALUE_LIMIT) {
          refuse("the manifest is " + Math.round(size2 / 1024) + " kB and a memory value holds 1024 kB. Nothing was written. Split the app into two manifests (one per chapter, say), or move the long texts into their own record.");
        }
        if (size2 > VALUE_WARN) {
          console.warn("[aimeat-assets] the manifest is " + Math.round(size2 / 1024) + " kB of the 1024 kB a memory value holds. Time to think about splitting it.");
        }
        return data.set(key, current, { visibility: "public" });
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
      url(name) {
        return addressOf(current, name);
      },
      /**
       * Is this key in the manifest at all.
       * @param {string} name
       * @returns {boolean}
       */
      has(name) {
        return kindOf(current, name) !== null;
      },
      /**
       * One row per key, for a table or a picker.
       * @param {string} [kind]  one group, or every group when omitted
       * @returns {import('./manifest.js').AssetRow[]}
       */
      list(kind) {
        return rows(current, kind);
      },
      /**
       * The manifest as a Phaser resource pack, in the shape AIMEAT.phaser.pack() and preloadPack()
       * both read: images without a frame strip stay images, images WITH one become spritesheets,
       * atlases stay atlases, audio keeps its mp3 and ogg pair, tilemaps are Tiled JSON, and a font
       * that carries `data` becomes a bitmap font. Every address is already resolved.
       * @returns {any}
       */
      toPack() {
        const man = current;
        const images = {};
        const spritesheets = {};
        for (const name of Object.keys(man.images)) {
          const entry = man.images[name];
          const url = absolute(entry.file, man.base);
          if (entry.frames) {
            spritesheets[name] = {
              url,
              frameWidth: entry.frames.frameWidth,
              frameHeight: entry.frames.frameHeight
            };
          } else {
            images[name] = url;
          }
        }
        const atlases = {};
        for (const name of Object.keys(man.atlases)) {
          atlases[name] = {
            texture: absolute(man.atlases[name].texture, man.base),
            data: absolute(man.atlases[name].data, man.base)
          };
        }
        const audio = {};
        for (const name of Object.keys(man.audio)) {
          audio[name] = man.audio[name].files.map(function(one) {
            return absolute(one, man.base);
          });
        }
        const tilemaps = {};
        for (const name of Object.keys(man.tilemaps)) {
          tilemaps[name] = absolute(man.tilemaps[name].file, man.base);
        }
        const bitmapFonts = {};
        for (const name of Object.keys(man.fonts)) {
          const entry = man.fonts[name];
          if (!entry.data) continue;
          bitmapFonts[name] = {
            texture: absolute(entry.file, man.base),
            data: absolute(entry.data, man.base)
          };
        }
        return {
          id: man.app,
          base: absolute(man.base || "./", ""),
          images,
          spritesheets,
          atlases,
          audio,
          tilemaps,
          json: {},
          bitmapFonts
        };
      },
      /**
       * One text, in the library's language, with {var} filled in and English behind it.
       * @param {string} name
       * @param {Record<string, any>} [vars]
       * @returns {string}
       */
      t(name, vars) {
        return lookup(current.texts, language, name, vars);
      },
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
        const missing = [];
        const broken = {};
        const seen = {};
        let next = 0;
        const worker = async function() {
          while (next < list.length) {
            const item = list[next];
            next += 1;
            seen[item.key] = true;
            const status = await probe(item.url);
            if (status < 200 || status >= 400) {
              broken[item.key] = true;
              missing.push({ key: item.key, url: item.url, status });
            }
          }
        };
        const crew = [];
        for (let i = 0; i < Math.min(CHECK_PARALLEL, list.length); i++) crew.push(worker());
        await Promise.all(crew);
        const ok = Object.keys(seen).filter(function(name) {
          return !broken[name];
        });
        return { ok, missing };
      },
      /**
       * Watch the manifest. The callback runs on set(), add(), load() and a language change.
       * @param {(man: any) => void} fn
       * @returns {() => void} stop watching
       */
      onChange(fn) {
        if (typeof fn !== "function" || !alive) return function() {
        };
        listeners.push(fn);
        return function() {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        };
      },
      /** Drop every listener. The manifest stays readable; nothing is left running. */
      destroy() {
        alive = false;
        listeners = [];
      }
    };
    return store;
  }

  // src/static/sdk-libs/assets/upload.js
  function storageLib() {
    const root = typeof window !== "undefined" ? (
      /** @type {any} */
      window.AIMEAT
    ) : null;
    return root && root.storage ? root.storage : null;
  }
  function publicAddress(ownerGhii, key) {
    const owner = encodeURIComponent(String(ownerGhii || ""));
    const path = String(key || "").split("/").map(encodeURIComponent).join("/");
    return "/v1/pub/" + owner + "/" + path;
  }
  function storageKey(file, opts) {
    if (opts.key) return String(opts.key);
    const name = file && typeof file.name === "string" && file.name ? file.name : "file-" + Date.now();
    const parts = [];
    if (opts.app) parts.push(String(opts.app));
    if (opts.kind) parts.push(String(opts.kind));
    parts.push(name);
    return parts.join("/");
  }
  async function upload(file, opts) {
    const store = storageLib();
    if (!store || typeof store.upload !== "function") {
      refuse('upload() needs the storage library. Add <script src="/v1/libs/aimeat-storage.js"><\/script> to the page (after aimeat-auth.js), or upload the file another way and pass its /v1/pub/<owner>/<key> address to add() yourself.');
    }
    const o = opts || /** @type {UploadOptions} */
    {};
    const key = storageKey(file, o);
    const visibility = o.visibility || "public";
    if (visibility !== "public") {
      console.warn('[aimeat-assets] "' + key + '" is being uploaded as ' + visibility + ". A player who is not you cannot read it, so a manifest entry pointing at it will draw nothing. Upload assets as public and keep saves private.");
    }
    const written = await store.upload(file, {
      key,
      visibility,
      mime_type: o.mime_type || file && /** @type {any} */
      file.type || void 0
    });
    const owner = written && (written.owner_gaii || written.ownerGaii);
    const url = written && written.embed_url || (owner ? publicAddress(owner, written.key || key) : "");
    if (!url) {
      refuse('the upload of "' + key + '" answered without an address. Nothing was written to the manifest; check the file in storage before trying again.');
    }
    return {
      key: written && written.key || key,
      url,
      bytes: written && typeof written.size === "number" ? written.size : 0
    };
  }

  // src/static/sdk-libs/assets/pack.js
  var MAX_SIZE = 2048;
  var PADDING = 2;
  async function loadSource(item) {
    const key = item && item.key ? String(item.key) : "";
    if (!key) refuse("every image handed to packAtlas() needs a key: it becomes the frame name.");
    const src = item.src;
    if (!src) refuse('"' + key + '" has no src.');
    if (typeof src === "string") {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = src;
      try {
        await img.decode();
      } catch {
        refuse('"' + key + '" did not load from ' + src + ". An address from another site also has to allow a cross-origin read, or the packed sheet cannot be read back out of the canvas.");
      }
      return { key, image: img, w: img.naturalWidth, h: img.naturalHeight };
    }
    if (typeof Blob !== "undefined" && src instanceof Blob) {
      const bitmap = await createImageBitmap(src);
      return { key, image: bitmap, w: bitmap.width, h: bitmap.height };
    }
    const any = (
      /** @type {any} */
      src
    );
    const w = any.naturalWidth || any.width || 0;
    const h = any.naturalHeight || any.height || 0;
    if (!w || !h) {
      refuse('"' + key + '" has no size yet. An <img> has to have finished loading (await img.decode()) before it can be packed.');
    }
    if (any.decode && any.complete === false) await any.decode();
    return { key, image: any, w, h };
  }
  function shelve(loaded, maxSize, padding) {
    const order = loaded.slice().sort(function(a, b) {
      return b.h - a.h || b.w - a.w || (a.key < b.key ? -1 : 1);
    });
    const placed = [];
    let x = padding;
    let y = padding;
    let shelfHeight = 0;
    let width = 0;
    for (const one of order) {
      if (one.w + padding * 2 > maxSize || one.h + padding * 2 > maxSize) {
        refuse('"' + one.key + '" is ' + one.w + "×" + one.h + " and the sheet is capped at " + maxSize + ". Raise maxSize, or keep that picture out of the atlas and load it on its own.");
      }
      if (x + one.w + padding > maxSize) {
        x = padding;
        y += shelfHeight + padding;
        shelfHeight = 0;
      }
      placed.push({ key: one.key, image: one.image, x, y, w: one.w, h: one.h });
      x += one.w + padding;
      if (x > width) width = x;
      if (one.h > shelfHeight) shelfHeight = one.h;
    }
    return { placed, width, height: y + shelfHeight + padding };
  }
  function potUp(value) {
    let size2 = 1;
    while (size2 < value) size2 *= 2;
    return size2;
  }
  function toPng(canvas) {
    return new Promise(function(resolve) {
      canvas.toBlob(function(blob) {
        if (!blob) refuse("the sheet could not be turned into a PNG. This happens when one of the pictures came from another site without permission to read it back.");
        resolve(
          /** @type {Blob} */
          blob
        );
      }, "image/png");
    });
  }
  async function packAtlas(images, opts) {
    const list = Array.isArray(images) ? images.filter(Boolean) : [];
    if (!list.length) refuse("packAtlas() was given no pictures.");
    const o = opts || /** @type {PackAtlasOptions} */
    {};
    const maxSize = o.maxSize && o.maxSize > 0 ? Math.floor(o.maxSize) : MAX_SIZE;
    const padding = o.padding != null && o.padding >= 0 ? Math.floor(o.padding) : PADDING;
    const seen = {};
    for (const one of list) {
      const key = one && one.key ? String(one.key) : "";
      if (key && seen[key]) {
        refuse('"' + key + '" was handed to packAtlas() twice. A frame name has to be unique inside a sheet, or one of the two pictures is unreachable.');
      }
      seen[key] = true;
    }
    const loaded = [];
    for (const one of list) loaded.push(await loadSource(one));
    const laid = shelve(loaded, maxSize, padding);
    const width = o.pot ? potUp(laid.width) : laid.width;
    const height = o.pot ? potUp(laid.height) : laid.height;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) refuse("this browser gave no 2d canvas, so nothing can be packed here.");
    for (const frame of laid.placed) {
      ctx.drawImage(frame.image, frame.x, frame.y, frame.w, frame.h);
    }
    const frames = {};
    for (const frame of laid.placed) {
      frames[frame.key] = {
        frame: { x: frame.x, y: frame.y, w: frame.w, h: frame.h },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: frame.w, h: frame.h },
        sourceSize: { w: frame.w, h: frame.h }
      };
    }
    const json = {
      frames,
      meta: {
        app: "aimeat-assets",
        version: "1.0",
        image: o.name || "atlas.png",
        format: "RGBA8888",
        size: { w: width, h: height },
        scale: "1"
      }
    };
    const png = await toPng(canvas);
    return { png, json, sheet: canvas };
  }

  // src/static/sdk-libs/assets/sound.js
  var SAMPLE_RATE = 44100;
  function tag(view, at, text) {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  }
  function interleave(buffer) {
    const channels = buffer.numberOfChannels;
    const length = buffer.length;
    if (channels === 1) return buffer.getChannelData(0);
    const out = new Float32Array(length * channels);
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) out[i * channels + c] = data[i];
    }
    return out;
  }
  function toWav(samples, sampleRate) {
    let data;
    let channels = 1;
    let rate = sampleRate && sampleRate > 0 ? Math.floor(sampleRate) : SAMPLE_RATE;
    if (samples && typeof samples === "object" && typeof samples.getChannelData === "function") {
      data = interleave(samples);
      channels = samples.numberOfChannels;
      rate = samples.sampleRate;
    } else if (samples instanceof Float32Array) {
      data = samples;
    } else if (Array.isArray(samples)) {
      data = Float32Array.from(samples);
    } else {
      refuse("toWav() takes a Float32Array of samples or an AudioBuffer.");
    }
    const frames = (
      /** @type {Float32Array} */
      data.length
    );
    const bytes = new ArrayBuffer(44 + frames * 2);
    const view = new DataView(bytes);
    tag(view, 0, "RIFF");
    view.setUint32(4, 36 + frames * 2, true);
    tag(view, 8, "WAVE");
    tag(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    tag(view, 36, "data");
    view.setUint32(40, frames * 2, true);
    let at = 44;
    for (let i = 0; i < frames; i++) {
      const s = Math.max(-1, Math.min(
        1,
        /** @type {Float32Array} */
        data[i]
      ));
      view.setInt16(at, s < 0 ? s * 32768 : s * 32767, true);
      at += 2;
    }
    return new Blob([bytes], { type: "audio/wav" });
  }
  async function record(synthFn, seconds, sampleRate, channels) {
    if (typeof synthFn !== "function") {
      refuse("record() takes a function (ctx, destination) that builds the sound.");
    }
    const length = Number(seconds);
    if (!(length > 0)) refuse("record() needs a length in seconds.");
    const Offline = (
      /** @type {any} */
      window.OfflineAudioContext || /** @type {any} */
      window.webkitOfflineAudioContext
    );
    if (!Offline) {
      refuse("this browser has no OfflineAudioContext, so a sound cannot be rendered here. Upload a file made elsewhere instead.");
    }
    const rate = sampleRate && sampleRate > 0 ? Math.floor(sampleRate) : SAMPLE_RATE;
    const count = channels && channels > 0 ? Math.floor(channels) : 1;
    const ctx = new Offline(count, Math.ceil(length * rate), rate);
    synthFn(ctx, ctx.destination);
    const rendered = await ctx.startRendering();
    return toWav(rendered);
  }
  var sound = { toWav, record };

  // src/static/sdk-libs/assets/preview.js
  var FRAME_MS = 90;
  var SPECIMEN = "The quick brown fox jumps 0123456789";
  function builder() {
    const root = typeof window !== "undefined" ? (
      /** @type {any} */
      window.AIMEAT
    ) : null;
    if (root && root.atelier && typeof root.atelier.el === "function") return root.atelier.el;
    return function(tag2, attrs, kids) {
      const node = document.createElement(tag2);
      if (attrs) {
        for (const name of Object.keys(attrs)) {
          const value = attrs[name];
          if (value == null || value === false) continue;
          if (name === "text") {
            node.textContent = String(value);
            continue;
          }
          if (name === "on") {
            for (const type of Object.keys(value)) node.addEventListener(type, value[type]);
            continue;
          }
          if (name === "vars") {
            for (const key of Object.keys(value)) node.style.setProperty(key, String(value[key]));
            continue;
          }
          if (name === "children") continue;
          node.setAttribute(name, value === true ? "" : String(value));
        }
        if (attrs.children != null) put(node, attrs.children);
      }
      if (kids != null) put(node, kids);
      return node;
    };
  }
  function put(parent, kids) {
    const list = Array.isArray(kids) ? kids : [kids];
    for (const kid of list) {
      if (kid == null || kid === false) continue;
      parent.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
    }
  }
  function lessMotion() {
    try {
      const root = document.documentElement;
      if (root && root.getAttribute("data-ak-motion") === "less") return true;
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", name === "pause" ? "M4 3h3v10H4zM9 3h3v10H9z" : "M5 3l8 5-8 5z");
    svg.appendChild(path);
    return svg;
  }
  function size(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " kB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }
  function facts(row) {
    const parts = [];
    if (row.w && row.h) parts.push(row.w + "×" + row.h);
    if (row.frames) parts.push(row.frames + " frames");
    if (row.bytes) parts.push(size(row.bytes));
    if (row.licence) parts.push(row.licence);
    return parts.join(" · ");
  }
  function imageCard(ctx, row) {
    const el = ctx.el;
    let thumb;
    if (row.frames > 1) {
      thumb = el("div", {
        class: "ak-assets__thumb ak-assets__thumb--strip",
        vars: { "--aka-strip": 'url("' + encodeURI(row.url) + '")', "--aka-frames": String(row.frames) },
        role: "img",
        "aria-label": row.key + ", " + row.frames + " frames"
      });
      if (!ctx.still) {
        const play = function() {
          if (thumb.dataset.running === "1") return;
          thumb.dataset.running = "1";
          let frame = 0;
          const timer = setInterval(function() {
            frame += 1;
            if (frame >= row.frames) {
              clearInterval(timer);
              ctx.timers.delete(timer);
              thumb.dataset.running = "";
              frame = 0;
            }
            thumb.style.setProperty("--aka-frame", String(frame));
          }, FRAME_MS);
          ctx.timers.add(timer);
        };
        thumb.addEventListener("mouseenter", play);
        thumb.addEventListener("focus", play);
      }
    } else {
      thumb = el("img", {
        class: "ak-assets__thumb",
        src: row.url,
        alt: row.key,
        loading: "lazy",
        decoding: "async"
      });
    }
    const card = el("figure", { class: "ak-assets__card", tabindex: "0" }, [
      el("div", { class: "ak-assets__frame" }, thumb),
      el("figcaption", { class: "ak-assets__caption" }, [
        el("span", { class: "ak-assets__key", text: row.key }),
        el("span", { class: "ak-assets__facts", text: facts(row) })
      ])
    ]);
    ctx.marks.push({ key: row.key, node: card });
    return card;
  }
  function audioRow(ctx, row) {
    const el = ctx.el;
    const button = el("button", {
      type: "button",
      class: "ak-assets__play",
      "aria-label": "Play " + row.key
    }, icon("play"));
    button.addEventListener("click", function() {
      if (ctx.playing && ctx.playing.button === button) {
        ctx.playing.audio.pause();
        return;
      }
      if (ctx.playing) ctx.playing.audio.pause();
      const audio = new Audio(row.url);
      const stop = function() {
        button.replaceChildren(icon("play"));
        button.setAttribute("aria-label", "Play " + row.key);
        if (ctx.playing && ctx.playing.button === button) ctx.playing = null;
      };
      audio.addEventListener("ended", stop);
      audio.addEventListener("pause", stop);
      audio.addEventListener("error", function() {
        stop();
        row.node.classList.add("is-missing");
      });
      ctx.playing = { audio, button };
      button.replaceChildren(icon("pause"));
      button.setAttribute("aria-label", "Pause " + row.key);
      const started = audio.play();
      if (started && typeof started.catch === "function") started.catch(stop);
    });
    const node = el("li", { class: "ak-assets__row" }, [
      button,
      el("span", { class: "ak-assets__key", text: row.key }),
      el("span", { class: "ak-assets__facts", text: facts(row) })
    ]);
    row.node = node;
    ctx.marks.push({ key: row.key, node });
    return node;
  }
  function fontRow(ctx, key, entry) {
    const el = ctx.el;
    const weights = Array.isArray(entry.weights) && entry.weights.length ? entry.weights.join(", ") : "";
    const node = el("li", { class: "ak-assets__row ak-assets__row--font" }, [
      el("span", { class: "ak-assets__key", text: key }),
      el("span", {
        class: "ak-assets__specimen",
        vars: { "--aka-family": entry.family },
        text: SPECIMEN
      }),
      el("span", {
        class: "ak-assets__facts",
        text: [entry.family, weights, entry.data ? "bitmap" : ""].filter(Boolean).join(" · ")
      })
    ]);
    ctx.marks.push({ key, node });
    return node;
  }
  function fileRow(ctx, row, extra) {
    const el = ctx.el;
    const node = el("li", { class: "ak-assets__row" }, [
      el("span", { class: "ak-assets__key", text: row.key }),
      el("span", { class: "ak-assets__file", text: row.file }),
      el("span", { class: "ak-assets__facts", text: [facts(row), extra].filter(Boolean).join(" · ") })
    ]);
    ctx.marks.push({ key: row.key, node });
    return node;
  }
  function section(ctx, title, count, body) {
    const el = ctx.el;
    return el("section", { class: "ak-assets__section" }, [
      el("h3", { class: "ak-assets__head" }, [
        el("span", { text: title }),
        el("span", { class: "ak-assets__count", text: String(count) })
      ]),
      body
    ]);
  }
  function textsTable(ctx, texts) {
    const el = ctx.el;
    const langs = languages(texts);
    const keys = textKeys(texts);
    if (!keys.length) return null;
    const head = el("tr", {}, [el("th", { scope: "col", text: "key" })].concat(
      langs.map(function(lang) {
        return el("th", { scope: "col", text: lang });
      })
    ));
    const body = keys.map(function(key) {
      const cells = [el("th", { scope: "row", class: "ak-assets__key", text: key })];
      for (const lang of langs) {
        const value = texts[lang] ? texts[lang][key] : null;
        cells.push(el("td", {
          class: value == null ? "ak-assets__cell is-gap" : "ak-assets__cell",
          text: value == null ? "" : value
        }));
      }
      return el("tr", {}, cells);
    });
    return el("table", { class: "ak-assets__table" }, [
      el("thead", {}, head),
      el("tbody", {}, body)
    ]);
  }
  function build(ctx) {
    const el = ctx.el;
    const man = ctx.library.get();
    ctx.marks = [];
    const sections = [];
    const images = ctx.library.list("images");
    if (images.length) {
      sections.push(section(
        ctx,
        "Images",
        images.length,
        el("div", { class: "ak-assets__grid" }, images.map(function(row) {
          return imageCard(ctx, row);
        }))
      ));
    }
    const atlases = ctx.library.list("atlases");
    if (atlases.length) {
      sections.push(section(
        ctx,
        "Atlases",
        atlases.length,
        el("ul", { class: "ak-assets__rows" }, atlases.map(function(row) {
          const frames = man.atlases[row.key].frames;
          return fileRow(ctx, row, frames && frames.length ? frames.length + " frames" : "");
        }))
      ));
    }
    const audio = ctx.library.list("audio");
    if (audio.length) {
      sections.push(section(
        ctx,
        "Audio",
        audio.length,
        el("ul", { class: "ak-assets__rows" }, audio.map(function(row) {
          return audioRow(ctx, row);
        }))
      ));
    }
    const fonts = Object.keys(man.fonts || {});
    if (fonts.length) {
      sections.push(section(
        ctx,
        "Fonts",
        fonts.length,
        el("ul", { class: "ak-assets__rows" }, fonts.map(function(key) {
          return fontRow(ctx, key, man.fonts[key]);
        }))
      ));
    }
    for (const kind of ["tilemaps", "videos"]) {
      const rows2 = ctx.library.list(kind);
      if (!rows2.length) continue;
      sections.push(section(
        ctx,
        kind === "tilemaps" ? "Tilemaps" : "Videos",
        rows2.length,
        el("ul", { class: "ak-assets__rows" }, rows2.map(function(row) {
          return fileRow(ctx, row);
        }))
      ));
    }
    const table = textsTable(ctx, man.texts);
    if (table) {
      sections.push(section(ctx, "Texts", textKeys(man.texts).length, table));
    }
    if (!sections.length) {
      sections.push(el("p", { class: "ak-assets__empty", text: "Nothing in this library yet." }));
    }
    return el("div", { class: "ak-assets" }, [
      el("header", { class: "ak-assets__bar" }, [
        el("h2", { class: "ak-assets__title", text: ctx.title || man.app }),
        el("p", {
          class: "ak-assets__summary",
          text: [man.meta.count + " files", size(man.meta.bytes), "v" + man.version].filter(Boolean).join(" · ")
        })
      ]),
      el("div", { class: "ak-assets__body" }, sections)
    ]);
  }
  function preview(target, library2, opts) {
    const host = typeof target === "string" ? document.querySelector(target) : target;
    if (!host) refuse('preview() could not find "' + target + '" on the page.');
    if (!library2 || typeof library2.get !== "function") {
      refuse("preview() takes the object AIMEAT.assets.library() returned.");
    }
    const o = opts || {};
    const ctx = {
      el: builder(),
      library: library2,
      title: o.title || "",
      still: lessMotion(),
      /** @type {Set<any>} */
      timers: /* @__PURE__ */ new Set(),
      /** @type {Array<{ key: string, node: HTMLElement }>} */
      marks: [],
      /** @type {any} */
      playing: null
    };
    let node = build(ctx);
    host.appendChild(node);
    function quiet() {
      for (const timer of ctx.timers) clearInterval(timer);
      ctx.timers.clear();
      if (ctx.playing) {
        ctx.playing.audio.pause();
        ctx.playing = null;
      }
    }
    function mark(report) {
      const broken = {};
      for (const row of report.missing) broken[row.key] = true;
      for (const item of ctx.marks) {
        item.node.classList.toggle("is-missing", broken[item.key] === true);
      }
    }
    async function runCheck() {
      try {
        mark(await library2.check());
      } catch (err) {
        console.warn("[aimeat-assets] the file check did not finish:", err);
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
      }
    };
    const stopWatching = typeof library2.onChange === "function" ? library2.onChange(function() {
      void gallery.refresh();
    }) : function() {
    };
    if (o.check) void runCheck();
    return gallery;
  }

  // src/static/sdk-libs/assets/index.js
  var assets = {
    /**
     * The library version. It MUST match the newest entry in /lib/aimeat-assets.css's version
     * history; e2e-libs.ts fails when the two drift, because a version string that never moves is
     * worse than none.
     */
    version: "1.0.0",
    /** The shape name every manifest carries, so a record found in memory explains itself. */
    spec: MANIFEST_SPEC,
    /** The kinds of file a manifest holds, in the order a listing shows them. */
    kinds: KINDS,
    // ── The record ──
    manifest,
    library,
    // ── Files in and out ──
    upload,
    publicAddress,
    absolute,
    // ── Making assets rather than collecting them ──
    packAtlas,
    sound,
    // ── Seeing what you have ──
    preview
  };
  attach("assets", assets);
})();
