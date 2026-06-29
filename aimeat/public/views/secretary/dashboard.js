/**
 * @file secretary/dashboard.js
 * @description Dashboard-first information architecture for the Secretary view (B1). Pure presentational
 *   render functions (props in → htm out, no hooks/state) that frame the Secretary's daily loop:
 *   a core quick-action row, a "Today" status strip (reliability · budget · next scheduled run ·
 *   last-scan + stale flag + refresh), a read-only "where things stand" orientation panel, and the
 *   collapsible "Manage & setup" disclosure header that tucks the set-up-once config cards away.
 *   The view (views/secretary.js) owns all state/handlers and passes them in; the config cards
 *   themselves still live in ./cards.js / ./cards-reach.js. Redesign: docs/internal/2026-06-25-secretary-view-redesign.md.
 * @structure quickActionRow · dashStatus · standPanel · actionItemsCard · routinesCard · quickActionsManager · manageHeader (one render function each)
 * @usage import { quickActionRow, dashStatus, standPanel, actionItemsCard, routinesCard, quickActionsManager, manageHeader } from '/views/secretary/dashboard.js';
 * @version-history
 *   v0.9.0 — 2026-06-28 — strategyCard: optional steering frame (vision/mission/principles/risks +
 *     current→target + ordered milestone gates with status/focus/reorder/goal-linking + AI re-plan).
 *   v0.8.0 — 2026-06-28 — secretaryDangerCard: a guarded "Reset Secretary" control (type RESET to wipe
 *     the brain + all secretary.* + self-organisms/workspaces + specialists) for the Manage & setup area.
 *   v0.7.0 — 2026-06-28 — triggersCard: "When it fires" binding (remind / run a workflow / run a
 *     specialist) + a bound-action badge in the trigger list; takes workflows + specialists props.
 *   v0.6.0 — 2026-06-28 — G3: dashStatus "Scan" button calls onReconcile (a real discover scan that
 *     stamps lastScanAt) with a scanning state, replacing the bare re-fetch; G2 cadence badge on routines.
 *   v0.5.0 — 2026-06-28 — G5: actionItemsCard renders the action-item label via t() from the item's
 *     structured labelKind + summary (legacy server-composed `text` kept as a fallback).
 *   v0.4.0 — 2026-06-28 — B5: actionItemsCard — the tick-derived follow-up action-items, one-click handle/dismiss.
 *   v0.3.0 — 2026-06-27 — B3: quickActionsManager — pin/dismiss proposed shortcuts, rename/remove/reorder
 *     active ones, "Suggest shortcuts".
 *   v0.2.0 — 2026-06-27 — B2: routinesCard — active Routines on the dashboard (status · last result ·
 *     next step · Advance).
 *   v0.1.0 — 2026-06-27 — B1: dashboard-first IA — quick-action row, Today status strip, where-things-stand
 *     panel, Manage disclosure header.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Markdown } from '/components/Markdown.js';

/** Core (+ later dynamic) quick actions: a button row above the chat. `items` are descriptors
 *  `{ key, label, title?, primary?, disabled?, hidden?, onClick }` so B3 can extend with dynamic actions. */
export function quickActionRow(p) {
  const items = (p.items || []).filter((it) => it && !it.hidden);
  if (items.length === 0) return null;
  return html`
    <div class="sec-quick">
      ${items.map((it) => html`
        <button class="${it.primary ? 'btn-primary' : 'btn-outline'} btn-sm sec-quick-btn" key=${it.key}
          disabled=${!!it.disabled} title=${it.title || ''} onClick=${it.onClick}>${it.label}</button>`)}
    </div>`;
}

/** "Today" status strip: reliability · budget · next scheduled run · last-scan + stale flag + refresh. */
export function dashStatus(p) {
  const rel = p.reliability;
  const relText = (rel && typeof rel.score === 'number') ? `${rel.score}/100` : t('secretary.reliabilityBuilding');
  const budgetText = p.budgetInfo ? `${p.budgetInfo.remaining} / ${p.budgetInfo.budget}` : t('secretary.noLimit');
  const sched = p.schedule;
  const nextText = (sched && sched.nextRunAt) ? new Date(sched.nextRunAt).toLocaleString() : '—';
  const paused = sched && !sched.enabled;
  const lastText = p.lastScan ? new Date(p.lastScan).toLocaleString() : t('secretary.dash.never');
  return html`
    <section class="sec-card sec-dash">
      <div class="sec-card-head">
        <h2 class="sec-h2">${t('secretary.dash.todayTitle')}</h2>
        <button class="btn-ghost btn-sm" disabled=${!!p.scanning} onClick=${p.onReconcile}>↻ ${p.scanning ? t('secretary.dash.scanning') : t('secretary.dash.reconcile')}</button>
      </div>
      <div class="sec-dash-strip">
        <div class="sec-chip">
          <span class="sec-chip-k">${t('secretary.reliability')}</span>
          <span class="sec-chip-v">${relText}${rel && rel.count ? html` <span class="sec-hint">(${rel.count})</span>` : null}</span>
        </div>
        <div class="sec-chip">
          <span class="sec-chip-k">${t('secretary.dash.budgetLabel')}</span>
          <span class="sec-chip-v">${budgetText}</span>
        </div>
        <div class="sec-chip">
          <span class="sec-chip-k">${t('secretary.dash.nextRunLabel')}</span>
          <span class="sec-chip-v">${nextText}${paused ? html` <span class="sec-hint">(${t('secretary.auto.paused')})</span>` : null}</span>
        </div>
        <div class="sec-chip ${p.stale ? 'stale' : ''}">
          <span class="sec-chip-k">${t('secretary.dash.lastScanLabel')}</span>
          <span class="sec-chip-v">${lastText}${p.stale ? html` <span class="sec-chip-badge">${t('secretary.dash.stale')}</span>` : null}</span>
        </div>
      </div>
    </section>`;
}

