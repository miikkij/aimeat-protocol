/**
 * @file bundle.ts
 * @description Creates structured context bundles from registered + probed components.
 *   Bundles capture what a component ACTUALLY exports and returns (from probes).
 * @version-history
 *   v1.0.0 — 2026-04-01 — Ported from public/js/services/generator-context-bundle.js
 */

import type { ComponentState, ComponentBundle, ProbeResult } from './types.js';

/**
 * Create a structured context bundle from a component's state after registration + probe.
 */
export function createBundle(component: ComponentState, probeResults: ProbeResult[]): ComponentBundle {
  const bundle: ComponentBundle = {
    name: component.registeredAs || component.label,
    type: component.type,
    subtype: component.subtype || null,
    registeredAs: component.registeredAs ?? undefined,
  };

  if (component.spec) {
    bundle.spec = component.spec;
  }

  if (component.type === 'extension') {
    const actionIds: string[] = [];
    const actionRegex = /- id:\s*["']?(\S+?)["']?\s*$/gm;
    let match;
    while ((match = actionRegex.exec(component.result || '')) !== null) {
      actionIds.push(match[1]);
    }
    bundle.actions = actionIds;
    bundle.probeResults = (probeResults || []).map(p => ({
      action: p.action, input: p.input, status: p.status, response: p.response,
    }));
  }

  if (component.type === 'cortex') {
    const exportsMatch = (component.result || '').match(/(?:const|var)\s+exports\s*=\s*\{([\s\S]*?)\}/);
    if (exportsMatch) {
      bundle.exports = exportsMatch[1].split(',').map(m => m.trim().split(':')[0].trim()).filter(Boolean);
    }
    const libMatch = (component.result || '').match(/const\s+LIB_NAME\s*=\s*['"]([^'"]+)['"]/);
    if (libMatch) bundle.libName = libMatch[1];
    bundle.probeResults = (probeResults || []).map(p => ({
      method: p.action, input: p.input, response: p.response,
    }));
  }

  if (component.type === 'translation') {
    try {
      const raw = component.result || '';
      const fenceMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)```/);
      const json = JSON.parse(fenceMatch ? fenceMatch[1] : raw) as Record<string, Record<string, string>>;
      const locale = Object.keys(json)[0];
      if (locale && json[locale]) {
        bundle.locale = locale;
        bundle.keys = Object.keys(json[locale]).sort();
      }
    } catch { /* skip */ }
  }

  return bundle;
}

/** Format a single bundle as text for prompt injection */
export function formatBundleForPrompt(bundle: ComponentBundle): string {
  const lines: string[] = [];
  lines.push(`## ${bundle.name} (${bundle.type}${bundle.subtype ? ':' + bundle.subtype : ''})`);
  lines.push(`Registered as: ${bundle.registeredAs}`);
  if (bundle.actions) lines.push(`Actions: ${bundle.actions.join(', ')}`);
  if (bundle.exports) lines.push(`Exports: ${bundle.exports.join(', ')}`);
  if (bundle.libName) lines.push(`Access via: AIMEAT.${bundle.libName}`);
  if (bundle.keys) {
    lines.push(`Translation keys (${bundle.locale}): ${bundle.keys.length} keys`);
    lines.push(`Keys: ${bundle.keys.slice(0, 20).join(', ')}${bundle.keys.length > 20 ? '...' : ''}`);
  }
  if (bundle.probeResults && bundle.probeResults.length > 0) {
    lines.push('');
    lines.push('### Actual responses (from live probe):');
    for (const p of bundle.probeResults) {
      const label = p.action || p.method || '?';
      const input = JSON.stringify(p.input || {});
      const response = JSON.stringify(p.response ?? null);
      const truncated = response.length > 400 ? response.substring(0, 400) + '...' : response;
      lines.push(`${label}(${input}) → ${truncated}`);
    }
  }
  return lines.join('\n');
}

/** Format multiple bundles for prompt injection */
export function formatBundlesForPrompt(bundles: ComponentBundle[]): string {
  if (!bundles || bundles.length === 0) return '';
  return '\n## Completed Components (actual outputs from live probes)\n\n' +
    bundles.map(formatBundleForPrompt).join('\n\n');
}
