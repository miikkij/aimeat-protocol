/**
 * @file living/hooks-shapes.js
 * @description WHAT THE TWO GEAR DIALOGS SAY, WORKED OUT FROM THE RECORD RATHER THAN TYPED INTO A
 *   TEMPLATE. A dialog that shows a plausible-looking example somebody wrote once is worse than no
 *   dialog at all: the person copies it, the shape is wrong for their node, and the failure lands on
 *   the far side of an API call where nobody can see it. So the JSON on the screen is generated from
 *   THIS node — its path, its unit, its current reading — and from describe(), which is the same
 *   vocabulary an AI reads.
 *
 *   THE INWARD DIALOG OFFERS THREE ROADS AND THEY ARE NOT ALTERNATIVES TO EACH OTHER. The URL road
 *   is for a reading that already exists at an address. The MEMORY road is for a value somebody
 *   else writes — a device, an agent, another app — and it is a key of this document's own, under
 *   `<document key>.in.<node>`, because a memory write REPLACES a value and a writer must never be
 *   handed the whole record to overwrite. The AGENT road is the same memory road said as a sentence
 *   a person can paste into their own chat, which is the road most people will actually take.
 *
 *   THE OUTWARD DIALOG SHOWS THE MESSAGE ITSELF, for the state the document is in at the moment it
 *   is opened. Not a sample, not a schema: the object that would leave if the machine moved now,
 *   built by the same payload.js the delivery uses. If those two ever disagree, the dialog is
 *   lying, which is why they are one function called twice rather than two functions.
 * @structure inwardShape(ctx) · outwardShape(ctx) · memoryKeyFor(doc, id) · ownerForAddress(owner, nodeId) ·
 *   ownerNotice(receiver, canSignIn)
 * @usage
 *   import { inwardShape } from './hooks-shapes.js';
 *   const shape = inwardShape({ id, node, doc, graph, langs, base });
 * @version-history
 *   v0.7.7 -- 2026-11-09 -- The program road's settings link carries `&sample=`, the message the
 *     value's current reading makes (at most 1000 characters of JSON), so the Incoming webhooks page's
 *     ready commands carry the document's real value (secaudit2026nov08b round 15d; v0.7.5 and v0.7.6
 *     are round 15c's).
 *   v0.7.6 -- 2026-11-08 -- The memory road's own call goes to the node's own address too (ctx.apex),
 *     single-quoted for a POSIX shell, double-quoted on Windows. The key's and the token's
 *     placeholders follow the dialog's language (inward.keyPlaceholder, inward.tokenPlaceholder),
 *     with the English ones as the fallback (secaudit2026nov08b round 15c).
 *   v0.7.5 -- 2026-11-08 -- The program road carries `signInNeeded`, and ownerNotice() says what the
 *     dialog shows when the address cannot carry the account name: a sign-in on a page that can sign
 *     the person in, a line to write the name on a page that cannot (secaudit2026nov08b round 15c).
 *   v0.7.4 -- 2026-11-08 -- The key's placeholder says `<your API key>`: a receiver is an incoming
 *     webhook and its key an API key in every text (developer, 2026-11-08; secaudit2026nov08b round 15b).
 *   v0.7.3 -- 2026-11-08 -- The program road's address is the node's own (ctx.apex), not the app's
 *     origin, and it carries the signed-in account's name (ctx.owner) where it said <owner>; the
 *     placeholder stays only when the page does not know the name. The POSIX line single-quotes the
 *     address, so a placeholder in it is text for the shell (secaudit2026nov08b round 15b).
 *   v0.7.2 -- 2026-11-08 -- Each road carries `windows`: the same call for Command Prompt and PowerShell,
 *     with the JSON body as its own block (value.json) and a curl.exe line that reads it, so the line
 *     holds no live data. The POSIX lines are unchanged (secaudit2026nov08b round 15).
 *   v0.7.1 — 2026-11-08 — The two copyable curl lines quote their JSON body for the shell: a single
 *     quote in the live value becomes '\'' inside the quoted argument, so the value stays one argument.
 *     A value without a single quote gives the same line as before (secaudit2026nov08 round 14).
 *   v0.7.0 — 2026-11-07 — The inward shape carries `receiver`: the owner's Receivers page with this key
 *     filled in, and the call a program sends through a receiver. The memory road's own call needs a
 *     session of the owner, which a program must not hold.
 *   v0.6.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */
import { NODES } from './describe-data.js';
import { shapeFor } from './json-path.js';
import { readValue, buildPayload } from './payload.js';
import { statesOf } from './render.js';
import { textOf } from './i18n.js';
import { watchOf, TRIGGER_METHODS } from './nodes/trigger.js';
import { say, fill } from './hooks-words.js';