/** Read-only "where things stand" orientation summary (the core "Missä mennään?" quick action). */
export function standPanel(p) {
  const s = p.stand;
  if (!s || (!s.loading && !s.text && !s.needModel)) return null;
  const title = p.title || t('secretary.dash.standTitle');
  const thinking = p.thinking || t('secretary.dash.standThinking');
  return html`
    <section class="sec-card sec-stand">
      <div class="sec-card-head">
        <h2 class="sec-h2">${title}</h2>
        ${!s.loading ? html`<button class="btn-ghost btn-sm" onClick=${p.onDismiss}>${t('secretary.dash.dismiss')}</button>` : null}
      </div>
      ${s.loading
        ? html`<div class="sec-hint">${thinking}<span class="sec-spin"></span></div>`
        : s.needModel
        ? html`<div class="sec-hint sec-warn">${t('secretary.next.needBigModel')}</div>`
        : html`
          ${s.generatedAt ? html`<div class="sec-hint sec-stand-when">${t('secretary.dash.standAt')} ${new Date(s.generatedAt).toLocaleString()} · <button class="sec-linkbtn" onClick=${p.onRefresh}>${t('secretary.dash.refreshStand')}</button></div>` : null}
          ${s.issues && s.issues.length ? html`<div class="sec-hint sec-warn">⚠ ${t('secretary.next.verifyFlag')}: ${s.issues.join('; ')}</div>` : null}
          <div class="sec-stand-body"><${Markdown} text=${s.text} /></div>`}
    </section>`;
}

/** "What's next" — the Secretary's proposed next actions, each with Do it / Skip; doing one runs it. */
export function whatsNextPanel(p) {
  const n = p.answer;
  if (!n) return null;
  return html`
    <section class="sec-card sec-stand sec-next-answer">
      <div class="sec-card-head">
        <h2 class="sec-h2">${t('secretary.next.title')}</h2>
        ${!n.loading ? html`<button class="btn-ghost btn-sm" onClick=${p.onDismiss}>${t('secretary.dash.dismiss')}</button>` : null}
      </div>
      ${n.loading
        ? html`<div class="sec-hint">${t('secretary.next.thinking')}<span class="sec-spin"></span></div>`
        : n.needModel
        ? html`<div class="sec-hint sec-warn">${t('secretary.next.needBigModel')}</div>`
        : (n.actions && n.actions.length
          ? html`<ul class="sec-next-actions">
              ${n.actions.map((a) => html`
                <li class="sec-next-action sec-next-action--${a.status}" key=${a.id}>
                  <div class="sec-next-action-main">
                    <div class="sec-next-action-sum">${a.summary}</div>
                    ${a.why ? html`<div class="sec-hint">${a.why}</div>` : null}
                    ${a.result ? html`<div class="sec-hint">→ ${a.result}${a.href ? html` · <a href=${a.href} target="_blank" rel="noopener">${t('secretary.next.openResult')} ↗</a>` : null}</div>` : null}
                    ${a.issues && a.issues.length ? html`<div class="sec-hint sec-warn">⚠ ${t('secretary.next.verifyFlag')}: ${a.issues.join('; ')}</div>` : null}
                    ${a.preview ? html`
                      <button class="sec-linkbtn sec-next-toggle" onClick=${() => p.onTogglePreview && p.onTogglePreview(a)}>${a.expanded ? t('secretary.next.hideResult') : t('secretary.next.showResult')}</button>
                      ${a.noteKey ? html` · <button class="sec-linkbtn sec-next-discard" onClick=${() => p.onDiscard && p.onDiscard(a)}>${t('secretary.next.discard')}</button>` : null}
                      ${a.expanded ? html`<div class="sec-next-preview"><${Markdown} text=${a.preview} /></div>` : null}` : null}
                    ${a.status === 'prompt' && a.promptText ? html`
                      <div class="sec-next-prompt">
                        <div class="sec-hint sec-warn">${t('secretary.next.needBigModel')}</div>
                        <div class="sec-prompt-box">${a.promptText}</div>
                        <div class="sec-next-action-btns">
                          <button class="btn-outline btn-sm" onClick=${() => navigator.clipboard && navigator.clipboard.writeText(a.promptText)}>${t('secretary.next.copyPrompt')}</button>
                        </div>
                        <textarea class="sec-paste" placeholder=${t('secretary.next.pastePlaceholder')} value=${(p.pasteDrafts && p.pasteDrafts[a.id]) || ''} onInput=${(e) => p.onPasteInput && p.onPasteInput(a.id, e.target.value)}></textarea>
                        <div class="sec-next-action-btns">
                          <button class="btn-primary btn-sm" onClick=${() => p.onSavePrompt && p.onSavePrompt(a)}>${t('secretary.next.saveResult')}</button>
                          <button class="btn-ghost btn-sm" onClick=${() => p.onSkip(a)}>${t('secretary.next.skipIt')}</button>
                        </div>
                      </div>` : null}
                  </div>
                  ${a.status === 'done' ? html`<span class="sec-step-status sec-done">${t('secretary.next.done')}</span>`
                    : a.status === 'skipped' ? html`<span class="sec-hint">${t('secretary.next.skipped')}</span>`
                    : a.status === 'discarded' ? html`<span class="sec-hint">${t('secretary.next.discarded')}</span>`
                    : a.status === 'asked' ? html`<span class="sec-hint">⏳ ${t('secretary.next.asked')} · <a href="/v1/profile?tab=messages" target="_blank" rel="noopener">${t('secretary.next.openInbox')}</a></span>`
                    : a.status === 'prompt' ? null
                    : html`<div class="sec-next-action-btns">
                        <button class="btn-primary btn-sm" disabled=${a.status === 'doing'} onClick=${() => p.onDo(a)}>${a.status === 'doing' ? html`${t('secretary.next.running')}<span class="sec-spin"></span>` : t('secretary.next.doIt')}</button>
                        <button class="btn-ghost btn-sm" onClick=${() => p.onSkip(a)}>${t('secretary.next.skipIt')}</button>
                      </div>`}
                </li>`)}
            </ul>`
          : html`<div class="sec-hint">${t('secretary.next.nothingNow')}</div>`)}
    </section>`;
}

