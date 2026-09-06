/**
 * @file src/data/builtin-extensions/living-hooks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `living-hooks`: the two doors a living document uses to talk to the world. `send`
 *   posts the whole state of a document to a URL the owner allowed when something in it changes;
 *   `read` pulls one value back in, raw or through a JSON path.
 *
 *   WHY IT IS AN EXTENSION AND NOT A ROUTE. A browser cannot call a third party itself: CORS stops
 *   it, and a document that carried its own API key would be handing that key to everyone who opens
 *   it. So the call is made by the node, inside the sandbox, with the owner's allowlist and the
 *   owner's secrets — neither of which ever reaches the page. A route would have been a second
 *   implementation of what the extension road already does (the paywall, the caller resolution, the
 *   safeFetch guard, the API budget), for one feature.
 *
 *   WHY IT SHIPS WITH THE NODE. A document is written by an AI and opened by a person who never
 *   installed anything; if the hooks arrive only after somebody finds the Extensions page, the
 *   feature does not exist for the people it was built for. services/builtin-extension-seeder.ts
 *   installs it at boot and updates it when the shipped version is newer, and never touches the
 *   config an owner set.
 * @structure
 *   - LIVING_HOOKS_MANIFEST — the YAML the shared manifest builder validates
 *   - LIVING_HOOKS_SEND_JS / LIVING_HOOKS_READ_JS — the two action scripts, lib and gate prepended
 *   - LIVING_HOOKS — the BuiltinExtension the seeder installs
 * @usage
 *   import { LIVING_HOOKS } from '../data/builtin-extensions/index.js';
 * @version-history
 *   v1.1.0 — 2026-09-06 — The secret is the PLATFORM's now. This extension resolved
 *     {{secret:NAME}} inside its own sandbox until today, which meant the credential was handed to
 *     the guest; ctx.fetch does it instead, after the script has let go of the request. Two things
 *     change for a person: their own vault entry beats the operator's shared map, and a key stored
 *     once under Access serves every extension rather than this one. The header allowlist stays
 *     here, because which headers may leave is a living-hooks decision. The `secrets` config field
 *     stays too, as the fallback, so nobody's existing setup stops working.
 *   v1.0.0 — 2026-09-06 — Initial (living hooks, the node-side half).
 */
import { LIVING_HOOKS_LIB_JS } from './living-hooks-lib.js';
import { LIVING_HOOKS_GATE_JS } from './living-hooks-gate.js';

/** The version the node ships. The seeder compares this against what is installed. */
export const LIVING_HOOKS_VERSION = '1.1.0';

/**
 * The manifest, in the same YAML the install route reads from anybody else. It goes through
 * buildExtensionRecordFromManifest exactly as an uploaded one does, so a mistake in here is a
 * refusal at boot with the field named, rather than a record nothing validated.
 */
