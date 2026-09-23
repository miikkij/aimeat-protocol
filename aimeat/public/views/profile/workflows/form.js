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
 *   2026-09-22 -- Composed from the shared component set (Field, Action tabs for a choice, Columns,
 *     Section, Fold, KeyValue); no own CSS. Same fields, same saved definition.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces workflows-form.js's machine fields.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, Stack, Columns, Field, Action, Text } from '/components/poster-parts.js';
import { timeOfCron, withTime } from '../scheduler/cron-words.js';
import { c, loc, triggerWords, signalWords, kindWords, renderPage } from './frame.js';

const TTL_CHOICES = [['15', '15 min'], ['60', '1 h'], ['240', '4 h'], ['1440', '24 h']];
const RETRY_CHOICES = [['0', 'retryNone'], ['1', 'retryOnce'], ['2', 'retryTwice']];

/** A group of choices: a label, the choices as tabs (one or more on), a hint under them. */
const choiceGroup = (label, options, hint = null) => html`<${Stack} density="compact">
  ${label ? html`<${Text} kind="label">${label}<//>` : null}
  <${Stack} direction="wrap" density="compact">${options.map(([key, text, on, onClick]) => html`<${Action} key=${key} kind="tab" selected=${on} onClick=${onClick}>${text}<//>`)}<//>
  ${hint ? html`<${Text} kind="caption" tone="muted">${hint}<//>` : null}
<//>`;

