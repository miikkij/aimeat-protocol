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
 *   v1.13.0 — 2026-10-02 — The question marks that explain the workflow settings: schedule.cron, schedule.timezone (TextField help), workflow.step_timeout (Field group help), workflow.skip_done, workflow.fresh, workflow.parallel (yn() help argument), workflow.llm_checks (HelpTip beside its Choice); their grey hints moved into them (components/HelpTip.js).
 *   v1.12.0 —2026-09-26 — The form is the Field family (page group G5): the fields are TextField and Select with their row labels, the yes-and-no and the other one-of settings the Choice, "starts when" the Tabs where several are on at once, "wait for an answer" the Check, the timeout's own number the TextField beside its Choice; the rail's checks are plain lines (a failing one in coral), the crumb's way back is data. It writes no class.
 *   v1.11.0 — 2026-09-26 — "Wait for an answer" is the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.10.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.9.0 — 2026-09-26 — How to read this page is the Facts; a fold's paragraph is the lead and a read-only value under its label the Facts' value (a unification: the look most tabs use); the rail's dead base look goes.
 *   v1.8.0 — 2026-09-26 — The cron, key, variable and step id fields are the Text field's code cut (.og-input--code), a unification: one cut for every identifier field.
 *   v1.7.0 — 2026-09-25 — Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.6.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.0.0 — 2026-08-30 — Initial. Replaces workflows-form.js's machine fields.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { timeOfCron, withTime } from '../scheduler/cron-words.js';
import { c, loc, triggerWords, signalWords, kindWords, renderPage } from './frame.js';
import { HelpTip } from '/components/HelpTip.js';
import { Field, Fields } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Choice } from '/components/Choice.js';
import { Tabs } from '/components/Tabs.js';
import { Row, Stack } from '/components/Layout.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Tinted } from '/components/Figure.js';

/** The value of "starts at once" among the steps a step may wait for (never a step id: ids are a-z0-9-). */
const AT_ONCE = ':at-once';
const TTL_CHOICES = [['15', '15 min'], ['60', '1 h'], ['240', '4 h'], ['1440', '24 h']];
const RETRY_CHOICES = [['0', 'retryNone'], ['1', 'retryOnce'], ['2', 'retryTwice']];

const YES_NO = () => [[false, c('no')], [true, c('yes')]];

