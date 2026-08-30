/**
 * @file public/views/profile/workflows/form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The workflow form in the poster face, in words: the basics (name, description,
 *   when it runs, the variables), the steps as folds (the agent and its offer, what the offer
 *   reads and how the node sees it produced, when the step starts, what happens when it does not
 *   produce, how long it may take), what happens when the run ends, and the model's judgement as
 *   a fold. A step that is a question to the person, the owner's model or an extension keeps its
 *   action and is shown as such. Save goes to PUT /v1/workflows/:id as before; the node's own
 *   validation errors render in the rail before the save is retried.
 * @structure renderForm · basics · varsBlock · stepFold · offerWords · endFold
 * @usage import { renderForm } from './form.js';
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial. Replaces workflows-form.js's machine fields.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold } from '/views/profile/organisms/poster-parts.js';
import { timeOfCron, withTime } from '../scheduler/cron-words.js';
import { c, loc, triggerWords, signalWords, kindWords, renderPage } from './frame.js';

const TTL_CHOICES = [['15', '15 min'], ['60', '1 h'], ['240', '4 h'], ['1440', '24 h']];
const RETRY_CHOICES = [['0', 'retryNone'], ['1', 'retryOnce'], ['2', 'retryTwice']];

export function renderForm(ctx) {
  const f = ctx.form;
  const editing = ctx.view.kind === 'edit';
  const set = (patch) => ctx.setForm({ ...f, ...patch });
  const title = editing ? c('formEditTitle', { name: f.title || f.id }) : c('formNewTitle');
  const back = html`<button type="button" class="og-rail-link" onClick=${() => ctx.pickView(editing ? { kind: 'detail', id: f.id } : { kind: 'cover' })}><i>←</i>${editing ? c('backToWorkflow') : c('backTo')}</button>`;
  const doors = html`
    <button type="button" class="og-slab" disabled=${ctx.saving || !f.id.trim() || !f.steps.length} onClick=${() => ctx.handleSave()}>${c('save')}</button>
    ${editing ? html`<button type="button" class="og-door" onClick=${() => ctx.copyPrompt('improve-mcp', f.id)}>${c('promptToChat')}</button>` : null}
    <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.pickView(editing ? { kind: 'detail', id: f.id } : { kind: 'cover' })}>${t('profile.cancel')}</button>`;
  const checks = [
    [f.steps.every(s => s.action || (s.agent && s.offer)), c('checkEveryStepOffer')],
    [!hasCycle(f.steps), c('checkNoCycle')],
    [undeclaredVars(f).length === 0, undeclaredVars(f).length ? c('checkVarsMissing', { vars: undeclaredVars(f).join(', ') }) : c('checkVarsOk')],
    [f.steps.every(s => s.id && /^[a-z0-9][a-z0-9-]*$/.test(s.id)), c('checkStepIds')],
  ];
  const rail = html`
    <hr />
    <span class="og-rail-label">${c('beforeSave')}</span>
    <div class="wp-words wp-words--rail">
      ${checks.map(([ok, label], i) => html`<div key=${i} class=${ok ? '' : 'wp-bad'}>${ok ? '✓' : '✗'} ${label}</div>`)}
      ${ctx.saveErrors.map((e, i) => html`<div key=${'e' + i} class="wp-bad">✗ ${e}</div>`)}
    </div>
    <hr />
    <span class="og-rail-label">${c('ratherInChat')}</span>
    <button type="button" class="og-rail-link" onClick=${() => ctx.copyPrompt(editing ? 'improve-mcp' : 'create-mcp', editing ? f.id : undefined)}><i>→</i>${editing ? c('copyImprove') : c('copyPrompt')}</button>`;

  return renderPage(ctx, {
    crumbs: editing ? [html`<button type="button" class="og-crumb-link" onClick=${() => ctx.pickView({ kind: 'detail', id: f.id })}>${f.title || f.id}</button>`, t('profile.workflows.edit')] : [c('formNewTitle')],
    title, doors, rail, back,
    children: html`
      <p class="og-desc og-desc--page">${c('formDesc')}</p>
      <${Section} id="wp-basics" num="01" title=${c('secBasics')} first>${basics(ctx, f, set, editing)}<//>
      <${Section} id="wp-form-steps" num="02" title=${c('secSteps')} count=${f.steps.length} doors=${html`<button type="button" class="og-door" onClick=${() => ctx.addStep()}>${c('addStep')}</button>`}>
        ${f.steps.map((s, i) => stepFold(ctx, f, s, i))}
        ${!f.steps.length ? html`<p class="og-empty">${c('noStepsYet')}</p>` : null}
      <//>
      <${Fold} id="wp-end" num="03" title=${c('secEnd')} sub=${c('endSub')} open=${ctx.folds.end} onToggle=${() => ctx.setFold('end', !ctx.folds.end)}>${endFold(f, set)}<//>
      <${Fold} id="wp-llm" num="04" title=${c('secLlm')} sub=${c('llmSub')} open=${ctx.folds.llm} onToggle=${() => ctx.setFold('llm', !ctx.folds.llm)}>
        <div class="og-choice"><button type="button" class=${`og-choice-btn ${!f.llm ? 'on' : ''}`} onClick=${() => set({ llm: false })}>${c('no')}</button><button type="button" class=${`og-choice-btn ${f.llm ? 'on' : ''}`} onClick=${() => set({ llm: true })}>${c('yes')}</button></div>
        <p class="wp-hint">${c('llmHint')}</p>
      <//>
      <${ctx.ConfirmUI} />`,
  });
}

function basics(ctx, f, set, editing) {
  const choice = (key, options) => html`<div class="og-choice">${options.map(([v, label]) => html`<button type="button" key=${v} class=${`og-choice-btn ${f[key] === v ? 'on' : ''}`} onClick=${() => set({ [key]: v })}>${label}</button>`)}</div>`;
  const time = timeOfCron(f.cron);
  return html`
    <div class="og-fields wp-form">
      <div class="og-fields--2">
        <div class="og-field"><label class="og-label" for="wp-f-title">${c('fName')}</label><input id="wp-f-title" class="og-input" value=${f.title} onInput=${e => set({ title: e.target.value, id: editing ? f.id : slugOf(e.target.value) })} placeholder=${c('namePlaceholder')} /></div>
        <div class="og-field"><label class="og-label" for="wp-f-id">${c('fId')}</label><input id="wp-f-id" class="og-input" value=${f.id} disabled=${editing} onInput=${e => set({ id: e.target.value })} placeholder="my-workflow" /><span class="wp-hint">${c('idHint')}</span></div>
      </div>
      <div class="og-field"><label class="og-label" for="wp-f-desc">${c('fDesc')}</label><input id="wp-f-desc" class="og-input" value=${f.description} onInput=${e => set({ description: e.target.value })} placeholder=${c('descPlaceholder')} /></div>
      <div class="og-field"><span class="og-label">${c('fTrigger')}</span>${choice('triggerKind', [['manual', c('trigger.manual')], ['schedule', c('trigger.scheduleWord')], ['event', c('trigger.eventWord')]])}
        ${f.triggerKind === 'schedule' ? html`<div class="wp-inline-fields">
          <label class="og-field wp-field--narrow"><span class="og-label">${c('fTime')}</span><input class="og-input" type="time" value=${time} onInput=${e => set({ cron: withTime(f.cron, e.target.value) })} /></label>
          <label class="og-field"><span class="og-label">${c('fCron')}</span><input class="og-input wp-mono" value=${f.cron} onInput=${e => set({ cron: e.target.value })} /></label>
          <label class="og-field"><span class="og-label">${c('fTimezone')}</span><input class="og-input" value=${f.timezone} onInput=${e => set({ timezone: e.target.value })} /></label>
        </div><span class="wp-hint">${triggerWords({ kind: 'schedule', cron: f.cron, timezone: f.timezone })}</span>` : null}
        ${f.triggerKind === 'event' ? html`<div class="wp-inline-fields">
          <div class="og-field"><span class="og-label">${c('fEventOn')}</span>${choice('eventOn', [['memory.write', c('eventMemory')], ['offer.ordered', c('eventOffer')]])}</div>
          <label class="og-field"><span class="og-label">${f.eventOn === 'memory.write' ? c('fEventKey') : c('fEventOffer')}</span><input class="og-input wp-mono" value=${f.eventMatch} onInput=${e => set({ eventMatch: e.target.value })} placeholder=${f.eventOn === 'memory.write' ? 'news.*' : 'fetch'} /></label>
        </div>` : null}
      </div>
      ${varsBlock(ctx, f, set)}
    </div>`;
}

function varsBlock(ctx, f, set) {
  const setVar = (i, patch) => set({ vars: f.vars.map((v, j) => j === i ? { ...v, ...patch } : v) });
  return html`
    <div class="og-field">
      <span class="og-label">${c('fVars')}</span>
      ${f.vars.map((v, i) => html`<div class="wp-var-row" key=${i}>
        <input class="og-input wp-mono" placeholder=${c('varName')} value=${v.name} onInput=${e => setVar(i, { name: e.target.value })} />
        <div class="og-choice">${['string', 'date', 'number'].map(ty => html`<button type="button" key=${ty} class=${`og-choice-btn ${v.type === ty ? 'on' : ''}`} onClick=${() => setVar(i, { type: ty })}>${c('varType.' + ty)}</button>`)}</div>
        <input class="og-input wp-mono" placeholder=${v.type === 'date' ? '<run-date>' : c('varDefault')} value=${v.default || ''} onInput=${e => setVar(i, { default: e.target.value })} />
        <button type="button" class="og-door og-door--quiet" onClick=${() => set({ vars: f.vars.filter((_, j) => j !== i) })}>${c('remove')}</button>
      </div>`)}
      <div class="og-doors"><button type="button" class="og-door og-door--quiet" onClick=${() => set({ vars: [...f.vars, { name: '', type: 'string', default: '' }] })}>${c('addVar')}</button></div>
      <span class="wp-hint">${c('varsHint')}</span>
    </div>`;
}

function stepFold(ctx, f, s, i) {
  const open = ctx.openStep === i;
  const setStep = (patch) => ctx.setForm({ ...f, steps: f.steps.map((x, j) => j === i ? { ...x, ...patch } : x) });
  const others = f.steps.filter((x, j) => j !== i && x.id).map(x => x.id);
  const offers = ctx.offersByAgent[s.agent] || null;
  const offer = offers?.find(o => o.id === s.offer);
  const sub = s.action ? kindWords(s) : [s.agent, s.offer].filter(Boolean).join(' · ') + (s.after?.length ? ` · ${c('afterSteps', { steps: s.after.join(', ') })}` : '');
  return html`
    <${Fold} key=${i} id=${'wp-step-' + i} num=${String(i + 1).padStart(2, '0')} title=${s.id || c('newStep')} sub=${sub} open=${open} onToggle=${() => ctx.setOpenStep(open ? -1 : i)}>
      <div class="og-fields wp-form">
        <div class="og-fields--2">
          <div class="og-field"><label class="og-label" for=${'wp-s-id-' + i}>${c('fStepId')}</label><input id=${'wp-s-id-' + i} class="og-input wp-mono" value=${s.id} onInput=${e => setStep({ id: e.target.value })} placeholder="fetch" /></div>
          <div class="og-field"><label class="og-label" for=${'wp-s-desc-' + i}>${c('fStepDesc')}</label><input id=${'wp-s-desc-' + i} class="og-input" value=${s.description} onInput=${e => setStep({ description: e.target.value })} placeholder=${c('stepDescPlaceholder')} /></div>
        </div>
        ${s.action ? html`<div class="og-field"><span class="og-label">${c('fStepKind')}</span><span class="wp-prose">${kindWords(s)}${s.action.kind === 'human-input' ? `: ${s.action.question?.prompt || ''}` : ''}</span><span class="wp-hint">${c('actionStepHint')}</span></div>` : html`
        <div class="og-fields--2">
          <div class="og-field"><label class="og-label" for=${'wp-s-agent-' + i}>${c('fAgent')}</label>
            <select id=${'wp-s-agent-' + i} class="og-input" value=${s.agent} onChange=${e => { setStep({ agent: e.target.value, offer: '' }); ctx.loadOffers(e.target.value); }}>
              <option value="">${c('pickAgent')}</option>
              ${ctx.agents.map(a => html`<option value=${a.name} key=${a.name}>${a.name}</option>`)}
            </select></div>
          <div class="og-field"><label class="og-label" for=${'wp-s-offer-' + i}>${c('fOffer')}</label>
            <select id=${'wp-s-offer-' + i} class="og-input" value=${s.offer} disabled=${!s.agent} onChange=${e => setStep({ offer: e.target.value })}>
              <option value="">${!s.agent ? c('pickAgentFirst') : offers === null ? t('common.loading') : offers.length ? c('pickOffer') : c('noCompatibleOffers')}</option>
              ${(offers || []).map(o => html`<option value=${o.id} key=${o.id}>${o.id}${loc(o.title) ? ` · ${loc(o.title)}` : ''}</option>`)}
            </select>
            ${offer ? html`<span class="wp-hint">${offerWords(offer)}</span>` : s.agent && offers && !offers.length ? html`<span class="wp-hint wp-bad">${c('noCompatibleOffersHint')}</span>` : null}</div>
        </div>`}
        <div class="og-fields--2">
          <div class="og-field"><span class="og-label">${c('fStartsWhen')}</span>
            <div class="og-choice"><button type="button" class=${`og-choice-btn ${!s.after?.length ? 'on' : ''}`} onClick=${() => setStep({ after: [] })}>${c('startsAtOnce')}</button>${others.map(o => html`<button type="button" key=${o} class=${`og-choice-btn ${s.after?.includes(o) ? 'on' : ''}`} onClick=${() => setStep({ after: s.after?.includes(o) ? s.after.filter(a => a !== o) : [...(s.after || []), o] })}>${c('afterStep', { step: o })}</button>`)}</div>
            ${!s.action ? html`<label class="wp-check"><input type="checkbox" checked=${s.noInput} onChange=${e => setStep({ noInput: e.target.checked })} /> ${c('noInputGate')}</label>` : null}</div>
          <div class="og-field"><span class="og-label">${c('fIfNotProduced')}</span>
            ${!s.action ? html`<div class="og-choice">${RETRY_CHOICES.map(([v, key]) => html`<button type="button" key=${v} class=${`og-choice-btn ${String(s.retryMax) === v ? 'on' : ''}`} onClick=${() => setStep({ retryMax: Number(v) })}>${c(key)}</button>`)}</div>` : null}
            <div class="og-choice wp-choice--tight">${TTL_CHOICES.map(([v, label]) => html`<button type="button" key=${v} class=${`og-choice-btn ${String(s.timeoutMin) === v ? 'on' : ''}`} onClick=${() => setStep({ timeoutMin: Number(v) })}>${label}</button>`)}<input class="og-input wp-num" type="number" min="1" value=${s.timeoutMin} onInput=${e => setStep({ timeoutMin: Number(e.target.value) || 60 })} /></div>
            <span class="wp-hint">${c('timeoutHint')}</span></div>
        </div>
        <div class="og-doors"><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setOpenStep(-1)}>${c('close')}</button><button type="button" class="og-door og-door--danger" onClick=${() => ctx.removeStep(i)}>${c('removeStep')}</button></div>
      </div>
    <//>`;
}

/** What an offer brings to a step, in words. */
function offerWords(o) {
  const input = o.required_to_function && o.required_to_function !== 'none' ? c('needs', { what: signalWords(o.required_to_function) }) : c('noInputNeeded');
  const out = o.success_signal ? c('producedWhen', { what: signalWords(o.success_signal) }) : '';
  const key = o.deliverable?.location?.key ? c('writesKey', { key: o.deliverable.location.key }) : '';
  return [input, out, key].filter(Boolean).join(' ');
}