/** Action-items the tick derived (B5): one-click handle (open routine / check delegate result) or dismiss. */
export function actionItemsCard(p) {
  if (!p.actionItems || p.actionItems.length === 0) return null;
  return html`
    <section class="sec-card sec-action-items">
      <h2 class="sec-h2">${t('secretary.items.title')}</h2>
      <ul class="sec-item-list">
        ${p.actionItems.map((it) => {
          const kind = (it.suggestedAction && it.suggestedAction.kind) || 'advance';
          // G5: the tick stores a structured labelKind + summary — render the label in the user's language
          // here. Fall back to a legacy server-composed `text` for any item written before G5.
          const label = it.labelKind ? t('secretary.items.text.' + it.labelKind, { summary: it.summary || '' }) : (it.text || '');
          return html`
            <li class="sec-item-row" key=${it.id}>
              <div class="sec-item-text">${(label)}</div>
              <div class="sec-item-actions">
                <button class="btn-primary btn-sm" onClick=${() => p.handleActionItem(it)}>${t('secretary.items.handle.' + kind)}</button>
                <button class="btn-ghost btn-sm" onClick=${() => p.dismissActionItem(it)}>${t('secretary.items.dismiss')}</button>
              </div>
            </li>`;
        })}
      </ul>
    </section>`;
}

/** Active Routines on the dashboard (B2): title · status · last result · next step, with Advance. */
export function routinesCard(p) {
  if (!p.activeRoutines || p.activeRoutines.length === 0) return null;
  return html`
    <section class="sec-card sec-routines">
      <h2 class="sec-h2">${t('secretary.next.routinesTitle')}</h2>
      <ul class="sec-routine-list">
        ${p.activeRoutines.map((r) => {
          const next = p.nextPendingStep(r);
          const last = (r.results && r.results[0]) || null;
          return html`
            <li class="sec-routine-row" key=${r.id}>
              <div class="sec-routine-main">
                <div class="sec-routine-title">${(r.title)}${r.cadence ? html` <span class="sec-cadence-badge">${t('secretary.next.cadence.' + r.cadence)}</span>` : null}</div>
                ${last ? html`<div class="sec-hint">${t('secretary.next.last')}: ${(last.summary)}</div>` : null}
                ${next
                  ? html`<div class="sec-hint">${t('secretary.next.next')}: ${(next.summary)}</div>`
                  : html`<div class="sec-hint">${t('secretary.next.allDone')}</div>`}
              </div>
              ${/* Always offer to open the routine — even with no pending step, so a delegated/waiting routine can be reopened to Check result. */ ''}
              <button class="btn-outline btn-sm" onClick=${() => p.advance(r)}>${t('secretary.next.advance')}</button>
            </li>`;
        })}
      </ul>
    </section>`;
}

