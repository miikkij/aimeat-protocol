/**
 * @file views/profile/generator-detail.results.js
 * @description Test-scope selector and the full test-report view for the service generator.
 *   Extracted from generator-detail.js to satisfy max-file-lines.
 * @structure
 *   - TestScopeSelector: radio group for test scope level
 *   - TestResultsView: renders full test report with screenshots
 * @usage
 *   import { TestScopeSelector, TestResultsView } from './generator-detail.results.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-detail.js (max-file-lines)
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { screenshotUrl } from '/js/services/generator-testing.js';

/* ── Test Scope & Results ────────────────────────────── */

export function TestScopeSelector({ value, onChange, compact }) {
  return html`<div class="pf-gen-test-scope ${compact ? 'pf-gen-test-scope-compact' : ''}">
    ${!compact && html`<h4>${t('profile.generator.test_scope_title')}</h4>`}
    ${['comprehensive', 'basic', 'none'].map(level => html`
      <label class="pf-gen-or-radio-label" title=${t('profile.generator.test_scope_' + level)}>
        <input type="radio" name="test-scope-${compact ? 'compact' : 'full'}" value=${level}
          checked=${value === level}
          onChange=${() => onChange(level)} />
        ${compact
          ? (level === 'comprehensive' ? '✓ ' + t('profile.generator.test_scope_comprehensive_short')
            : level === 'basic' ? '○ ' + t('profile.generator.test_scope_basic_short')
            : '— ' + t('profile.generator.test_scope_none_short'))
          : t('profile.generator.test_scope_' + level)}
      </label>
    `)}
  </div>`;
}

export function TestResultsView({ report, projectId, onFixRequest }) {
  if (!report) return null;

  const overallKey = report.overall === 'passed' ? 'test_passed'
    : report.overall === 'partial' ? 'test_partial'
    : 'test_failed';

  return html`<div class="pf-gen-test-results">
    <div class="pf-gen-test-overall pf-gen-test-${report.overall}">
      ${t('profile.generator.' + overallKey)}
    </div>
    ${(report.components || []).map(c => html`
      <div class="pf-gen-test-component pf-gen-test-${c.status}">
        <strong>${c.label || c.componentId}</strong>
        <span class="pf-gen-test-badge">${t('profile.generator.test_component_' + c.status)}</span>
        ${c.fixRound > 0 && html`<span class="pf-gen-test-badge">${t('profile.generator.test_fix_round')} ${c.fixRound}</span>`}
        ${c.errors && c.errors.length > 0
          ? html`<span>${c.errors.length} ${t('profile.generator.test_errors_count')}</span>`
          : html`<span>${c.passed}/${c.scenarios}</span>`}
        ${c.errors && c.errors.length > 0 && html`<ul class="pf-gen-test-errors">
          ${c.errors.map(e => html`<li>${e}</li>`)}
        </ul>`}
        ${c.screenshots && c.screenshots.length > 0 && html`<div class="pf-gen-test-screenshots">
          <strong>${t('profile.generator.test_screenshots')}</strong>
          <div class="pf-gen-screenshot-grid">
            ${c.screenshots.map(s => html`
              <img src=${screenshotUrl(projectId, s)} class="pf-gen-screenshot" alt=${s}
                onClick=${() => window.open(screenshotUrl(projectId, s), '_blank')} />
            `)}
          </div>
        </div>`}
        ${c.status === 'failed' && onFixRequest && html`<div class="pf-gen-test-fix-actions">
          <button class="btn-primary" onClick=${() => onFixRequest(c.componentId, 'auto')}>
            ${t('profile.generator.test_fix_auto')}
          </button>
          <button class="btn-outline" onClick=${() => onFixRequest(c.componentId, 'manual')}>
            ${t('profile.generator.test_fix_manual')}
          </button>
          <button class="btn-ghost" onClick=${() => onFixRequest(c.componentId, 'skip')}>
            ${t('profile.generator.test_fix_skip')}
          </button>
        </div>`}
      </div>
    `)}
  </div>`;
}
