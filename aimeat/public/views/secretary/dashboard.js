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
        ? html`<div class="sec-hint">${thinking}</div>`
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
        ? html`<div class="sec-hint">${t('secretary.next.thinking')}</div>`
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
                    : a.status === 'prompt' ? null
                    : html`<div class="sec-next-action-btns">
                        <button class="btn-primary btn-sm" disabled=${a.status === 'doing'} onClick=${() => p.onDo(a)}>${a.status === 'doing' ? t('secretary.next.running') : t('secretary.next.doIt')}</button>
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
              <div class="sec-trig-label">${tr.label}</div>
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
          <div class="sec-actions">
            <button class="btn-ghost btn-sm" onClick=${p.closeForm}>${t('secretary.cancel')}</button>
            <button class="btn-primary btn-sm" disabled=${p.adding || !f.label.trim()} onClick=${p.createTrigger}>${p.adding ? t('secretary.saving') : t('secretary.trig.create')}</button>
          </div>
        </div>` : null}
    </section>`;
}
