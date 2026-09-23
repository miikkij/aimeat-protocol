/**
 * @file api-index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The API reference as plain HTML: every operation in openapi.yaml, grouped by tag,
 *   with its method, path and summary. /v1/docs serves it inside the Swagger UI page so a reader
 *   that does not run JavaScript finds the endpoints in the document as sent; Swagger removes it
 *   once it has drawn the same list itself.
 *
 *   Measured 2026-09-23 with Bingbot's user agent: /v1/docs answered 25 words, because Swagger UI
 *   is an empty div until its script runs. The contract holds about 1 500 operations, each with a
 *   summary, so the page had the most content on the node and showed a crawler none of it.
 *
 *   Built once per process from the same file GET /v1/spec serves, and every string is escaped.
 * @structure
 *   - apiIndexHtml() — the index, cached; '' when the contract cannot be read
 * @usage
 *   const index = apiIndexHtml();
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { logger } from '../utils/logger.js';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface Operation { summary?: string; tags?: string[]; deprecated?: boolean }

let cached: string | null = null;

/** The operation index as HTML, grouped by tag in the contract's own tag order. */
export function apiIndexHtml(): string {
  if (cached !== null) return cached;
  cached = '';
  const path = [join(process.cwd(), 'openapi.yaml'), join(process.cwd(), '..', 'openapi.yaml')].find(existsSync);
  if (!path) return cached;
  try {
    const doc = parse(readFileSync(path, 'utf-8')) as {
      paths?: Record<string, Record<string, Operation>>;
      tags?: Array<{ name: string; description?: string }>;
    };
    const groups = new Map<string, string[]>();
    for (const t of doc.tags ?? []) groups.set(t.name, []);
    for (const [p, item] of Object.entries(doc.paths ?? {})) {
      for (const m of METHODS) {
        const op = item?.[m];
        if (!op || op.deprecated) continue;
        const tag = op.tags?.[0] ?? 'Other';
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag)!.push(`<li><code>${m.toUpperCase()} ${esc(p)}</code> ${esc(op.summary ?? '')}</li>`);
      }
    }
    const descs = new Map((doc.tags ?? []).map(t => [t.name, t.description ?? '']));
    const sections: string[] = [];
    for (const [tag, items] of groups) {
      if (!items.length) continue;
      const d = descs.get(tag);
      sections.push(`<h2>${esc(tag)}</h2>${d ? `<p>${esc(d.split('\n')[0])}</p>` : ''}<ul>${items.join('')}</ul>`);
    }
    cached = sections.join('\n');
  } catch (err) {
    logger.warn('api-index: could not read openapi.yaml', { error: String(err) });
  }
  return cached;
}
