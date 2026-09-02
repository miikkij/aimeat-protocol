/**
 * @file assets/manifest.js
 * @description The record at the centre of the aimeat-assets library: ONE manifest per app, listing
 *   every picture, sound, font, map and video the app loads, plus its texts. It is one memory value
 *   because the node's budget says so (1024 kB per value, 1000 keys per person), so a key per
 *   sprite would spend a person's whole allowance on a single game.
 *
 *   IT IS SELF-DESCRIBING. The `spec` field names the shape ('aimeat.assets.manifest/v1'), so an
 *   agent that finds the record knows how to read and extend it without being told.
 *
 *   A data: URI IS REFUSED, with words and by name. A base64 blob inside the record is paid for in
 *   the record's own bytes on every single load, forever, and the budget above is what it eats.
 *   Files belong in storage at /v1/pub/<owner>/<key>, which is an ordinary address anyone can read.
 *
 *   KEYS ARE ADDRESSES, not sentences: lowercase, digits, dashes, with dots and slashes allowed as
 *   separators. A key is what a scene names when it draws a sprite, so it has to stay put while the
 *   file behind it is replaced.
 *
 *   NOTHING HERE FETCHES. This module validates, resolves addresses and freezes; the network lives
 *   in library.check(), upload() and packAtlas()'s image loads.
 * @structure MANIFEST_SPEC · KINDS · refuse/checkKey/checkAddress · absolute() · manifest(spec) ·
 *   rows() (one per key, for a table) · files() (one per file, for a check) · deepFreeze
 * @usage
 *   import { manifest } from './manifest.js';
 *   const m = manifest({ app: 'ridge', version: 1, base: '/v1/pub/alice@node/ridge/',
 *     images: { hero: { file: 'hero.png', w: 32, h: 40 } } });
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial: the v1 manifest shape, the data: URI refusal, key validation,
 *     address resolution and the row/file readings.
 */
import { NODE_URL } from '../_core/config.js';

/** The shape name written into every record, so whoever finds it knows how to read it. */
export const MANIFEST_SPEC = 'aimeat.assets.manifest/v1';

/** The kinds of file a manifest carries, in the order a listing shows them. */
export const KINDS = ['images', 'atlases', 'audio', 'fonts', 'tilemaps', 'videos'];

/** What a key may be made of: lowercase letters and digits, joined by a dash, a dot or a slash. */
const KEY_RE = /^[a-z0-9]+(?:[-./][a-z0-9]+)*$/;

/** An address that already names its own scheme (https:, blob:, data:, …). */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * @typedef {object} ImageEntry
 * @property {string} file                the address, relative to the manifest's base
 * @property {number} [w]                 pixel width, when it is known
 * @property {number} [h]                 pixel height
 * @property {{ frameWidth: number, frameHeight: number, count: number }} [frames]  a sprite strip
 * @property {number} [bytes]
 * @property {string} [licence]
 * @property {string} [source]            where it came from, so the licence can be checked
 * @property {string[]} [tags]
 */

/**
 * @typedef {object} AtlasEntry
 * @property {string} texture             the packed sheet
 * @property {string} data                the JSON that cuts it up
 * @property {string[]} [frames]          the frame names inside, when the app wants them listed
 * @property {number} [bytes]
 * @property {string} [licence]
 * @property {string} [source]
 * @property {string[]} [tags]
 */

/**
 * @typedef {object} AudioEntry
 * @property {string[]} files             the mp3 and ogg pair, so every browser has one it plays
 * @property {'sfx'|'music'} [kind]
 * @property {number} [duration]          seconds
 * @property {number} [bytes]
 * @property {string} [licence]
 * @property {string} [source]
 * @property {string[]} [tags]
 */

/**
 * @typedef {object} FontEntry
 * @property {string} file                the webfont, or the bitmap font's texture
 * @property {string} family              the family name CSS asks for
 * @property {Array<number|string>} [weights]
 * @property {string} [data]              a bitmap font's .xml/.fnt; with it, toPack() hands the
 *   entry to Phaser as a bitmap font instead of a web font
 * @property {number} [bytes]
 * @property {string} [licence]
 * @property {string} [source]
 */

