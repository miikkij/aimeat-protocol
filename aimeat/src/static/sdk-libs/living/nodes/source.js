/**
 * @file living/nodes/source.js
 * @description A VALUE THAT COMES FROM SOMEWHERE ELSE. A source node reads a memory key — the
 *   sensor an agent writes, the reading a device pushes, the record another app keeps — or an
 *   ADDRESS on the open internet, and puts it into the graph as an ordinary quantity, so a formula
 *   standing on it cannot tell whether a person moved a slider or a thermometer moved by itself.
 *
 *   TWO ROADS IN, AND THE RECORD PICKS ONE. `key` is the memory road: AIMEAT.data when the page
 *   carries it, kept up to date on the same aimeat-live-update event every profile tab listens for.
 *   `url` is the outward road: the reading is fetched through the node's `living-hooks` extension as
 *   the signed-in caller, because a browser calling a third-party address directly meets CORS on
 *   the good days and is a way to carry secrets to an address of the record's choosing on the bad
 *   ones. `path` digs into the answer either way; `raw` takes the body itself; `every` is how often
 *   the URL is asked, with a floor of ten seconds under it so a document cannot be written that
 *   hammers somebody's API.
 *
 *   A FAILED READ KEEPS THE LAST VALUE. A day of spot prices that drops to zero because the server
 *   was down for one poll is a document that LIES, and it lies with a number rather than with a
 *   message. So the number stands and the node's `stale` output gains the refusal in words, which a
 *   sentence, the chain and the drawn row can all show.
 *
 *   WITHOUT THE LIBRARY IT IS A CONSTANT. A page with no aimeat-data and no session — a test, a
 *   preview, a file opened from disk — falls back to the node's own `value`, so a document always
 *   renders. That is the same progressive rule the mosaic's live binding follows.
 *
 * @node       source    A live value from a memory key or a URL, or a constant when the page cannot read one.
 * @inputs     source    key (a memory key) · url (an address, read through the node's living-hooks extension) · path (a path inside the answer, dots and brackets) · raw (take the body itself as the value) · value (the fallback)
 * @outputs    source    value — what the key or the address holds now, with the node's unit on it · stale — the words a failed read left, empty while it is fresh
 * @options    source    unit · headers (sent with a url read; a value may name a secret of the owner's as {{secret:NAME}}, which the node puts in as the call leaves, so no key is written into the document) · every (seconds between reads of a url; the floor is 10) · format (how it is printed: 1 · "int" · "unit" · an object; `locale: "auto"` writes the number in the page's language) · scope=own|public · owner (for a public read) · label
 * @languages  source    label
 * @example    source    { "type": "source", "url": "https://api.porssisahko.net/v1/latest-prices.json", "path": "prices[0].price", "every": 900, "unit": "EUR/kWh", "value": 0.042, "label": { "fi": "Pörssihinta", "en": "Spot price" } }
 * @structure sourceNode: the node-type module (dependsOn · prepare · evaluate · coerce · fields · read)
 * @usage  import { sourceNode } from './source.js';
 * @version-history
 *   v0.6.0 — 2026-09-06 — THE OTHER ROAD IN: `url`, `path` with brackets, `raw` and `every`. The
 *     reading is fetched through the node's living-hooks extension rather than by the browser, a
 *     failed read keeps the last value and writes the refusal into the new `stale` output, and a
 *     poll under ten seconds is refused by name before the document mounts. A URL answer is NOT dug
 *     a second time here: the extension applied the path on its side, and digging twice would read
 *     `price.price`.
 *   v0.4.0 — 2026-09-06 — `label` may be a language map. The `key` is not one: a memory key is an
 *     address, and an address that changed with the reader's language would read a different
 *     device in each.
 *   v0.3.0 — 2026-09-05 — `format`: a reading from a device arrives with as many digits as the
 *     device felt like sending, and this is where a document says how many of them to print.
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { parseUnit } from '../units.js';
import { formatError } from '../format.js';
import { isError } from '../formula-eval.js';
import { digPath, pathError } from '../json-path.js';
import { wrapValue } from './value.js';

/** The shortest poll a record may ask for. Somebody else's server is on the other end of it. */
export const EVERY_FLOOR = 10;

