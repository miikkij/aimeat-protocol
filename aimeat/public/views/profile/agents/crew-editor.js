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
 *   - ToolMenu — nine core tools, the Exchange bundle, and the verbs behind a "pick verbs" toggle
 *   - IdentitySection · CrewSection · RunSection · ContractSection
 * @version-history
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
  return html`<ul class="pf-agd-crew-errors">${lines.map((l, i) => html`<li key=${i}>${l}</li>`)}</ul>`;
}

const isStringList = (v) => Array.isArray(v) && v.every(x => typeof x === 'string');

/**
 * A comma-separated list with local text, committed on blur so typing a comma is not eaten, and
 * only when the text actually changed. Two guards keep it from destroying what it cannot show:
 * `toText`/`fromText` map a list of objects to names and back (the mapper decides how an existing
 * object survives an edit), and a list this input has no mapper for and cannot show as strings is
 * handed to the JSON editor instead of being flattened to "[object Object]" and written back.
 */
function ListInput({ value, onChange, placeholder, id, toText, fromText }) {
  const list = Array.isArray(value) ? value : [];
  const canShow = toText ? true : isStringList(list);
  const joined = canShow ? (toText ? toText(list) : list).join(', ') : '';
  const [text, setText] = useState(joined);
  useEffect(() => { setText(joined); }, [joined]);
  if (!canShow) return html`<${JsonInput} id=${id} value=${list} onChange=${onChange} rows="3" />`;
  const commit = () => {
    if (text === joined) return;
    const names = text.split(',').map(s => s.trim()).filter(Boolean);
    onChange(fromText ? fromText(names, list) : names);
  };
  return html`<input id=${id} type="text" class="input-field input-sm" value=${text} placeholder=${placeholder || ''}
    onInput=${e => setText(e.target.value)} onBlur=${commit} />`;
}

/** capabilities.technical is a list of {name, type} objects (the node indexes it for search). Shown
 *  by name; an edit keeps the existing object for a name that is still there and makes {name, type:
 *  'tool'} for a new one, so nothing the person did not touch is rewritten. */
const technicalToText = (list) => list.map(x => (x && typeof x === 'object' ? String(x.name ?? '') : String(x))).filter(Boolean);
function technicalFromText(names, prev) {
  const byName = new Map((Array.isArray(prev) ? prev : []).map(x => [x && typeof x === 'object' ? x.name : x, x]));
  return names.map(n => (byName.has(n) ? byName.get(n) : { name: n, type: 'tool' }));
}

/** A JSON blob (offers, signals) with local text; parsed on blur, parse errors shown in place. */
function JsonInput({ value, onChange, id, rows }) {
  const pretty = value === undefined || value === null ? '' : JSON.stringify(value, null, 2);
  const [text, setText] = useState(pretty);
  const [err, setErr] = useState(null);
  useEffect(() => { setText(pretty); setErr(null); }, [pretty]);
  const commit = () => {
    if (!text.trim()) { setErr(null); onChange(undefined); return; }
    try { onChange(JSON.parse(text)); setErr(null); }
    catch (e) { setErr(e.message); }
  };
  return html`
    <textarea id=${id} class="input-field pf-agd-crew-json" rows=${rows || 4} value=${text}
      onInput=${e => setText(e.target.value)} onBlur=${commit}></textarea>
    ${err && html`<div class="pf-agd-crew-parse-error">${t(`${K}.messages.jsonInvalid`, { err })}</div>`}
  `;
}

function Field({ label, hint, children, htmlFor }) {
  return html`
    <div class="pf-agd-form-field pf-agd-crew-field">
      <label for=${htmlFor}>${label}</label>
      ${children}
      ${hint && html`<div class="pf-agd-help-text">${hint}</div>`}
    </div>
  `;
}