/** B3 quick-actions manager (✎): pin/dismiss proposed shortcuts, rename/remove/reorder active ones, suggest more. */
export function quickActionsManager(p) {
  if (!p.managing) return null;
  return html`
    <section class="sec-card sec-qa-manage">
      <div class="sec-card-head">
        <h2 class="sec-h2">${t('secretary.qa.title')}</h2>
        <button class="btn-ghost btn-sm" onClick=${p.toggleManage}>${t('secretary.qa.close')}</button>
      </div>
      <p class="sec-hint">${t('secretary.qa.hint')}</p>

      ${p.proposed.length > 0 ? html`
        <h3 class="sec-h3">${t('secretary.qa.proposedTitle')}</h3>
        <ul class="sec-qa-list">
          ${p.proposed.map((a) => html`
            <li class="sec-qa-row proposed" key=${a.id}>
              <div class="sec-qa-main">
                <span class="sec-qa-label">${(a.label)} <span class="sec-qa-kind">${t('secretary.qa.kind.' + a.kind)}</span></span>
                <div class="sec-hint">${a.kind === 'prompt' ? (a.prompt) : t('secretary.qa.composeTarget') + ': ' + (a.target)}</div>
              </div>
              <button class="btn-primary btn-sm" onClick=${() => p.approve(a)}>${t('secretary.qa.pin')}</button>
              <button class="btn-ghost btn-sm" onClick=${() => p.dismiss(a)}>${t('secretary.qa.dismiss')}</button>
            </li>`)}
        </ul>` : null}

      <h3 class="sec-h3">${t('secretary.qa.activeTitle')}</h3>
      ${p.activeActions.length === 0
        ? html`<div class="sec-hint">${t('secretary.qa.empty')}</div>`
        : html`<ul class="sec-qa-list">
            ${p.activeActions.map((a) => html`
              <li class="sec-qa-row" key=${a.id}>
                <div class="sec-qa-main">
                  ${p.editingId === a.id
                    ? html`<input class="sec-input" value=${p.editLabel} onInput=${(e) => p.setEditLabel(e.target.value)}
                        onKeyDown=${(e) => { if (e.key === 'Enter') p.saveRename(a); if (e.key === 'Escape') p.cancelRename(); }} />`
                    : html`<span class="sec-qa-label">${(a.label)} <span class="sec-qa-kind">${t('secretary.qa.kind.' + a.kind)}</span></span>`}
                </div>
                ${p.editingId === a.id
                  ? html`
                    <button class="btn-primary btn-sm" onClick=${() => p.saveRename(a)}>${t('secretary.qa.save')}</button>
                    <button class="btn-ghost btn-sm" onClick=${p.cancelRename}>${t('secretary.cancel')}</button>`
                  : html`
                    <button class="btn-ghost btn-sm" title=${t('secretary.qa.moveUp')} onClick=${() => p.move(a, -1)}>↑</button>
                    <button class="btn-ghost btn-sm" title=${t('secretary.qa.moveDown')} onClick=${() => p.move(a, 1)}>↓</button>
                    <button class="btn-ghost btn-sm" onClick=${() => p.startRename(a)}>${t('secretary.qa.rename')}</button>
                    <button class="btn-ghost btn-sm" onClick=${() => p.dismiss(a)}>${t('secretary.qa.remove')}</button>`}
              </li>`)}
          </ul>`}

      <div class="sec-actions">
        <button class="btn-outline btn-sm" disabled=${p.suggesting} onClick=${p.suggest}>${p.suggesting ? t('secretary.qa.suggesting') : t('secretary.qa.suggest')}</button>
      </div>
    </section>`;
}

/** Collapsible "Manage & setup" disclosure header — tucks the set-up-once config cards out of the default view. */
export function manageHeader(p) {
  return html`
    <section class="sec-card sec-manage">
      <button class="sec-manage-toggle" onClick=${p.onToggle} aria-expanded=${p.open ? 'true' : 'false'}>
        <span class="sec-manage-title">${t('secretary.dash.manage')}</span>
        <span class="sec-manage-meta">${p.crewSummary ? p.crewSummary + ' · ' : ''}${p.open ? '▾' : '▸'}</span>
      </button>
      ${!p.open ? html`<p class="sec-hint sec-manage-hint">${t('secretary.dash.manageHint')}</p>` : null}
    </section>`;
}

/** Triggers (Slice 3): list the owner's triggers + an add-form for all four kinds; pause/resume/delete.
 *  The tick fires them; this is just management. `goals`/`routines` feed the completion-target picker. */
