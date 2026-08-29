/**
 * @file public/views/profile/scheduler/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the scheduler's cover and its pages share: the crumb, the page frame with its
 *   rail, the rail's page links, and the small words (who runs a schedule, how its last run went).
 *   Lives apart from cover.js so the detail page and the cover import one way only.
 * @structure c · loc · hhmm · whoRuns · resultWord · lastRun · crumb · pageLinks · renderPage
 * @usage import { renderPage, whoRuns, c, loc } from './frame.js';
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { kindOf } from './model.js';

export const c = (key, vars) => t('profile.scheduler.cover.' + key, vars);
export const loc = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-CO' : 'en-GB');
const two = (n) => String(n).padStart(2, '0');
export const hhmm = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`;

/** "AI, with your key" · "agent claude-desktop" · "extension pulse": who does the work. */
export function whoRuns(s) {
  const k = kindOf(s);
  if (k === 'agent') return c('whoAgent', { a: s.agentName || '' });
  if (k === 'ext') return c('whoExt', { e: s.extensionName || '' });
  if (k === 'ai') return c('whoAi');
  if (k === 'eco') return t('profile.scheduler.kind.eco-capability');
  if (k === 'workflow') return c('whoWorkflow');
  if (k === 'publish') return c('whoPublish');
  if (k === 'secretary') return t('profile.scheduler.kind.secretary');
  return t('profile.scheduler.kind.core');
}
export const resultWord = (r) => (r ? c('result.' + r) : '');
export function lastRun(s) {
  if (!s.lastRunAt) return html`<span class="og-tbl-dot">${t('profile.scheduler.never')}</span>`;
  return html`${formatRelativeTime(s.lastRunAt)} · <b class=${`sc-res sc-res--${s.lastRunResult || 'success'}`}>${resultWord(s.lastRunResult || 'success')}</b>`;
}

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
export function crumb(ctx, parts) {
  const home = () => ctx.pickView({ kind: 'cover' });
  return html`
    <div class="og-crumb">
      <span>${t('nav.profile')}</span><span>/</span>
      ${parts.length ? html`<button type="button" class="og-crumb-link" onClick=${home}>${t('profile.scheduler.title')}</button>` : html`<span class="og-crumb-here">${t('profile.scheduler.title')}</span>`}
      ${parts.map((p, i) => html`<span key=${i}>/</span><span class="og-crumb-here">${p}</span>`)}
    </div>`;
}

const PAGES = [['create', 'newSchedule'], ['paused', 'pausedPage'], ['failed', 'failedPage'], ['calendar', 'calendar']];
export function pageLinks(ctx, current) {
  const m = ctx.model;
  const n = { paused: m.paused.length, failed: m.failed.length };
  return PAGES.map(([id, key]) => html`
    <button type="button" class=${`og-rail-link ${current === id ? 'on' : ''}`} key=${id} onClick=${() => ctx.pickView({ kind: 'page', id })}>
      <i>→</i>${id === 'create' ? t('profile.scheduler.newSchedule') : c(key)}<em>${id in n ? n[id] : '→'}</em>
    </button>`);
}

export function renderPage(ctx, { id, crumbs, title, chips = null, doors = null, strip = null, rail = null, children }) {
  return html`
    <div class="og og-sc og-page">
      ${crumb(ctx, crumbs)}
      <div class="og-mast og-mast--page">
        <div class="og-mast-words">
          <h1 class="og-title sc-title--page">${title}</h1>
          ${chips ? html`<div class="og-chips">${chips}</div>` : null}
        </div>
        ${doors ? html`<div class="og-mast-actions"><div class="og-doors">${doors}</div></div>` : null}
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">${children}</div>
        <div class="sc-side">
          <nav class="og-rail" aria-label=${c('railTitle')}>
            <span class="og-rail-label">${t('profile.scheduler.title')}</span>
            <button type="button" class="og-rail-link" onClick=${() => ctx.pickView({ kind: 'cover' })}><i>←</i>${c('backTo')}</button>
            ${rail}
            <hr />
            <span class="og-rail-label">${c('pages')}</span>
            ${pageLinks(ctx, id)}
          </nav>
        </div>
      </div>
    </div>`;
}