/**
 * @typedef {object} FileEntry
 * @property {string} file
 * @property {string} [format]            'tiled' for a tilemap
 * @property {number} [bytes]
 * @property {string} [licence]
 * @property {string} [source]
 * @property {string[]} [tags]
 */

/**
 * @typedef {object} ManifestSpec
 * @property {string} app
 * @property {number|string} [version]
 * @property {string} [base]              a /v1/pub/<owner>/<prefix>/ address every relative file
 *   in the manifest resolves against
 * @property {Record<string, ImageEntry|string>} [images]
 * @property {Record<string, AtlasEntry>} [atlases]
 * @property {Record<string, AudioEntry|string|string[]>} [audio]
 * @property {Record<string, FontEntry>} [fonts]
 * @property {Record<string, FileEntry|string>} [tilemaps]
 * @property {Record<string, FileEntry|string>} [videos]
 * @property {Record<string, Record<string, string>>} [texts]
 * @property {{ updated?: string, bytes?: number, count?: number }} [meta]
 */

/**
 * One row of a listing: what a person needs to see about an entry without opening the file.
 * @typedef {object} AssetRow
 * @property {string} key
 * @property {string} kind
 * @property {string} file      the address as written in the manifest
 * @property {string} url       the same address, resolved
 * @property {number} bytes     0 when the manifest does not say
 * @property {number} w         0 when unknown
 * @property {number} h         0 when unknown
 * @property {number} frames    0 for anything that is not a strip
 * @property {string} licence   '' when unstated
 */

/**
 * Refuse, in words that say what to do instead. Every refusal in this library comes through here,
 * so they all read the same and all carry the library's name.
 * @param {string} message
 * @returns {never}
 */
export function refuse(message) {
  throw new Error('[aimeat-assets] ' + message);
}

/**
 * A key has to survive a file being replaced, so it is checked rather than accepted.
 * @param {string} kind
 * @param {string} key
 */
function checkKey(kind, key) {
  if (typeof key !== 'string' || !key) refuse('a ' + kind + ' entry has no key. A key is the name a scene draws with.');
  if (!KEY_RE.test(key)) {
    refuse('the ' + kind + ' key "' + key + '" is not an address. Use lowercase letters, digits and '
      + 'dashes (dots and slashes separate parts), for example "' + slug(key) + '". A key is what '
      + 'your code names for years while the file behind it is replaced.');
  }
}

/**
 * The key this one was probably meant to be, so the refusal above can suggest it.
 * @param {string} value
 * @returns {string}
 */
function slug(value) {
  const out = String(value).toLowerCase().replace(/[^a-z0-9./]+/g, '-').replace(/^-+|-+$/g, '');
  return out || 'asset';
}

/**
 * Check one address. A data: URI is the one form this library will not carry, and it says why.
 * @param {any} value
 * @param {string} where   'images.hero.file', for the message
 * @returns {string}
 */
function checkAddress(value, where) {
  if (typeof value !== 'string' || !value.trim()) {
    refuse(where + ' needs an address. Upload the file first, then put the address it answered with here.');
  }
  const address = value.trim();
  if (address.slice(0, 5).toLowerCase() === 'data:') {
    refuse(where + ' is a data: URI, and the manifest will not carry one. The record is ONE memory '
      + 'value with 1024 kB to spend, and a base64 blob spends it on every load forever. Upload the '
      + 'file (AIMEAT.assets.upload) and put its /v1/pub/<owner>/<key> address here instead.');
  }
  return address;
}

/** The page this app is served from. */
function pageRoot() {
  return typeof location !== 'undefined' && location.href ? location.href : 'http://localhost/';
}

/**
 * Resolve an address to something a browser can fetch.
 *
 * An address starting with '/' points at the NODE (that is where /v1/pub lives), which is not
 * always the origin the app is served from: an app on its own subdomain would otherwise ask itself
 * for the file. Everything else resolves against the manifest's base, and the base against the page.
 *
 * @param {string} address
 * @param {string} [base]
 * @returns {string}
 */
export function absolute(address, base) {
  const value = String(address == null ? '' : address).trim();
  if (!value) return '';
  if (SCHEME_RE.test(value)) return value;
  if (value.charAt(0) === '/') return new URL(value, NODE_URL || pageRoot()).href;
  const b = String(base == null ? '' : base).trim();
  if (!b) return new URL(value, pageRoot()).href;
  const root = SCHEME_RE.test(b)
    ? b
    : new URL(b, b.charAt(0) === '/' ? (NODE_URL || pageRoot()) : pageRoot()).href;
  return new URL(value, root).href;
}