export function renderForm(ctx) {
  const f = ctx.form;
  const editing = ctx.view.kind === 'edit';
  const set = (patch) => ctx.setForm({ ...f, ...patch });
  const title = editing ? c('formEditTitle', { name: f.title || f.id }) : c('formNewTitle');
  const back = { label: editing ? c('backToWorkflow') : c('backTo'), onClick: () => ctx.pickView(editing ? { kind: 'detail', id: f.id } : { kind: 'cover' }) };
  const doors = html`
    <${Loud} control disabled=${ctx.saving || !f.id.trim() || !f.steps.length} onClick=${() => ctx.handleSave()}>${c('save')}<//>
    ${editing ? html`<${Action} small onClick=${() => ctx.copyPrompt('improve-mcp', f.id)}>${c('promptToChat')}<//>` : null}
    <${Action} small soft onClick=${() => ctx.pickView(editing ? { kind: 'detail', id: f.id } : { kind: 'cover' })}>${t('profile.cancel')}<//>`;
  const checks = [
    [f.steps.every(s => s.action || (s.agent && s.offer)), c('checkEveryStepOffer')],
    [!hasCycle(f.steps), c('checkNoCycle')],
    [undeclaredVars(f).length === 0, undeclaredVars(f).length ? c('checkVarsMissing', { vars: undeclaredVars(f).join(', ') }) : c('checkVarsOk')],
    [f.steps.every(s => s.id && /^[a-z0-9][a-z0-9-]*$/.test(s.id)), c('checkStepIds')],
  ];
  const railGroups = [
    { label: c('beforeSave'), items: [
      ...checks.map(([ok, label], i) => ({ key: 'c' + i, plain: true, mark: ok ? '✓' : '✗', label, notice: !ok })),
      ...ctx.saveErrors.map((e, i) => ({ key: 'e' + i, plain: true, mark: '✗', label: e, notice: true })),
    ] },
    { label: c('ratherInChat'), items: [{ key: 'chat', mark: '→', label: editing ? c('copyImprove') : c('copyPrompt'), onClick: () => ctx.copyPrompt(editing ? 'improve-mcp' : 'create-mcp', editing ? f.id : undefined) }] },
  ];

  return renderPage(ctx, {
    crumbs: editing ? [{ label: f.title || f.id, onClick: () => ctx.pickView({ kind: 'detail', id: f.id }) }, t('profile.workflows.edit')] : [c('formNewTitle')],
    title, doors, railGroups, back, desc: c('formDesc'),
    children: html`
      <${PageSection} id="wp-basics" num="01" title=${c('secBasics')} first>${basics(ctx, f, set, editing)}<//>
      <${PageSection} id="wp-form-steps" num="02" title=${c('secSteps')} count=${f.steps.length} doors=${html`<${Action} small onClick=${() => ctx.addStep()}>${c('addStep')}<//>`}>
        ${f.steps.map((s, i) => stepFold(ctx, f, s, i))}
        ${!f.steps.length ? html`<${Note} kind="quiet">${c('noStepsYet')}<//>` : null}
      <//>
      <${FoldSection} clip id="wp-end" num="03" title=${c('secEnd')} sub=${c('endSub')} open=${ctx.folds.end} onToggle=${() => ctx.setFold('end', !ctx.folds.end)}>${endFold(f, set)}<//>
      <${FoldSection} clip id="wp-llm" num="04" title=${c('secLlm')} sub=${c('llmSub')} open=${ctx.folds.llm} onToggle=${() => ctx.setFold('llm', !ctx.folds.llm)}>
        <${Row} wrap>
          <${Choice} ariaLabel=${c('secLlm')} value=${!!f.llm} options=${YES_NO()} onChange=${(v) => set({ llm: v })} />
          <${HelpTip} term="workflow.llm_checks" label=${c('secLlm')} />
        <//>
      <//>
      <${ctx.ConfirmUI} />`,
  });
}

function basics(ctx, f, set, editing) {
  const time = timeOfCron(f.cron);
  return html`
    <${Fields}>
      <${Fields} cols=${2}>
        <${TextField} id="wp-f-title" label=${c('fName')} value=${f.title} onInput=${v => set({ title: v, id: editing ? f.id : slugOf(v) })} placeholder=${c('namePlaceholder')} />
        <${TextField} id="wp-f-id" label=${c('fId')} hint=${c('idHint')} value=${f.id} disabled=${editing} onInput=${v => set({ id: v })} placeholder="my-workflow" />
      <//>
      <${TextField} id="wp-f-desc" label=${c('fDesc')} value=${f.description} onInput=${v => set({ description: v })} placeholder=${c('descPlaceholder')} />
      <${Field} label=${c('fTrigger')} group>
        <${Stack} gap="medium">
          <${Choice} ariaLabel=${c('fTrigger')} value=${f.triggerKind} onChange=${v => set({ triggerKind: v })}
            options=${[['manual', c('trigger.manual')], ['schedule', c('trigger.scheduleWord')], ['event', c('trigger.eventWord')]]} />
          ${f.triggerKind === 'schedule' ? html`
            <${Row} wrap gap="large" align="end">
              <${TextField} type="time" size="short" label=${c('fTime')} value=${time} onInput=${v => set({ cron: withTime(f.cron, v) })} />
              <${TextField} code label=${c('fCron')} help="schedule.cron" value=${f.cron} onInput=${v => set({ cron: v })} />
              <${TextField} label=${c('fTimezone')} help="schedule.timezone" value=${f.timezone} onInput=${v => set({ timezone: v })} />
            <//>
            <${Note}>${triggerWords({ kind: 'schedule', cron: f.cron, timezone: f.timezone })}<//>` : null}
          ${f.triggerKind === 'event' ? html`
            <${Row} wrap gap="large" align="end">
              <${Choice} label=${c('fEventOn')} value=${f.eventOn} onChange=${v => set({ eventOn: v })}
                options=${[['memory.write', c('eventMemory')], ['offer.ordered', c('eventOffer')]]} />
              <${TextField} code label=${f.eventOn === 'memory.write' ? c('fEventKey') : c('fEventOffer')} value=${f.eventMatch} onInput=${v => set({ eventMatch: v })} placeholder=${f.eventOn === 'memory.write' ? 'news.*' : 'fetch'} />
            <//>` : null}
        <//>
      <//>
      ${varsBlock(ctx, f, set)}
    <//>`;
}

function varsBlock(ctx, f, set) {
  const setVar = (i, patch) => set({ vars: f.vars.map((v, j) => j === i ? { ...v, ...patch } : v) });
  return html`
    <${Field} label=${c('fVars')} hint=${c('varsHint')} group>
      ${f.vars.map((v, i) => html`<${Row} key=${i} wrap gap="medium" align="end" above="small">
        <${TextField} code ariaLabel=${c('varName')} placeholder=${c('varName')} value=${v.name} onInput=${val => setVar(i, { name: val })} />
        <${Choice} ariaLabel=${v.name || c('varName')} value=${v.type} onChange=${ty => setVar(i, { type: ty })}
          options=${['string', 'date', 'number'].map(ty => [ty, c('varType.' + ty)])} />
        <${TextField} code ariaLabel=${c('varDefault')} placeholder=${v.type === 'date' ? '<run-date>' : c('varDefault')} value=${v.default || ''} onInput=${val => setVar(i, { default: val })} />
        <${Action} small soft onClick=${() => set({ vars: f.vars.filter((_, j) => j !== i) })}>${c('remove')}<//>
      <//>`)}
      <${Actions}><${Action} small soft onClick=${() => set({ vars: [...f.vars, { name: '', type: 'string', default: '' }] })}>${c('addVar')}<//><//>
    <//>`;
}

function stepFold(ctx, f, s, i) {
  const open = ctx.openStep === i;
  const setStep = (patch) => ctx.setForm({ ...f, steps: f.steps.map((x, j) => j === i ? { ...x, ...patch } : x) });
  const others = f.steps.filter((x, j) => j !== i && x.id).map(x => x.id);
  const offers = ctx.offersByAgent[s.agent] || null;
  const offer = offers?.find(o => o.id === s.offer);
  const sub = s.action ? kindWords(s) : [s.agent, s.offer].filter(Boolean).join(' · ') + (s.after?.length ? ` · ${c('afterSteps', { steps: s.after.join(', ') })}` : '');
  // "Starts at once" is on while the step waits for no other; each other step toggles on its own.
  const afterPick = (o) => (o === AT_ONCE ? setStep({ after: [] }) : setStep({ after: s.after?.includes(o) ? s.after.filter(a => a !== o) : [...(s.after || []), o] }));
  return html`
    <${FoldSection} clip key=${i} id=${'wp-step-' + i} num=${String(i + 1).padStart(2, '0')} title=${s.id || c('newStep')} sub=${sub} open=${open} onToggle=${() => ctx.setOpenStep(open ? -1 : i)}>
      <${Fields}>
        <${Fields} cols=${2}>
          <${TextField} id=${'wp-s-id-' + i} code label=${c('fStepId')} value=${s.id} onInput=${v => setStep({ id: v })} placeholder="fetch" />
          <${TextField} id=${'wp-s-desc-' + i} label=${c('fStepDesc')} value=${s.description} onInput=${v => setStep({ description: v })} placeholder=${c('stepDescPlaceholder')} />
        <//>
        ${s.action ? html`<${Field} label=${c('fStepKind')} hint=${c('actionStepHint')} group>${kindWords(s)}${s.action.kind === 'human-input' ? `: ${s.action.question?.prompt || ''}` : ''}<//>` : html`
        <${Fields} cols=${2}>
          <${Select} id=${'wp-s-agent-' + i} label=${c('fAgent')} value=${s.agent} placeholder=${c('pickAgent')}
            options=${ctx.agents.map(a => [a.name, a.name])} onChange=${v => { setStep({ agent: v, offer: '' }); ctx.loadOffers(v); }} />
          <${Select} id=${'wp-s-offer-' + i} label=${c('fOffer')} value=${s.offer} disabled=${!s.agent} onChange=${v => setStep({ offer: v })}
            placeholder=${!s.agent ? c('pickAgentFirst') : offers === null ? t('common.loading') : offers.length ? c('pickOffer') : c('noCompatibleOffers')}
            options=${(offers || []).map(o => [o.id, `${o.id}${loc(o.title) ? ` · ${loc(o.title)}` : ''}`])}
            hint=${offer ? offerWords(offer) : s.agent && offers && !offers.length ? html`<${Tinted} tone="notice">${c('noCompatibleOffersHint')}<//>` : null} />
        <//>`}
        <${Fields} cols=${2}>
          <${Field} label=${c('fStartsWhen')} group>
            <${Stack}>
              <${Tabs} kind="toggle" label=${c('fStartsWhen')} value=${s.after || []} onSelect=${(o) => afterPick(o)}
                items=${[{ value: AT_ONCE, label: c('startsAtOnce'), on: !s.after?.length }, ...others.map(o => ({ value: o, label: c('afterStep', { step: o }) }))]} />
              ${!s.action ? html`<${Check} checked=${s.noInput} onChange=${on => setStep({ noInput: on })}>${c('noInputGate')}<//>` : null}
            <//>
          <//>
          <${Field} label=${c('fIfNotProduced')} help="workflow.step_timeout" group>
            <${Stack}>
              ${!s.action ? html`<${Choice} ariaLabel=${c('fIfNotProduced')} value=${String(s.retryMax)} onChange=${v => setStep({ retryMax: Number(v) })}
                options=${RETRY_CHOICES.map(([v, key]) => [v, c(key)])} />` : null}
              <${Choice} ariaLabel=${c('fIfNotProduced')} value=${String(s.timeoutMin)} onChange=${v => setStep({ timeoutMin: Number(v) })} options=${TTL_CHOICES}>
                <${TextField} type="number" size="short" min="1" ariaLabel=${c('fIfNotProduced')} value=${s.timeoutMin} onInput=${v => setStep({ timeoutMin: Number(v) || 60 })} />
              <//>
            <//>
          <//>
        <//>
        <${Actions}>
          <${Action} small soft onClick=${() => ctx.setOpenStep(-1)}>${c('close')}<//>
          <${Action} small tone="danger" onClick=${() => ctx.removeStep(i)}>${c('removeStep')}<//>
        <//>
      <//>
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
  const yn = (key, label, hint, help) => html`<${Choice} label=${label} hint=${hint} help=${help} value=${!!f[key]} options=${YES_NO()} onChange=${(v) => set({ [key]: v })} />`;
  return html`<${Fields} cols=${2}>
    ${yn('notify', c('setNotify'), c('notifyHint'))}
    ${yn('skipDone', c('setSkipDone'), null, 'workflow.skip_done')}
    ${yn('fresh', c('setFresh'), null, 'workflow.fresh')}
    ${yn('parallel', c('setParallel'), null, 'workflow.parallel')}
    <${Field} label=${c('setOnFail')} hint=${c('onFailHint')} group>${c('onFailInspect')}<//>
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
