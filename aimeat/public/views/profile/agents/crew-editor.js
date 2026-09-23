/**
 * @file crew-editor.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The four form sections of the Crew tab (Identity · Crew · Run · Contract) and the
 *   error anchoring they share. A crew definition is edited as a plain object; each section gets
 *   the doc and an onChange that replaces it. The validator's messages are shown VERBATIM: this
 *   file only decides which card a line sits under, from the `<field>[<index>]` prefix the
 *   crewaimeat validator puts at the start of every message.
 * @structure
 *   - anchorErrors(lines) — group verbatim messages by field / member index / task index
 *   - ListInput / JsonInput — comma lists and JSON blobs with local text state
 *   - Group — a label over controls the shared Field cannot hold
 *   - ToolMenu — the runtime's own tool list when it answered, else the served copy; the Exchange
 *     bundle, and its verbs behind a "pick verbs" fold
 *   - CrewPart · ItemBox — a section with its error lines; one member or task
 *   - IdentitySection · CrewSection · RunSection · ContractSection
 * @version-history
 *   2026-09-22 -- A member's or task's Remove carries the danger tone.
 *   2026-09-22 -- Composed from the shared parts (Section, Fold, Field, Surface, Action, Text) instead
 *     of the agents-crew sheet's classes. The list and JSON inputs commit on the native change event
 *     (fired when the field is left with a changed value), which is what the blur handler did.
 *   2026-09-20 -- ToolMenu has a Decisions group: `decide` and `decide:<rule>`, disabled with the
 *     reason and a link to the settings when no TypeSafe key exists for this agent.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   v1.1.0 -- 2026-08-28 -- A list field never flattens what it cannot show. capabilities.technical is
 *     a list of {name, type} objects; the comma input rendered them as "[object Object]" and a blur
 *     wrote that string back, which would have emptied the agent's searchable capabilities without
 *     an error. Now: objects shown by name and preserved by name on edit, any other non-string
 *     list handed to the JSON editor, and a blur writes only when the text changed.
 *   v1.0.0 -- 2026-08-28 -- Initial (JSON-agent Crew tab).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { CORE_TOOLS, EXCHANGE_BUNDLE, EXCHANGE_VERBS, toolLabelKey } from './crew-tools.js';
import { emptyMember, emptyTask } from './crew-templates.js';
import { TaskDag } from './crew-dag.js';
import { Section, Fold, Stack, Columns, Field, Action, Surface, Text } from '/components/poster-parts.js';

const html = htm.bind(h);
const K = 'profile.agents.detail.crew';

const IDENTITY_FIELDS = new Set(['agent_name', 'tags', 'capabilities', 'readme_md', 'skills']);
const RUN_FIELDS = new Set(['llm_profile', 'temperature', 'process', 'listen_for', 'memory', 'discover']);
const CONTRACT_FIELDS = new Set(['offers', 'signals']);

/**
 * Group the validator's lines by where they point. The prefix grammar is
 * `<field>[<index>] (<name>): <problem>`; anything that does not parse stays general.
 * Lines are never rewritten — only sorted into buckets.
 */
export function anchorErrors(lines) {
  const out = { general: [], identity: [], run: [], contract: [], agents: new Map(), tasks: new Map(), problemTaskIndexes: new Set() };
  for (const line of Array.isArray(lines) ? lines : []) {
    const m = /^([a-z_]+)(?:\[(\d+)\])?(?:\s*\([^)]*\))?\s*:/.exec(String(line));
    if (!m) { out.general.push(line); continue; }
    const field = m[1];
    const idx = m[2] !== undefined ? parseInt(m[2], 10) : null;
    if (field === 'agents' && idx !== null) {
      if (!out.agents.has(idx)) out.agents.set(idx, []);
      out.agents.get(idx).push(line);
    } else if (field === 'tasks' && idx !== null) {
      if (!out.tasks.has(idx)) out.tasks.set(idx, []);
      out.tasks.get(idx).push(line);
      out.problemTaskIndexes.add(idx);
    } else if (IDENTITY_FIELDS.has(field)) out.identity.push(line);
    else if (RUN_FIELDS.has(field)) out.run.push(line);
    else if (CONTRACT_FIELDS.has(field)) out.contract.push(line);
    else out.general.push(line);
  }
  return out;
}

