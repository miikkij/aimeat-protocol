/**
 * @file secretary/dashboard.js
 * @description Dashboard-first information architecture for the Secretary view (B1). Pure presentational
 *   render functions (props in → htm out, no hooks/state) that frame the Secretary's daily loop:
 *   a core quick-action row, a "Today" status strip (reliability · budget · next scheduled run ·
 *   last-scan + stale flag + refresh), a read-only "where things stand" orientation panel, and the
 *   collapsible "Manage & setup" disclosure header that tucks the set-up-once config cards away.
 *   The view (views/secretary.js) owns all state/handlers and passes them in; the config cards
 *   themselves still live in ./cards.js / ./cards-reach.js. Redesign: docs/internal/2026-06-25-secretary-view-redesign.md.
 * @structure quickActionRow · dashStatus · standPanel · routinesCard · manageHeader (one render function each)
 * @usage import { quickActionRow, dashStatus, standPanel, routinesCard, manageHeader } from '/views/secretary/dashboard.js';
 * @version-history
 *   v0.2.0 — 2026-06-27 — B2: routinesCard — active Routines on the dashboard (status · last result ·
 *     next step · Advance).
 *   v0.1.0 — 2026-06-27 — B1: dashboard-first IA — quick-action row, Today status strip, where-things-stand
 *     panel, Manage disclosure header.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';

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
        <button class="btn-ghost btn-sm" onClick=${p.onRefresh}>↻ ${t('secretary.dash.refresh')}</button>
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
  if (!s || (!s.loading && !s.text)) return null;
  return html`
    <section class="sec-card sec-stand">
      <div class="sec-card-head">
        <h2 class="sec-h2">${t('secretary.dash.standTitle')}</h2>
        ${!s.loading ? html`<button class="btn-ghost btn-sm" onClick=${p.onDismiss}>${t('secretary.dash.dismiss')}</button>` : null}
      </div>
      ${s.loading
        ? html`<div class="sec-hint">${t('secretary.dash.standThinking')}</div>`
        : html`<div class="sec-stand-body">${escHtml(s.text)}</div>`}
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
                <div class="sec-routine-title">${escHtml(r.title)}</div>
                ${last ? html`<div class="sec-hint">${t('secretary.next.last')}: ${escHtml(last.summary)}</div>` : null}
                ${next
                  ? html`<div class="sec-hint">${t('secretary.next.next')}: ${escHtml(next.summary)}</div>`
                  : html`<div class="sec-hint">${t('secretary.next.allDone')}</div>`}
              </div>
              ${next ? html`<button class="btn-outline btn-sm" onClick=${() => p.advance(r)}>${t('secretary.next.advance')}</button>` : null}
            </li>`;
        })}
      </ul>
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
