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
 *   - ToolMenu — the runtime's own tool list when it answered, else the served copy; the Exchange
 *     bundle, and its verbs behind a "pick verbs" toggle
 *   - IdentitySection · CrewSection · RunSection · ContractSection
 * @version-history
 *   v1.17.0 -- 2026-09-26 -- Every part is a component that takes data (page group G1a): the fields are
 *     TextField, TextArea and Select with their own label and hint (this file's Field goes), the grids
 *     are Fields in two or three columns, a member or a task is the Box (its place as the code in its
 *     head, Remove at its end, the attention frame when the validator points at it), the tools are the
 *     List's pick rows under Group headings (a decision tool with no key cannot be ticked: pickOff),
 *     the checks are Check, the validator's lines are the error Note, the parts are Split, and the
 *     task-order picture is the TaskGraph component.
 *   v1.16.0 -- 2026-09-26 -- The crew form's check lines are the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.15.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.14.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.13.0 -- 2026-09-26 -- A crew member's and a task's place (agents[0], tasks[0]), a tool's id and a tag's memory prefix are the inline code (.code-inline), a unification: the look most tabs use for an identifier.
 *   v1.12.0 -- 2026-09-26 -- A part of the crew form under its hairline is the split (.og-split), a unification: the line Workflows and Boards draw.
 *   v1.11.0 -- 2026-09-25 -- A field's or a directive's label is the Row label (.poster-label), a unification: Jouni's decision Row label.
 *   v1.10.0 -- 2026-09-25 -- Every quiet way on is the action link (.poster-action, its quiet tone where it sits among controls), and the one loud action is the dark block (.poster-slab, its control cut), a unification: Jouni's decisions Action link and Loud action.
 *   v1.9.0 -- 2026-09-25 -- A grey line that explains is the Hint (poster-hint, css/components/hint.css); a place keeps only its margin (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.7.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.6.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.5.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.4.0 -- 2026-09-25 -- The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.3.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
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
import { TaskGraph } from '/components/TaskGraph.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Field, Fields, FormActions } from '/components/Field.js';
import { Box } from '/components/Box.js';
import { Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action } from '/components/Action.js';
import { SubHeading } from '/components/SubHeading.js';
import { List, Row, Name, Desc, Group } from '/components/List.js';
import { Split, Stack } from '/components/Layout.js';

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

/** The validator's lines, verbatim, each a refusal said where it points. */
export function ErrorLines({ lines }) {
  if (!lines || lines.length === 0) return null;
  return html`<${Stack} gap="tight">${lines.map((l, i) => html`<${Note} key=${i} kind="message" error role="status">${l}<//>`)}<//>`;
}

const isStringList = (v) => Array.isArray(v) && v.every(x => typeof x === 'string');

/**
 * A comma-separated list with local text, committed on blur so typing a comma is not eaten, and
 * only when the text actually changed. Two guards keep it from destroying what it cannot show:
 * `toText`/`fromText` map a list of objects to names and back (the mapper decides how an existing
 * object survives an edit), and a list this input has no mapper for and cannot show as strings is
 * handed to the JSON editor instead of being flattened to "[object Object]" and written back.
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
  return html`<${TextField} id=${id} label=${label} hint=${hint} type="text" value=${text} placeholder=${placeholder || ''}
    onInput=${setText} onBlur=${commit} />`;
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
  // The refusal is said under the text area (the field's message), with or without a label.
  const message = err ? { text: t(`${K}.messages.jsonInvalid`, { err }), error: true } : null;
  return html`
    <${TextArea} id=${id} label=${label} hint=${hint} rows=${Number(rows) || 4} value=${text}
      message=${message} onInput=${setText} onBlur=${commit} />
  `;
}

/**
 * The core rows, one Exchange row, and the verbs only when asked for.
 *
 * `runtimeTools` is what the agent's OWN runtime said it resolves (GET /crew/menu). When it answered,
 * that is the list, and each row carries the runtime's own one-line purpose. The served list is the
 * fallback for an agent that is offline or older — and it is a copy, which is exactly why it drifted
 * two tools behind before anybody asked the runtime.
 */
export function ToolMenu({ selected, onChange, runtimeTools, decideTools }) {
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
  // One tool: its box first, the whole row its label; the id in the typewriter face, what it does after.
  const toolRow = (id, desc, off = false) => html`
    <${Row} key=${id} picked=${set.has(id)} pickOff=${off} pickLabel=${id} onPick=${() => toggle(id)}>
      <${Name} code>${id}<//>
      <${Desc}>${desc}<//>
    <//>`;
  const decideRow = (id) => {
    const rule = ruleOf.get(id);
    const desc = id === 'decide' ? t(`${K}.tools.decide`)
      : rule ? t(`${K}.tools.decideRule`, { title: rule.title, decides: rule.decides })
        : t(`${K}.tools.decideRuleGone`);
    return toolRow(id, desc, decideOff && !set.has(id));
  };
  const row = (id) => toolRow(id, livePurpose.get(id) || t(toolLabelKey(id)));
  const settingsLink = html`<${Action} small href="/v1/profile?tab=ai&open=decide-card">${t(`${K}.tools.decideNoKeyLink`)} →<//>`;
  return html`
    <${Stack} gap="small">
      <${Group} title=${t(`${K}.tools.core`)}>
        <${List} cols="check-name-desc" keepCols dense>${core.map(row)}<//>
      <//>
      <${Group} title=${t(`${K}.tools.exchange`)}>
        <${List} cols="check-name-desc" keepCols dense>${row(EXCHANGE_BUNDLE)}<//>
        <div>
          <${Action} small expanded=${refine} onClick=${() => setRefine(r => !r)}>
            ${refine ? '▾' : '▸'} ${t(`${K}.tools.exchangeRefine`)}
          <//>
        </div>
        ${refine && html`<${List} cols="check-name-desc" keepCols dense under>${verbs.map(row)}<//>`}
      <//>
      <${Group} title=${t(`${K}.tools.decisions`)}>
        ${decideOff && html`
          <${Note} role="note">
            ${decideTools && !decideTools.enabled ? t(`${K}.tools.decideOffOperator`) : t(`${K}.tools.decideNoKey`)}
            ${' '}${settingsLink}
          <//>`}
        <${List} cols="check-name-desc" keepCols dense>${decideIds.map(decideRow)}<//>
        ${!decideOff && ruleIds.length === 0 && html`
          <${Note}>${t(`${K}.tools.decideNoRules`)} ${settingsLink}<//>`}
      <//>
    <//>
  `;
}

/** A part of the crew form: its heading, the validator's lines for it, and its fields. */
function Part({ title, lines, children }) {
  return html`
    <${Split} gap="small">
      <${SubHeading}>${title}<//>
      <${ErrorLines} lines=${lines} />
      ${children}
    <//>
  `;
}

export function IdentitySection({ doc, onChange, errors }) {
  const set = (patch) => onChange({ ...doc, ...patch });
  const caps = (doc.capabilities && typeof doc.capabilities === 'object') ? doc.capabilities : {};
  const setCap = (k, v) => set({ capabilities: { ...caps, [k]: v } });
  return html`
    <${Part} title=${t(`${K}.sections.identity`)} lines=${errors.identity}>
      <${Fields}>
        <${TextField} id="crew-agent-name" label=${t(`${K}.fields.agentName`)} hint=${t(`${K}.fields.agentNameHint`)}
          type="text" value=${doc.agent_name || ''} readOnly />
        <${ListInput} id="crew-tags" label=${t(`${K}.fields.tags`)} hint=${t(`${K}.fields.tagsHint`)}
          value=${doc.tags} onChange=${v => set({ tags: v })} placeholder="research, news" />
        <${Fields} cols=${3}>
          <${ListInput} id="crew-cap-tech" label=${t(`${K}.fields.capTechnical`)} value=${caps.technical} onChange=${v => setCap('technical', v)}
            toText=${technicalToText} fromText=${technicalFromText} />
          <${ListInput} id="crew-cap-domain" label=${t(`${K}.fields.capDomain`)} value=${caps.domain} onChange=${v => setCap('domain', v)} />
          <${ListInput} id="crew-cap-lang" label=${t(`${K}.fields.capLanguages`)} value=${caps.languages} onChange=${v => setCap('languages', v)} placeholder="fi, en" />
        <//>
        <${ListInput} id="crew-skills" label=${t(`${K}.fields.skills`)} hint=${t(`${K}.fields.skillsHint`)}
          value=${doc.skills} onChange=${v => set({ skills: v.length ? v : undefined })} />
        <${TextArea} id="crew-readme" label=${t(`${K}.fields.readme`)} rows=${3} value=${doc.readme_md || ''}
          onInput=${v => set({ readme_md: v || undefined })} />
      <//>
    <//>
  `;
}

function memberKey(m) { return (m && (m.name || m.role)) || ''; }

export function CrewSection({ doc, onChange, errors, runtimeTools, decideTools }) {
  const agents = Array.isArray(doc.agents) ? doc.agents : [];
  const tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
  const setAgents = (next) => onChange({ ...doc, agents: next });
  const setTasks = (next) => onChange({ ...doc, tasks: next });
  const patchAgent = (i, patch) => setAgents(agents.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const patchTask = (i, patch) => setTasks(tasks.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const memberKeys = agents.map(memberKey).filter(Boolean);
  return html`
    <${Part} title=${t(`${K}.sections.crew`)} lines=${[]}>
      <${SubHeading}>${t(`${K}.fields.members`)}<//>
      ${agents.map((a, i) => html`
        <${Box} key=${`m${i}`} tone=${errors.agents.has(i) ? 'attention' : undefined}
          marks=${html`<${Code}>agents[${i}]<//>`}
          end=${html`<${Action} small onClick=${() => setAgents(agents.filter((_, j) => j !== i))}>${t(`${K}.actions.remove`)}<//>`}>
          <${Fields}>
            <${ErrorLines} lines=${errors.agents.get(i)} />
            <${Fields} cols=${2}>
              <${TextField} id=${`crew-m${i}-name`} label=${t(`${K}.fields.memberName`)} type="text" value=${a.name || ''} onInput=${v => patchAgent(i, { name: v })} />
              <${TextField} id=${`crew-m${i}-role`} label=${t(`${K}.fields.memberRole`)} type="text" value=${a.role || ''} onInput=${v => patchAgent(i, { role: v })} />
            <//>
            <${TextArea} id=${`crew-m${i}-goal`} label=${t(`${K}.fields.memberGoal`)} rows=${2} value=${a.goal || ''} onInput=${v => patchAgent(i, { goal: v })} />
            <${TextArea} id=${`crew-m${i}-backstory`} label=${t(`${K}.fields.memberBackstory`)} rows=${2} value=${a.backstory || ''} onInput=${v => patchAgent(i, { backstory: v })} />
            <${Field} label=${t(`${K}.fields.memberTools`)} group>
              <${ToolMenu} selected=${a.tools} runtimeTools=${runtimeTools} decideTools=${decideTools} onChange=${v => patchAgent(i, { tools: v })} />
            <//>
            <${Check} checked=${!!a.allow_delegation} onChange=${on => patchAgent(i, { allow_delegation: on })}>
              ${t(`${K}.fields.allowDelegation`)}
            <//>
          <//>
        <//>
      `)}
      <${FormActions}>
        <${Action} small onClick=${() => setAgents([...agents, emptyMember()])}>${t(`${K}.actions.addMember`)}<//>
      <//>

      <${SubHeading}>${t(`${K}.fields.tasks`)}<//>
      ${tasks.map((task, i) => html`
        <${Box} key=${`t${i}`} tone=${errors.tasks.has(i) ? 'attention' : undefined}
          marks=${html`<${Code}>tasks[${i}]<//>`}
          end=${html`<${Action} small onClick=${() => setTasks(tasks.filter((_, j) => j !== i))}>${t(`${K}.actions.remove`)}<//>`}>
          <${Fields}>
            <${ErrorLines} lines=${errors.tasks.get(i)} />
            <${Fields} cols=${2}>
              <${TextField} id=${`crew-t${i}-id`} label=${t(`${K}.fields.taskId`)} type="text" value=${task.id || ''} onInput=${v => patchTask(i, { id: v })} />
              <${Select} id=${`crew-t${i}-agent`} label=${t(`${K}.fields.taskAgent`)} value=${task.agent || ''} onChange=${v => patchTask(i, { agent: v })}
                placeholder="—" options=${memberKeys} />
            <//>
            <${TextArea} id=${`crew-t${i}-desc`} label=${t(`${K}.fields.taskDescription`)} hint=${t(`${K}.fields.taskDescriptionHint`)}
              rows=${3} value=${task.description || ''} onInput=${v => patchTask(i, { description: v })} />
            <${TextArea} id=${`crew-t${i}-expected`} label=${t(`${K}.fields.taskExpected`)}
              rows=${2} value=${task.expected_output || ''} onInput=${v => patchTask(i, { expected_output: v })} />
            ${i > 0 && html`
              <${Field} label=${t(`${K}.fields.taskContext`)} group>
                <div>
                  ${tasks.slice(0, i).map((prev, j) => {
                    const pid = prev.id || `#${j + 1}`;
                    const on = Array.isArray(task.context) && task.context.includes(prev.id);
                    return html`<${Check} key=${j} inline checked=${on} disabled=${!prev.id} onChange=${checked => {
                      const cur = Array.isArray(task.context) ? task.context : [];
                      patchTask(i, { context: checked ? [...cur, prev.id] : cur.filter(x => x !== prev.id) });
                    }}>${pid}<//>`;
                  })}
                </div>
              <//>
            `}
            <${Check} checked=${!!task.async} onChange=${on => patchTask(i, { async: on })}>
              ${t(`${K}.fields.taskAsync`)}
            <//>
          <//>
        <//>
      `)}
      <${FormActions}>
        <${Action} small onClick=${() => setTasks([...tasks, emptyTask()])}>${t(`${K}.actions.addTask`)}<//>
      <//>

      ${tasks.length > 0 && html`
        <${SubHeading}>${t(`${K}.dag.title`)}<//>
        <${Note}>${t(`${K}.dag.hint`)}<//>
        <${TaskGraph} tasks=${tasks} problemIds=${errors.problemTaskIndexes} />
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
    <${Part} title=${t(`${K}.sections.run`)} lines=${errors.run}>
      <${Fields}>
        <${Fields} cols=${3}>
          <${TextField} id="crew-llm" label=${t(`${K}.fields.llmProfile`)} hint=${t(`${K}.fields.llmProfileHint`)}
            type="text" value=${doc.llm_profile || ''} onInput=${v => set({ llm_profile: v || undefined })} />
          <${TextField} id="crew-temp" label=${t(`${K}.fields.temperature`)} type="number" min="0" max="2" step="0.1"
            value=${doc.temperature ?? ''} onInput=${v => set({ temperature: v === '' ? undefined : Number(v) })} />
          <${Select} id="crew-process" label=${t(`${K}.fields.process`)} value=${doc.process || 'sequential'} onChange=${v => set({ process: v })}
            options=${[['sequential', t(`${K}.fields.processSequential`)], ['hierarchical', t(`${K}.fields.processHierarchical`)]]} />
        <//>
        <${Field} label=${t(`${K}.fields.listenFor`)} group>
          <div>
            ${LISTEN.map(k => html`<${Check} key=${k} inline checked=${listen.has(k)} onChange=${() => toggleListen(k)}>${t(`${K}.fields.${LISTEN_KEY[k]}`)}<//>`)}
          </div>
        <//>
        <${Check} checked=${!!doc.memory} onChange=${on => set({ memory: on })}>${t(`${K}.fields.memory`)}<//>
        <${Check} checked=${!!doc.discover} onChange=${on => set({ discover: on })}>${t(`${K}.fields.discover`)}<//>
      <//>
    <//>
  `;
}

export function ContractSection({ doc, onChange, errors }) {
  const set = (patch) => onChange({ ...doc, ...patch });
  return html`
    <${Part} title=${t(`${K}.sections.contract`)} lines=${errors.contract}>
      <${Fields}>
        <${JsonInput} id="crew-offers" label=${t(`${K}.fields.offers`)} hint=${t(`${K}.fields.offersHint`)}
          value=${doc.offers} onChange=${v => set({ offers: v })} rows="4" />
        <${JsonInput} id="crew-signals" label=${t(`${K}.fields.signals`)} hint=${t(`${K}.fields.signalsHint`)}
          value=${doc.signals} onChange=${v => set({ signals: v })} rows="4" />
      <//>
    <//>
  `;
}
