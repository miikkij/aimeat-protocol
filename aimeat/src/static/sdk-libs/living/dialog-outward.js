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
 *   THE AGENT IS PICKED, NOT SPELLED. A typed name is a name that can be typed wrong, and the
 *   refusal for a wrong one arrives at delivery time, on the far side of a crossing nobody is
 *   watching. So the list is the owner's own agents, read as the signed-in owner, with when each
 *   was last seen beside it; an owner with none is told so and given the door to where an agent is
 *   connected, rather than a select with nothing in it.
 *
 *   A HEADER CARRIES THE KEY, AND THE KEY IS NOT IN THE RECORD. Most addresses worth telling want
 *   an API key, and a key typed into a header here would be a key in a document anybody holding a
 *   copy can read. The value box takes `{{secret:NAME}}` from the owner's vault instead: the name
 *   is what travels, and the server puts the value in as the call leaves.
 *
 *   A TEST SEND GOES THROUGH THE SAME DOOR AS A REAL ONE and is marked `test: true` in the body, so
 *   a receiver can tell them apart and the allowlist, the rate limit and the refusal words are
 *   exactly the ones a real delivery would meet.
 * @structure openOutward(spec) → { close }
 * @usage
 *   import { openOutward } from './dialog-outward.js';
 *   openOutward({ id, node, doc, graph, hooks, langs, onSave });
 * @version-history
 *   v0.7.0 — 2026-09-06 — The agent target is a pick over the owner's own agents, and the URL
 *     target gained the headers it sends, with a picker that writes a secret's NAME into a value.
 *   v0.6.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */
import { el, kit } from './dom.js';
import { say, fill } from './hooks-words.js';
import { outwardShape } from './hooks-shapes.js';
import { group, fields, copyBlock, statusLine, vocabularyNote, ownerRead, pickOrWords, headerEditor, apexPage } from './dialog-parts.js';

/** A date as short as a pick's second line needs it. */
function seenWord(iso, langs) {
  if (!iso) return say('agent.unseen', langs);
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return say('agent.unseen', langs);
  return fill(say('agent.seen', langs), { date: when.toLocaleDateString() });
}

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
  // The headers come off the record itself rather than off the shape: the shape says what the
  // message looks like, and a header is part of the road, not part of the message.
  const written = shape.trigger ? (((spec.doc || {}).model || {}).nodes || {})[shape.trigger] : null;
  const writtenHeaders = (written && written.target && written.target.headers) || {};
  const draft = {
    kind: shape.target.kind,
    url: String(shape.target.url || ''),
    method: String(shape.target.method || 'POST'),
    agent: String(shape.target.agent || ''),
    enabled: shape.enabled,
    headers: Object.assign({}, writtenHeaders),
  };
  /** The vault's names, once they arrive. Never a value: the route does not carry one. */
  let vault = [];

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

      // The headers of the URL road, with the secret picker on every value. An agent target is a
      // task on this node and carries none, which is why this sits inside the URL group.
      const headers = headerEditor(urlRoad.body, {
        headers: draft.headers,
        langs: langs,
        base: String(spec.base || ''),
        secrets: function () { return vault; },
        onChange: function (map) { draft.headers = map; },
      });
      ownerRead('/v1/secrets').then(function (data) {
        const list = data && Array.isArray(data.secrets) ? data.secrets : [];
        vault = list.map(function (s) { return String(s && s.name ? s.name : s); }).filter(Boolean);
        headers.refresh();
      });

      // The agent road: the owner's own agents, read as the owner. Until the list arrives the box
      // is the name the record already carries, so a dialog opened and closed changes nothing.
      const agentBox = el('div', { class: 'ak-living__dialog-fields' });
      agentRoad.body.appendChild(agentBox);
      fields(agentBox, [
        { name: 'agent', id: 'ak-living-hook-agent', type: 'text', label: words('outward.agent'), value: draft.agent },
      ], draft);
      ownerRead('/v1/agents').then(function (data) {
        const list = data && Array.isArray(data.agents) ? data.agents : [];
        while (agentBox.firstChild) agentBox.removeChild(agentBox.firstChild);
        if (!list.length) {
          agentBox.appendChild(pickOrWords({
            words: words('agent.none'),
            doorWords: words('agent.connect'),
            href: apexPage('/v1/profile?tab=agents'),
          }));
          return;
        }
        // A name the record carries that the account no longer has stays on the list, so saving
        // the dialog cannot silently retarget a trigger at somebody else's agent.
        const options = list.map(function (a) {
          const name = String(a.name || '');
          const said = String(a.display_name || name);
          return { value: name, label: said + ' · ' + seenWord(a.last_seen, langs()) };
        });
        if (draft.agent && !options.some(function (o) { return o.value === draft.agent; })) {
          options.unshift({ value: draft.agent, label: draft.agent });
        }
        if (!draft.agent) options.unshift({ value: '', label: words('agent.pick') });
        fields(agentBox, [{
          name: 'agent', id: 'ak-living-hook-agent', type: 'select', label: words('outward.agent'),
          value: draft.agent, options: options,
        }], draft);
      });

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
              : spec.hooks.send({ url: draft.url, method: draft.method, headers: draft.headers, body: body });
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
        : Object.assign(
          { kind: 'url', url: String(draft.url || ''), method: String(draft.method || 'POST') },
          // An empty map is left OFF the record rather than written as {}: a trigger that sends no
          // headers of its own should read as one, in the record as much as on the screen.
          Object.keys(draft.headers || {}).length ? { headers: draft.headers } : null,
        ),
    });
    if (spec.onSave) spec.onSave(id);
  }

  return handle;
}