export function triggersCard(p) {
  const f = p.form;
  const kindLabel = (tr) => {
    if (tr.kind === 'recurring') return `${t('secretary.trig.kind.recurring')} · ${t('secretary.trig.cad.' + (tr.cadence || 'weekly'))}`;
    if (tr.kind === 'time') return `${t('secretary.trig.kind.time')} · ${tr.nextFireAt ? new Date(tr.nextFireAt).toLocaleDateString() : '—'}`;
    if (tr.kind === 'completion') return t('secretary.trig.kind.completion');
    if (tr.kind === 'condition') return `${t('secretary.trig.kind.condition')} · ${t('secretary.trig.ct.' + ((tr.condition && tr.condition.type) || 'memory_count'))}`;
    return tr.kind;
  };
  // What it does when it fires (badge): a bound workflow / specialist, else a plain reminder.
  const actLabel = (tr) => {
    const a = tr.action || {};
    if (a.kind === 'workflow' && a.workflowId) return `▶️ ${a.workflowId}`;
    if (a.kind === 'specialist' && a.specialistName) return `🧩 ${a.specialistName}`;
    return null;
  };
  const workflows = p.workflows || [];
  const specialists = p.specialists || [];
  return html`
    <section class="sec-card sec-triggers">
      <div class="sec-card-head">
        <h2 class="sec-h2">${t('secretary.trig.title')}</h2>
        ${!f ? html`<button class="btn-outline btn-sm" onClick=${p.openForm}>+ ${t('secretary.trig.add')}</button>` : null}
      </div>
      <p class="sec-hint">${t('secretary.trig.hint')}</p>
      ${p.triggers.length === 0 && !f ? html`<div class="sec-hint">${t('secretary.trig.empty')}</div>` : null}
      ${p.triggers.length ? html`<ul class="sec-trig-list">
        ${p.triggers.map((tr) => html`
          <li class="sec-trig-row ${tr.status}" key=${tr.id}>
            <div class="sec-trig-main">
              <div class="sec-trig-label">${tr.label}${actLabel(tr) ? html` <span class="sec-trig-bound">${actLabel(tr)}</span>` : null}</div>
              <div class="sec-hint">${kindLabel(tr)}${tr.status === 'proposed' ? ' · ' + t('secretary.trig.proposedBadge') : tr.status === 'paused' ? ' · ' + t('secretary.trig.paused') : tr.status === 'fired' ? ' · ' + t('secretary.trig.fired') : ''}</div>
            </div>
            <div class="sec-trig-btns">
              ${tr.status === 'proposed'
                ? html`<button class="btn-primary btn-sm" onClick=${() => p.armTrigger(tr)}>${t('secretary.trig.arm')}</button>
                       <button class="btn-ghost btn-sm" onClick=${() => p.removeTrigger(tr)}>${t('secretary.trig.dismiss')}</button>`
                : html`<button class="btn-ghost btn-sm" onClick=${() => p.togglePause(tr)}>${tr.status === 'paused' ? t('secretary.trig.resume') : t('secretary.trig.pause')}</button>
                       <button class="btn-ghost btn-sm" title=${t('secretary.remove')} onClick=${() => p.removeTrigger(tr)}>✕</button>`}
            </div>
          </li>`)}
      </ul>` : null}
      ${f ? html`
        <div class="sec-form sec-trig-form">
          <input class="sec-input" placeholder=${t('secretary.trig.labelPlaceholder')} value=${f.label} onInput=${(e) => p.setField('label', e.target.value)} />
          <select class="sec-input" value=${f.kind} onChange=${(e) => p.setField('kind', e.target.value)}>
            <option value="recurring" selected=${f.kind === 'recurring'}>${t('secretary.trig.kind.recurring')}</option>
            <option value="time" selected=${f.kind === 'time'}>${t('secretary.trig.kind.time')}</option>
            <option value="completion" selected=${f.kind === 'completion'}>${t('secretary.trig.kind.completion')}</option>
            <option value="condition" selected=${f.kind === 'condition'}>${t('secretary.trig.kind.condition')}</option>
          </select>
          ${f.kind === 'recurring' ? html`<select class="sec-input" value=${f.cadence} onChange=${(e) => p.setField('cadence', e.target.value)}>
            <option value="daily" selected=${f.cadence === 'daily'}>${t('secretary.trig.cad.daily')}</option>
            <option value="weekly" selected=${f.cadence === 'weekly'}>${t('secretary.trig.cad.weekly')}</option>
            <option value="monthly" selected=${f.cadence === 'monthly'}>${t('secretary.trig.cad.monthly')}</option></select>` : null}
          ${f.kind === 'time' ? html`<input class="sec-input" type="datetime-local" value=${f.when} onInput=${(e) => p.setField('when', e.target.value)} />` : null}
          ${f.kind === 'completion' ? html`<select class="sec-input" value=${f.targetId} onChange=${(e) => p.setField('targetId', e.target.value)}>
            <option value="" selected=${!f.targetId}>${t('secretary.trig.pickTarget')}</option>
            ${(p.goals || []).filter((g) => g.status !== 'done').map((g) => html`<option value=${g.id} key=${g.id}>${t('secretary.trig.goalOpt')}: ${g.title}</option>`)}
            ${(p.routines || []).filter((r) => r.status === 'active').map((r) => html`<option value=${r.id} key=${r.id}>${t('secretary.trig.routineOpt')}: ${r.title}</option>`)}
          </select>` : null}
          ${f.kind === 'condition' ? html`
            <select class="sec-input" value=${f.condType} onChange=${(e) => p.setField('condType', e.target.value)}>
              <option value="memory_count" selected=${f.condType === 'memory_count'}>${t('secretary.trig.ct.memory_count')}</option>
              <option value="workspace_count" selected=${f.condType === 'workspace_count'}>${t('secretary.trig.ct.workspace_count')}</option>
              <option value="no_activity" selected=${f.condType === 'no_activity'}>${t('secretary.trig.ct.no_activity')}</option>
              <option value="memory_exists" selected=${f.condType === 'memory_exists'}>${t('secretary.trig.ct.memory_exists')}</option>
            </select>
            <input class="sec-input" placeholder=${t('secretary.trig.prefixPlaceholder')} value=${f.condPrefix} onInput=${(e) => p.setField('condPrefix', e.target.value)} />
            ${f.condType === 'no_activity'
              ? html`<input class="sec-input sec-input-sm" type="number" min="1" value=${f.condDays} onInput=${(e) => p.setField('condDays', e.target.value)} title=${t('secretary.trig.days')} />`
              : (f.condType !== 'memory_exists' ? html`<input class="sec-input sec-input-sm" type="number" min="1" value=${f.condValue} onInput=${(e) => p.setField('condValue', e.target.value)} title=${t('secretary.trig.count')} />` : null)}` : null}
          <label class="sec-hint sec-trig-actlabel">${t('secretary.trig.act.label')}</label>
          <select class="sec-input" value=${f.actionKind} onChange=${(e) => p.setField('actionKind', e.target.value)}>
            <option value="remind" selected=${f.actionKind === 'remind'}>${t('secretary.trig.act.remind')}</option>
            ${workflows.length ? html`<option value="workflow" selected=${f.actionKind === 'workflow'}>${t('secretary.trig.act.workflow')}</option>` : null}
            ${specialists.length ? html`<option value="specialist" selected=${f.actionKind === 'specialist'}>${t('secretary.trig.act.specialist')}</option>` : null}
          </select>
          ${f.actionKind === 'workflow' ? html`<select class="sec-input" value=${f.actionWorkflowId} onChange=${(e) => p.setField('actionWorkflowId', e.target.value)}>
            <option value="" selected=${!f.actionWorkflowId}>${t('secretary.trig.act.pickWorkflow')}</option>
            ${workflows.map((w) => html`<option value=${w.id} key=${w.id} selected=${f.actionWorkflowId === w.id}>${w.name || w.id}</option>`)}
          </select>` : null}
          ${f.actionKind === 'specialist' ? html`
            <select class="sec-input" value=${f.actionSpecialistName} onChange=${(e) => p.setField('actionSpecialistName', e.target.value)}>
              <option value="" selected=${!f.actionSpecialistName}>${t('secretary.trig.act.pickSpecialist')}</option>
              ${specialists.map((s) => html`<option value=${s.name} key=${s.name} selected=${f.actionSpecialistName === s.name}>${s.display_name || s.name}</option>`)}
            </select>
            <textarea class="sec-paste" rows="2" placeholder=${t('secretary.trig.act.promptPlaceholder')} value=${f.actionPrompt} onInput=${(e) => p.setField('actionPrompt', e.target.value)}></textarea>` : null}
          <div class="sec-actions">
            <button class="btn-ghost btn-sm" onClick=${p.closeForm}>${t('secretary.cancel')}</button>
            <button class="btn-primary btn-sm" disabled=${p.adding || !f.label.trim()} onClick=${p.createTrigger}>${p.adding ? t('secretary.saving') : t('secretary.trig.create')}</button>
          </div>
        </div>` : null}
    </section>`;
}