export function ErrorLines({ lines }) {
  if (!lines || lines.length === 0) return null;
  return html`<${Stack} density="compact">${lines.map((l, i) => html`<${Text} key=${i} tone="danger">${l}<//>`)}<//>`;
}

const isStringList = (v) => Array.isArray(v) && v.every(x => typeof x === 'string');

/**
 * A comma-separated list with local text, committed when the field is left (the native change
 * event) so typing a comma is not eaten, and only when the text actually changed. Two guards keep
 * it from destroying what it cannot show: `toText`/`fromText` map a list of objects to names and
 * back (the mapper decides how an existing object survives an edit), and a list this input has no
 * mapper for and cannot show as strings is handed to the JSON editor instead of being flattened to
 * "[object Object]" and written back.
 */
function ListInput({ value, onChange, placeholder, id, toText, fromText, label, hint }) {
  const list = Array.isArray(value) ? value : [];
  const canShow = toText ? true : isStringList(list);
  const joined = canShow ? (toText ? toText(list) : list).join(', ') : '';
  const [text, setText] = useState(joined);
  useEffect(() => { setText(joined); }, [joined]);
  if (!canShow) return html`<${JsonInput} id=${id} label=${label} hint=${hint} value=${list} onChange=${onChange} rows="3" />`;
  const commit = () => {
    if (text === joined) return;
    const names = text.split(',').map(s => s.trim()).filter(Boolean);
    onChange(fromText ? fromText(names, list) : names);
  };
  return html`<${Field} id=${id} label=${label} hint=${hint} value=${text} placeholder=${placeholder || ''}
    onInput=${e => setText(e.target.value)} onChange=${commit} />`;
}

/** capabilities.technical is a list of {name, type} objects (the node indexes it for search). Shown
 *  by name; an edit keeps the existing object for a name that is still there and makes {name, type:
 *  'tool'} for a new one, so nothing the person did not touch is rewritten. */
const technicalToText = (list) => list.map(x => (x && typeof x === 'object' ? String(x.name ?? '') : String(x))).filter(Boolean);
function technicalFromText(names, prev) {
  const byName = new Map((Array.isArray(prev) ? prev : []).map(x => [x && typeof x === 'object' ? x.name : x, x]));
  return names.map(n => (byName.has(n) ? byName.get(n) : { name: n, type: 'tool' }));
}

/** A JSON blob (offers, signals) with local text; parsed when left, parse errors shown in place. */
function JsonInput({ value, onChange, id, rows, label, hint }) {
  const pretty = value === undefined || value === null ? '' : JSON.stringify(value, null, 2);
  const [text, setText] = useState(pretty);
  const [err, setErr] = useState(null);
  useEffect(() => { setText(pretty); setErr(null); }, [pretty]);
  const commit = () => {
    if (!text.trim()) { setErr(null); onChange(undefined); return; }
    try { onChange(JSON.parse(text)); setErr(null); }
    catch (e) { setErr(e.message); }
  };
  return html`<${Field} type="textarea" id=${id} label=${label} hint=${hint} rows=${Number(rows) || 4} value=${text}
    onInput=${e => setText(e.target.value)} onChange=${commit}
    error=${err ? t(`${K}.messages.jsonInvalid`, { err }) : undefined} />`;
}

/** A labelled group of controls the shared Field cannot hold (tool rows, checkbox groups). */
function Group({ label, children }) {
  return html`<${Stack} density="compact"><${Text} kind="label">${label}<//>${children}<//>`;
}

/**
 * The core rows, one Exchange row, and the verbs only when asked for.
 *
 * `runtimeTools` is what the agent's OWN runtime said it resolves (GET /crew/menu). When it answered,
 * that is the list, and each row carries the runtime's own one-line purpose. The served list is the
 * fallback for an agent that is offline or older — and it is a copy, which is exactly why it drifted
 * two tools behind before anybody asked the runtime.
 */