/**
 * Freeze a value and everything under it. A manifest two scenes share must not be edited by either.
 * @param {any} value
 * @returns {any}
 */
export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const name of Object.keys(value)) deepFreeze(value[name]);
  return Object.freeze(value);
}

/** A positive number, or 0 for anything that is not one. */
function num(value) {
  return typeof value === 'number' && isFinite(value) && value > 0 ? value : 0;
}

/** Copy the fields every entry may carry, whatever its kind. */
function common(from, into) {
  if (num(from.bytes)) into.bytes = num(from.bytes);
  if (typeof from.licence === 'string' && from.licence) into.licence = from.licence;
  if (typeof from.source === 'string' && from.source) into.source = from.source;
  if (Array.isArray(from.tags) && from.tags.length) into.tags = from.tags.map(String);
  return into;
}

/**
 * The images, each with its optional size and its optional frame strip.
 * @param {Record<string, any>|undefined} src
 * @returns {Record<string, ImageEntry>}
 */
function buildImages(src) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const key of Object.keys(src || {})) {
    checkKey('images', key);
    const from = typeof src[key] === 'string' ? { file: src[key] } : (src[key] || {});
    /** @type {any} */
    const entry = { file: checkAddress(from.file, 'images.' + key + '.file') };
    if (num(from.w)) entry.w = num(from.w);
    if (num(from.h)) entry.h = num(from.h);
    if (from.frames) {
      const f = from.frames;
      const frameWidth = num(f.frameWidth);
      const frameHeight = num(f.frameHeight);
      if (!frameWidth || !frameHeight) {
        refuse('images.' + key + '.frames needs frameWidth and frameHeight in pixels. Without them '
          + 'nothing can tell where one frame ends and the next begins.');
      }
      entry.frames = { frameWidth: frameWidth, frameHeight: frameHeight, count: num(f.count) || 1 };
    }
    out[key] = common(from, entry);
  }
  return out;
}

/**
 * The atlases: a packed sheet plus the JSON that cuts it up. packAtlas() makes both.
 * @param {Record<string, any>|undefined} src
 * @returns {Record<string, AtlasEntry>}
 */
function buildAtlases(src) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const key of Object.keys(src || {})) {
    checkKey('atlases', key);
    const from = src[key] || {};
    /** @type {any} */
    const entry = {
      texture: checkAddress(from.texture, 'atlases.' + key + '.texture'),
      data: checkAddress(from.data, 'atlases.' + key + '.data'),
    };
    if (Array.isArray(from.frames) && from.frames.length) entry.frames = from.frames.map(String);
    out[key] = common(from, entry);
  }
  return out;
}

/**
 * The sounds. One address is legal; the mp3 and ogg pair is what plays everywhere.
 * @param {Record<string, any>|undefined} src
 * @returns {Record<string, AudioEntry>}
 */
function buildAudio(src) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const key of Object.keys(src || {})) {
    checkKey('audio', key);
    const raw = src[key];
    const from = (typeof raw === 'string' || Array.isArray(raw)) ? { files: raw } : (raw || {});
    const list = Array.isArray(from.files) ? from.files : [from.files];
    const files = list.map(function (one, i) {
      return checkAddress(one, 'audio.' + key + '.files[' + i + ']');
    });
    if (!files.length) refuse('audio.' + key + ' has no files.');
    /** @type {any} */
    const entry = { files: files };
    if (from.kind === 'sfx' || from.kind === 'music') entry.kind = from.kind;
    if (num(from.duration)) entry.duration = num(from.duration);
    out[key] = common(from, entry);
  }
  return out;
}

/**
 * The fonts. `family` is what CSS asks for; `data` turns the entry into a Phaser bitmap font.
 * @param {Record<string, any>|undefined} src
 * @returns {Record<string, FontEntry>}
 */