/** Phase 3 — "Design a workflow": state outcome → the Secretary composes a chain of agent+offer steps,
 *  proposes how to arm it (manual / schedule / event), and saves it. p = { state, on* handlers }. */
export function workflowDesignPanel(p) {
  const s = p.state;
  if (!s) return null;
  const trig = s.trigger || { kind: 'manual' };
  return html`
    <section class="sec-card sec-stand sec-wf">
      <div class="sec-card-head">
        <h2 class="sec-h2">${t('secretary.wf.title')}</h2>
        <button class="btn-ghost btn-sm" onClick=${p.onDiscard}>${t('secretary.dash.dismiss')}</button>
      </div>
      ${s.saved
        ? html`<div class="sec-hint">✓ ${t('secretary.wf.saved', { id: s.saved })}</div>`
        : s.draft
        ? html`
          ${s.draft.description ? html`<div class="sec-hint">${s.draft.description}</div>` : null}
          <div class="sec-h3">${t('secretary.wf.steps')}</div>
          <ol class="sec-wf-steps">
            ${s.draft.steps.map((st) => html`<li key=${st.id}><strong>${st.agent}</strong> · ${st.offer} — ${st.description}${st.after && st.after.length ? html` <span class="sec-hint">(${t('secretary.wf.after')} ${st.after.join(', ')})</span>` : null}</li>`)}
          </ol>
          <div class="sec-h3">${t('secretary.wf.arming')}</div>
          <select class="sec-band" value=${trig.kind} onChange=${(e) => p.onTrigKind(e.target.value)}>
            <option value="manual" selected=${trig.kind === 'manual'}>${t('secretary.wf.trigManual')}</option>
            <option value="schedule" selected=${trig.kind === 'schedule'}>${t('secretary.wf.trigSchedule')}</option>
            <option value="event" selected=${trig.kind === 'event'}>${t('secretary.wf.trigEvent')}</option>
          </select>
          ${trig.kind === 'schedule' ? html`<input class="sec-input sec-wf-cron" value=${trig.cron || '0 9 * * *'} placeholder="0 18 * * *" onInput=${(e) => p.onCron(e.target.value)} />` : null}
          ${s.errors && s.errors.length ? html`<div class="sec-hint sec-warn">⚠ ${s.errors.join('; ')}</div>` : null}
          <div class="sec-next-action-btns">
            <button class="btn-primary btn-sm" disabled=${s.saving} onClick=${p.onSave}>${s.saving ? t('secretary.saving') : t('secretary.wf.save')}</button>
            <button class="btn-ghost btn-sm" onClick=${p.onRedo}>${t('secretary.wf.redo')}</button>
          </div>`
        : s.designing
        ? html`<div class="sec-hint">${t('secretary.wf.designing')}<span class="sec-spin"></span></div>`
        : s.error === 'needModel'
        ? html`<div class="sec-hint sec-warn">${t('secretary.next.needBigModel')}</div>`
        : s.error === 'noSteps'
        ? html`<div class="sec-hint sec-warn">${t('secretary.wf.noSteps')}${s.title ? `: ${s.title}` : ''}</div>`
        : html`
          <p class="sec-hint">${t('secretary.wf.prompt')}</p>
          <textarea class="sec-paste sec-wf-outcome" placeholder=${t('secretary.wf.placeholder')} value=${s.outcome || ''} onInput=${(e) => p.onOutcome(e.target.value)}></textarea>
          <div class="sec-next-action-btns">
            <button class="btn-primary btn-sm" disabled=${!(s.outcome || '').trim()} onClick=${p.onDesign}>${t('secretary.wf.design')}</button>
          </div>`}
    </section>`;
}

