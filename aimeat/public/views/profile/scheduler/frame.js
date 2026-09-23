/**
 * @file public/views/profile/scheduler/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the scheduler's cover and its pages share: the crumb, the page frame with its
 *   rail, the rail's page links, and the small words (who runs a schedule, how its last run went).
 *   Lives apart from cover.js so the detail page and the cover import one way only.
 * @structure c · hhmm · whoRuns · resultWord · resultTone · lastRun · crumb · chipRow · railList · pageLinks · renderPage
 * @usage import { renderPage, whoRuns, c, hhmm } from './frame.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared component set (Page, Rail, Chip, Stack, Action, Text); no
 *     own CSS. A run's result carries a tone instead of a class; the words are unchanged.
 *   v1.3.0 -- 2026-09-13 -- Compose existing top rules from poster.css.
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 — 2026-09-12 — `loc()` is gone: it derived the date FORMAT from the page LANGUAGE, which
 *     is a separate setting, and /js/format.js reads the reader's own. `hhmm` reads their clock too
 *     rather than the browser's, which matters most here, where the clock IS the content.
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { time } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { Page, Rail, Stack, Action, Chip, Text } from '/components/poster-parts.js';
import { kindOf } from './model.js';

export const c = (key, vars) => t('profile.scheduler.cover.' + key, vars);

/**
 * A fire time on the reader's own clock.
 *
 * It used to be `getHours()`/`getMinutes()` padded by hand, which is the BROWSER's clock and a
 * 24-hour face for everybody. A schedule is the one page where the clock is the whole content, so
 * a reader who keeps a different zone was being shown the wrong hour for their own jobs.
 */
export const hhmm = (d) => time(d, { hour: '2-digit', minute: '2-digit' });

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
/** A run result as a tone: success, error, or anything else (skipped, limited) muted. */
export const resultTone = (r) => (r === 'error' ? 'danger' : r === 'success' || !r ? 'success' : 'muted');
/** The last run in words: when, and how it went. */
export function lastRun(s) {
  if (!s.lastRunAt) return t('profile.scheduler.never');
  return `${formatRelativeTime(s.lastRunAt)} · ${resultWord(s.lastRunResult || 'success')}`;
}

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
/** The trail: Settings & Controls, Automation, Scheduler, then the page's own name. */
export function crumb(ctx, parts) {
  return [
    { label: t('nav.profile') },
    { label: t('profile.landing.menuAutomation') },
    { label: t('profile.scheduler.title'), onClick: parts.length ? () => ctx.pickView({ kind: 'cover' }) : undefined },
    ...parts.map(p => ({ label: p })),
  ];
}

/** A row of chips: [text, tone] pairs, a falsy entry skipped. */
export const chipRow = (chips) => html`<${Stack} direction="wrap" density="compact">
  ${chips.filter(Boolean).map(([text, tone], i) => html`<${Chip} key=${i} tone=${tone}>${text}<//>`)}<//>`;

/** A short list for the rail: a label and one action per entry (a plain line when it goes nowhere). */
export const railList = (label, entries) => html`<${Stack} density="compact">
  <${Text} kind="label">${label}<//>
  ${entries.map(e => (e.onClick ? html`<${Action} key=${e.key} kind="text" onClick=${e.onClick}>${e.label}<//>`
    : html`<${Text} key=${e.key} kind="mono">${e.label}<//>`))}
<//>`;

const PAGES = [['create', 'newSchedule'], ['paused', 'pausedPage'], ['failed', 'failedPage'], ['calendar', 'calendar']];
export function pageLinks(ctx, current) {
  const m = ctx.model;
  const n = { paused: m.paused.length, failed: m.failed.length };
  return html`<${Stack} density="compact">
    <${Text} kind="label">${c('pages')}<//>
    ${PAGES.map(([id, key]) => html`<${Action} key=${id} kind=${current === id ? "tab" : "text"} selected=${current === id} onClick=${() => ctx.pickView({ kind: 'page', id })}>
      ${id === 'create' ? t('profile.scheduler.newSchedule') : c(key)} ${id in n ? n[id] : '→'}<//>`)}
  <//>`;
}

export function renderPage(ctx, { id, crumbs, title, chips = null, doors = null, strip = null, rail = null, children }) {
  return html`<${Page} width="wide" title=${title} crumbs=${crumb(ctx, crumbs)} identity=${chips} actions=${doors}
    rail=${html`<${Rail} kind="index" title=${t('profile.scheduler.title')} label=${c('railTitle')}><${Stack}>
      <${Action} onClick=${() => ctx.pickView({ kind: 'cover' })}>← ${c('backTo')}<//>
      ${rail}
      ${pageLinks(ctx, id)}
    <//><//>`}>
    <${Stack}>${strip}${children}<//>
  <//>`;
}
