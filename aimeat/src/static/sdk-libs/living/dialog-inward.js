/**
 * @file living/dialog-inward.js
 * @description "TÄMÄ ARVO VOI TULLA ULKOA." The dialog behind the inward gear, and the whole of its
 *   job is to answer one question a person cannot answer by looking at the document: what would
 *   somebody else have to send for this number to move by itself?
 *
 *   THREE ROADS, AND THEY ARE NOT ALTERNATIVES SO MUCH AS THREE DIFFERENT PEOPLE. The URL road is
 *   for a reading that already exists at an address — a spot price, a weather station, a plant's
 *   own API — and the document goes and asks for it. The MEMORY road is for a writer who has no
 *   address to be asked at: a device, an agent, another app, pushing a value into a key of this
 *   document's own. The AGENT road is that same memory road said as one sentence a person can paste
 *   into their own chat, and it is the road most people will actually take, which is why it is
 *   shown whichever road is picked.
 *
 *   EVERY EXAMPLE IS THIS NODE'S. The JSON on the screen is built from this node's path, this
 *   node's unit and this node's current reading (hooks-shapes.js), so a person who copies it is
 *   copying something that will work. A dialog that showed a generic example would be worse than
 *   none: the person copies it, the shape is wrong, and the failure lands on the far side of an API
 *   call where nobody can see it.
 *
 *   SAVE WRITES INTO THE RECORD, and the record is the truth. There is no second store of hook
 *   settings anywhere: what this dialog does is edit a node, and the document's own persistence —
 *   whatever the app does with `onRecordChange` — carries it.
 *   AN ADDRESS THAT ASKS WHO IS CALLING IS THE ORDINARY CASE, not the exotic one. A spot price is
 *   open; a plant's own API, a metering service and every paid feed want a key, and until this
 *   dialog could send a header the URL road reached only the open half of the world. The key is
 *   not typed into the record: the value box takes `{{secret:NAME}}` from the owner's vault, the
 *   name is what the document carries, and the server puts the value in as the read leaves.
 * @structure openInward(spec) → { close }
 * @usage
 *   import { openInward } from './dialog-inward.js';
 *   openInward({ id, node, doc, graph, hooks, langs, base, onSave });
 * @version-history
 *   v0.8.4 -- 2026-11-08 -- The vault is read only when the sign-in can list it (vaultNames), so the
 *     dialog inside an app makes no refused request; the picker then says the list is not available
 *     here (secaudit2026nov08b round 15c).
 *   v0.8.3 -- 2026-11-08 -- When the page does not know who is signed in, a notice above the program
 *     road's call says the address needs the person signed in and offers the page's own sign-in
 *     (AIMEAT.auth.signIn); after it the dialog draws again with the name in the call and the road
 *     the person chose kept (spec.draft). A page without the auth library says to write the username
 *     in. Signed in, the dialog is as before (secaudit2026nov08b round 15c).
 *   v0.8.2 -- 2026-11-08 -- The program road's call goes to the node's own address with the signed-in
 *     owner's name in it, and a line under it says where the key comes from (and, when the page does
 *     not know the name, what goes in its place) (secaudit2026nov08b round 15b).
 *   v0.8.1 -- 2026-11-08 -- Each curl line's label says it is for macOS and Linux, and a closed fold
 *     under it holds the same call for PowerShell and Command Prompt: the body to save as value.json
 *     and a curl.exe line that reads it (secaudit2026nov08b round 15).
 *   v0.8.0 — 2026-11-07 — The memory road leads with the program road: a receiver made for this key
 *     on the owner's Receivers page, and the call a program sends through it. The call with the
 *     owner's own token stays below it, for the owner's own tools.
 *   v0.7.0 — 2026-09-06 — The URL road sends headers, and a header's value takes a secret's NAME
 *     from the owner's vault rather than a key typed into the document.
 *   v0.6.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */
