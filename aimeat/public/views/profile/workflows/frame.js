/**
 * @file public/views/profile/workflows/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Workflows cover, a workflow's page, a run's page and the form share: the
 *   words (a run's status, a step's state, a trigger, a signal as a sentence, what was observed),
 *   the one sentence that says what a run did, the rows of the workflows table, the crumb and the
 *   page frame with its rail. Every machine word (partial, output-red, count_nonempty) is turned
 *   into the reader's language here and nowhere else.
 * @structure c · loc · words (runWord, stepWord, triggerWords, signalWords, observedWords) · toneStatus · verdictOf · workflowRows · crumb · renderPage
 * @usage import { renderPage, verdictOf, signalWords } from './frame.js';
 * @version-history
 *   v1.3.1 -- 2026-09-26 -- A run stopped because its next AI step's estimate did not fit in what was
 *            left of the spending limit says so: the step, the estimate, the spend and the limit.
 *   v1.10.0 -- 2026-09-26 -- The page frame is the SettingsPage (the crumb and the rail's groups and page links as data), the workflows table the List (the last run's word a Tinted word in its tone, main's .wp-m--ok/--bad/--wait), a state the Status Mark (statusMark); the file writes no class (page group G5).
 *   v1.3.0 -- 2026-09-26 -- Words for a run the node stopped at its spending limit and one its trigger
 *            did not start, and the verdict says why in the reader's language: the cap, the spend
 *            and the step, or who saved the workflow and what they lack.
 *   v1.9.0 -- 2026-09-26 -- The workflows table is the Listing (listing, listing-row and its head row, name, words and doors cells; listing--cols keeps the narrow-screen columns), a unification: the look most tabs use.
 *   v1.8.0 -- 2026-09-26 -- The line under a workflow's name is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.7.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.6.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.5.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 -- 2026-09-13 -- Compose existing top rules from poster.css.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Työnkulkujen sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { date as fmtDate, money } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { cronWords } from '../scheduler/cron-words.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { List, Row, Name, Desc, Cell, Doors } from '/components/List.js';
import { Action, Actions } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Tinted } from '/components/Figure.js';

export const c = (key, vars) => t('profile.workflows.cover.' + key, vars);
// The locale() helper here derived the FORMAT from the LANGUAGE. They are different settings:
// /js/format.js reads the reader's own, from their profile, falling back to their browser.
export const day = (iso) => (iso ? fmtDate(iso) : '');
export const rel = (iso) => { if (!iso) return ''; const d = new Date(iso); return Date.now() - d.getTime() > 30 * 864e5 ? day(iso) : formatRelativeTime(iso); };

/** A localized value (string | { en_US, fi_FI, en, fi }) in the reader's language. */
export function loc(s) {
  if (!s) return '';
  if (typeof s === 'string') return s;
  const lang = getLocale();
  return s[lang] || s[`${lang}_${lang.toUpperCase()}`] || s[lang === 'fi' ? 'fi_FI' : lang === 'es' ? 'es_ES' : 'en_US'] || s.en || s.en_US || Object.values(s)[0] || '';
}

/** "3 h 12 min", "48 min", "40 s". */
export function durationWords(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.round(ms / 60000);
  if (min < 1) return c('seconds', { n: Math.max(1, Math.round(ms / 1000)) });
  if (min < 60) return c('minutes', { n: min });
  const h = Math.floor(min / 60), m = min % 60;
  return m ? c('hoursMinutes', { h, m }) : c('hours', { n: h });
}
export const minutesWords = (min) => durationWords(min * 60000);