export function renderForm(ctx) {
  const f = ctx.form;
  const editing = ctx.view.kind === 'edit';
  const set = (patch) => ctx.setForm({ ...f, ...patch });
  const title = editing ? c('formEditTitle', { name: f.title || f.id }) : c('formNewTitle');
  const back = html`<${Action} onClick=${() => ctx.pickView(editing ? { kind: 'detail', id: f.id } : { kind: 'cover' })}>← ${editing ? c('backToWorkflow') : c('backTo')}<//>`;
  const doors = html`
    <${Action} kind="primary" disabled=${ctx.saving || !f.id.trim() || !f.steps.length} onClick=${() => ctx.handleSave()}>${c('save')}<//>
    ${editing ? html`<${Action} onClick=${() => ctx.copyPrompt('improve-mcp', f.id)}>${c('promptToChat')}<//>` : null}
    <${Action} onClick=${() => ctx.pickView(editing ? { kind: 'detail', id: f.id } : { kind: 'cover' })}>${t('profile.cancel')}<//>`;
  const checks = [
    [f.steps.every(s => s.action || (s.agent && s.offer)), c('checkEveryStepOffer')],
    [!hasCycle(f.steps), c('checkNoCycle')],
    [undeclaredVars(f).length === 0, undeclaredVars(f).length ? c('checkVarsMissing', { vars: undeclaredVars(f).join(', ') }) : c('checkVarsOk')],
    [f.steps.every(s => s.id && /^[a-z0-9][a-z0-9-]*$/.test(s.id)), c('checkStepIds')],
  ];
  const rail = html`
    <${Stack} density="compact">
      <${Text} kind="label">${c('beforeSave')}<//>
      ${checks.map(([ok, label], i) => html`<${Text} key=${i} kind="caption" tone=${ok ? 'plain' : 'danger'}>${ok ? '✓' : '✗'} ${label}<//>`)}
      ${ctx.saveErrors.map((e, i) => html`<${Text} key=${'e' + i} kind="caption" tone="danger">✗ ${e}<//>`)}
    <//>
    <${Stack} density="compact">
      <${Text} kind="label">${c('ratherInChat')}<//>
      <${Action} kind="text" onClick=${() => ctx.copyPrompt(editing ? 'improve-mcp' : 'create-mcp', editing ? f.id : undefined)}>${editing ? c('copyImprove') : c('copyPrompt')} →<//>
    <//>`;

  return renderPage(ctx, {
    crumbs: editing ? [{ label: f.title || f.id, go: () => ctx.pickView({ kind: 'detail', id: f.id }) }, t('profile.workflows.edit')] : [c('formNewTitle')],
    title, doors, rail, back,
    children: html`
      <${Text} kind="lead">${c('formDesc')}<//>
      <${Section} id="wp-basics" title=${c('secBasics')}>${basics(ctx, f, set, editing)}<//>
      <${Section} id="wp-form-steps" title=${c('secSteps')} count=${f.steps.length} actions=${html`<${Action} onClick=${() => ctx.addStep()}>${c('addStep')}<//>`}>
        ${f.steps.map((s, i) => stepFold(ctx, f, s, i))}
        ${!f.steps.length ? html`<${Text} tone="muted">${c('noStepsYet')}<//>` : null}
      <//>
      <${Fold} id="wp-end" number="03" title=${c('secEnd')} sub=${c('endSub')} open=${ctx.folds.end} onToggle=${() => ctx.setFold('end', !ctx.folds.end)}>${endFold(f, set)}<//>
      <${Fold} id="wp-llm" number="04" title=${c('secLlm')} sub=${c('llmSub')} open=${ctx.folds.llm} onToggle=${() => ctx.setFold('llm', !ctx.folds.llm)}>
        ${choiceGroup(null, [['no', c('no'), !f.llm, () => set({ llm: false })], ['yes', c('yes'), !!f.llm, () => set({ llm: true })]], c('llmHint'))}
      <//>
      <${ctx.ConfirmUI} />`,
  });
}

function basics(ctx, f, set, editing) {
  const choice = (key, options) => options.map(([v, label]) => [v, label, f[key] === v, () => set({ [key]: v })]);
  const time = timeOfCron(f.cron);
  return html`<${Stack}>
    <${Columns} layout="equal" collapse="600">
      <${Field} id="wp-f-title" label=${c('fName')} value=${f.title} onInput=${e => set({ title: e.target.value, id: editing ? f.id : slugOf(e.target.value) })} placeholder=${c('namePlaceholder')} />
      <${Field} id="wp-f-id" label=${c('fId')} value=${f.id} disabled=${editing} onInput=${e => set({ id: e.target.value })} placeholder="my-workflow" hint=${c('idHint')} />
    <//>
    <${Field} id="wp-f-desc" label=${c('fDesc')} value=${f.description} onInput=${e => set({ description: e.target.value })} placeholder=${c('descPlaceholder')} />
    ${choiceGroup(c('fTrigger'), choice('triggerKind', [['manual', c('trigger.manual')], ['schedule', c('trigger.scheduleWord')], ['event', c('trigger.eventWord')]]))}
    ${f.triggerKind === 'schedule' ? html`<${Stack} density="compact">
      <${Columns} layout="thirds" collapse="600" density="compact">
        <${Field} type="time" label=${c('fTime')} value=${time} onInput=${e => set({ cron: withTime(f.cron, e.target.value) })} />
        <${Field} label=${c('fCron')} value=${f.cron} onInput=${e => set({ cron: e.target.value })} />
        <${Field} label=${c('fTimezone')} value=${f.timezone} onInput=${e => set({ timezone: e.target.value })} />
      <//>
      <${Text} kind="caption" tone="muted">${triggerWords({ kind: 'schedule', cron: f.cron, timezone: f.timezone })}<//>
    <//>` : null}
    ${f.triggerKind === 'event' ? html`<${Columns} layout="equal" collapse="600" density="compact">
      ${choiceGroup(c('fEventOn'), choice('eventOn', [['memory.write', c('eventMemory')], ['offer.ordered', c('eventOffer')]]))}
      <${Field} label=${f.eventOn === 'memory.write' ? c('fEventKey') : c('fEventOffer')} value=${f.eventMatch} onInput=${e => set({ eventMatch: e.target.value })} placeholder=${f.eventOn === 'memory.write' ? 'news.*' : 'fetch'} />
    <//>` : null}
    ${varsBlock(ctx, f, set)}
  <//>`;
}

function varsBlock(ctx, f, set) {
  const setVar = (i, patch) => set({ vars: f.vars.map((v, j) => j === i ? { ...v, ...patch } : v) });
  return html`<${Stack} density="compact">
    <${Text} kind="label">${c('fVars')}<//>
    ${f.vars.map((v, i) => html`<${Stack} key=${i} direction="wrap" align="end" density="compact">
      <${Field} placeholder=${c('varName')} value=${v.name} onInput=${e => setVar(i, { name: e.target.value })} />
      ${choiceGroup(null, ['string', 'date', 'number'].map(ty => [ty, c('varType.' + ty), v.type === ty, () => setVar(i, { type: ty })]))}
      <${Field} placeholder=${v.type === 'date' ? '<run-date>' : c('varDefault')} value=${v.default || ''} onInput=${e => setVar(i, { default: e.target.value })} />
      <${Action} onClick=${() => set({ vars: f.vars.filter((_, j) => j !== i) })}>${c('remove')}<//>
    <//>`)}
    <${Stack} direction="horizontal" align="start"><${Action} onClick=${() => set({ vars: [...f.vars, { name: '', type: 'string', default: '' }] })}>${c('addVar')}<//><//>
    <${Text} kind="caption" tone="muted">${c('varsHint')}<//>
  <//>`;
}

function stepFold(ctx, f, s, i) {
  const open = ctx.openStep === i;
  const setStep = (patch) => ctx.setForm({ ...f, steps: f.steps.map((x, j) => j === i ? { ...x, ...patch } : x) });
  const others = f.steps.filter((x, j) => j !== i && x.id).map(x => x.id);
  const offers = ctx.offersByAgent[s.agent] || null;
  const offer = offers?.find(o => o.id === s.offer);
  const sub = s.action ? kindWords(s) : [s.agent, s.offer].filter(Boolean).join(' · ') + (s.after?.length ? ` · ${c('afterSteps', { steps: s.after.join(', ') })}` : '');
  const offerLabel = !s.agent ? c('pickAgentFirst') : offers === null ? t('common.loading') : offers.length ? c('pickOffer') : c('noCompatibleOffers');
  return html`
    <${Fold} key=${i} id=${'wp-step-' + i} number=${String(i + 1).padStart(2, '0')} title=${s.id || c('newStep')} sub=${sub} open=${open} onToggle=${() => ctx.setOpenStep(open ? -1 : i)}>
      <${Columns} layout="equal" collapse="600">
        <${Field} id=${'wp-s-id-' + i} label=${c('fStepId')} value=${s.id} onInput=${e => setStep({ id: e.target.value })} placeholder="fetch" />
        <${Field} id=${'wp-s-desc-' + i} label=${c('fStepDesc')} value=${s.description} onInput=${e => setStep({ description: e.target.value })} placeholder=${c('stepDescPlaceholder')} />
      <//>
      ${s.action ? html`<${Stack} density="compact">
        <${Text} kind="label">${c('fStepKind')}<//>
        <${Text}>${kindWords(s)}${s.action.kind === 'human-input' ? `: ${s.action.question?.prompt || ''}` : ''}<//>
        <${Text} kind="caption" tone="muted">${c('actionStepHint')}<//>
      <//>` : html`<${Columns} layout="equal" collapse="600">
        <${Field} id=${'wp-s-agent-' + i} type="select" label=${c('fAgent')} value=${s.agent} onChange=${e => { setStep({ agent: e.target.value, offer: '' }); ctx.loadOffers(e.target.value); }}
          options=${[{ value: '', label: c('pickAgent') }, ...ctx.agents.map(a => ({ value: a.name, label: a.name }))]} />
        <${Stack} density="compact">
          <${Field} id=${'wp-s-offer-' + i} type="select" label=${c('fOffer')} value=${s.offer} disabled=${!s.agent} onChange=${e => setStep({ offer: e.target.value })}
            options=${[{ value: '', label: offerLabel }, ...(offers || []).map(o => ({ value: o.id, label: `${o.id}${loc(o.title) ? ` · ${loc(o.title)}` : ''}` }))]} />
          ${offer ? html`<${Text} kind="caption" tone="muted">${offerWords(offer)}<//>` : s.agent && offers && !offers.length ? html`<${Text} kind="caption" tone="danger">${c('noCompatibleOffersHint')}<//>` : null}
        <//>
      <//>`}
      <${Columns} layout="equal" collapse="600">
        <${Stack} density="compact">
          ${choiceGroup(c('fStartsWhen'), [['now', c('startsAtOnce'), !s.after?.length, () => setStep({ after: [] })],
            ...others.map(o => [o, c('afterStep', { step: o }), !!s.after?.includes(o), () => setStep({ after: s.after?.includes(o) ? s.after.filter(a => a !== o) : [...(s.after || []), o] })])])}
          ${!s.action ? html`<${Field} type="checkbox" label=${c('noInputGate')} value=${s.noInput} onChange=${e => setStep({ noInput: e.target.checked })} />` : null}
        <//>
        <${Stack} density="compact">
          ${!s.action ? choiceGroup(c('fIfNotProduced'), RETRY_CHOICES.map(([v, key]) => [v, c(key), String(s.retryMax) === v, () => setStep({ retryMax: Number(v) })])) : html`<${Text} kind="label">${c('fIfNotProduced')}<//>`}
          ${choiceGroup(null, TTL_CHOICES.map(([v, label]) => [v, label, String(s.timeoutMin) === v, () => setStep({ timeoutMin: Number(v) })]))}
          <${Field} type="number" min="1" value=${s.timeoutMin} onInput=${e => setStep({ timeoutMin: Number(e.target.value) || 60 })} />
          <${Text} kind="caption" tone="muted">${c('timeoutHint')}<//>
        <//>
      <//>
      <${Stack} direction="wrap"><${Action} onClick=${() => ctx.setOpenStep(-1)}>${c('close')}<//><${Action} onClick=${() => ctx.removeStep(i)}>${c('removeStep')}<//><//>
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
  const yn = (key, label, hint) => choiceGroup(label, [['no', c('no'), !f[key], () => set({ [key]: false })], ['yes', c('yes'), !!f[key], () => set({ [key]: true })]], hint);
  return html`<${Columns} layout="equal" collapse="600">
    ${yn('notify', c('setNotify'), c('notifyHint'))}
    ${yn('skipDone', c('setSkipDone'), c('skipDoneHint'))}
    ${yn('fresh', c('setFresh'), c('freshHint'))}
    ${yn('parallel', c('setParallel'), c('parallelHint'))}
    <${Stack} density="compact"><${Text} kind="label">${c('setOnFail')}<//><${Text}>${c('onFailInspect')}<//><${Text} kind="caption" tone="muted">${c('onFailHint')}<//><//>
  <//>`;
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
    notify: !!def?.notify_on_finish, skipDone: !!def?.skip_done, fresh: !!def?.fresh, parallel: !!def?.parallel, llm: !!def?.llm?.approved,
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
    ...(f.parallel ? { parallel: true } : {}),
    ...(f.llm ? { llm: { approved: true } } : {}),
  };
}

export const blankStep = () => ({ id: '', description: '', agent: '', offer: '', after: [], noInput: false, timeoutMin: 60, retryMax: 0, backoffMin: 5, action: null, offerKeys: '' });
export { Section };