import { kit } from './dom.js';
import { say, fill } from './hooks-words.js';
import { inwardShape, ownerNotice } from './hooks-shapes.js';
import { asRaw } from './sources-url.js';
import {
  group, fields, copyBlock, statusLine, vocabularyNote, headerEditor, apexPage, signedInOwner, signInOffer,
  secretsListable, vaultNames,
} from './dialog-parts.js';
import { NODE_ID } from '../_core/config.js';

/** The value a reading came back as, in one line a status can show. */
function reading(value) {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * The Windows form of one call, folded: the JSON body to save as value.json, and the curl.exe line
 * that reads it in the same folder. Closed until the person opens it.
 * @param {HTMLElement} host @param {{ file: string, body: string, curl: string }} call
 * @param {(key: string) => string} words @param {() => string[]} langs
 */
function windowsBlock(host, call, words, langs) {
  if (!call) return;
  const fold = document.createElement('details');
  fold.className = 'ak-living__copy';
  const summary = document.createElement('summary');
  summary.className = 'ak-living__copy-label';
  summary.textContent = words('shell.windows');
  fold.appendChild(summary);
  copyBlock(fold, { label: fill(words('shell.windowsFile'), { file: call.file }), text: call.body, langs: langs });
  copyBlock(fold, { label: words('shell.windowsRun'), text: call.curl, langs: langs });
  host.appendChild(fold);
}

/**
 * The notice above the program road's call when its address cannot carry the account name: why the
 * name is missing, and the page's own sign-in as a button (ownerNotice kind `signIn`), or the line
 * that says to write the name in (kind `write`). `onSignedIn` runs with the session a sign-in made.
 * @param {HTMLElement} host @param {any} notice @param {string} placeholder
 * @param {(key: string) => string} words @param {(() => Promise<any>)|null} signIn
 * @param {(session: any) => void} onSignedIn
 */
function ownerNoticeBlock(host, notice, placeholder, words, signIn, onSignedIn) {
  if (!notice) return;
  const box = document.createElement('div');
  box.className = 'ak-living__dialog-signin';
  box.setAttribute('data-ak-part', 'signIn');
  const line = document.createElement('p');
  line.className = 'ak-living__dialog-signin-text';
  line.textContent = fill(words(notice.words), { placeholder: placeholder });
  box.appendChild(line);
  if (notice.kind === 'signIn' && signIn) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ak-btn ak-btn--primary ak-living__dialog-test';
    button.textContent = words(notice.button);
    button.addEventListener('click', function () {
      // The click is the user gesture an app origin's grant window needs. Null: the window was
      // closed or the sign-in dialog dismissed, and the notice stays as it is.
      signIn().then(function (session) { if (session) onSignedIn(session); })
        .catch(function (e) { console.debug('[aimeat-living] sign-in closed', e); });
    });
    box.appendChild(button);
  }
  host.appendChild(box);
}
/**
 * Open the inward dialog for one node.
 * @param {{ id: string, node: any, doc: any, graph: any, hooks: any, langs?: () => string[],
 *   base?: string, onSave?: (id: string) => void, draft?: any }} spec
 * @returns {any}
 */
