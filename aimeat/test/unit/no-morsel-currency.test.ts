/**
 * @file test/unit/no-morsel-currency.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description No server code publishes a morsel as a currency. A morsel paces what is written into
 *   the store and is never a price (ruling D4, 2026-10-11), so the string "MORSEL" never appears as
 *   a currency code in what the node sends out, and the ACP and UCP surfaces read money only.
 *   The served browser libraries (src/static) are left out: they read a currency they are given,
 *   and accept "MORSEL" there only to show an older amount as a count.
 *
 * @version-history
 *   v1.0.0 — 2026-10-11 — The ACP feed priced products in currency "MORSEL", and app pages published
 *     schema.org Offers with priceCurrency "MORSEL" (wish-acp-reitti-ei-k-yt-morseleita-valuuttana-morsel).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(import.meta.dirname, '../../src');
const SKIP = new Set(['static', '__tests__']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (!SKIP.has(name)) sourceFiles(path, out); }
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('a morsel is never published as a currency', () => {
  it('no server source names "MORSEL" as a currency code', () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith('*') || code.startsWith('/*') || code.startsWith('//')) return; // a comment says it, the code does not
        if (/['"`]MORSELS?['"`]/.test(code)) hits.push(`${relative(SRC, file)}:${i + 1}: ${code}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('the ACP and UCP routes open, show and settle sessions through the money-only helpers', () => {
    for (const route of ['routes/commerce-acp.ts', 'routes/commerce-ucp.ts']) {
      const text = readFileSync(join(SRC, route), 'utf-8');
      expect(text, route).toContain('createMoneySession(');
      expect(text, route).toContain('assertMoneySession(');
      expect(text, route).toContain('moneyHandlerFor(');
      expect(text, route).not.toMatch(/\bcreateSession\(/);
      expect(text, route).toContain('{ moneyOnly: true }');
    }
  });
});