function buildFonts(src) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const key of Object.keys(src || {})) {
    checkKey('fonts', key);
    const from = src[key] || {};
    /** @type {any} */
    const entry = { file: checkAddress(from.file, 'fonts.' + key + '.file') };
    entry.family = typeof from.family === 'string' && from.family ? from.family : key;
    if (Array.isArray(from.weights) && from.weights.length) entry.weights = from.weights.slice();
    if (from.data != null) entry.data = checkAddress(from.data, 'fonts.' + key + '.data');
    out[key] = common(from, entry);
  }
  return out;
}

/**
 * Tilemaps and videos: one file each, with a format on the map so a reader knows what made it.
 * @param {Record<string, any>|undefined} src
 * @param {string} kind
 * @param {string} [defaultFormat]
 * @returns {Record<string, FileEntry>}
 */
function buildFiles(src, kind, defaultFormat) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const key of Object.keys(src || {})) {
    checkKey(kind, key);
    const from = typeof src[key] === 'string' ? { file: src[key] } : (src[key] || {});
    /** @type {any} */
    const entry = { file: checkAddress(from.file, kind + '.' + key + '.file') };
    const format = typeof from.format === 'string' && from.format ? from.format : defaultFormat;
    if (format) entry.format = format;
    out[key] = common(from, entry);
  }
  return out;
}

/**
 * The texts, one dictionary per language. English is the fallback every other language falls
 * through to, so it is always present even when it is empty.
 * @param {Record<string, any>|undefined} src
 * @returns {Record<string, Record<string, string>>}
 */
function buildTexts(src) {
  /** @type {Record<string, Record<string, string>>} */
  const out = { en: {} };
  for (const lang of Object.keys(src || {})) {
    const dict = src[lang];
    if (!dict || typeof dict !== 'object' || Array.isArray(dict)) {
      refuse('texts.' + lang + ' has to be a dictionary of key to sentence.');
    }
    /** @type {Record<string, string>} */
    const words = {};
    for (const key of Object.keys(dict)) {
      const value = dict[key];
      if (value == null) continue;
      if (typeof value === 'object') {
        refuse('texts.' + lang + '.' + key + ' is an object. A text is one sentence; nest by naming '
          + 'the key "menu.start" rather than by nesting the dictionary.');
      }
      words[key] = String(value);
    }
    out[String(lang).slice(0, 5)] = words;
  }
  return out;
}

/**
 * Build a validated, frozen manifest. Hand it a spec, or hand it a manifest that came back from
 * memory: both go through the same checks, so a record edited by hand cannot quietly rot.
 *
 * @param {ManifestSpec} spec
 * @returns {Readonly<any>}
 */
export function manifest(spec) {
  const s = spec || /** @type {ManifestSpec} */ ({});
  if (typeof s.app !== 'string' || !s.app.trim()) {
    refuse('a manifest needs `app`: the name of the app these files belong to.');
  }
  const base = s.base == null || s.base === '' ? '' : checkAddress(s.base, 'base');
  const built = {
    spec: MANIFEST_SPEC,
    app: s.app.trim(),
    version: s.version == null ? 1 : s.version,
    base: base && base.charAt(base.length - 1) !== '/' ? base + '/' : base,
    images: buildImages(s.images),
    atlases: buildAtlases(s.atlases),
    audio: buildAudio(s.audio),
    fonts: buildFonts(s.fonts),
    tilemaps: buildFiles(s.tilemaps, 'tilemaps', 'tiled'),
    videos: buildFiles(s.videos, 'videos'),
    texts: buildTexts(s.texts),
    meta: { updated: '', bytes: 0, count: 0 },
  };

  let count = 0;
  let bytes = 0;
  for (const kind of KINDS) {
    const group = /** @type {Record<string, any>} */ (built[kind]);
    for (const key of Object.keys(group)) {
      const entry = group[key];
      count += kind === 'audio' ? entry.files.length : (kind === 'atlases' ? 2 : 1);
      if (entry.data && kind === 'fonts') count += 1;
      bytes += num(entry.bytes);
    }
  }
  const askedMeta = s.meta || {};
  built.meta = {
    updated: typeof askedMeta.updated === 'string' && askedMeta.updated
      ? askedMeta.updated
      : new Date().toISOString(),
    bytes: bytes || num(askedMeta.bytes),
    count: count,
  };

  return deepFreeze(built);
}

