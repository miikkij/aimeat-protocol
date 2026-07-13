/**
 * @file views/profile/generator-detail.helpers.js
 * @description Workflow-state helper and the guided-workflow step-arrow indicator for the
 *   service generator component detail view. Extracted from generator-detail.js to satisfy
 *   max-file-lines.
 * @structure
 *   - getWorkflowStep: determines a component's current workflow state
 *   - StepArrow: SVG arrow indicator placed next to the current action target
 * @usage
 *   import { getWorkflowStep, StepArrow } from './generator-detail.helpers.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-detail.js (max-file-lines)
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/* ── Workflow Helpers ─────────────────────────────────── */

export function getWorkflowStep(component, validationResult, result) {
  if (component.registeredAs) return 'done';
  if (validationResult?.valid === true) return 'register';
  if (validationResult?.valid === false) return 'fix';
  if ((result || '').trim()) return 'validate';
  if (component.status === 'waiting_user' || component.status === 'prompt_ready') return 'paste';
  return 'copy';
}

/** Small circle-with-arrow SVG placed inline next to the current action target.
 * @param {Object} props
 * @param {'right'|'down'} [props.direction='right'] - arrow direction
 */
export function StepArrow({ direction = 'right' } = {}) {
  const chevron = direction === 'down'
    ? 'M8 10l4 4 4-4'   // ↓ pointing down
    : 'M10 8l4 4-4 4';  // → pointing right
  const cls = `pf-gen-step-arrow${direction === 'down' ? ' pf-gen-step-arrow--down' : ''}`;
  return html`<svg class=${cls} viewBox="0 0 24 24" width="22" height="22">
    <circle cx="12" cy="12" r="10" fill="var(--accent,#E8564A)" opacity="0.15"/>
    <circle cx="12" cy="12" r="10" fill="none" stroke="var(--accent,#E8564A)" stroke-width="1.5"/>
    <path d=${chevron} fill="none" stroke="var(--accent,#E8564A)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