export function ToolMenu({ selected, onChange, idPrefix, runtimeTools, decideTools }) {
  const set = new Set(Array.isArray(selected) ? selected : []);
  // The decision rows: `decide`, one `decide:<rule>` per rule the owner made for agents, and any
  // `decide:` id the definition already names whose rule is gone, so it stays visible and removable.
  const ruleIds = (decideTools?.rules ?? []).map(r => `decide:${r.id}`);
  const orphans = [...set].filter(id => id.startsWith('decide:') && !ruleIds.includes(id));
  const decideIds = ['decide', ...ruleIds, ...orphans];
  const ruleOf = new Map((decideTools?.rules ?? []).map(r => [`decide:${r.id}`, r]));
  const [refine, setRefine] = useState(EXCHANGE_VERBS.some(v => set.has(v)));
  const live = Array.isArray(runtimeTools) && runtimeTools.length > 0 ? runtimeTools : null;
  const livePurpose = new Map((live ?? []).map(x => [x.id, x.purpose]));
  // Exchange keeps its own group whichever list we are on: it is one bundle plus thirteen verbs, and
  // spilling those into the core column is what the grouping exists to prevent.
  const core = live
    ? live.map(x => x.id).filter(id => id !== EXCHANGE_BUNDLE && !id.startsWith('exchange_'))
    : CORE_TOOLS;
  const verbs = live
    ? live.map(x => x.id).filter(id => id.startsWith('exchange_'))
    : EXCHANGE_VERBS;
  const toggle = (id) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange([...core.filter(id => !decideIds.includes(id)), EXCHANGE_BUNDLE, ...verbs, ...decideIds].filter(x => next.has(x)));
  };
  // A decision row is ticked only when a key exists somewhere in the order. A ticked one stays
  // untickable, so a definition can always be cleaned up.
  const decideOff = !decideTools?.available;
  // A tool row is a plain label around a native checkbox: the shared Field sets its label as a coral
  // small-caps caption, which is right for a field's name and wrong for a sentence of purpose.
  const toolRow = (id, desc, disabled) => html`<label key=${id}>
    <input type="checkbox" id=${`${idPrefix}-${id}`} checked=${set.has(id)} disabled=${disabled} onChange=${() => toggle(id)} />
    ${' '}<${Text} kind="mono">${id}<//>${' '}<${Text} kind="caption" tone="muted">${desc}<//>
  </label>`;
  const decideRow = (id) => {
    const rule = ruleOf.get(id);
    const desc = id === 'decide' ? t(`${K}.tools.decide`)
      : rule ? t(`${K}.tools.decideRule`, { title: rule.title, decides: rule.decides })
        : t(`${K}.tools.decideRuleGone`);
    return toolRow(id, desc, decideOff && !set.has(id));
  };
  const row = (id) => toolRow(id, livePurpose.get(id) || t(toolLabelKey(id)), false);
  return html`
    <${Stack} density="compact">
      <${Group} label=${t(`${K}.tools.core`)}>${core.map(row)}<//>
      <${Group} label=${t(`${K}.tools.exchange`)}>
        ${row(EXCHANGE_BUNDLE)}
        <${Fold} title=${t(`${K}.tools.exchangeRefine`)} open=${refine} onToggle=${() => setRefine(r => !r)}>
          <${Stack} density="compact">${verbs.map(row)}<//>
        <//>
      <//>
      <${Group} label=${t(`${K}.tools.decisions`)}>
        ${decideOff && html`
          <${Text} tone="muted">
            ${decideTools && !decideTools.enabled ? t(`${K}.tools.decideOffOperator`) : t(`${K}.tools.decideNoKey`)}
            ${' '}<${Action} kind="text" href="/v1/profile?tab=ai&open=decide-card">${t(`${K}.tools.decideNoKeyLink`)} →<//>
          <//>`}
        ${decideIds.map(decideRow)}
        ${!decideOff && ruleIds.length === 0 && html`
          <${Text} tone="muted">${t(`${K}.tools.decideNoRules`)} <${Action} kind="text" href="/v1/profile?tab=ai&open=decide-card">${t(`${K}.tools.decideNoKeyLink`)} →<//><//>`}
      <//>
    <//>
  `;
}

function CrewPart({ title, lines, children }) {
  return html`<${Section} size="small" density="compact" title=${title}>
    <${Stack} density="compact"><${ErrorLines} lines=${lines} />${children}<//>
  <//>`;
}