/** The shapes a device writes, in the order a device is likely to have written them. */
const COMMON_FIELDS = ['value', 'reading', 'n', 'celsius', 'temp', 'amount'];

export const sourceNode = {
  id: 'source',
  settable: true,

  dependsOn() { return []; },

  prepare(node, ctx) {
    const errors = [];
    const unit = parseUnit(node.unit);
    if (isError(unit)) errors.push(unit.error);
    ctx.compiled.unit = isError(unit) ? null : unit;
    const badFormat = formatError(node.format);
    if (badFormat) errors.push(badFormat);
    const badPath = pathError(node.path);
    if (badPath) errors.push(badPath);
    if (node.key && node.url) {
      errors.push('a source naming both a key and a url; a reading comes from one place');
    }
    if (node.every != null) {
      const every = Number(node.every);
      if (!Number.isFinite(every) || every < EVERY_FLOOR) {
        errors.push('a poll of ' + String(node.every) + ' seconds; the shortest this document may '
          + 'ask an address for is ' + EVERY_FLOOR);
      }
    }
    if (!ctx.state.values.has(ctx.id)) ctx.state.values.set(ctx.id, wrapValue(node.value, ctx.compiled.unit));
    return errors;
  },

  evaluate(node, ctx) { return ctx.state.values.get(ctx.id); },

  /**
   * The words a failed read left. It is an extra OUTPUT rather than part of the value, because the
   * value did not move — that is the whole point of keeping it — and a sentence reads it as
   * `{{ spot.stale }}`.
   */
  fields(node, ctx) {
    const extra = ctx.state.extra ? (ctx.state.extra.get(ctx.id) || {}) : {};
    return { stale: String(extra.stale == null ? '' : extra.stale) };
  },

  coerce(node, ctx, raw) {
    let v = raw;
    // A URL ANSWER IS ALREADY AT ITS PATH. The extension dug it on its own side, which is where the
    // whole body was; digging again here would read `price.price` and store nothing.
    if (node.url) {
      if (v != null && typeof v === 'object' && typeof v.n === 'number') v = v.n;
      return wrapValue(v, ctx.compiled.unit);
    }
    if (v != null && typeof v === 'object' && !Array.isArray(v) && typeof v.n !== 'number') {
      const dug = digPath(v, node.path);
      v = dug;
      if (v != null && typeof v === 'object' && !Array.isArray(v)) {
        for (const f of COMMON_FIELDS) if (typeof v[f] === 'number') { v = v[f]; break; }
      }
    } else if (node.path && v != null && typeof v === 'object') {
      v = digPath(v, node.path);
    }
    if (v != null && typeof v === 'object' && typeof v.n === 'number') v = v.n;
    return wrapValue(v, ctx.compiled.unit);
  },

  /**
   * Read the key through the platform's data library, when the page has one. Resolves to
   * undefined where it cannot, and the fallback value stands. The URL road is not here: it needs a
   * session and a runtime that can poll, so it lives in sources-url.js.
   * @param {any} node
   * @returns {Promise<any>}
   */
  read(node) {
    const ns = /** @type {any} */ (window).AIMEAT;
    if (!node.key || !ns || !ns.data) return Promise.resolve(undefined);
    const call = node.scope === 'public' && typeof ns.data.getPublic === 'function'
      ? ns.data.getPublic(node.owner, node.key)
      : (typeof ns.data.get === 'function' ? ns.data.get(node.key) : null);
    if (!call) return Promise.resolve(undefined);
    return Promise.resolve(call).catch(() => undefined);
  },
};
