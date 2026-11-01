/**
 * @file public/views/profile/ai/gen-rules-section.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI page's section for the generation rules (wish
 *   wish-image-and-video-generation-people-only-in-an-artistic-non-ph): rules the node gives to every
 *   AI picture and video made for this person, such as people only in an artistic style. One switch
 *   per rule, locked when the node requires it, and the person's exceptions for one app or one agent,
 *   each with a reason. Reads GET /v1/ai/gen-rules and writes PUT /v1/ai/gen-rules; the owner's write
 *   applies at once. Its own state, so the page passes nothing but the section number.
 * @structure GenRulesSection({ num })
 * @usage html`<${GenRulesSection} num="06" />`
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { apiGet, apiPut } from '/js/api.js';
import { PageSection } from '/components/PageSection.js';
import { Facts } from '/components/Facts.js';
import { List, Row, Name, Desc, Doors } from '/components/List.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Note } from '/components/Note.js';
import { Action, Actions } from '/components/Action.js';
import { HelpLabel } from '/components/HelpTip.js';
import { x } from './frame.js';

const html = htm.bind(h);
const errText = (e, fallback) => e?.error?.message || e?.response?.error?.message || e?.message || fallback;
const msgLine = (m) => (m ? html`<${Note} kind="message" error=${!!m.error}>${m.text}<//>` : null);

/** What the node says about one rule, in the person's words. */
const nodeWords = (rule) => (rule.required ? x('gr.node.required') : x('gr.node.' + rule.node));

export function GenRulesSection({ num }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [draft, setDraft] = useState(null);

  const load = useCallback(async () => {
    const r = await apiGet('/v1/ai/gen-rules').catch((e) => ({ ok: false, error: { message: e?.message } }));
    if (r && r.ok !== false && r.data) { setView(r.data); setError(null); } else setError(errText(r, x('gr.loadFailed')));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  // One timer at a time, so a second save's message is not closed by the first one's timer.
  const flashTimer = useRef(null);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const flash = (text, isError = false) => {
    clearTimeout(flashTimer.current);
    setMsg({ text, error: isError });
    flashTimer.current = setTimeout(() => setMsg(null), 6000);
  };
  /** Write a change; the person reads the refusal in the section's message line. True when it saved. */
  const save = async (genRules, done) => {
    setBusy(true);
    let saved = false;
    try {
      const r = await apiPut('/v1/ai/gen-rules', { gen_rules: genRules });
      if (r && r.ok === false) throw r;
      await load();
      flash(done);
      saved = true;
    } catch (e) {
      flash(errText(e, x('gr.saveFailed')), true);
    } finally { setBusy(false); }
    return saved;
  };

  if (error) return html`<${PageSection} id="ai-gen-rules" num=${num} title=${x('gr.title')}><${Note} kind="message" error>${error}<//><//>`;
  if (!view) return null;

  const rules = view.rules || [];
  const exceptions = view.exceptions || [];
  const onCount = rules.filter((r) => r.on).length;
  const ruleTitle = (id) => x('gr.rule.' + id + '.title');

  const rows = rules.map((r) => ({
    key: r.id,
    // One explanation per rule: explain.ai.<rule id with "_" for "-"> (people-artistic → ai.people_artistic).
    k: html`<${HelpLabel} term=${'ai.' + r.id.replace(/-/g, '_')} label=${ruleTitle(r.id)}>${ruleTitle(r.id)}<//>`,
    v: html`<${Check} checked=${r.on} disabled=${busy || r.required}
      onChange=${(on) => save({ rules: { [r.id]: on } }, on ? x('gr.switchedOn') : x('gr.switchedOff'))}>
      ${r.on ? x('gr.on') : x('gr.off')}<//>`,
    sub: `${x('gr.rule.' + r.id + '.explain')} ${nodeWords(r)}`,
  }));

  const writeExceptions = (list, done) => save({ exceptions: list.map(({ rule, app, agent, reason }) => ({ rule, ...(app ? { app } : {}), ...(agent ? { agent } : {}), reason })) }, done);
  const remove = (i) => writeExceptions(exceptions.filter((_, j) => j !== i), x('gr.exRemoved'));
  const free = rules.filter((r) => !r.required);
  const startAdd = () => setDraft({ rule: free[0]?.id || '', kind: 'app', name: '', reason: '' });
  const add = async () => {
    const entry = { rule: draft.rule, [draft.kind]: draft.name.trim(), reason: draft.reason.trim() };
    if (await writeExceptions([...exceptions, entry], x('gr.exAdded'))) setDraft(null);
  };

  return html`
    <${PageSection} id="ai-gen-rules" num=${num} title=${x('gr.title')} count=${onCount ? x('gr.countOn', { n: onCount }) : x('gr.countNone')}>
      <${Note} kind="lead">${x('gr.lead')}<//>
      <${Facts} rows=${rows} />
      <${List} cols="name-desc-doors" head=${[x('gr.exWho'), x('gr.exReason'), '']} empty=${x('gr.exNone')}>
        ${exceptions.map((e, i) => html`<${Row} key=${e.rule + (e.app || e.agent) + i}>
          <${Name} meta=${ruleTitle(e.rule)}>${e.app ? x('gr.exApp', { name: e.app }) : x('gr.exAgent', { name: e.agent })}<//>
          <${Desc}>${e.reason}<//>
          <${Doors}><${Action} small soft row tone="danger" disabled=${busy} onClick=${() => remove(i)}>${x('gr.exRemove')}<//><//>
        <//>`)}
      <//>
      ${draft ? html`
        <${Select} label=${x('gr.exRule')} value=${draft.rule} onChange=${(v) => setDraft({ ...draft, rule: v })}
          options=${free.map((r) => [r.id, ruleTitle(r.id)])} />
        <${Select} label=${x('gr.exKind')} value=${draft.kind} onChange=${(v) => setDraft({ ...draft, kind: v })}
          options=${[['app', x('gr.exKindApp')], ['agent', x('gr.exKindAgent')]]} />
        <${TextField} label=${draft.kind === 'app' ? x('gr.exAppName') : x('gr.exAgentName')} value=${draft.name}
          placeholder=${draft.kind === 'app' ? 'owner/app.html' : 'my-agent'} onInput=${(v) => setDraft({ ...draft, name: v })} />
        <${TextField} label=${x('gr.exReason')} value=${draft.reason} maxLength=${300} onInput=${(v) => setDraft({ ...draft, reason: v })} />
        <${Actions}>
          <${Action} small disabled=${busy || !draft.rule || !draft.name.trim() || !draft.reason.trim()} onClick=${add}>${x('gr.exAdd')}<//>
          <${Action} small soft onClick=${() => setDraft(null)}>${x('cancel')}<//>
        <//>`
        : free.length ? html`<${Actions}><${Action} small onClick=${startAdd}>${x('gr.exNew')}<//><//>` : null}
      ${msgLine(msg)}
    <//>`;
}
