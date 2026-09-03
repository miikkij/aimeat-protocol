/**
 * @file public/views/profile/calibrator/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the calibrator's views share: the words (x), the four steps of a run in order,
 *   the date, time and duration words, which runs are empty and which are scored, the average of a
 *   run, the checkpoints that did not pass in words, the judge a calibration actually uses (its own
 *   or the AI page's choice), the crumb and the cross-page rail links.
 * @structure x · STEPS · dateWord · timeWord · durationWords · isEmptyRun · runAverage · runsInOrder ·
 *   labelWords · failedWords · stepsDone · judgeOf · candidatesOf · crumb · pageLinks · openTab
 * @usage import { x, STEPS, judgeOf } from './frame.js';
 * @version-history
 *   v1.0.1 — 2026-09-04 — labelWords: a stored label without the maker prefix and the appended price.
 *   v1.0.0 — 2026-09-04 — Initial (design canvas "AIMEAT Kalibraattori-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';

export const x = (key, vars) => t('calpage.' + key, vars);

/** The four steps of a run, in the order they happen. */
export const STEPS = ['generate', 'analyze', 'reflect', 'synthesize'];

const localeTag = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-ES' : 'en-GB');

export function dateWord(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(localeTag(), { day: 'numeric', month: 'numeric', year: 'numeric' });
}

export function timeWord(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' });
}

/** "12 s", "4 min 25 s"; '' for nothing measured. */
export function durationWords(ms) {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (!s) return '';
  if (s < 60) return x('secondsN', { n: s });
  return x('minutesN', { m: Math.floor(s / 60), s: s % 60 });
}

/** A run that was created and never started: no step has run on any model. */
export function isEmptyRun(summary) {
  if (!summary) return false;
  if (summary.status && summary.status !== 'created') return false;
  return !(summary.scores || []).some((s) => s.overallScore != null);
}

/** The mean of the scored models of one run, or null when nothing is scored. */
export function runAverage(summary) {
  const scores = (summary?.scores || []).map((s) => s.overallScore).filter((v) => v != null);
  if (!scores.length) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/**
 * The runs that count, oldest first and numbered from 1, so "run 2" stays "run 2" whatever is
 * created after it; the empty ones are left out and counted separately.
 */
export function runsInOrder(batches) {
  const real = (batches || []).filter((b) => !isEmptyRun(b));
  return real
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((b, i) => ({ ...b, number: i + 1 }));
}

/**
 * A stored model label as a name: without the maker prefix and without the price the old editor
 * appended, so "Mistral: Mistral Small 4 — $0.15/$0.60 /M" reads "Mistral Small 4". The labels
 * on aimeat.io's runs were stored that way and cannot be rewritten.
 */
export function labelWords(label) {
  let s = String(label || '');
  s = s.replace(/\s+[—–-]+\s+\$.*$/, '');
  const i = s.indexOf(': ');
  if (i > 0) s = s.slice(i + 2);
  return s.trim();
}

/** The checkpoints one model did not pass, as words: "formatting, required sections". */
export function failedWords(model) {
  const dims = model?.step2_analysis?.dimensions || [];
  return dims.filter((d) => !d.pass).map((d) => String(d.name || '').replace(/_/g, ' ')).filter(Boolean);
}

/** Which of the four steps a run has finished, from its full record. */
export function stepsDone(batch) {
  const models = batch?.models || [];
  const any = (pick) => models.some((m) => pick(m)?.status === 'done');
  return {
    generate: any((m) => m.step1_generation),
    analyze: any((m) => m.step2_analysis),
    reflect: any((m) => m.step3_reflection),
    synthesize: batch?.step4_synthesis?.status === 'done',
  };
}

/**
 * The judge this calibration uses. A calibration with its own choice keeps it; otherwise the AI
 * page's reasoning model, then its default model, then the server's own default, and the call is
 * made by role so the server resolves the same way.
 */
export function judgeOf(project, settings) {
  const own = project?.reasoningLlm?.modelId;
  if (own) return { modelId: own, label: labelWords(project.reasoningLlm.label) || own, own: true };
  const s = settings || {};
  if (s.reasoningModel) return { modelId: s.reasoningModel, label: s.reasoningModel, own: false, source: 'reasoning' };
  if (s.model) return { modelId: s.model, label: s.model, own: false, source: 'default' };
  return { modelId: '', label: '', own: false, source: 'server' };
}

/** The candidate models that can actually be called: a stored row without a model id is skipped. */
export const candidatesOf = (project) => (project?.candidateModels || []).filter((m) => m && m.modelId);

export function crumb(here) {
  return html`<div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuBuildShare')}</span><span>/</span>${here
    ? html`<span>${t('profile.calibrator.tabLabel')}</span><span>/</span><span class="og-crumb-here">${here}</span>`
    : html`<span class="og-crumb-here">${t('profile.calibrator.tabLabel')}</span>`}</div>`;
}

export const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export function pageLinks() {
  return html`
    <button type="button" class="og-rail-link" onClick=${() => openTab('ai')}><i>→</i>${t('profile.generator.openrouter.title')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('usage')}><i>→</i>${t('profile.tabs.usage')}<em>→</em></button>`;
}
