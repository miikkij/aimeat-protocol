/**
 * @file living/dialog-outward.js
 * @description "KUN TÄMÄ MUUTTUU, KERRO JOLLEKIN." The dialog behind the outward gear, on a machine
 *   or on a trigger already written against one. Where the inward dialog answers "what would
 *   somebody have to send me", this one answers the harder question: what exactly am I about to
 *   send THEM?
 *
 *   THE PAYLOAD IS SHOWN, NOT DESCRIBED. Not a schema, not a sample with placeholder numbers: the
 *   object that would leave this browser if the machine moved right now, built by the same
 *   payload.js the delivery uses. If those two ever disagreed the dialog would be lying, which is
 *   why they are one function called twice rather than two functions that look alike. A person can
 *   copy it, paste it into whatever is going to receive it, and build against the real thing before
 *   a single crossing has happened.
 *
 *   TWO KINDS OF RECEIVER, AND THE SECOND ONE IS THE POINT. A URL is the ordinary webhook. An AGENT
 *   is this platform's own answer: the message becomes a task for one of the owner's own agents,
 *   titled with the crossing, so a document that notices something can hand it to something that
 *   can act on it — without anybody writing a service in between.
 *
 *   A TEST SEND GOES THROUGH THE SAME DOOR AS A REAL ONE and is marked `test: true` in the body, so
 *   a receiver can tell them apart and the allowlist, the rate limit and the refusal words are
 *   exactly the ones a real delivery would meet.
 * @structure openOutward(spec) → { close }
 * @usage
 *   import { openOutward } from './dialog-outward.js';
 *   openOutward({ id, node, doc, graph, hooks, langs, onSave });
 * @version-history
 *   v0.6.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */
import { el, kit } from './dom.js';
import { say } from './hooks-words.js';
import { outwardShape } from './hooks-shapes.js';
import { group, fields, copyBlock, statusLine, vocabularyNote } from './dialog-parts.js';

/**
 * Open the outward dialog for a machine or a trigger.
 * @param {{ id: string, node: any, doc: any, graph: any, hooks: any, langs?: () => string[],
 *   base?: string, onSave?: (id: string) => void }} spec
 * @returns {any}
 */
export function openOutward(spec) {
  const langs = typeof spec.langs === 'function' ? spec.langs : function () { return []; };
  const shape = outwardShape(spec);
  const words = function (key) { return say(key, langs()); };
  const draft = {
    kind: shape.target.kind,
    url: String(shape.target.url || ''),
    method: String(shape.target.method || 'POST'),
    agent: String(shape.target.agent || ''),
    enabled: shape.enabled,
  };

  const k = kit();
  const handle = k.dialog({
    title: words('outward.title'),
    text: words('outward.lead'),
    size: 'wide',
    body(host) {
      host.classList.add('ak-living__dialog');

      const watching = el('p', { class: 'ak-living__dialog-watch' }, [
        el('span', { class: 'ak-living__dialog-watch-label', text: words('outward.watching') + ': ' }),
        el('code', { text: shape.watching }),
      ]);
      host.appendChild(watching);
      if (shape.states.length) {
        const strip = el('div', { class: 'ak-living__states ak-living__dialog-states', role: 'group' });
        for (const name of shape.states) {
          strip.appendChild(el('span', {
            class: 'ak-living__state', 'data-state': name, text: name,
            'data-on': String(shape.payload.machines[shape.watching] || '').split('.').indexOf(name) >= 0 ? 'yes' : 'no',
          }));
        }
        host.appendChild(el('div', { class: 'ak-living__dialog-group' }, [
          el('h3', { class: 'ak-living__dialog-heading', text: words('outward.states') }),
          strip,
        ]));
      }

      const who = group(host, words('outward.kind'));
      const urlRoad = group(host, words('outward.url'));
      const agentRoad = group(host, words('outward.agent'));

      function showKind() {
        urlRoad.show(draft.kind === 'url');
        agentRoad.show(draft.kind === 'agent');
      }

      fields(who.body, [
        {
          name: 'kind', id: 'ak-living-kind', type: 'select', label: words('outward.kind'),
          value: draft.kind,
          options: [
            { value: 'url', label: words('outward.kind.url') },
            { value: 'agent', label: words('outward.kind.agent') },
          ],
          after: showKind,
        },
        {
          name: 'enabled', id: 'ak-living-enabled', type: 'toggle', label: words('outward.enabled'),
          value: draft.enabled,
        },
      ], draft);

      fields(urlRoad.body, [
        { name: 'url', id: 'ak-living-hook-url', type: 'text', label: words('outward.url'), value: draft.url },
        {
          name: 'method', id: 'ak-living-hook-method', type: 'select', label: words('outward.method'),
          value: draft.method,
          options: shape.methods.map(function (m) { return { value: m, label: m }; }),
        },
      ], draft);

      fields(agentRoad.body, [
        { name: 'agent', id: 'ak-living-hook-agent', type: 'text', label: words('outward.agent'), value: draft.agent },
      ], draft);

      copyBlock(host, {
        label: words('outward.payload'),
        text: JSON.stringify(shape.payload, null, 2),
        langs: langs,
      });

      const status = statusLine(host);
      const testSend = el('button', {
        type: 'button', class: 'ak-btn ak-btn--outline ak-living__dialog-test',
        text: words('outward.testSend'),
        on: {
          click() {
            status.say('…', true);
            const body = Object.assign({}, shape.payload, { test: true });
            const call = draft.kind === 'agent'
              ? spec.hooks.task({
                agent: draft.agent,
                title: 'Living document: ' + shape.label + ' (test)',
                description: JSON.stringify(body, null, 2),
                body: body,
              })
              : spec.hooks.send({ url: draft.url, method: draft.method, body: body });
            call.then(function (answer) {
              if (answer.refusal) { status.say(spec.hooks.words(answer.refusal), false); return; }
              status.say(String(answer.status || 200) + ' · ' + String(answer.ms || 0) + ' ms', true);
            });
          },
        },
      });
      host.appendChild(testSend);
      vocabularyNote(host, shape.vocabulary);
      showKind();
    },
    actions: [
      { id: 'close', label: words('close'), tone: 'ghost', run: function () { handle.close('close'); } },
      { id: 'save', label: words('save'), tone: 'primary', run: function () { save(); handle.close('save'); } },
    ],
  });

  /**
   * Write the trigger into the record — the one that is there, or the first one on this machine.
   * A trigger the record did not carry a moment ago works on the next crossing: the delivery
   * runtime reads its triggers out of the record rather than out of the graph.
   */
  function save() {
    const model = (spec.doc || {}).model || {};
    if (!model.nodes) model.nodes = {};
    const id = shape.trigger || shape.newId;
    const before = model.nodes[id] || {};
    model.nodes[id] = Object.assign({}, before, {
      type: 'trigger',
      on: shape.watching,
      enabled: !!draft.enabled,
      include: shape.include,
      target: draft.kind === 'agent'
        ? { kind: 'agent', agent: String(draft.agent || '') }
        : { kind: 'url', url: String(draft.url || ''), method: String(draft.method || 'POST') },
    });
    if (spec.onSave) spec.onSave(id);
  }

  return handle;
}
