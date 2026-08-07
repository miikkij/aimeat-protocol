/**
 * @file views/profile/calibrator-batch.helpers.js
 * @description Pure helpers, the OpenRouter model-call wrapper, pending-state constants and small
 *   reusable presentational components for the Prompt Calibrator V2 batch card. Extracted from
 *   calibrator-batch.js to satisfy max-file-lines.
 * @structure
 *   - computeWeightedScore: weighted pass/fail score (critical=3, major=2, minor=1)
 *   - callModel: POST a prompt to /v1/openrouter/complete with retries + 30-min timeout
 *   - extractJson: best-effort JSON extraction from LLM text
 *   - scoreClass / formatDuration: small formatting helpers
 *   - PENDING_ANALYSIS / PENDING_REFLECTION / PENDING_SYNTHESIS: pending step-state seeds
 *   - PasteBack: reusable paste-back textarea component
 *   - CollapsiblePre: collapsible <pre> block
 * @usage
 *   import { callModel, extractJson, computeWeightedScore, scoreClass, formatDuration,
 *     PENDING_ANALYSIS, PENDING_REFLECTION, PENDING_SYNTHESIS, PasteBack, CollapsiblePre } from './calibrator-batch.helpers.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from calibrator-batch.js (max-file-lines)
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { authHeaders } from '/js/services/auth.js';

/** Weighted score: critical=3, major=2, minor=1. Returns 0-100 or null. */
export function computeWeightedScore(dims) {
  if (!dims || dims.length === 0) return null;
  const weights = { critical: 3, major: 2, minor: 1 };
  let totalWeight = 0, passedWeight = 0;
  for (const d of dims) {
    const w = weights[d.severity] || 1;
    totalWeight += w;
    if (d.pass) passedWeight += w;
  }
  return totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : null;
}


// ── Helpers ──

export async function callModel(projectId, prompt, modelId, { retries = 1, temperature, top_p, max_tokens } = /** @type {{ retries?: number, temperature?: number, top_p?: number, max_tokens?: number }} */ ({})) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1_800_000); // 30 min
    const headers = { 'Content-Type': 'application/json', ...authHeaders() };
    try {
      const body = { projectId, prompt, model: modelId };
      if (temperature !== undefined) body.temperature = temperature;
      if (top_p !== undefined) body.top_p = top_p;
      if (max_tokens !== undefined) body.max_tokens = max_tokens;
      const raw = await fetch('/v1/openrouter/complete', {
        method: 'POST', headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!raw.ok) {
        let msg = `HTTP ${raw.status}`;
        try { const e = await raw.json(); msg = e.error?.message || msg; } catch (err) { swallowed('calibrator-batch.helpers: callModel', err); }
        // Retry on 502/503/429
        if (attempt < retries && (raw.status === 502 || raw.status === 503 || raw.status === 429)) {
          console.warn(`callModel retry ${attempt + 1}/${retries}: ${msg}`);
          await new Promise(r => setTimeout(r, 3000)); // wait 3s before retry
          continue;
        }
        throw new Error(msg);
      }
      const resp = await raw.json();
      if (resp.ok === false) throw new Error(resp.error?.message || 'OpenRouter error');
      const content = resp.data?.content || '';
      // Empty response = model didn't run properly. Retry if possible.
      if (!content && attempt < retries) {
        console.warn(`callModel retry ${attempt + 1}/${retries}: empty response from ${modelId}`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      if (!content) {
        throw new Error(`Model returned empty response (${modelId}). This usually means OpenRouter failed to route the request. Try again.`);
      }
      return content;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Request timed out (30 min)', { cause: e });
      // Retry on network errors
      if (attempt < retries && e.name === 'TypeError') {
        console.warn(`callModel retry ${attempt + 1}/${retries}: network error`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      throw e;
    } finally { clearTimeout(timeoutId); }
  }
}

export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }   // eslint-disable-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
}

export function scoreClass(score) {
  if (score == null) return '';
  if (score >= 80) return 'pass';
  if (score >= 50) return 'mixed';
  return 'fail';
}

export function formatDuration(ms) {
  if (!ms) return '';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

export const PENDING_ANALYSIS = { status: 'pending', dimensions: [], overallScore: null, analysis: null, error: null, promptSent: null, rawResponse: null };
export const PENDING_REFLECTION = { status: 'pending', judgeProposals: null, selfProposals: null, error: null };
export const PENDING_SYNTHESIS = { status: 'pending', groupedProposals: [], options: null, recommendation: null, analysis: null, error: null, promptSent: null, rawResponse: null };


// ── PasteBack Component ──

export function PasteBack({ label, onSave }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  if (!open) return html`<button class="btn-ghost btn-sm" onClick=${() => setOpen(true)}>${label}</button>`;
  return html`
    <div class="fnd-cal-paste">
      <textarea value=${text} onInput=${e => setText(e.target.value)}
        placeholder="Paste JSON response here..." />
      <div class="fnd-cal-paste-actions">
        <button class="btn-primary btn-sm" onClick=${() => { onSave(text); setOpen(false); setText(''); }}
          disabled=${!text.trim()}>${t('profile.calibrator.save')}</button>
        <button class="btn-ghost btn-sm" onClick=${() => { setOpen(false); setText(''); }}>${t('profile.calibrator.back')}</button>
      </div>
    </div>
  `;
}


// ── Collapsible Pre Block ──

export function CollapsiblePre({ label, text }) {
  if (!text) return null;
  return html`
    <details class="fnd-cal-collapsible">
      <summary>${label}</summary>
      <div class="fnd-cal-run-detail">
        <pre>${text}</pre>
      </div>
    </details>
  `;
}