/** Strategy — the optional steering frame: vision · mission · principles · risks · current → target ·
 *  ordered milestones (gates, not tasks). Shows only the filled parts. The owner edits the text/list
 *  fields in one Edit mode, manages milestones inline (status cycle, reorder, remove, add, link goals),
 *  and can Re-plan (AI re-proposes a coherent strategy after a change). Rendered only when enabled. */
export function strategyCard(p) {
  const s = p.strategy || {};
  const ms = s.milestones || [];
  const goals = p.goals || [];
  const focusIdx = ms.findIndex((m) => m.status !== 'reached'); // focus = first not-yet-reached gate
  const statusLabel = (st) => t('secretary.strat.status.' + (st || 'not-started'));
  const e = p.edit;        // text/list edit draft, or null
  const rp = p.replan;     // { note } | { busy } | { draft } | null
  const list = (arr) => (arr || []).filter(Boolean);
  return html`
    <section class="sec-card sec-strategy">
      <div class="sec-card-head">
        <h2 class="sec-h2">${t('secretary.strat.title')}</h2>
        ${!e && !rp ? html`<div class="sec-trig-btns">
          <button class="btn-ghost btn-sm" onClick=${p.onStartReplan}>${t('secretary.strat.replan')}</button>
          <button class="btn-ghost btn-sm" onClick=${p.onStartEdit}>${t('secretary.strat.edit')}</button>
        </div>` : null}
      </div>

      ${rp ? html`
        ${rp.draft ? html`
          <div class="sec-hint">${t('secretary.strat.replanReady')}</div>
          <div class="sec-dir-state">
            <div><span class="sec-dir-lbl">${t('secretary.strat.target')}</span> ${rp.draft.target || '—'}</div>
            <div class="sec-hint">${(rp.draft.milestones || []).map((m) => m.title).join(' → ') || '—'}</div>
          </div>
          <div class="sec-actions">
            <button class="btn-ghost btn-sm" onClick=${p.onCancelReplan}>${t('secretary.cancel')}</button>
            <button class="btn-primary btn-sm" onClick=${p.onApplyReplan}>${t('secretary.strat.replanApply')}</button>
          </div>`
        : html`
          <label class="sec-hint">${t('secretary.strat.replanPrompt')}</label>
          <textarea class="sec-paste" rows="2" value=${rp.note || ''} onInput=${(ev) => p.onReplanNote(ev.target.value)}></textarea>
          <div class="sec-actions">
            <button class="btn-ghost btn-sm" disabled=${rp.busy} onClick=${p.onCancelReplan}>${t('secretary.cancel')}</button>
            <button class="btn-primary btn-sm" disabled=${rp.busy || !(rp.note || '').trim()} onClick=${p.onRunReplan}>${rp.busy ? html`${t('secretary.strat.replanning')}<span class="sec-spin"></span>` : t('secretary.strat.replanRun')}</button>
          </div>`}`
      : e ? html`
        <label class="sec-hint">${t('secretary.strat.vision')}</label>
        <textarea class="sec-paste" rows="2" value=${e.vision} onInput=${(ev) => p.onEditField('vision', ev.target.value)}></textarea>
        <label class="sec-hint">${t('secretary.strat.mission')}</label>
        <textarea class="sec-paste" rows="2" value=${e.mission} onInput=${(ev) => p.onEditField('mission', ev.target.value)}></textarea>
        <label class="sec-hint">${t('secretary.strat.current')}</label>
        <textarea class="sec-paste" rows="2" value=${e.current} onInput=${(ev) => p.onEditField('current', ev.target.value)}></textarea>
        <label class="sec-hint">${t('secretary.strat.target')}</label>
        <textarea class="sec-paste" rows="2" value=${e.target} onInput=${(ev) => p.onEditField('target', ev.target.value)}></textarea>
        <label class="sec-hint">${t('secretary.strat.principles')} ${t('secretary.strat.onePerLine')}</label>
        <textarea class="sec-paste" rows="2" value=${e.principles} onInput=${(ev) => p.onEditField('principles', ev.target.value)}></textarea>
        <label class="sec-hint">${t('secretary.strat.risks')} ${t('secretary.strat.onePerLine')}</label>
        <textarea class="sec-paste" rows="2" value=${e.risks} onInput=${(ev) => p.onEditField('risks', ev.target.value)}></textarea>
        <div class="sec-actions">
          <button class="btn-ghost btn-sm" onClick=${p.onCancelEdit}>${t('secretary.cancel')}</button>
          <button class="btn-primary btn-sm" onClick=${p.onSaveEdit}>${t('secretary.save')}</button>
        </div>`
      : html`
        ${s.vision ? html`<div class="sec-dir-line"><span class="sec-dir-lbl">${t('secretary.strat.vision')}</span> ${s.vision}</div>` : null}
        ${s.mission ? html`<div class="sec-dir-line"><span class="sec-dir-lbl">${t('secretary.strat.mission')}</span> ${s.mission}</div>` : null}
        <div class="sec-dir-state">
          <div class="sec-dir-now"><span class="sec-dir-lbl">${t('secretary.strat.current')}</span> ${s.current ? html`<span>${s.current}</span>` : html`<span class="sec-hint">${t('secretary.strat.empty')}</span>`}</div>
          <div class="sec-dir-arrow">↓</div>
          <div class="sec-dir-goal"><span class="sec-dir-lbl">${t('secretary.strat.target')}</span> ${s.target ? html`<span>${s.target}</span>` : html`<span class="sec-hint">${t('secretary.strat.empty')}</span>`}</div>
        </div>
        ${list(s.principles).length ? html`<div class="sec-dir-line"><span class="sec-dir-lbl">${t('secretary.strat.principles')}</span><ul class="sec-dir-bul">${list(s.principles).map((x, i) => html`<li key=${i}>${x}</li>`)}</ul></div>` : null}
        ${list(s.risks).length ? html`<div class="sec-dir-line"><span class="sec-dir-lbl">${t('secretary.strat.risks')}</span><ul class="sec-dir-bul">${list(s.risks).map((x, i) => html`<li key=${i}>${x}</li>`)}</ul></div>` : null}`}

      ${!e && !rp ? html`
        <div class="sec-h3">${t('secretary.strat.milestones')}</div>
        ${ms.length === 0 ? html`<p class="sec-hint">${t('secretary.strat.noMilestones')}</p>` : html`
          <ol class="sec-dir-ms">
            ${ms.map((m, i) => html`
              <li class=${`sec-dir-ms-row${i === focusIdx ? ' focus' : ''}${m.status === 'reached' ? ' reached' : ''}`} key=${m.id || (m.title + i)}>
                <button class=${`sec-dir-pill sec-dir-${m.status}`} title=${t('secretary.strat.advance')} onClick=${() => p.onCycle(i)}>${statusLabel(m.status)}</button>
                <div class="sec-dir-ms-main">
                  <div class="sec-dir-ms-title">${m.title}${i === focusIdx ? html` <span class="sec-dir-focus">${t('secretary.strat.focus')}</span>` : null}</div>
                  ${m.enables ? html`<div class="sec-hint">${t('secretary.strat.enables')}: ${m.enables}</div>` : null}
                  ${m.criterion ? html`<div class="sec-hint">${t('secretary.strat.criterion')}: ${m.criterion}</div>` : null}
                  ${goals.length ? html`<details class="sec-dir-goals"><summary class="sec-hint">${t('secretary.strat.linkGoals')} (${(m.goalRefs || []).length})</summary>
                    ${goals.map((g) => html`<label class="sec-hint sec-dir-goal-opt" key=${g.id}>
                      <input type="checkbox" checked=${(m.goalRefs || []).includes(g.id)} onChange=${() => p.onToggleGoal(i, g.id)} /> ${g.title}${g.status === 'done' ? ' ✓' : ''}
                    </label>`)}
                  </details>` : null}
                </div>
                <div class="sec-trig-btns">
                  <button class="sec-linkbtn" disabled=${i === 0} title=${t('secretary.layout.up')} onClick=${() => p.onMove(i, -1)}>↑</button>
                  <button class="sec-linkbtn" disabled=${i === ms.length - 1} title=${t('secretary.layout.down')} onClick=${() => p.onMove(i, 1)}>↓</button>
                  <button class="sec-linkbtn sec-next-discard" title=${t('secretary.remove')} onClick=${() => p.onRemove(i)}>✕</button>
                </div>
              </li>`)}
          </ol>`}
        <div class="sec-note-bar">
          <input class="sec-input sec-input-sm" placeholder=${t('secretary.strat.addPlaceholder')} value=${p.msInput || ''}
            onInput=${(ev) => p.onMsInput(ev.target.value)}
            onKeyDown=${(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); p.onAdd(); } }} />
          <button class="btn-outline btn-sm" disabled=${!(p.msInput || '').trim()} onClick=${p.onAdd}>${t('secretary.strat.add')}</button>
        </div>
        <button class="sec-linkbtn sec-dir-off" onClick=${p.onDisable}>${t('secretary.strat.stop')}</button>` : null}
    </section>`;
}

