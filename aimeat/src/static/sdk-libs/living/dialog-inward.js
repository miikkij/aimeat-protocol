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
 * @structure openInward(spec) → { close }
 * @usage
 *   import { openInward } from './dialog-inward.js';
 *   openInward({ id, node, doc, graph, hooks, langs, base, onSave });
 * @version-history
 *   v0.6.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */
import { kit } from './dom.js';
import { say } from './hooks-words.js';
import { inwardShape } from './hooks-shapes.js';
import { asRaw } from './sources-url.js';
import { group, fields, copyBlock, statusLine, vocabularyNote } from './dialog-parts.js';

/** The value a reading came back as, in one line a status can show. */
function reading(value) {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Open the inward dialog for one node.
 * @param {{ id: string, node: any, doc: any, graph: any, hooks: any, langs?: () => string[],
 *   base?: string, onSave?: (id: string) => void }} spec
 * @returns {any}
 */
export function openInward(spec) {
  const langs = typeof spec.langs === 'function' ? spec.langs : function () { return []; };
  const shape = inwardShape(spec);
  const words = function (key) { return say(key, langs()); };
  const draft = {
    road: shape.road, url: shape.url, path: shape.path, every: shape.every, key: shape.key,
  };

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
        spec.hooks.read({ url: draft.url, path: draft.path, raw: shape.raw ? true : undefined })
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
      copyBlock(keyRoad.body, {
        label: words('inward.write'), text: shape.write.curl, langs: langs,
      });

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
    if (draft.road === 'url') {
      node.type = 'source';
      node.url = String(draft.url || '');
      if (draft.path) node.path = String(draft.path); else delete node.path;
      const every = Number(draft.every);
      if (Number.isFinite(every) && every > 0) node.every = every;
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