/**
 * One row per KEY, which is what a table shows.
 * @param {any} man
 * @param {string} [kind]  one group, or every group when omitted
 * @returns {AssetRow[]}
 */
export function rows(man, kind) {
  /** @type {AssetRow[]} */
  const out = [];
  if (!man) return out;
  const wanted = kind ? [kind] : KINDS;
  for (const group of wanted) {
    const entries = man[group] || {};
    for (const key of Object.keys(entries)) {
      const entry = entries[key];
      const file = group === 'audio' ? entry.files[0] : (group === 'atlases' ? entry.texture : entry.file);
      out.push({
        key: key,
        kind: group,
        file: file,
        url: absolute(file, man.base),
        bytes: num(entry.bytes),
        w: num(entry.w),
        h: num(entry.h),
        frames: entry.frames && entry.frames.count ? entry.frames.count : 0,
        licence: entry.licence || '',
      });
    }
  }
  return out;
}

/**
 * One row per FILE, which is what a check probes: an audio pair is two addresses, an atlas is its
 * sheet and its JSON, a bitmap font is its texture and its data.
 * @param {any} man
 * @returns {Array<{ key: string, kind: string, url: string }>}
 */
export function files(man) {
  /** @type {Array<{ key: string, kind: string, url: string }>} */
  const out = [];
  if (!man) return out;
  const put = function (key, kind, address) {
    const url = absolute(address, man.base);
    if (url) out.push({ key: key, kind: kind, url: url });
  };
  for (const key of Object.keys(man.images || {})) put(key, 'images', man.images[key].file);
  for (const key of Object.keys(man.atlases || {})) {
    put(key, 'atlases', man.atlases[key].texture);
    put(key, 'atlases', man.atlases[key].data);
  }
  for (const key of Object.keys(man.audio || {})) {
    for (const one of man.audio[key].files) put(key, 'audio', one);
  }
  for (const key of Object.keys(man.fonts || {})) {
    put(key, 'fonts', man.fonts[key].file);
    if (man.fonts[key].data) put(key, 'fonts', man.fonts[key].data);
  }
  for (const key of Object.keys(man.tilemaps || {})) put(key, 'tilemaps', man.tilemaps[key].file);
  for (const key of Object.keys(man.videos || {})) put(key, 'videos', man.videos[key].file);
  return out;
}

/**
 * The address of one named file, resolved. Kinds are searched in the order a game asks for them.
 * @param {any} man
 * @param {string} key
 * @returns {string|null}
 */
export function addressOf(man, key) {
  if (!man || !key) return null;
  if (man.images && man.images[key]) return absolute(man.images[key].file, man.base);
  if (man.atlases && man.atlases[key]) return absolute(man.atlases[key].texture, man.base);
  if (man.audio && man.audio[key]) return absolute(man.audio[key].files[0], man.base);
  if (man.fonts && man.fonts[key]) return absolute(man.fonts[key].file, man.base);
  if (man.tilemaps && man.tilemaps[key]) return absolute(man.tilemaps[key].file, man.base);
  if (man.videos && man.videos[key]) return absolute(man.videos[key].file, man.base);
  return null;
}

/**
 * Which group holds this key, or null.
 * @param {any} man
 * @param {string} key
 * @returns {string|null}
 */
export function kindOf(man, key) {
  if (!man || !key) return null;
  for (const kind of KINDS) {
    if (man[kind] && man[kind][key]) return kind;
  }
  return null;
}

/**
 * A copy of a manifest with one entry added or replaced, re-validated and re-stamped. The manifest
 * itself is frozen, so this is how an entry is written after an upload.
 * @param {any} man
 * @param {string} kind
 * @param {string} key
 * @param {any} entry
 * @returns {Readonly<any>}
 */
export function withEntry(man, kind, key, entry) {
  if (KINDS.indexOf(kind) < 0) {
    refuse('"' + kind + '" is not a kind of asset. The kinds are ' + KINDS.join(', ') + '.');
  }
  /** @type {any} */
  const next = {
    app: man.app,
    version: man.version,
    base: man.base,
    texts: man.texts,
    meta: {},
  };
  for (const group of KINDS) next[group] = Object.assign({}, man[group]);
  next[kind] = Object.assign({}, next[kind]);
  next[kind][key] = entry;
  return manifest(next);
}