function endFold(f, set) {
  const yn = (key, label, hint) => html`<div class="og-field"><span class="og-label">${label}</span><div class="og-choice"><button type="button" class=${`og-choice-btn ${!f[key] ? 'on' : ''}`} onClick=${() => set({ [key]: false })}>${c('no')}</button><button type="button" class=${`og-choice-btn ${f[key] ? 'on' : ''}`} onClick=${() => set({ [key]: true })}>${c('yes')}</button></div><span class="wp-hint">${hint}</span></div>`;
  return html`<div class="og-fields--2 wp-form">
    ${yn('notify', c('setNotify'), c('notifyHint'))}
    ${yn('skipDone', c('setSkipDone'), c('skipDoneHint'))}
    ${yn('fresh', c('setFresh'), c('freshHint'))}
    <div class="og-field"><span class="og-label">${c('setOnFail')}</span><span class="wp-prose">${c('onFailInspect')}</span><span class="wp-hint">${c('onFailHint')}</span></div>
  </div>`;
}

/* ── helpers ───────────────────────────────────────────────────────────────────────────────── */
export const slugOf = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

function hasCycle(steps) {
  const after = new Map(steps.map(s => [s.id, s.after || []]));
  const seen = new Map();
  const visit = (id, stack) => {
    if (stack.has(id)) return true;
    if (seen.get(id)) return false;
    stack.add(id);
    for (const dep of after.get(id) || []) if (visit(dep, stack)) return true;
    stack.delete(id); seen.set(id, true);
    return false;
  };
  return steps.some(s => visit(s.id, new Set()));
}

