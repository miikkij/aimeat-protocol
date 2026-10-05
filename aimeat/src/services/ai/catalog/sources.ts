/**
 * @file sources.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the model catalogue comes from, and the one fetch that reads it (System 2 plan,
 *   V4; docs/internal/llmproviderintegrations/06, section 2). Three public sources, no key:
 *   models.dev (capabilities, limits and text prices for the vendors), OpenRouter's model list (its
 *   whole range, image, speech, transcription and embedding models, voices, retirement dates) and
 *   LiteLLM's price table (image, speech and transcription prices the others lack). models.dev and
 *   LiteLLM are MIT; their data ships in the seed, so both are in the third-party notices.
 *
 *   Every fetch goes through safeFetch, with a size ceiling and a timeout, and a source that does not
 *   answer is reported, never fatal: the refresh keeps what it had (refresh.ts).
 * @structure SourceName · DEFAULT_SOURCE_URLS · sourceUrls · fetchSource
 * @version-history
 *   v1.1.0 — 2026-10-05 — fetchSource reads the body with readBodyCapped, so the size limit holds while
 *     the body arrives (secaudit 2026-10, AI-5).
 *   v1.0.0 — 2026-09-28 — Initial (V4 of the System 2 plan).
 */
import type { AimeatConfig } from '../../../config.js';
import { safeFetch } from '../../../utils/url-validator.js';
import { readBodyCapped } from '../../../utils/read-capped.js';
import { logger } from '../../../utils/logger.js';

export type SourceName = 'modelsDev' | 'openRouter' | 'liteLlm';

export const DEFAULT_SOURCE_URLS: Readonly<Record<SourceName, string>> = Object.freeze({
  modelsDev: 'https://models.dev/api.json',
  openRouter: 'https://openrouter.ai/api/v1/models?output_modalities=all',
  liteLlm: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
});

/** The largest source measured on 2026-09-28 was 4.9 MB (models.dev); four times that is the ceiling. */
const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

/**
 * The address of each source on this node: the defaults, or the operator's AIMEAT_AI_CATALOG_SOURCES
 * (JSON, a subset of the three names), which is how a test points the refresh at a stub.
 */
export function sourceUrls(config: AimeatConfig): Record<SourceName, string> {
  const out = { ...DEFAULT_SOURCE_URLS };
  const raw = (config.aiCatalogSources ?? '').trim();
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const name of Object.keys(out) as SourceName[]) {
      if (typeof parsed[name] === 'string' && URL.canParse(parsed[name] as string)) out[name] = parsed[name] as string;
    }
  } catch (err) {
    logger.error('[ai-catalog] AIMEAT_AI_CATALOG_SOURCES is not JSON; the default sources are used', { error: String(err) });
  }
  return out;
}

/** One source, parsed. Throws with the reason, which the refresh records against that source. */
export async function fetchSource(url: string): Promise<unknown> {
  const resp = await safeFetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const length = Number(resp.headers.get('content-length') ?? '0');
  if (length > MAX_BYTES) throw new Error(`larger than ${MAX_BYTES} bytes`);
  // Capped while it arrives: text() held the whole body before the length was measured, so a source
  // with no or a false Content-Length could fill the process (secaudit 2026-10, AI-5).
  const body = await readBodyCapped(resp, MAX_BYTES);
  if (body === null) throw new Error(`larger than ${MAX_BYTES} bytes`);
  return JSON.parse(body.toString('utf8')) as unknown;
}