export function openInward(spec) {
  const langs = typeof spec.langs === 'function' ? spec.langs : function () { return []; };
  // The program road's call goes to the node's own address in the signed-in owner's name: a program
  // copies it as it is, so it must not carry this document's origin or a word the person fills in.
  const shape = inwardShape(Object.assign({
    apex: apexPage(''), owner: signedInOwner(), nodeId: NODE_ID,
  }, spec));
  const words = function (key) { return say(key, langs()); };
  // The headers come off the node itself: the shape says what the ANSWER must look like, and a
  // header is part of the asking.
  const subjectNode = (((spec.doc || {}).model || {}).nodes || {})[shape.subject] || {};
  // `spec.draft` is what the person had chosen when the dialog redraws after a sign-in.
  const draft = Object.assign({
    road: shape.road, url: shape.url, path: shape.path, every: shape.every, key: shape.key,
    headers: Object.assign({}, subjectNode.headers || {}),
  }, spec.draft || {});
  /**
   * The vault's names, once they arrive. Never a value: the route does not carry one. Null when this
   * sign-in cannot list them, which the picker shows as "not available here".
   * @type {string[]|null}
   */
  let vault = secretsListable() ? [] : null;

  const k = kit();
  const handle = k.dialog({
    title: words('inward.title'),
    text: words('inward.lead'),
    size: 'wide',
    body(host) {
      host.classList.add('ak-living__dialog');

      const roads = group(host, words('inward.road'));
      const urlRoad = group(host, words('inward.url'));
      const keyRoad = group(host, words('inward.write'));

      /** Which road's fields are on the screen. Only one is ever an answer to "where from". */
      function showRoad() {
        urlRoad.show(draft.road === 'url');
        keyRoad.show(draft.road === 'key');
      }

      fields(roads.body, [{
        name: 'road', id: 'ak-living-road', type: 'select', label: words('inward.road'),
        value: draft.road,
        options: [
          { value: 'hand', label: words('inward.road.hand') },
          { value: 'url', label: words('inward.road.url') },
          { value: 'key', label: words('inward.road.key') },
        ],
        after: showRoad,
      }], draft);

      // ── The URL road ──
      const expected = { block: null };
      fields(urlRoad.body, [
        { name: 'url', id: 'ak-living-url', type: 'text', label: words('inward.url'), value: draft.url },
        {
          name: 'path', id: 'ak-living-path', type: 'text', label: words('inward.path'),
          value: draft.path,
          after() { if (expected.block) expected.block.set(JSON.stringify(shapeNow(), null, 2)); },
        },
        { name: 'every', id: 'ak-living-every', type: 'number', label: words('inward.every'), value: draft.every, min: 10 },
      ], draft);

      /** The answer shape for the path currently in the box, not the one the record was saved with. */
      function shapeNow() {
        return inwardShape(Object.assign({}, spec, {
          node: Object.assign({}, spec.node, { path: draft.path, raw: shape.raw, url: draft.url || 'x' }),
        })).expected;
      }

      // What the asking carries. An open address needs none of this; an address that wants a key
      // gets it by name, and the value never reaches this browser.
      const headers = headerEditor(urlRoad.body, {
        headers: draft.headers,
        langs: langs,
        base: String(spec.base || ''),
        secrets: function () { return vault; },
        onChange: function (map) { draft.headers = map; },
      });
      // Asked only when this sign-in can list the vault; inside an app without that permission the
      // picker says so, and no request is refused on every opening (dialog-parts.js vaultNames).
      if (vault !== null) {
        vaultNames().then(function (names) { vault = names; headers.refresh(); });
      }

      expected.block = copyBlock(urlRoad.body, {
        label: words('inward.expected'), text: JSON.stringify(shape.expected, null, 2), langs: langs,
      });
      const urlStatus = statusLine(urlRoad.body);
      const testRead = document.createElement('button');
      testRead.type = 'button';
      testRead.className = 'ak-btn ak-btn--outline ak-living__dialog-test';
      testRead.textContent = words('inward.testRead');
      testRead.addEventListener('click', function () {
        urlStatus.say('…', true);
        spec.hooks.read({ url: draft.url, path: draft.path, raw: shape.raw ? true : undefined, headers: draft.headers })
          .then(function (answer) {
            if (answer.refusal) { urlStatus.say(spec.hooks.words(answer.refusal), false); return; }
            const got = shape.raw ? asRaw(answer.value) : answer.value;
            urlStatus.say(reading(got), true);
          });
      });
      urlRoad.body.appendChild(testRead);

      // ── The memory road ──
      fields(keyRoad.body, [{
        name: 'key', id: 'ak-living-key', type: 'text', label: words('inward.key'),
        value: draft.key || shape.write.key,
      }], draft);
      // A PROGRAM WRITES THROUGH A RECEIVER, never with a session of the owner (services/receivers/):
      // the call above is for the owner's own tools, and the receiver's address and key reach this
      // one key only. The link opens the owner's Receivers page with the key filled in.
      const receiverLine = document.createElement('p');
      receiverLine.className = 'ak-living__dialog-range';
      receiverLine.textContent = words('inward.receiverWhy') + ' ';
      const receiverLink = document.createElement('a');
      receiverLink.href = shape.receiver.settings;
      receiverLink.target = '_blank';
      receiverLink.rel = 'noopener';
      receiverLink.textContent = words('inward.receiverMake');
      receiverLine.appendChild(receiverLink);
      keyRoad.body.appendChild(receiverLine);
      // An app's own origin has no session until the person signs in there, and the address needs
      // the account name: the notice says so above the call and offers the sign-in. After it, the
      // dialog draws again with the name in the call and the person's choices kept.
      ownerNoticeBlock(keyRoad.body, ownerNotice(shape.receiver, !!signInOffer()), shape.receiver.ownerPlaceholder,
        words, signInOffer(), function () {
          handle.close('signed-in');
          openInward(Object.assign({}, spec, { draft: Object.assign({}, draft) }));
        });
      // Each call twice: the line for sh, bash and zsh, and, folded under it, the same call for a
      // Windows shell, whose line carries no live data (hooks-shapes.js windowsCall).
      copyBlock(keyRoad.body, {
        label: words('inward.receiverCall') + ' (' + words('shell.posix') + ')', text: shape.receiver.curl, langs: langs,
      });
      windowsBlock(keyRoad.body, shape.receiver.windows, words, langs);
      // The key is shown once, when it is made, so the call carries a placeholder and this line says
      // where the key comes from. The account name has its own notice above the call.
      const keyWhere = document.createElement('p');
      keyWhere.className = 'ak-living__dialog-range';
      keyWhere.textContent = fill(words('inward.keyWhere'), { placeholder: shape.receiver.keyPlaceholder });
      keyRoad.body.appendChild(keyWhere);
      copyBlock(keyRoad.body, {
        label: words('inward.write') + ' (' + words('shell.posix') + ')', text: shape.write.curl, langs: langs,
      });
      windowsBlock(keyRoad.body, shape.write.windows, words, langs);

      // ── The agent road, always on the screen: it is the one most people will use ──
      copyBlock(host, { label: words('inward.agent'), text: shape.sentence, langs: langs });

      if (shape.range) {
        const line = document.createElement('p');
        line.className = 'ak-living__dialog-range';
        line.textContent = words('inward.range') + ': ' + [
          shape.range.min, shape.range.max,
        ].filter(function (n) { return n != null; }).join(' … ')
          + (shape.range.unit ? ' ' + shape.range.unit : '')
          + (shape.range.step != null ? ' (' + shape.range.step + ')' : '');
        host.appendChild(line);
      }
      vocabularyNote(host, shape.vocabulary);
      showRoad();
    },
    actions: [
      { id: 'close', label: words('close'), tone: 'ghost', run: function () { handle.close('close'); } },
      { id: 'save', label: words('save'), tone: 'primary', run: function () { save(); handle.close('save'); } },
    ],
  });

  /** Write the road into the record. The node is the truth; there is no second store. */
  function save() {
    const nodes = ((spec.doc || {}).model || {}).nodes || {};
    const node = nodes[shape.subject];
    if (!node) return;
    delete node.url;
    delete node.key;
    delete node.every;
    delete node.headers;
    if (draft.road === 'url') {
      node.type = 'source';
      node.url = String(draft.url || '');
      if (draft.path) node.path = String(draft.path); else delete node.path;
      const every = Number(draft.every);
      if (Number.isFinite(every) && every > 0) node.every = every;
      // Written only when there is one: a source that asks plainly reads as one in the record.
      if (Object.keys(draft.headers || {}).length) node.headers = draft.headers;
    } else if (draft.road === 'key') {
      node.type = 'source';
      node.key = String(draft.key || shape.write.key);
      if (draft.path) node.path = String(draft.path); else delete node.path;
    } else {
      // Back to a value a person moves: the reading it last held stays as the value it starts at.
      node.type = 'value';
      delete node.path;
      delete node.raw;
    }
    if (spec.onSave) spec.onSave(shape.subject);
  }

  return handle;
}