function undeclaredVars(f) {
  const declared = new Set(['run', 'date', ...f.vars.map(v => v.name).filter(Boolean)]);
  const used = new Set();
  const scan = (s) => { for (const m of String(s || '').matchAll(/\{([a-zA-Z0-9_]+)\}/g)) used.add(m[1]); };
  for (const s of f.steps) { scan(s.offerKeys); }
  return [...used].filter(v => !declared.has(v));
}

/** The form state out of a definition (edit), or empty (create). */
export function formOf(def) {
  const loc0 = (x) => loc(x);
  return {
    id: def?.id || '', title: loc0(def?.title), description: loc0(def?.description),
    triggerKind: def?.trigger?.kind === 'ecosystem.event' ? 'manual' : (def?.trigger?.kind || 'manual'),
    cron: def?.trigger?.cron || '0 7 * * *', timezone: def?.trigger?.timezone || 'Europe/Helsinki',
    eventOn: def?.trigger?.on || 'memory.write', eventMatch: def?.trigger?.match?.key || def?.trigger?.match?.offer || '',
    vars: (def?.vars || []).map(v => ({ name: v.name, type: v.type || 'string', default: v.default ?? '', description: loc0(v.description) })),
    steps: (def?.steps || []).map(s => ({
      id: s.id, description: loc0(s.description), agent: Array.isArray(s.agent) ? s.agent[0] : (s.agent || ''), offer: s.offer || '',
      after: s.after || [], noInput: s.required_to_function === 'none', timeoutMin: s.timeout_min ?? (s.action?.kind === 'human-input' ? 1440 : 60),
      retryMax: s.retry?.max || 0, backoffMin: s.retry?.backoff_min || 5, action: s.action && s.action.kind !== 'agent' ? s.action : null,
      offerKeys: '',
    })),
    notify: !!def?.notify_on_finish, skipDone: !!def?.skip_done, fresh: !!def?.fresh, llm: !!def?.llm?.approved,
  };
}

