/**
 * @file services/generator-autopilot-helpers.ts
 * @description Internal same-server HTTP helper plus registered-name and probe-scenario derivation for the generator autopilot. Extracted from services/generator-autopilot.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-autopilot.ts (max-file-lines)
 */
import { type AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { stripCodeblock } from './generator-prompts/index.js';

const log = { info: (m: string) => logger.info(m), warn: (m: string) => logger.warn(m), error: (m: string) => logger.error(m) };

export async function internalFetch(config: AimeatConfig, path: string, jwt: string, opts: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; status: number; data: unknown; error?: unknown }> {
  const url = `http://localhost:${config.port}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${jwt}`,
  };
  const fetchOpts: RequestInit = { method: opts.method || 'GET', headers };
  if (opts.body) fetchOpts.body = JSON.stringify(opts.body);

  const resp = await fetch(url, fetchOpts);
  const text = await resp.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    log.error(`internalFetch ${opts.method || 'GET'} ${path} — non-JSON response (${resp.status}): ${text.slice(0, 500)}`);
    return { ok: false, status: resp.status, data: null, error: { message: `Non-JSON response: ${text.slice(0, 200)}` } };
  }
  if (!resp.ok) {
    log.warn(`internalFetch ${opts.method || 'GET'} ${path} — ${resp.status}: ${JSON.stringify(json.error || json).slice(0, 300)}`);
  }
  return { ok: resp.ok, status: resp.status, data: json.data, error: json.error };
}

export function extractRegisteredName(type: string, content: string, _vr: { extracted?: unknown }): string | null {
  if (type === 'extension' || type === 'cortex') {
    const nameMatch = (typeof content === 'string' ? content : '').match(/name:\s*"?([^\s"]+)"?/);
    return nameMatch?.[1] || null;
  }
  if (type === 'csm' || type === 'msm') {
    const nameMatch = (typeof content === 'string' ? content : '').match(/name:\s*"?([^\s"]+)"?/);
    return nameMatch?.[1] || null;
  }
  if (type === 'memory') {
    // Memory content is JSON object — return the first key name as the registered name
    try {
      const stripped = stripCodeblock(typeof content === 'string' ? content : '');
      const parsed = JSON.parse(stripped);
      const keys = Object.keys(parsed);
      return keys.length > 0 ? `memory:${keys[0]}` : 'memory';
    } catch {
      return 'memory';
    }
  }
  if (type === 'translation') {
    // Translation content is { locale: { key: value } } — return i18n.{locale} matching the stored memory key
    try {
      const stripped = stripCodeblock(typeof content === 'string' ? content : '');
      const parsed = JSON.parse(stripped);
      const locales = Object.keys(parsed);
      return locales.length > 0 ? `i18n.${locales[0]}` : 'translation';
    } catch {
      return 'translation';
    }
  }
  if (type === 'app') {
    // App content is HTML with manifest comment: <!-- AIMEAT App Manifest\nname: kebab-case-name -->
    const nameMatch = (typeof content === 'string' ? content : '').match(/name:\s*([^\n\r]+)/);
    return nameMatch?.[1]?.trim() || 'app';
  }
  return null;
}

export function buildProbeScenarios(blueprint: Record<string, unknown>, comp: Record<string, unknown>, content: string): Array<{ action: string; input: Record<string, unknown> }> {
  // Prefer SPEC actions — they have correct IDs and example inputs matching the actual API.
  // Blueprint scenarios have abstract inputs (e.g. {query, type}) that don't match the extension.
  const spec = comp.spec as Record<string, unknown> | undefined;
  if (spec) {
    const specActions = (spec.actions || []) as Array<Record<string, unknown>>;
    if (specActions.length > 0) {
      return specActions
        .filter(a => a.id && a.example)
        .map(a => ({
          action: a.id as string,
          input: ((a.example as Record<string, unknown>)?.input as Record<string, unknown>) || {},
        }));
    }
  }

  // Fallback: extract action names from YAML content
  const actionMatches = [...content.matchAll(/- id:\s*"?([^\s"]+)/g)];
  return actionMatches.map(m => ({ action: m[1], input: {} }));
}