/** "Reset Secretary" — a guarded full wipe (start over). The owner types RESET to confirm; the view's
 *  handler calls POST /v1/secretary/reset and reloads. Lives at the bottom of "Manage & setup". */
export function secretaryDangerCard(p) {
  return html`
    <section class="sec-card sec-danger">
      <h2 class="sec-h2">${t('secretary.reset.title')}</h2>
      <p class="sec-hint">${t('secretary.reset.hint')}</p>
      ${!p.show
        ? html`<button class="btn-danger btn-sm" onClick=${p.onOpen}>${t('secretary.reset.start')}</button>`
        : html`
          <p class="sec-warn">⚠ ${t('secretary.reset.warn')}</p>
          <label class="sec-hint">${t('secretary.reset.confirmLabel')}</label>
          <input class="sec-input" value=${p.text} onInput=${(e) => p.onText(e.target.value)} placeholder="RESET" />
          <div class="sec-actions">
            <button class="btn-ghost btn-sm" disabled=${p.busy} onClick=${p.onCancel}>${t('secretary.cancel')}</button>
            <button class="btn-danger-solid btn-sm" disabled=${p.busy || (p.text || '').trim().toUpperCase() !== 'RESET'} onClick=${p.onConfirm}>${p.busy ? t('secretary.reset.resetting') : t('secretary.reset.confirm')}</button>
          </div>`}
    </section>`;
}