/** describe()'s own answer for one type, without importing the library's front door. */
function vocabularyOf(type) {
  const found = NODES[String(type)];
  return found ? Object.assign({ id: String(type) }, found) : { id: String(type) };
}

/**
 * The memory key somebody writing this value from outside would write to. It is a key of this
 * document's own rather than the record itself, because a memory write replaces a value: handing a
 * device the record's key would let one reading overwrite the whole document.
 * @param {any} doc @param {string} id
 * @returns {string}
 */
export function memoryKeyFor(doc, id) {
  return String((doc && doc.key) || 'living') + '.in.' + String(id);
}

/**
 * A receiver name for one value of a document: lowercase letters, digits and dashes, at most 40, as
 * services/receivers/contract.ts RECEIVER_NAME_RE takes it.
 */
export function receiverNameFor(doc, id) {
  const raw = (String((doc && doc.key) || 'living').split('.').pop() + '-' + String(id)).toLowerCase();
  const slug = raw.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return (slug || 'living-value').slice(0, 40).replace(/-$/, '');
}

/**
 * One shell argument in single quotes, for a line a person copies into a terminal. A single quote in
 * the text becomes '\'' (close, an escaped quote, open again), so a live value that holds one stays
 * inside the argument. Text without a single quote comes out as before: the text between two quotes.
 * @param {string} text
 * @returns {string}
 */
