/**
 * @file consent-surfaces.test.ts
 * @description The consent vocabulary and the anti-drift guards over the consent surfaces.
 *
 *   Two kinds of assertion, on purpose:
 *   1. EXECUTES consent-vocab.js against the real en.json — the sentences the surfaces will
 *      actually render (override chain, preset summaries generated from the real template sets,
 *      the three boundary lines, a sentence for every APP_GRANTABLE scope).
 *   2. READS the standalone pages as text and refuses the private copies that already diverged
 *      once: agent-consent.html carried its own SCOPE_PRESETS whose "Standard" granted a
 *      DIFFERENT set than the SPA's (memory:*, work:*, wallet:read; no storage) for months.
 *      A copy deleted without a guard is a copy that comes back.
 * @version-history
 *   v1.0.0 — 2026-08-17 — With the consent-surface rebuild (shared vocabulary, preset unification).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { presetSummary, scopeSentence, boundaryLines, areaLine } from '../../public/js/consent-vocab.js';
import { SCOPE_TEMPLATES } from '../../public/views/profile/agents/scope-model.js';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

// The same flatten + interpolation contract as public/js/i18n.js, over the real en.json.
function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = String(v);
  }
  return out;
}
const dict = flatten(JSON.parse(read('../../locales/en.json')));
const t = (key: string, vars?: Record<string, unknown>) => {
  let s = dict[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};

describe('consent vocabulary over the real en.json', () => {
  it('gives three boundary sentences and none of them is a raw key', () => {
    const lines = boundaryLines(t);
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l).not.toMatch(/^consent\./);
    expect(lines[0]).toContain('AIMEAT account');
  });

  it('generates preset summaries from the REAL template sets', () => {
    const std = presetSummary('standard', t);
    // The families the standard set actually grants, by their friendly names — the sentence can
    // never say less than the set gives, because the set is what generates it.
    expect(std).toContain('your saved data');
    expect(std).toContain('the files you keep here');
    expect(presetSummary('keep', t)).toBe(dict['consent.preset.keep']);
    expect(presetSummary('full', t)).toBe(dict['consent.preset.full']);
  });

  it('resolves the override chain: app-context sentence beats the shared agent sentence', () => {
    expect(scopeSentence('task:read', t)).toBe(dict['appGrant.scopeText.task.read']);
    expect(scopeSentence('memory:read', t)).toBe(dict['profile.agents.scopeUi.scopeText.memory.read']);
    expect(scopeSentence('never:heard-of-it', t, 'server words')).toBe('server words');
  });

  it('has a localized sentence and a family name for EVERY app-grantable scope', () => {
    const route = read('../../src/routes/app-grants.ts');
    const block = route.match(/APP_GRANTABLE_SCOPES: Record<string, string> = \{([\s\S]*?)\n\};/);
    expect(block, 'APP_GRANTABLE_SCOPES not found — update this parser with the route').toBeTruthy();
    const scopes = [...block![1].matchAll(/'([a-z-]+:[a-z-]+)':/g)].map((m) => m[1]);
    expect(scopes.length).toBeGreaterThan(20);
    for (const s of scopes) {
      expect(scopeSentence(s, t), `no consent sentence for ${s}`).not.toBe(s);
      const family = s.split(':')[0];
      expect(areaLine([s], t), `no appGrant.area name for family "${family}"`).not.toBe(family);
    }
  });
});

describe('the standalone pages keep no private copies', () => {
  it('agent-consent.html reads the shared model, not a preset copy of its own', () => {
    const page = read('../../public/agent-consent.html');
    expect(page).not.toMatch(/const SCOPE_PRESETS\s*=/);
    expect(page).not.toMatch(/const ALL_SCOPES\s*=/);
    expect(page).toContain("from '/views/profile/agents/scope-model.js'");
    expect(page).toContain("from '/js/i18n.js'");
    expect(page).toContain("from '/js/consent-vocab.js'");
  });

  it('oauth-consent.html renders the selected agent, not the static "Full access" line', () => {
    const page = read('../../public/oauth-consent.html');
    expect(page).not.toContain("t('scopeFull')");
    expect(page).toContain("from '/views/profile/agents/scope-model.js'");
    expect(page).toContain("from '/js/consent-vocab.js'");
    expect(page).toContain('default_scopes');
  });

  it('the static scope line is gone from every locale', () => {
    for (const lang of ['en', 'fi', 'es']) {
      const locale = JSON.parse(read(`../../locales/${lang}.json`));
      expect(locale.oauthConsent?.scopeFull, `${lang}.json still carries oauthConsent.scopeFull`).toBeUndefined();
      expect(locale.oauthConsent?.walletNote, `${lang}.json still carries oauthConsent.walletNote`).toBeUndefined();
    }
  });
});