/* ── the words ─────────────────────────────────────────────────────────────────────────────── */
export const RUN_WORDS = { done: 'run.done', partial: 'run.partial', 'waiting-step': 'run.waiting', running: 'run.running', cancelled: 'run.cancelled', red: 'run.red', stopped: 'run.stopped', refused: 'run.refused' };
export const STEP_WORDS = { green: 'step.green', 'output-red': 'step.outputRed', 'input-red': 'step.inputRed', 'timed-out': 'step.timedOut', 'agent-offline': 'step.offline', skipped: 'step.skipped', 'waiting-human': 'step.waitingHuman', dispatched: 'step.dispatched', pending: 'step.pending' };
export const runWord = (s) => (s ? c(RUN_WORDS[s] || 'run.unknown') : '·');
export const stepWord = (s) => (s ? c(STEP_WORDS[s] || 'step.pending') : '·');
export const runTone = (s) => (s === 'done' ? 'ok' : s === 'partial' || s === 'red' || s === 'stopped' || s === 'refused' ? 'bad' : s === 'waiting-step' || s === 'running' ? 'wait' : '');
export const stepTone = (s) => (s === 'green' ? 'ok' : s === 'output-red' || s === 'input-red' || s === 'timed-out' || s === 'agent-offline' ? 'bad' : s === 'waiting-human' || s === 'dispatched' ? 'wait' : '');
/** A run's or a step's tone as a Status tone: ok is fine, bad is danger, wait needs a look, the rest is off. */
export const toneStatus = (tone) => ({ ok: 'fine', bad: 'danger', wait: 'attention' })[tone] || 'off';
/** A run's or a step's word as the Status Mark in its tone. */
export const statusMark = (tone, word) => html`<${Mark} kind="status" tone=${toneStatus(tone)}>${word}<//>`;
/** A run's word in a table cell, in its tone's colour (the runs' own cut, main's .wp-m--ok/--bad/--wait). */
const TINT = { ok: 'fine', bad: 'notice', wait: 'warn' };
export const runTint = (tone, word) => html`<${Tinted} strong tone=${TINT[tone]}>${word}<//>`;
export const isRed = (s) => s === 'output-red' || s === 'input-red' || s === 'timed-out' || s === 'agent-offline';

/** "every day at 00:17 (Helsinki)", "by hand", "when news.* is written". */
export function triggerWords(trigger) {
  if (!trigger) return '';
  if (trigger.kind === 'schedule') return `${cronWords(trigger.cron)}${trigger.timezone ? ` (${trigger.timezone.split('/').pop()})` : ''}`;
  if (trigger.kind === 'event') return c('trigger.event', { what: trigger.match?.key || trigger.match?.offer || trigger.on });
  if (trigger.kind === 'ecosystem.event') return c('trigger.app', { app: trigger.app });
  return c('trigger.manual');
}

/** A step's kind in words: an agent's offer, a question to you, the owner's model, an extension, an app. */
export function kindWords(step) {
  const k = step?.action?.kind || 'agent';
  return c('kind.' + (k === 'human-input' ? 'human' : k === 'export-out' || k === 'trigger-geai' ? 'app' : k));
}

/** A signal as a sentence: "news.{date}.raw holds at least 12 categories". */
export function signalWords(sig) {
  if (!sig || sig === 'none') return c('sig.none');
  if (sig.all) return sig.all.map(signalWords).join(c('sig.and'));
  if (sig.any) return sig.any.map(signalWords).join(c('sig.or'));
  if (sig.when) return signalWords(sig.then || sig.when);
  if (sig.kind === 'llm') return c('sig.llm', { ask: sig.ask });
  const key = sig.key || sig.key_glob || '';
  const many = !!sig.key_glob;
  switch (sig.op) {
    case 'exists': return c(many ? 'sig.existsMany' : 'sig.exists', { key });
    case 'nonempty': return c(many ? 'sig.nonemptyMany' : 'sig.nonempty', { key });
    case 'json_valid': return c('sig.jsonValid', { key });
    case 'json_schema': return c('sig.jsonSchema', { key });
    case 'count_nonempty': return sig.path ? c('sig.countPath', { key, n: sig.min, path: sig.path }) : c(many ? 'sig.countMany' : 'sig.count', { key, n: sig.min });
    case 'json_field': return sig.equals !== undefined ? c('sig.fieldEquals', { key, path: sig.path, v: String(sig.equals) }) : sig.min !== undefined ? c('sig.fieldMin', { key, path: sig.path, n: sig.min }) : c('sig.fieldNonempty', { key, path: sig.path });
    default: return key;
  }
}

