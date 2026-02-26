#!/usr/bin/env node
/**
 * AIMEAT IndexNow Submission Script
 *
 * Submits URLs to Bing/Yandex via the IndexNow protocol so
 * browse-mode LLMs (Copilot, Gemini) can discover AIMEAT endpoints.
 *
 * Prerequisites:
 *   - Set MEAT_INDEXNOW_KEY in your .env
 *   - Set MEAT_BASE_URL in your .env
 *   - The key verification file must be served at {baseUrl}/{key}.txt
 *
 * Usage:
 *   pnpm indexnow                    # submit default URL set
 *   pnpm indexnow https://example.com/custom-page   # submit specific URLs
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── Resolve env vars ───────────────────────────────────────

// Node 24 --env-file loads .env automatically, but handle manual fallback
if (!process.env.MEAT_INDEXNOW_KEY) {
  const envPath = resolve(ROOT, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const key = process.env.MEAT_INDEXNOW_KEY;
const baseUrl = process.env.MEAT_BASE_URL;

if (!key) {
  console.error('Error: MEAT_INDEXNOW_KEY is not set. Add it to your .env file.');
  console.error('Generate a key: any hex string (e.g. openssl rand -hex 16)');
  process.exit(1);
}

if (!baseUrl) {
  console.error('Error: MEAT_BASE_URL is not set. Add it to your .env file.');
  process.exit(1);
}

// ─── Determine URLs to submit ───────────────────────────────

const customUrls = process.argv.slice(2).filter(a => a.startsWith('http'));

const defaultUrls = [
  `${baseUrl}/`,
  `${baseUrl}/.well-known/aimeat`,
  `${baseUrl}/v1/prompts/anonymous/share?format=text`,
  `${baseUrl}/v1/spec`,
  `${baseUrl}/v1/health`,
];

const urlsToSubmit = customUrls.length > 0 ? customUrls : defaultUrls;

// ─── Submit via IndexNow batch API ──────────────────────────

const keyLocation = `${baseUrl}/${key}.txt`;

console.log(`IndexNow submission`);
console.log(`  Key: ${key}`);
console.log(`  Key location: ${keyLocation}`);
console.log(`  URLs to submit (${urlsToSubmit.length}):`);
for (const url of urlsToSubmit) {
  console.log(`    - ${url}`);
}
console.log();

const payload = {
  host: new URL(baseUrl).host,
  key,
  keyLocation,
  urlList: urlsToSubmit,
};

const engines = [
  { name: 'IndexNow (Bing + Yandex)', url: 'https://api.indexnow.org/indexnow' },
];

for (const engine of engines) {
  try {
    const resp = await fetch(engine.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });

    if (resp.ok || resp.status === 202) {
      console.log(`✅ ${engine.name}: accepted (${resp.status})`);
    } else {
      const body = await resp.text();
      console.error(`❌ ${engine.name}: ${resp.status} — ${body}`);
    }
  } catch (err) {
    console.error(`❌ ${engine.name}: ${(err as Error).message}`);
  }
}

console.log('\nDone. URLs will be crawled within minutes to hours.');