export const LIVING_HOOKS_MANIFEST = `extension: "1.0"

# The node-side half of a living document's hooks. The browser half (sdk-libs/living) calls these
# two actions; nothing else does. A document that fires a trigger calls send; a node that reads a
# value from a URL calls read.
#
# The whole security model is two lines: the owner names which hosts may be reached, and the node
# refuses everything else; a secret the owner does not want written into a document is named in the
# header as {{secret:NAME}} and filled in by the node itself, out of sight of the page AND out of
# sight of this script.

metadata:
  name: "living-hooks"
  version: "${LIVING_HOOKS_VERSION}"
  description: "Lets a living document talk to the world: send the whole state of the document to an address you allowed when something changes, and read a value back in from an address, raw or picked out of JSON. You say which addresses are allowed; nothing else is called. A password or key you would rather not write into the document is stored once in your own vault and named in a header as {{secret:NAME}}, and it is filled in on the way out."
  author: "AIMEAT"
  license: "MIT"

required_apis:
  - memory

config:
  allow_hosts:
    type: array
    default: []
    description: "The hosts this node may call for everyone on it. Usually empty: each person names their own in the record living-hooks.settings in their own memory, and the two lists are added together. An entry is either a whole host (api.example.com) or a leading dot (.example.com), which allows that host and everything under it. A comma-separated string works too."
  secrets:
    type: secret
    default: ""
    description: "A JSON object of keys and passwords for everyone on this node, as {\\"NAME\\": \\"value\\"}. Usually empty: each person stores their own under Access, and theirs is used first. This is the operator's shared fallback, for a key every document on the node should be able to use. Stored encrypted."

limits:
  # timeout_ms is BOTH ceilings: the sandbox interrupts the script at it, and the outbound call is
  # aborted at it too (extension-runtime.ts hands min(timeout_ms, 30s) to the fetch). Six seconds,
  # so a document waiting on a value that is not coming gives up in about five.
  memory_mb: 64
  timeout_ms: 6000
  max_api_calls: 20

actions:
  - id: send
    description: "Send the whole state of a document to a URL you have allowed. Answers with the receiver's status and how long it took, or a refusal that says what to change."
    method: POST
    path: "/v1/ext/living-hooks/send"
    auth: required
    script: send.js
    input:
      url:
        type: string
        description: "Where to send it. A whole http:// or https:// address, on a host you allowed."
      method:
        type: string
        description: "POST or PUT. POST when omitted."
      headers:
        type: object
        description: "Header names and values. Authorization, Content-Type, Accept, X-Api-Key, X-Requested-With, and any name starting with X-Living-. A value may name a secret from your vault as {{secret:NAME}}; the node fills it in on the way out and it never reaches this document."
      body:
        type: object
        description: "What the receiver reads: the whole state of the document, the transition that fired, and the time."
    output:
      ok:
        type: boolean
        description: "True when the receiver accepted it."
      status:
        type: integer
        description: "The status the receiver answered with."
      ms:
        type: integer
        description: "How long the call took, in milliseconds."
      error:
        type: object
        description: "Present instead of the three above when the call was refused: a code and a message written for the person reading it."

  - id: read
    description: "Read one value from a URL you have allowed: the whole body as it comes, or one value picked out of JSON by a path such as prices[0].price. The same address is only fetched once every ten seconds."
    method: POST
    path: "/v1/ext/living-hooks/read"
    auth: required
    script: read.js
    input:
      url:
        type: string
        description: "Where to read from. A whole http:// or https:// address, on a host you allowed."
      path:
        type: string
        description: "Which value to take out of the JSON answer, in dots and brackets: prices[0].price, a.b, data['total.eur']. The whole answer when omitted."
      raw:
        type: boolean
        description: "Take the body itself as the value: a number when it is one, otherwise the text. Cannot be combined with path."
      headers:
        type: object
        description: "Header names and values, same rules as send."
    output:
      value:
        type: object
        description: "What was read: a number, a string, or whatever the path pointed at."
      fetchedAt:
        type: string
        description: "When this value was actually fetched. An answer that came from the ten-second cache carries the original time."
      contentType:
        type: string
        description: "What the far end said it was sending."
      cached:
        type: boolean
        description: "True when this came from the ten-second cache rather than a new call."
      error:
        type: object
        description: "Present instead of the four above when the read was refused: a code and a message written for the person reading it."
`;

/** send: the whole state of a document, to an address its owner allowed. */
const SEND_ACTION_JS = String.raw`
export default async function (ctx, input) {
  var open = await livingOpen(ctx, input, 'memory:write');
  if (open.error) return open;

  var method = String(input.method === null || input.method === undefined ? 'POST' : input.method).toUpperCase();
  if (method !== 'POST' && method !== 'PUT') {
    return livingRefuse('INVALID_INPUT', 'method must be POST or PUT. Got "' + method + '".');
  }
  if (!input.body || typeof input.body !== 'object' || Array.isArray(input.body)) {
    return livingRefuse('INVALID_INPUT',
      'body must be an object: the state the receiver is meant to read, whole, so it can use whatever it needs.');
  }

  var payload = JSON.stringify(input.body);
  var size = livingBytes(payload);
  if (size > 262144) {
    return livingRefuse('PAYLOAD_TOO_LARGE',
      'The body is ' + size + ' bytes and the ceiling is 262144, which is 256 kB. Send fewer values, '
      + 'or send an address the receiver can read them from.', { bytes: size, limit: 262144 });
  }

  var head = livingHeaders(input.headers, { 'Content-Type': 'application/json' });
  if (head.refusal) return head.refusal;

  // The pacer moves here, after every refusal and before the call goes out — and it is written
  // before the fetch, so a receiver that hangs or fails still costs the sender its share.
  if (!livingCount(open.state, 'sends', 60, open.now)) {
    return livingRefuse('RATE_LIMITED',
      'This account has sent 60 times in the last minute, which is the ceiling. The next one goes '
      + 'when the minute turns.', { limit: 60, per: 'minute' });
  }
  await ctx.memory.set(open.stateKey, open.state, { visibility: 'private' });

  var startedAt = Date.now();
  var res;
  try {
    res = await ctx.fetch(open.url, { method: method, headers: head.headers, body: payload });
  } catch (err) {
    // The node fills {{secret:NAME}} inside ctx.fetch and throws when a name is not set, so a
    // missing secret arrives here as an error rather than as a refusal this script built. It keeps
    // its own code: "you named a secret nobody stored" and "the far end did not answer" are two
    // different problems, and only one of them is fixed by looking at the receiver.
    var lhMsg = err && err.message ? err.message : String(err);
    if (lhMsg.indexOf('SECRET_UNKNOWN:') === 0) {
      return livingRefuse('SECRET_UNKNOWN', lhMsg.slice(15).replace(/^\s+/, ''));
    }
    return livingRefuse('UPSTREAM_FAILED', 'The call to ' + open.host + ' did not complete: ' + lhMsg);
  }
  var ms = Date.now() - startedAt;
  if (!res.ok) {
    return livingRefuse('UPSTREAM_FAILED', open.host + ' answered ' + res.status + '.',
      { status: res.status, ms: ms });
  }
  return { ok: true, status: res.status, ms: ms };
}
`;