/** What the check observed, in words: "18 categories (12 needed)", "present", "missing". */
export function observedWords(obs) {
  if (!obs || typeof obs !== 'object') return '';
  if (obs.skipped === 'none') return c('obs.noInput');
  if (typeof obs.count === 'number') return c('obs.count', { n: obs.count, min: obs.min ?? 0 });
  if (obs.nonempty === true || obs.exists === true) return c('obs.present');
  if (obs.nonempty === false || obs.exists === false) return c('obs.missing');
  if (typeof obs.ok === 'boolean') return obs.ok ? c('obs.present') : c('obs.missing');
  return '';
}

/** The step's title: its description in the reader's language, else its id. */
export const stepTitle = (step) => (loc(step?.description) || step?.id || '').replace(/[.!]\s*$/, '');
export const stepAgents = (step, resolved) => (resolved?.agents?.length ? resolved.agents : Array.isArray(step?.agent) ? step.agent : step?.agent ? [step.agent] : []);

/** The one sentence that says what a run did, and a second line with the numbers. */
export function verdictOf(run) {
  if (!run) return { tone: '', head: '', sub: '' };
  const def = run.defSnapshot || {};
  const steps = def.steps || [];
  const st = (id) => run.steps?.[id]?.state;
  // A description ends with a period; inside a sentence the name goes without it.
  const name = (id) => (stepTitle(steps.find(s => s.id === id)) || id).replace(/[.!]\s*$/, '');
  const list = (ids) => ids.map(name).join(', ');
  const green = steps.filter(s => st(s.id) === 'green').length;
  const took = run.endedAt ? durationWords(new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()) : '';
  const when = rel(run.startedAt);
  const waitingHuman = steps.find(s => st(s.id) === 'waiting-human');
  if (waitingHuman) {
    const q = run.steps[waitingHuman.id].human?.question;
    return { tone: 'wait', head: c('verdict.waitingYou', { step: name(waitingHuman.id), q: q?.prompt || '' }), sub: c('verdict.waitingYouSub', { n: green, total: steps.length }) };
  }
  if (run.status === 'running' || run.status === 'waiting-step') {
    const busy = steps.filter(s => st(s.id) === 'dispatched').map(s => name(s.id));
    return { tone: 'wait', head: busy.length ? c('verdict.running', { steps: busy.join(', ') }) : c('verdict.starting'), sub: c('verdict.runningSub', { n: green, total: steps.length, when }) };
  }
  // The node ended the run at its spending limit, or its trigger did not start it: said from the
  // numbers and names the run keeps, in the reader's language (the run's own `reason` is English).
  if (run.status === 'stopped') {
    const cap = run.costCap;
    // neededUsd: the next ai step's estimate did not fit in what was left, before the cap was spent.
    const words = cap && { step: name(cap.stoppedBefore), spent: money(cap.spentUsd), cap: money(cap.capUsd), needed: money(cap.neededUsd || 0) };
    const head = !cap ? c('verdict.stoppedPlain') : cap.neededUsd ? c('verdict.stoppedEstimate', words) : c('verdict.stopped', words);
    return { tone: 'bad', head, sub: c('verdict.doneSub', { n: green, total: steps.length, when, took }) };
  }
  if (run.status === 'refused') {
    const r = run.refusal || {};
    const head = r.gone ? c('verdict.refusedGone', { saver: r.saverName || '' }) : c('verdict.refused', { saver: r.saverName || '', words: (r.missing || []).join(', ') });
    return { tone: 'bad', head, sub: c('verdict.refusedSub', { last: rel(r.lastAttemptAt || run.startedAt), when }) };
  }
  if (run.status === 'cancelled') return { tone: '', head: c('verdict.cancelled'), sub: c('verdict.doneSub', { n: green, total: steps.length, when, took }) };
  if (run.status === 'done') return { tone: 'ok', head: c('verdict.done', { total: steps.length }), sub: c('verdict.doneSub', { n: green, total: steps.length, when, took }) };
  const outRed = steps.filter(s => st(s.id) === 'output-red').map(s => s.id);
  const inRed = steps.filter(s => st(s.id) === 'input-red' || st(s.id) === 'skipped').map(s => s.id);
  const other = steps.filter(s => st(s.id) === 'timed-out' || st(s.id) === 'agent-offline').map(s => s.id);
  const parts = [];
  if (outRed.length) parts.push(c('verdict.notProduced', { steps: list(outRed) }));
  if (other.length) parts.push(c('verdict.timedOut', { steps: list(other) }));
  if (inRed.length) parts.push(c('verdict.noInput', { steps: list(inRed) }));
  return { tone: 'bad', head: c('verdict.partial', { why: parts.join('; ') || c('verdict.partialPlain') }), sub: c('verdict.doneSub', { n: green, total: steps.length, when, took }) };
}