/** Nine core rows, one Exchange row, and the verbs only when asked for. */
export function ToolMenu({ selected, onChange, idPrefix }) {
  const set = new Set(Array.isArray(selected) ? selected : []);
  const [refine, setRefine] = useState(EXCHANGE_VERBS.some(v => set.has(v)));
  const toggle = (id) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange([...CORE_TOOLS, EXCHANGE_BUNDLE, ...EXCHANGE_VERBS].filter(x => next.has(x)));
  };
  const row = (id) => html`
    <label key=${id} class="pf-agd-crew-tool">
      <input type="checkbox" id=${`${idPrefix}-${id}`} checked=${set.has(id)} onChange=${() => toggle(id)} />
      <span class="pf-agd-crew-tool-id">${id}</span>
      <span class="pf-agd-crew-tool-desc">${t(toolLabelKey(id))}</span>
    </label>
  `;
  return html`
    <div class="pf-agd-crew-tools">
      <div class="pf-agd-crew-tools-group">
        <div class="pf-agd-crew-tools-title">${t(`${K}.tools.core`)}</div>
        ${CORE_TOOLS.map(row)}
      </div>
      <div class="pf-agd-crew-tools-group">
        <div class="pf-agd-crew-tools-title">${t(`${K}.tools.exchange`)}</div>
        ${row(EXCHANGE_BUNDLE)}
        <button type="button" class="btn-ghost btn-sm pf-agd-crew-tools-refine" onClick=${() => setRefine(r => !r)}>
          ${refine ? '▾' : '▸'} ${t(`${K}.tools.exchangeRefine`)}
        </button>
        ${refine && html`<div class="pf-agd-crew-tools-verbs">${EXCHANGE_VERBS.map(row)}</div>`}
      </div>
    </div>
  `;
}

function SectionHead({ title, lines }) {
  return html`
    <div class="pf-agd-section-title">${title}</div>
    <${ErrorLines} lines=${lines} />
  `;
}

export function IdentitySection({ doc, onChange, errors }) {
  const set = (patch) => onChange({ ...doc, ...patch });
  const caps = (doc.capabilities && typeof doc.capabilities === 'object') ? doc.capabilities : {};
  const setCap = (k, v) => set({ capabilities: { ...caps, [k]: v } });
  return html`
    <section class="pf-agd-crew-section">
      <${SectionHead} title=${t(`${K}.sections.identity`)} lines=${errors.identity} />
      <${Field} label=${t(`${K}.fields.agentName`)} hint=${t(`${K}.fields.agentNameHint`)} htmlFor="crew-agent-name">
        <input id="crew-agent-name" type="text" class="input-field input-sm" value=${doc.agent_name || ''} readonly />
      <//>
      <${Field} label=${t(`${K}.fields.tags`)} hint=${t(`${K}.fields.tagsHint`)} htmlFor="crew-tags">
        <${ListInput} id="crew-tags" value=${doc.tags} onChange=${v => set({ tags: v })} placeholder="research, news" />
      <//>
      <div class="pf-agd-crew-grid3">
        <${Field} label=${t(`${K}.fields.capTechnical`)} htmlFor="crew-cap-tech">
          <${ListInput} id="crew-cap-tech" value=${caps.technical} onChange=${v => setCap('technical', v)}
            toText=${technicalToText} fromText=${technicalFromText} />
        <//>
        <${Field} label=${t(`${K}.fields.capDomain`)} htmlFor="crew-cap-domain">
          <${ListInput} id="crew-cap-domain" value=${caps.domain} onChange=${v => setCap('domain', v)} />
        <//>
        <${Field} label=${t(`${K}.fields.capLanguages`)} htmlFor="crew-cap-lang">
          <${ListInput} id="crew-cap-lang" value=${caps.languages} onChange=${v => setCap('languages', v)} placeholder="fi, en" />
        <//>
      </div>
      <${Field} label=${t(`${K}.fields.skills`)} hint=${t(`${K}.fields.skillsHint`)} htmlFor="crew-skills">
        <${ListInput} id="crew-skills" value=${doc.skills} onChange=${v => set({ skills: v.length ? v : undefined })} />
      <//>
      <${Field} label=${t(`${K}.fields.readme`)} htmlFor="crew-readme">
        <textarea id="crew-readme" class="input-field" rows="3" value=${doc.readme_md || ''}
          onInput=${e => set({ readme_md: e.target.value || undefined })}></textarea>
      <//>
    </section>
  `;
}

function memberKey(m) { return (m && (m.name || m.role)) || ''; }