/** read: one value from an address its owner allowed, raw or through a JSON path. */
const READ_ACTION_JS = String.raw`
export default async function (ctx, input) {
  var open = await livingOpen(ctx, input, 'memory:read');
  if (open.error) return open;

  var raw = input.raw === true;
  var path = typeof input.path === 'string' ? input.path.trim() : '';
  if (raw && path) {
    return livingRefuse('INVALID_INPUT',
      'raw takes the whole body as the value, so there is nothing for path to pick out. Use one or the other.');
  }

  // The cache is per URL per owner and lasts ten seconds. A hit makes no outbound call, so it does
  // not spend the minute's reads either — a document polling a value it already has costs nothing.
  var cacheKey = ctx.hash(open.url);
  var hit = open.state.cache[cacheKey];
  if (hit && typeof hit === 'object' && typeof hit.at === 'number'
      && open.now - hit.at < 10000 && typeof hit.body === 'string') {
    var reshaped = livingShape(hit.body, raw, path);
    if (!reshaped.ok) return livingRefuse(reshaped.code, reshaped.message);
    return { value: reshaped.value, fetchedAt: hit.fetchedAt, contentType: hit.contentType, cached: true };
  }

  var head = livingHeaders(input.headers,
    { Accept: 'application/json, text/plain;q=0.9, */*;q=0.8' });
  if (head.refusal) return head.refusal;

  if (!livingCount(open.state, 'reads', 120, open.now)) {
    return livingRefuse('RATE_LIMITED',
      'This account has read 120 times in the last minute, which is the ceiling. The next one goes '
      + 'when the minute turns.', { limit: 120, per: 'minute' });
  }
  await ctx.memory.set(open.stateKey, open.state, { visibility: 'private' });

  var res;
  try {
    res = await ctx.fetch(open.url, { method: 'GET', headers: head.headers });
  } catch (err) {
    // Same as send: a secret the vault does not hold arrives as a throw from ctx.fetch and keeps
    // its own code, because it is fixed in the vault and not at the far end.
    var lhMsg = err && err.message ? err.message : String(err);
    if (lhMsg.indexOf('SECRET_UNKNOWN:') === 0) {
      return livingRefuse('SECRET_UNKNOWN', lhMsg.slice(15).replace(/^\s+/, ''));
    }
    return livingRefuse('UPSTREAM_FAILED', 'The call to ' + open.host + ' did not complete: ' + lhMsg);
  }
  if (!res.ok) {
    return livingRefuse('UPSTREAM_FAILED', open.host + ' answered ' + res.status + '.', { status: res.status });
  }

  var bytes = livingBytes(res.text);
  if (bytes > 1048576) {
    return livingRefuse('TOO_LARGE',
      'The answer is ' + bytes + ' bytes and the ceiling is 1048576, which is 1 MB. Ask the far end '
      + 'for a smaller answer, or for the one value instead of the whole document.',
      { bytes: bytes, limit: 1048576 });
  }

  var contentType = '';
  if (res.headers && typeof res.headers === 'object') {
    contentType = res.headers['content-type'] || res.headers['Content-Type'] || '';
  }
  var fetchedAt = ctx.now();
  var shaped = livingShape(res.text, raw, path);

  // Cache the BODY, not the shaped value, so a second node reading a different path out of the same
  // answer within the window reuses the one call. A large body is not cached at all: this record is
  // one memory key and it has a ceiling.
  if (bytes <= 32768) {
    open.state.cache = livingPrune(open.state.cache, open.now);
    open.state.cache[cacheKey] = { at: open.now, body: res.text, fetchedAt: fetchedAt, contentType: contentType };
    await ctx.memory.set(open.stateKey, open.state, { visibility: 'private' });
  }

  if (!shaped.ok) return livingRefuse(shaped.code, shaped.message);
  return { value: shaped.value, fetchedAt: fetchedAt, contentType: contentType, cached: false };
}
`;

/** One extension the node ships: what the seeder needs to install and to keep up to date. */
export interface BuiltinExtension {
  name: string;
  version: string;
  manifest: string;
  scripts: Record<string, string>;
}

export const LIVING_HOOKS: BuiltinExtension = {
  name: 'living-hooks',
  version: LIVING_HOOKS_VERSION,
  manifest: LIVING_HOOKS_MANIFEST,
  scripts: {
    // The shared halves are prepended rather than imported: a sandboxed script has no imports, so
    // sharing code between two actions means shipping the same bytes into both. The transform in
    // extension-runtime.ts keeps top-level declarations that sit above `export default`.
    'send.js': `${LIVING_HOOKS_LIB_JS}\n${LIVING_HOOKS_GATE_JS}\n${SEND_ACTION_JS}`,
    'read.js': `${LIVING_HOOKS_LIB_JS}\n${LIVING_HOOKS_GATE_JS}\n${READ_ACTION_JS}`,
  },
};