export function IdentitySection({ doc, onChange, errors }) {
  const set = (patch) => onChange({ ...doc, ...patch });
  const caps = (doc.capabilities && typeof doc.capabilities === 'object') ? doc.capabilities : {};
  const setCap = (k, v) => set({ capabilities: { ...caps, [k]: v } });
  return html`
    <${CrewPart} title=${t(`${K}.sections.identity`)} lines=${errors.identity}>
      <${Field} id="crew-agent-name" label=${t(`${K}.fields.agentName`)} hint=${t(`${K}.fields.agentNameHint`)}
        value=${doc.agent_name || ''} readOnly />
      <${ListInput} id="crew-tags" label=${t(`${K}.fields.tags`)} hint=${t(`${K}.fields.tagsHint`)}
        value=${doc.tags} onChange=${v => set({ tags: v })} placeholder="research, news" />
      <${Columns} layout="thirds" density="compact" collapse="600">
        <${ListInput} id="crew-cap-tech" label=${t(`${K}.fields.capTechnical`)} value=${caps.technical} onChange=${v => setCap('technical', v)}
          toText=${technicalToText} fromText=${technicalFromText} />
        <${ListInput} id="crew-cap-domain" label=${t(`${K}.fields.capDomain`)} value=${caps.domain} onChange=${v => setCap('domain', v)} />
        <${ListInput} id="crew-cap-lang" label=${t(`${K}.fields.capLanguages`)} value=${caps.languages} onChange=${v => setCap('languages', v)} placeholder="fi, en" />
      <//>
      <${ListInput} id="crew-skills" label=${t(`${K}.fields.skills`)} hint=${t(`${K}.fields.skillsHint`)}
        value=${doc.skills} onChange=${v => set({ skills: v.length ? v : undefined })} />
      <${Field} type="textarea" id="crew-readme" label=${t(`${K}.fields.readme`)} rows=${3} value=${doc.readme_md || ''}
        onInput=${e => set({ readme_md: e.target.value || undefined })} />
    <//>
  `;
}

function memberKey(m) { return (m && (m.name || m.role)) || ''; }

/** One member or task: its index in the definition, a remove action, and the validator's lines. */
function ItemBox({ index, problem, onRemove, lines, children }) {
  return html`<${Surface} kind="box" density="compact" tone=${problem ? 'danger' : 'plain'}>
    <${Stack} density="compact">
      <${Stack} direction="horizontal" align="between" density="compact">
        <${Text} kind="mono">${index}<//>
        <${Action} kind="text" tone="danger" onClick=${onRemove}>${t(`${K}.actions.remove`)}<//>
      <//>
      <${ErrorLines} lines=${lines} />
      ${children}
    <//>
  <//>`;
}