export function CrewSection({ doc, onChange, errors }) {
  const agents = Array.isArray(doc.agents) ? doc.agents : [];
  const tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
  const setAgents = (next) => onChange({ ...doc, agents: next });
  const setTasks = (next) => onChange({ ...doc, tasks: next });
  const patchAgent = (i, patch) => setAgents(agents.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const patchTask = (i, patch) => setTasks(tasks.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const memberKeys = agents.map(memberKey).filter(Boolean);
  return html`
    <section class="pf-agd-crew-section">
      <${SectionHead} title=${t(`${K}.sections.crew`)} lines=${[]} />
      <div class="pf-agd-crew-sub">${t(`${K}.fields.members`)}</div>
      ${agents.map((a, i) => html`
        <div key=${`m${i}`} class="pf-agd-crew-card ${errors.agents.has(i) ? 'pf-agd-crew-card--problem' : ''}">
          <div class="pf-agd-crew-card-head">
            <span class="pf-agd-crew-card-index">agents[${i}]</span>
            <button type="button" class="btn-ghost btn-sm" onClick=${() => setAgents(agents.filter((_, j) => j !== i))}>${t(`${K}.actions.remove`)}</button>
          </div>
          <${ErrorLines} lines=${errors.agents.get(i)} />
          <div class="pf-agd-crew-grid2">
            <${Field} label=${t(`${K}.fields.memberName`)} htmlFor=${`crew-m${i}-name`}>
              <input id=${`crew-m${i}-name`} type="text" class="input-field input-sm" value=${a.name || ''} onInput=${e => patchAgent(i, { name: e.target.value })} />
            <//>
            <${Field} label=${t(`${K}.fields.memberRole`)} htmlFor=${`crew-m${i}-role`}>
              <input id=${`crew-m${i}-role`} type="text" class="input-field input-sm" value=${a.role || ''} onInput=${e => patchAgent(i, { role: e.target.value })} />
            <//>
          </div>
          <${Field} label=${t(`${K}.fields.memberGoal`)} htmlFor=${`crew-m${i}-goal`}>
            <textarea id=${`crew-m${i}-goal`} class="input-field" rows="2" value=${a.goal || ''} onInput=${e => patchAgent(i, { goal: e.target.value })}></textarea>
          <//>
          <${Field} label=${t(`${K}.fields.memberBackstory`)} htmlFor=${`crew-m${i}-backstory`}>
            <textarea id=${`crew-m${i}-backstory`} class="input-field" rows="2" value=${a.backstory || ''} onInput=${e => patchAgent(i, { backstory: e.target.value })}></textarea>
          <//>
          <${Field} label=${t(`${K}.fields.memberTools`)}>
            <${ToolMenu} idPrefix=${`crew-m${i}-tool`} selected=${a.tools} onChange=${v => patchAgent(i, { tools: v })} />
          <//>
          <label class="pf-agd-crew-check">
            <input type="checkbox" checked=${!!a.allow_delegation} onChange=${e => patchAgent(i, { allow_delegation: e.target.checked })} />
            ${t(`${K}.fields.allowDelegation`)}
          </label>
        </div>
      `)}
      <div class="pf-agd-form-actions">
        <button type="button" class="btn-outline btn-sm" onClick=${() => setAgents([...agents, emptyMember()])}>${t(`${K}.actions.addMember`)}</button>
      </div>

      <div class="pf-agd-crew-sub">${t(`${K}.fields.tasks`)}</div>
      ${tasks.map((task, i) => html`
        <div key=${`t${i}`} class="pf-agd-crew-card ${errors.tasks.has(i) ? 'pf-agd-crew-card--problem' : ''}">
          <div class="pf-agd-crew-card-head">
            <span class="pf-agd-crew-card-index">tasks[${i}]</span>
            <button type="button" class="btn-ghost btn-sm" onClick=${() => setTasks(tasks.filter((_, j) => j !== i))}>${t(`${K}.actions.remove`)}</button>
          </div>
          <${ErrorLines} lines=${errors.tasks.get(i)} />
          <div class="pf-agd-crew-grid2">
            <${Field} label=${t(`${K}.fields.taskId`)} htmlFor=${`crew-t${i}-id`}>
              <input id=${`crew-t${i}-id`} type="text" class="input-field input-sm" value=${task.id || ''} onInput=${e => patchTask(i, { id: e.target.value })} />
            <//>
            <${Field} label=${t(`${K}.fields.taskAgent`)} htmlFor=${`crew-t${i}-agent`}>
              <select id=${`crew-t${i}-agent`} class="input-field input-sm" value=${task.agent || ''} onChange=${e => patchTask(i, { agent: e.target.value })}>
                <option value="">—</option>
                ${memberKeys.map(k => html`<option key=${k} value=${k}>${k}</option>`)}
              </select>
            <//>
          </div>
          <${Field} label=${t(`${K}.fields.taskDescription`)} hint=${t(`${K}.fields.taskDescriptionHint`)} htmlFor=${`crew-t${i}-desc`}>
            <textarea id=${`crew-t${i}-desc`} class="input-field" rows="3" value=${task.description || ''} onInput=${e => patchTask(i, { description: e.target.value })}></textarea>
          <//>
          <${Field} label=${t(`${K}.fields.taskExpected`)} htmlFor=${`crew-t${i}-expected`}>
            <textarea id=${`crew-t${i}-expected`} class="input-field" rows="2" value=${task.expected_output || ''} onInput=${e => patchTask(i, { expected_output: e.target.value })}></textarea>
          <//>
          ${i > 0 && html`
            <${Field} label=${t(`${K}.fields.taskContext`)}>
              <div class="pf-agd-crew-context">
                ${tasks.slice(0, i).map((prev, j) => {
                  const pid = prev.id || `#${j + 1}`;
                  const on = Array.isArray(task.context) && task.context.includes(prev.id);
                  return html`<label key=${j} class="pf-agd-crew-check pf-agd-crew-check--inline">
                    <input type="checkbox" checked=${on} disabled=${!prev.id} onChange=${e => {
                      const cur = Array.isArray(task.context) ? task.context : [];
                      patchTask(i, { context: e.target.checked ? [...cur, prev.id] : cur.filter(x => x !== prev.id) });
                    }} />${pid}</label>`;
                })}
              </div>
            <//>
          `}
          <label class="pf-agd-crew-check">
            <input type="checkbox" checked=${!!task.async} onChange=${e => patchTask(i, { async: e.target.checked })} />
            ${t(`${K}.fields.taskAsync`)}
          </label>
        </div>
      `)}
      <div class="pf-agd-form-actions">
        <button type="button" class="btn-outline btn-sm" onClick=${() => setTasks([...tasks, emptyTask()])}>${t(`${K}.actions.addTask`)}</button>
      </div>

      ${tasks.length > 0 && html`
        <div class="pf-agd-crew-sub">${t(`${K}.dag.title`)}</div>
        <div class="pf-agd-help-text">${t(`${K}.dag.hint`)}</div>
        <${TaskDag} tasks=${tasks} problemIds=${errors.problemTaskIndexes} />
      `}
    </section>
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
    <section class="pf-agd-crew-section">
      <${SectionHead} title=${t(`${K}.sections.run`)} lines=${errors.run} />
      <div class="pf-agd-crew-grid3">
        <${Field} label=${t(`${K}.fields.llmProfile`)} hint=${t(`${K}.fields.llmProfileHint`)} htmlFor="crew-llm">
          <input id="crew-llm" type="text" class="input-field input-sm" value=${doc.llm_profile || ''} onInput=${e => set({ llm_profile: e.target.value || undefined })} />
        <//>
        <${Field} label=${t(`${K}.fields.temperature`)} htmlFor="crew-temp">
          <input id="crew-temp" type="number" min="0" max="2" step="0.1" class="input-field input-sm" value=${doc.temperature ?? ''}
            onInput=${e => set({ temperature: e.target.value === '' ? undefined : Number(e.target.value) })} />
        <//>
        <${Field} label=${t(`${K}.fields.process`)} htmlFor="crew-process">
          <select id="crew-process" class="input-field input-sm" value=${doc.process || 'sequential'} onChange=${e => set({ process: e.target.value })}>
            <option value="sequential">${t(`${K}.fields.processSequential`)}</option>
            <option value="hierarchical">${t(`${K}.fields.processHierarchical`)}</option>
          </select>
        <//>
      </div>
      <${Field} label=${t(`${K}.fields.listenFor`)}>
        <div class="pf-agd-crew-context">
          ${LISTEN.map(k => html`<label key=${k} class="pf-agd-crew-check pf-agd-crew-check--inline">
            <input type="checkbox" checked=${listen.has(k)} onChange=${() => toggleListen(k)} />${t(`${K}.fields.${LISTEN_KEY[k]}`)}</label>`)}
        </div>
      <//>
      <label class="pf-agd-crew-check">
        <input type="checkbox" checked=${!!doc.memory} onChange=${e => set({ memory: e.target.checked })} />${t(`${K}.fields.memory`)}
      </label>
      <label class="pf-agd-crew-check">
        <input type="checkbox" checked=${!!doc.discover} onChange=${e => set({ discover: e.target.checked })} />${t(`${K}.fields.discover`)}
      </label>
    </section>
  `;
}

export function ContractSection({ doc, onChange, errors }) {
  const set = (patch) => onChange({ ...doc, ...patch });
  return html`
    <section class="pf-agd-crew-section">
      <${SectionHead} title=${t(`${K}.sections.contract`)} lines=${errors.contract} />
      <${Field} label=${t(`${K}.fields.offers`)} hint=${t(`${K}.fields.offersHint`)} htmlFor="crew-offers">
        <${JsonInput} id="crew-offers" value=${doc.offers} onChange=${v => set({ offers: v })} rows="4" />
      <//>
      <${Field} label=${t(`${K}.fields.signals`)} hint=${t(`${K}.fields.signalsHint`)} htmlFor="crew-signals">
        <${JsonInput} id="crew-signals" value=${doc.signals} onChange=${v => set({ signals: v })} rows="4" />
      <//>
    </section>
  `;
}
