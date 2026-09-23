/**
 * @file public/views/profile/workflows/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Workflows cover, a workflow's page, a run's page and the form share: the
 *   words (a run's status, a step's state, a trigger, a signal as a sentence, what was observed),
 *   the one sentence that says what a run did, the rows of the workflows table, the crumb and the
 *   page frame with its rail. Every machine word (partial, output-red, count_nonempty) is turned
 *   into the reader's language here and nowhere else.
 * @structure c · loc · words (runWord, stepWord, triggerWords, signalWords, observedWords) · verdictOf · toneOf · chipTone · workflowRows · crumb · chipRow · pageLinks · renderPage · verdictBlock · railList
 * @usage import { renderPage, verdictOf, signalWords } from './frame.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared component set (Page, Rail, Table, Surface, Chip); no own
 *     CSS. A tone is a named Text, Chip or Surface tone; the verdict is one shared block.
 *   v1.2.0 -- 2026-09-13 -- Compose existing top rules from poster.css.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Työnkulkujen sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { cronWords } from '../scheduler/cron-words.js';
import { Page, Rail, Stack, Table, Surface, Action, Chip, Text } from '/components/poster-parts.js';

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
export const RUN_WORDS = { done: 'run.done', partial: 'run.partial', 'waiting-step': 'run.waiting', running: 'run.running', cancelled: 'run.cancelled', red: 'run.red' };
export const STEP_WORDS = { green: 'step.green', 'output-red': 'step.outputRed', 'input-red': 'step.inputRed', 'timed-out': 'step.timedOut', 'agent-offline': 'step.offline', skipped: 'step.skipped', 'waiting-human': 'step.waitingHuman', dispatched: 'step.dispatched', pending: 'step.pending' };
export const runWord = (s) => (s ? c(RUN_WORDS[s] || 'run.unknown') : '·');
export const stepWord = (s) => (s ? c(STEP_WORDS[s] || 'step.pending') : '·');
export const runTone = (s) => (s === 'done' ? 'ok' : s === 'partial' || s === 'red' ? 'bad' : s === 'waiting-step' || s === 'running' ? 'wait' : '');
export const stepTone = (s) => (s === 'green' ? 'ok' : s === 'output-red' || s === 'input-red' || s === 'timed-out' || s === 'agent-offline' ? 'bad' : s === 'waiting-human' || s === 'dispatched' ? 'wait' : '');
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

/** A tone word ('ok' | 'bad' | 'wait' | '') as a Text tone. */
export const toneOf = (tone) => (tone === 'ok' ? 'success' : tone === 'bad' ? 'danger' : tone === 'wait' ? 'coral' : 'plain');
/** The same tone as a Chip tone: a bad or waiting state is the one to see. */
export const chipTone = (tone) => (tone === 'bad' || tone === 'wait' ? 'sun' : 'plain');

/** The workflows table: name and its line, when it runs, the last run's word, what happened, the doors. */
export function workflowRows(ctx, items) {
  return html`<${Table} density="compact" label=${t('profile.workflows.title')}
    headers=${[c('colWorkflow'), c('colTrigger'), c('colLast'), c('colWhat'), '']}
    rows=${items.map(item => {
      const def = item.def;
      const w = lastRunWords(item);
      const agents = new Set(def.steps.flatMap(s => Array.isArray(s.agent) ? s.agent : s.agent ? [s.agent] : []));
      const gates = def.steps.filter(s => s.action?.kind === 'human-input').length;
      return [
        html`<${Stack} density="compact">
          <${Action} kind="text" onClick=${() => ctx.pickView({ kind: 'detail', id: def.id })}>${loc(def.title) || def.id}<//>
          <${Text} kind="caption" tone="muted">${[c('stepsN', { n: def.steps.length }), agents.size ? c('agentsN', { n: agents.size }) : '', gates ? c('gatesN', { n: gates }) : ''].filter(Boolean).join(' · ')}<//>
        <//>`,
        triggerWords(def.trigger),
        html`<${Text} kind="label" tone=${toneOf(w.tone)}>${w.word}<//>`,
        html`<${Text} kind="caption" tone="muted">${w.sub}<//>`,
        html`<${Stack} direction="wrap" density="compact">
          <${Action} onClick=${() => ctx.handleCheck(def.id)}>${c('checkNow')}<//>
          <${Action} onClick=${() => ctx.pickView({ kind: 'detail', id: def.id })}>${item.waiting ? c('answer') : c('open')}<//>
        <//>`,
      ];
    })} />`;
}

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
/** The trail: Settings & Controls, Automation, Workflows, then the parts ({ label, go } or a string). */
export function crumb(ctx, parts) {
  return [
    { label: t('nav.profile') },
    { label: t('profile.landing.menuAutomation') },
    { label: t('profile.workflows.title'), onClick: parts.length ? () => ctx.pickView({ kind: 'cover' }) : undefined },
    ...parts.map((p, i) => (typeof p === 'string' ? { label: p } : { label: p.label, onClick: i < parts.length - 1 ? p.go : undefined })),
  ];
}

/** A row of chips: [text, tone] pairs, a falsy entry skipped. */
export const chipRow = (chips) => html`<${Stack} direction="wrap" density="compact">
  ${chips.filter(Boolean).map(([text, tone], i) => html`<${Chip} key=${i} tone=${tone}>${text}<//>`)}<//>`;

const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export function pageLinks() {
  return html`<${Stack} density="compact">
    <${Text} kind="label">${c('pages')}<//>
    <${Action} kind="text" onClick=${() => openTab('scheduler')}>${t('profile.tabs.scheduler')} →<//>
    <${Action} kind="text" onClick=${() => openTab('agents')}>${t('profile.tabs.agents')} →<//>
    <${Action} kind="text" onClick=${() => openTab('offers')}>${t('profile.tabs.offers')} →<//>
  <//>`;
}

/** A page under the Workflows crumb. `back` replaces the rail's door back to the cover. */
export function renderPage(ctx, { crumbs, label = null, title, chips = null, doors = null, strip = null, rail = null, back = null, children }) {
  return html`<${Page} width="wide" title=${title} crumbs=${crumb(ctx, crumbs)}
    identity=${label || chips ? html`<${Stack} density="compact">${label ? html`<${Text} kind="label">${label}<//>` : null}${chips}<//>` : null}
    actions=${doors}
    rail=${html`<${Rail} kind="index" title=${t('profile.workflows.title')} label=${c('railTitle')}><${Stack}>
      ${back || html`<${Action} onClick=${() => ctx.pickView({ kind: 'cover' })}>← ${c('backTo')}<//>`}
      ${rail}
      ${pageLinks()}
    <//><//>`}>
    <${Stack}>${strip}${children}<//>
  <//>`;
}

/** The verdict of a run as one sentence and a line of numbers, in the run's tone. */
export const verdictBlock = (v, actions = null) => html`<${Surface} kind="box" tone=${v.tone === 'bad' ? 'danger' : v.tone === 'ok' ? 'success' : v.tone === 'wait' ? 'sun' : 'plain'}>
  <${Stack} density="compact">
    <${Text} kind="heading">${v.head}<//>
    <${Text} kind="mono" tone="muted">${v.sub}<//>
    ${actions ? html`<${Stack} direction="horizontal" align="start">${actions}<//>` : null}
  <//>
<//>`;

/** A short list for the rail: a label and one line per entry. */
export const railList = (label, entries) => html`<${Stack} density="compact">
  <${Text} kind="label">${label}<//>
  ${entries.map(e => html`<${Text} key=${e.key} kind="mono" tone=${e.tone}>${e.label}<//>`)}
<//>`;