function shellQuoted(text) {
  return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

/** The file the Windows line reads its body from. */
const WINDOWS_BODY_FILE = 'value.json';

/**
 * The same call for Command Prompt and PowerShell. Neither shell has a quoting that holds any text
 * (cmd.exe toggles on every double quote and expands %NAME% inside quotes; PowerShell ends a single-
 * quoted string at the POSIX '\'' form), so the line carries no live data at all: the JSON body is its
 * own block, saved as value.json, and curl.exe reads it. `curl.exe`, because `curl` is a name for
 * Invoke-WebRequest in Windows PowerShell 5.1. The address and the headers are double-quoted.
 * @param {string} address @param {string} bearer @param {any} body
 * @returns {{ file: string, body: string, curl: string }}
 */
function windowsCall(address, bearer, body) {
  return {
    file: WINDOWS_BODY_FILE,
    body: JSON.stringify(body),
    curl: 'curl.exe -X POST "' + address + '"'
      + ' -H "Content-Type: application/json"'
      + ' -H "Authorization: Bearer ' + bearer + '"'
      + ' --data-binary "@' + WINDOWS_BODY_FILE + '"',
  };
}

/** The longest sample, in characters of JSON, the settings link carries (the page takes the same). */
const SAMPLE_MAX = 1000;

/**
 * `&sample=<URL-encoded JSON>` for the settings link: the message the value's current reading makes,
 * so the page's ready commands carry it. '' when it is longer than SAMPLE_MAX or is not JSON.
 * @param {any} body
 * @returns {string}
 */
function sampleParam(body) {
  // The curl line beside it stringifies the same body, so a value that cannot be stringified fails there.
  const json = JSON.stringify(body) || '';
  return json && json.length <= SAMPLE_MAX ? '&sample=' + encodeURIComponent(json) : '';
}

/** What the address carries where the account name goes when the page does not know it. */
export const OWNER_PLACEHOLDER = '<owner>';

/** What the call carries where the key goes: the key is shown once when it is made, never again. */
export const KEY_PLACEHOLDER = '<your API key>';

/** What the memory road's call carries where the person's own token goes. */
export const TOKEN_PLACEHOLDER = '<your token>';

/**
 * A placeholder in the dialog's language (hooks-words.js `inward.keyPlaceholder`,
 * `inward.tokenPlaceholder`), or `fallback` when the word is missing or holds a character a shell
 * reads inside double quotes (`"`, `$`, a backtick, a backslash, cmd.exe's `%` and `!`) or a single
 * quote. The placeholder sits inside the double-quoted Authorization header of every line.
 * @param {string} key @param {string[]} langs @param {string} fallback
 * @returns {string}
 */
function placeholderIn(key, langs, fallback) {
  const word = say(key, langs);
  return /^<[^"$`\\%!'<>]+>$/.test(word) ? word : fallback;
}

/**
 * The account name for the address path, or '' when there is none this line can carry as it is. A
 * GHII of this node (`alice@<node id>`) gives its account part. Any other text gives '': the address
 * then keeps OWNER_PLACEHOLDER, inside the quotes.
 * @param {any} owner @param {string} [nodeId]
 * @returns {string}
 */
export function ownerForAddress(owner, nodeId) {
  let name = typeof owner === 'string' ? owner.trim() : '';
  const at = name.indexOf('@');
  if (at >= 0) name = nodeId && name.slice(at + 1) === String(nodeId) ? name.slice(0, at) : '';
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name) ? name : '';
}

/**
 * The program road of the inward dialog: where the owner makes the receiver, and the call a program
 * sends. `apex` is the node's own address: /v1/receive and the profile page answer there, and an app
 * host of a node that shows its content to signed-in accounts only answers neither. `owner` is the
 * signed-in account's name, '' when the page does not know it. The POSIX line single-quotes the
 * address, so the placeholder in it stays text for the shell.
 */
function receiverRoad(apex, owner, key, doc, id, sample, keyPlaceholder) {
  const name = receiverNameFor(doc, id);
  const address = apex + '/v1/receive/' + (owner || OWNER_PLACEHOLDER) + '/' + name;
  return {
    name: name,
    key: key,
    owner: owner,
    ownerKnown: !!owner,
    /** The page does not know the account name: the dialog says so and offers the sign-in (ownerNotice). */
    signInNeeded: !owner,
    keyPlaceholder: keyPlaceholder,
    ownerPlaceholder: OWNER_PLACEHOLDER,
    settings: apex + '/v1/profile?tab=receivers&new=key&key=' + encodeURIComponent(key) + '&name=' + encodeURIComponent(name)
      + sampleParam({ value: sample }),
    address: address,
    curl: 'curl -X POST ' + shellQuoted(address)
      + ' -H "Content-Type: application/json"'
      + ' -H "Authorization: Bearer ' + keyPlaceholder + '"'
      + ' -d ' + shellQuoted(JSON.stringify({ value: sample })),
    /** The same call for a Windows shell (windowsCall). `curl` above is for sh, bash and zsh. */
    windows: windowsCall(address, keyPlaceholder, { value: sample }),
  };
}

/**
 * What the program road says about the account name in its address. Null when the address carries
 * it. Otherwise a notice above the call: `signIn` on a page that can sign the person in (the auth
 * library is loaded and nobody is signed in), with the sentence and the button's words; `write` on a
 * page that cannot (no auth library, or a session whose name this node's address cannot carry),
 * where the person writes the name in place of the placeholder. The words are keys of hooks-words.js
 * and their `{placeholder}` is the receiver's ownerPlaceholder.
 * @param {{ ownerKnown?: boolean }|null|undefined} receiver @param {boolean} canSignIn
 * @returns {{ kind: 'signIn', words: string, button: string }|{ kind: 'write', words: string }|null}
 */
export function ownerNotice(receiver, canSignIn) {
  if (receiver && receiver.ownerKnown) return null;
  return canSignIn
    ? { kind: 'signIn', words: 'inward.signInWhy', button: 'inward.signIn' }
    : { kind: 'write', words: 'inward.ownerWhere' };
}

/**
 * The inward dialog's whole content, for a control, a value or a source. `apex` is the node's own
 * address for the two calls a person copies (default: base); `owner` the signed-in account's name or GHII and
 * `nodeId` this node's id, both optional.
 * @param {{ id: string, node: any, doc: any, graph: any, langs?: () => string[], base?: string,
 *   apex?: string, owner?: string, nodeId?: string }} ctx
 * @returns {any}
 */
export function inwardShape(ctx) {
  const doc = ctx.doc || {};
  const nodes = (doc.model || {}).nodes || {};
  const langs = typeof ctx.langs === 'function' ? ctx.langs : function () { return []; };
  const wanted = langs();

  // A GEAR ON A CONTROL IS A GEAR ON THE VALUE UNDER IT. A control is a hand on a quantity; the
  // quantity is what an address or an agent would write, so that is the node this dialog edits.
  const subjectId = String(ctx.node && ctx.node.type === 'control' && ctx.node.target
    ? ctx.node.target : ctx.id);
  const subject = nodes[subjectId] || ctx.node || {};

  const sample = readValue(ctx.graph ? ctx.graph.valueOf(subjectId) : subject.value);
  const road = subject.url ? 'url' : (subject.key ? 'key' : 'hand');
  const path = String(subject.path || '');
  const expected = subject.raw ? sample : shapeFor(path || 'value', sample);

  const base = String(ctx.base || '');
  // Both calls a person copies go to the node's own address: an app's origin is not where a program
  // or a terminal reaches /v1/memory or /v1/receive on a node that shows content to signed-in accounts.
  const apex = String(ctx.apex || base);
  const keyPlaceholder = placeholderIn('inward.keyPlaceholder', wanted, KEY_PLACEHOLDER);
  const tokenPlaceholder = placeholderIn('inward.tokenPlaceholder', wanted, TOKEN_PLACEHOLDER);
  const key = memoryKeyFor(doc, subjectId);
  const body = { key: key, value: { value: sample } };
  const hasRange = typeof subject.min === 'number' || typeof subject.max === 'number'
    || typeof subject.step === 'number';

  return {
    subject: subjectId,
    target: subjectId,
    label: String(textOf(subject.label, wanted) || subjectId),
    road: road,
    url: String(subject.url || ''),
    path: path,
    raw: !!subject.raw,
    every: subject.every == null ? '' : String(subject.every),
    key: String(subject.key || ''),
    sample: sample,
    /** The answer a URL has to give for THIS node to find its number in it. */
    expected: expected,
    range: hasRange
      ? { min: subject.min, max: subject.max, step: subject.step, unit: String(subject.unit || '') }
      : null,
    /** The memory road: the key, the request, and a line somebody can paste into a terminal. */
    write: {
      key: key,
      request: {
        method: 'POST',
        url: apex + '/v1/memory',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenPlaceholder },
        body: body,
      },
      tokenPlaceholder: tokenPlaceholder,
      curl: 'curl -X POST ' + shellQuoted(apex + '/v1/memory')
        + ' -H "Content-Type: application/json"'
        + ' -H "Authorization: Bearer ' + tokenPlaceholder + '"'
        + ' -d ' + shellQuoted(JSON.stringify(body)),
      /** The same call for a Windows shell (windowsCall). `curl` above is for sh, bash and zsh. */
      windows: windowsCall(apex + '/v1/memory', tokenPlaceholder, body),
    },
    /**
     * The program road (2026-11-07): an outside program (a sensor, a Lambda) writes this value through
     * a receiver of the owner, an address and a key that reach exactly this key and nothing else
     * (/v1/receive). The memory road above needs a session of the owner, which a program must not
     * hold: a personal access token writes into its own test identity, and an agent token reaches
     * all of the owner's memory. `settings` opens the owner's Receivers page with this key filled in.
     */
    receiver: receiverRoad(apex, ownerForAddress(ctx.owner, ctx.nodeId), key, doc, subjectId, sample, keyPlaceholder),
    /** The agent road: the same thing said out loud, in the language the page is reading. */
    sentence: fill(say('sentence.write', wanted), {
      key: key,
      sample: JSON.stringify(sample),
      title: String(textOf(doc.title, wanted) || doc.key || ''),
    }),
    vocabulary: vocabularyOf(subject.type || 'value'),
  };
}

