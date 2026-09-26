/**
 * @file public/views/profile/scheduler/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the scheduler's cover and its pages share: the crumb, the page frame with its
 *   rail, the rail's page links, and the small words (who runs a schedule, how its last run went).
 *   Lives apart from cover.js so the detail page and the cover import one way only.
 * @structure c · hhmm · whoRuns · resultWord · resultTone · resultMark · lastRun · crumb · pageLinks · renderPage
 * @usage import { renderPage, whoRuns, c, hhmm } from './frame.js';
 * @version-history
 *   v1.6.0 -- 2026-09-26 -- The page frame is the SettingsPage (components/SettingsPage.js): the crumb and the rail's page links are data, a run's result is the Status Mark, "never" the faint tint (page group G5: a page writes no class).
 *   v1.5.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.4.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
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
import { SettingsPage } from '/components/SettingsPage.js';
import { Actions } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Tinted } from '/components/Figure.js';
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
/** How a run went, as a Status tone: an error is danger, a skipped run is off, the rest is fine. */
export const resultTone = (r) => (r === 'error' ? 'danger' : r === 'skipped' ? 'off' : 'fine');
/** How a run went, as the Status Mark. */
export const resultMark = (r) => html`<${Mark} kind="status" tone=${resultTone(r)}>${resultWord(r)}<//>`;
/** The figure strip's tone for how a run went: success green, an error coral, a skipped one grey. */
export const resultStripTone = (r) => (r === 'error' ? 'coral' : r === 'skipped' ? 'word dim' : 'word fine');
export function lastRun(s) {
  if (!s.lastRunAt) return html`<${Tinted} tone="faint">${t('profile.scheduler.never')}<//>`;
  return html`${formatRelativeTime(s.lastRunAt)} · ${resultMark(s.lastRunResult || 'success')}`;
}

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
/** The crumb's steps: Settings / Scheduler / the page (every part after the name is ink). */
export function crumb(ctx, parts) {
  const name = t('profile.scheduler.title');
  return [t('nav.profile'), parts.length ? { label: name, onClick: () => ctx.pickView({ kind: 'cover' }) } : name,
    ...parts.map((p) => ({ label: p, here: true }))];
}

const PAGES = [['create', 'newSchedule'], ['paused', 'pausedPage'], ['failed', 'failedPage'], ['calendar', 'calendar']];
/** The rail's page links, as data. */
export function pageLinks(ctx, current) {
  const m = ctx.model;
  const n = { paused: m.paused.length, failed: m.failed.length };
  return PAGES.map(([id, key]) => ({
    key: id, mark: '→', label: id === 'create' ? t('profile.scheduler.newSchedule') : c(key),
    count: id in n ? n[id] : '→', on: current === id, onClick: () => ctx.pickView({ kind: 'page', id }),
  }));
}

/**
 * A page of the scheduler: the crumb, the head with its tags (`marks`, data for the Mark) and its
 * actions (`doors`), the strip, the page's own sections, and the rail (back, `railGroups` of the
 * page's own, the page links).
 */
export function renderPage(ctx, { id, crumbs, title, marks = null, desc = null, doors = null, strip = null, railGroups = [], children }) {
  return html`<${SettingsPage} name="sc" page crumb=${crumb(ctx, crumbs)} title=${title} marks=${marks || undefined} desc=${desc}
    actions=${doors ? html`<${Actions}>${doors}<//>` : null} strip=${strip}
    rail=${{ title: c('railTitle'), groups: [
      { label: t('profile.scheduler.title'), items: [{ back: true, key: 'back', label: c('backTo'), onClick: () => ctx.pickView({ kind: 'cover' }) }] },
      ...railGroups,
      { label: c('pages'), items: pageLinks(ctx, id) },
    ] }}>${children}<//>`;
}