/** The definition out of the form state, in the shape PUT /v1/workflows/:id takes. */
export function defOf(f) {
  const trigger = f.triggerKind === 'schedule' ? { kind: 'schedule', cron: f.cron, ...(f.timezone ? { timezone: f.timezone } : {}) }
    : f.triggerKind === 'event' ? { kind: 'event', on: f.eventOn, match: f.eventOn === 'memory.write' ? { key: f.eventMatch } : { offer: f.eventMatch } }
    : { kind: 'manual' };
  return {
    title: f.title || f.id,
    description: f.description || '-',
    trigger,
    vars: f.vars.filter(v => v.name).map(v => ({ name: v.name, type: v.type || 'string', description: v.description || v.name, ...(v.default ? { default: v.default } : {}) })),
    steps: f.steps.map(s => ({
      id: s.id,
      ...(s.action ? { action: s.action } : { agent: s.agent, offer: s.offer }),
      ...(s.after?.length ? { after: s.after } : {}),
      description: s.description || s.id,
      ...(s.noInput && !s.action ? { required_to_function: 'none' } : {}),
      ...(Number(s.retryMax) > 0 && !s.action ? { retry: { max: Number(s.retryMax), backoff_min: Number(s.backoffMin) || 5 } } : {}),
      timeout_min: Number(s.timeoutMin) || 60,
    })),
    on_step_fail: 'inspect',
    ...(f.notify ? { notify_on_finish: true } : {}),
    ...(f.skipDone ? { skip_done: true } : {}),
    ...(f.fresh ? { fresh: true } : {}),
    ...(f.llm ? { llm: { approved: true } } : {}),
  };
}

export const blankStep = () => ({ id: '', description: '', agent: '', offer: '', after: [], noInput: false, timeoutMin: 60, retryMax: 0, backoffMin: 5, action: null, offerKeys: '' });
export { Section };