export function CrewSection({ doc, onChange, errors, runtimeTools, decideTools }) {
  const agents = Array.isArray(doc.agents) ? doc.agents : [];
  const tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
  const setAgents = (next) => onChange({ ...doc, agents: next });
  const setTasks = (next) => onChange({ ...doc, tasks: next });
  const patchAgent = (i, patch) => setAgents(agents.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const patchTask = (i, patch) => setTasks(tasks.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const memberKeys = agents.map(memberKey).filter(Boolean);
  const agentOptions = [{ value: '', label: '—' }, ...memberKeys.map(k => ({ value: k, label: k }))];
  return html`
    <${CrewPart} title=${t(`${K}.sections.crew`)} lines=${[]}>
      <${Text} kind="label">${t(`${K}.fields.members`)}<//>
      ${agents.map((a, i) => html`
        <${ItemBox} key=${`m${i}`} index=${`agents[${i}]`} problem=${errors.agents.has(i)} lines=${errors.agents.get(i)}
          onRemove=${() => setAgents(agents.filter((_, j) => j !== i))}>
          <${Columns} density="compact" collapse="560">
            <${Field} id=${`crew-m${i}-name`} label=${t(`${K}.fields.memberName`)} value=${a.name || ''} onInput=${e => patchAgent(i, { name: e.target.value })} />
            <${Field} id=${`crew-m${i}-role`} label=${t(`${K}.fields.memberRole`)} value=${a.role || ''} onInput=${e => patchAgent(i, { role: e.target.value })} />
          <//>
          <${Field} type="textarea" rows=${2} id=${`crew-m${i}-goal`} label=${t(`${K}.fields.memberGoal`)} value=${a.goal || ''} onInput=${e => patchAgent(i, { goal: e.target.value })} />
          <${Field} type="textarea" rows=${2} id=${`crew-m${i}-backstory`} label=${t(`${K}.fields.memberBackstory`)} value=${a.backstory || ''} onInput=${e => patchAgent(i, { backstory: e.target.value })} />
          <${Group} label=${t(`${K}.fields.memberTools`)}>
            <${ToolMenu} idPrefix=${`crew-m${i}-tool`} selected=${a.tools} runtimeTools=${runtimeTools} decideTools=${decideTools} onChange=${v => patchAgent(i, { tools: v })} />
          <//>
          <${Field} type="checkbox" label=${t(`${K}.fields.allowDelegation`)} value=${!!a.allow_delegation} onChange=${e => patchAgent(i, { allow_delegation: e.target.checked })} />
        <//>
      `)}
      <${Stack} direction="horizontal" density="compact">
        <${Action} onClick=${() => setAgents([...agents, emptyMember()])}>${t(`${K}.actions.addMember`)}<//>
      <//>

      <${Text} kind="label">${t(`${K}.fields.tasks`)}<//>
      ${tasks.map((task, i) => html`
        <${ItemBox} key=${`t${i}`} index=${`tasks[${i}]`} problem=${errors.tasks.has(i)} lines=${errors.tasks.get(i)}
          onRemove=${() => setTasks(tasks.filter((_, j) => j !== i))}>
          <${Columns} density="compact" collapse="560">
            <${Field} id=${`crew-t${i}-id`} label=${t(`${K}.fields.taskId`)} value=${task.id || ''} onInput=${e => patchTask(i, { id: e.target.value })} />
            <${Field} type="select" id=${`crew-t${i}-agent`} label=${t(`${K}.fields.taskAgent`)} value=${task.agent || ''}
              options=${agentOptions} onChange=${e => patchTask(i, { agent: e.target.value })} />
          <//>
          <${Field} type="textarea" rows=${3} id=${`crew-t${i}-desc`} label=${t(`${K}.fields.taskDescription`)} hint=${t(`${K}.fields.taskDescriptionHint`)}
            value=${task.description || ''} onInput=${e => patchTask(i, { description: e.target.value })} />
          <${Field} type="textarea" rows=${2} id=${`crew-t${i}-expected`} label=${t(`${K}.fields.taskExpected`)}
            value=${task.expected_output || ''} onInput=${e => patchTask(i, { expected_output: e.target.value })} />
          ${i > 0 && html`
            <${Group} label=${t(`${K}.fields.taskContext`)}>
              <${Stack} direction="wrap" density="compact">
                ${tasks.slice(0, i).map((prev, j) => {
                  const pid = prev.id || `#${j + 1}`;
                  const on = Array.isArray(task.context) && task.context.includes(prev.id);
                  return html`<${Field} key=${j} type="checkbox" label=${pid} value=${on} disabled=${!prev.id} onChange=${e => {
                    const cur = Array.isArray(task.context) ? task.context : [];
                    patchTask(i, { context: e.target.checked ? [...cur, prev.id] : cur.filter(x => x !== prev.id) });
                  }} />`;
                })}
              <//>
            <//>
          `}
          <${Field} type="checkbox" label=${t(`${K}.fields.taskAsync`)} value=${!!task.async} onChange=${e => patchTask(i, { async: e.target.checked })} />
        <//>
      `)}
      <${Stack} direction="horizontal" density="compact">
        <${Action} onClick=${() => setTasks([...tasks, emptyTask()])}>${t(`${K}.actions.addTask`)}<//>
      <//>

      ${tasks.length > 0 && html`
        <${Text} kind="label">${t(`${K}.dag.title`)}<//>
        <${Text} tone="muted">${t(`${K}.dag.hint`)}<//>
        <${TaskDag} tasks=${tasks} problemIds=${errors.problemTaskIndexes} />
      `}
    <//>
  `;
}

const LISTEN = ['tasks', 'messages', 'records', 'dms'];
const LISTEN_KEY = { tasks: 'listenTasks', messages: 'listenMessages', records: 'listenRecords', dms: 'listenDms' };

export function RunSection({ doc, onChange, errors }) {
  const set = (patch) => onChange({ ...doc, ...patch });
  const listen = new Set(Array.isArray(doc.listen_for) ? doc.listen_for : []);
  const toggleListen = (k) => {
    const next = new Set(listen);
    if (next.has(k)) next.delete(k); else next.add(k);
    const list = LISTEN.filter(x => next.has(x));
    set({ listen_for: list.length ? list : undefined });
  };
  return html`
    <${CrewPart} title=${t(`${K}.sections.run`)} lines=${errors.run}>
      <${Columns} layout="thirds" density="compact" collapse="600">
        <${Field} id="crew-llm" label=${t(`${K}.fields.llmProfile`)} hint=${t(`${K}.fields.llmProfileHint`)}
          value=${doc.llm_profile || ''} onInput=${e => set({ llm_profile: e.target.value || undefined })} />
        <${Field} id="crew-temp" type="number" min="0" max="2" step="0.1" label=${t(`${K}.fields.temperature`)} value=${doc.temperature ?? ''}
          onInput=${e => set({ temperature: e.target.value === '' ? undefined : Number(e.target.value) })} />
        <${Field} id="crew-process" type="select" label=${t(`${K}.fields.process`)} value=${doc.process || 'sequential'}
          onChange=${e => set({ process: e.target.value })}
          options=${[
            { value: 'sequential', label: t(`${K}.fields.processSequential`) },
            { value: 'hierarchical', label: t(`${K}.fields.processHierarchical`) },
          ]} />
      <//>
      <${Group} label=${t(`${K}.fields.listenFor`)}>
        <${Stack} direction="wrap" density="compact">
          ${LISTEN.map(k => html`<${Field} key=${k} type="checkbox" label=${t(`${K}.fields.${LISTEN_KEY[k]}`)}
            value=${listen.has(k)} onChange=${() => toggleListen(k)} />`)}
        <//>
      <//>
      <${Field} type="checkbox" label=${t(`${K}.fields.memory`)} value=${!!doc.memory} onChange=${e => set({ memory: e.target.checked })} />
      <${Field} type="checkbox" label=${t(`${K}.fields.discover`)} value=${!!doc.discover} onChange=${e => set({ discover: e.target.checked })} />
    <//>
  `;
}

export function ContractSection({ doc, onChange, errors }) {
  const set = (patch) => onChange({ ...doc, ...patch });
  return html`
    <${CrewPart} title=${t(`${K}.sections.contract`)} lines=${errors.contract}>
      <${JsonInput} id="crew-offers" label=${t(`${K}.fields.offers`)} hint=${t(`${K}.fields.offersHint`)}
        value=${doc.offers} onChange=${v => set({ offers: v })} rows="4" />
      <${JsonInput} id="crew-signals" label=${t(`${K}.fields.signals`)} hint=${t(`${K}.fields.signalsHint`)}
        value=${doc.signals} onChange=${v => set({ signals: v })} rows="4" />
    <//>
  `;
}
