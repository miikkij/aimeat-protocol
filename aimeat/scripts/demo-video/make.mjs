/**
 * @file scripts/demo-video/make.mjs
 * @description Convenience wrapper: record a demo scene manifest and then compose the
 *   final mp4 in one call. Equivalent to running record.mjs then compose.mjs.
 * @usage node scripts/demo-video/make.mjs scripts/demo-video/scenes.<name>.json
 * @version-history v0.1.0 - 2026-07-25 - initial wrapper (PoC)
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = process.argv[2];
if (!manifest) { console.error('usage: node scripts/demo-video/make.mjs <scenes.json>'); process.exit(1); }
const run = (f) => execFileSync(process.execPath, [resolve(here, f), manifest], { stdio: 'inherit' });
run('record.mjs');
run('compose.mjs');