/** One workflow's row on the cover: what the last run did, in words, from the health and the last run. */
export function lastRunWords(item) {
  const run = item.lastRun;
  if (!run) return { tone: '', word: c('noRunsYet'), sub: '' };
  const v = verdictOf(run);
  return { tone: v.tone, word: runWord(run.status), sub: `${rel(run.startedAt)}: ${v.head}` };
}

/** Rows of the workflows table: name and its line, when it runs, the last run's word, what happened, the doors. */
export function workflowRows(ctx, items, { head = false } = {}) {
  return html`<${List} cols="name-trigger-state-words-doors" keepCols
    head=${head ? [c('colWorkflow'), c('colTrigger'), c('colLast'), c('colWhat'), ''] : null}>
    ${items.map(item => { const def = item.def; const w = lastRunWords(item); const agents = new Set(def.steps.flatMap(s => Array.isArray(s.agent) ? s.agent : s.agent ? [s.agent] : [])); const gates = def.steps.filter(s => s.action?.kind === 'human-input').length; return html`
      <${Row} key=${def.id}>
        <${Name} onOpen=${() => ctx.pickView({ kind: 'detail', id: def.id })}
          meta=${[c('stepsN', { n: def.steps.length }), agents.size ? c('agentsN', { n: agents.size }) : '', gates ? c('gatesN', { n: gates }) : ''].filter(Boolean).join(' · ')}>${loc(def.title) || def.id}<//>
        <${Desc}>${triggerWords(def.trigger)}<//>
        <${Cell} meta>${runTint(w.tone, w.word)}<//>
        <${Desc}>${w.sub}<//>
        <${Doors}>
          <${Action} small row soft onClick=${() => ctx.handleCheck(def.id)}>${c('checkNow')}<//>
          <${Action} small row onClick=${() => ctx.pickView({ kind: 'detail', id: def.id })}>${item.waiting ? c('answer') : c('open')}<//>
        <//>
      <//>`; })}
  <//>`;
}

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
/**
 * The crumb's steps: Settings / Workflows / the parts. A part is words (the page you are on, in
 * ink) or { label, onClick } (a way back to the workflow).
 */
export function crumb(ctx, parts) {
  const name = t('profile.workflows.title');
  return [t('nav.profile'), parts.length ? { label: name, onClick: () => ctx.pickView({ kind: 'cover' }) } : name,
    ...parts.map((p) => (typeof p === 'string' ? { label: p, here: true } : p))];
}

/** The rail's sibling pages, as data (each opens its Settings tab). */
export function pageLinks() {
  return [
    { tab: 'scheduler', label: t('profile.tabs.scheduler') },
    { tab: 'agents', label: t('profile.tabs.agents') },
    { tab: 'offers', label: t('profile.tabs.offers') },
  ];
}

/**
 * A page of Workflows: the crumb, the head (`label` over the title, `marks` as Mark data, `doors`),
 * the strip, the page's own sections, and the rail: the way back (`back`: { label, onClick }), the
 * page's own groups (`railGroups`), the sibling pages.
 */
export function renderPage(ctx, { crumbs, label = null, title, marks = null, desc = null, doors = null, strip = null, railGroups = [], back = null, children }) {
  return html`<${SettingsPage} name="wp" page crumb=${crumb(ctx, crumbs)} label=${label} title=${title} marks=${marks || undefined} desc=${desc}
    actions=${doors ? html`<${Actions}>${doors}<//>` : null} strip=${strip}
    rail=${{ title: c('railTitle'), groups: [
      { label: t('profile.workflows.title'), items: [{ back: true, key: 'back', ...(back || { label: c('backTo'), onClick: () => ctx.pickView({ kind: 'cover' }) }) }] },
      ...railGroups,
      { label: c('pages'), items: pageLinks().map((p) => ({ mark: '→', count: '→', ...p })) },
    ] }}>${children}<//>`;
}