/**
 * The outward dialog's whole content, for a machine or for a trigger already written on one.
 * @param {{ id: string, node: any, doc: any, graph: any, langs?: () => string[], base?: string }} ctx
 * @returns {any}
 */
export function outwardShape(ctx) {
  const doc = ctx.doc || {};
  const nodes = (doc.model || {}).nodes || {};
  const langs = typeof ctx.langs === 'function' ? ctx.langs : function () { return []; };
  const wanted = langs();
  const isTrigger = String((ctx.node || {}).type) === 'trigger';

  /** The trigger this dialog edits: the one clicked, the one already on this machine, or none yet. */
  let triggerId = isTrigger ? String(ctx.id) : null;
  if (!triggerId) {
    for (const id of Object.keys(nodes)) {
      const node = nodes[id] || {};
      if (String(node.type) === 'trigger' && watchOf(node).node === String(ctx.id)) {
        triggerId = id;
        break;
      }
    }
  }
  const written = triggerId ? nodes[triggerId] : null;
  const watching = written ? watchOf(written).node : String(ctx.id);
  const machine = nodes[watching] || {};

  const target = (written && written.target) || {};
  const kind = String(target.kind || 'url') === 'agent' ? 'agent' : 'url';
  const shaped = kind === 'agent'
    ? { kind: 'agent', agent: String(target.agent || '') }
    : { kind: 'url', url: String(target.url || ''), method: String(target.method || 'POST') };

  const draft = written || {
    type: 'trigger', on: watching, enabled: true, target: shaped, include: 'all',
  };
  const state = String(ctx.graph ? ctx.graph.valueOf(watching) || '' : '');

  return {
    /** The trigger's id when the record already carries one, null when this would write the first. */
    trigger: triggerId,
    /** The id a new trigger would be written under, so the dialog can say it before saving. */
    newId: String(watching) + 'Tells',
    watching: watching,
    label: String(textOf(draft.label, wanted) || textOf(machine.label, wanted) || watching),
    states: statesOf(machine),
    enabled: draft.enabled !== false,
    include: Array.isArray(draft.include) ? draft.include.slice() : 'all',
    target: shaped,
    methods: TRIGGER_METHODS.slice(),
    /** The message as it would go, for the state the document is in right now. */
    payload: buildPayload({
      doc: doc, graph: ctx.graph, langs: langs,
      triggerId: triggerId || (String(watching) + 'Tells'),
      trigger: draft,
      transition: { node: watching, from: state, to: state, event: '' },
      at: new Date().toISOString(),
    }),
    vocabulary: vocabularyOf('trigger'),
  };
}
