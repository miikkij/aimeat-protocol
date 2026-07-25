/**
 * @file embed-viewport.ts
 * @description Keeps the copy of aimeat-viewport.js that is embedded inside other cortex packs
 *   byte-identical to the source. Cortex packs are served live and each declares a single script
 *   tag with no `requires`, so a pack that needs the shared camera cannot simply depend on it —
 *   splitting a pack into two files would break every app carrying the old single tag. The camera
 *   is therefore copied INTO the consuming pack between generated markers, and this script is the
 *   only thing allowed to write that region. `--check` (pre-commit + CI) fails on drift, so the
 *   duplicate can never quietly diverge from the source.
 * @structure
 *   - SOURCE / TARGETS  → the camera file and every pack that embeds it
 *   - detectEol/toEol   → preserve each target's existing line endings (Windows checkouts)
 *   - main()            → write mode (default) or --check mode (exit 1 on drift)
 * @usage
 *   pnpm sync:viewport     # rewrite the embedded region in every target
 *   pnpm check:viewport    # verify, non-zero exit on drift
 * @version-history
 *   v1.0.0 — 2026-07-25 — Initial (TARGET-051 Slice 1): aimeat-dag embeds aimeat-viewport.
 *   v1.1.0 — 2026-07-25 — Also assert every pack's VERSION constant matches its manifest;
 *     they crossed once already (constant 1.0.1 while the manifest said 1.0.2).
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const BUNDLED = join(REPO, 'public', 'cortex-bundled');

const SOURCE = join(BUNDLED, 'aimeat-viewport.js');
const TARGETS = [join(BUNDLED, 'aimeat-dag.js')];

const BEGIN = '/* BEGIN embedded aimeat-viewport — GENERATED, DO NOT EDIT (pnpm sync:viewport) */';
const END = '/* END embedded aimeat-viewport */';

/** Windows checkouts may hold CRLF; keep whatever the target already uses. */
function detectEol(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}
function toEol(text: string, eol: '\r\n' | '\n'): string {
  const lf = text.replace(/\r\n/g, '\n');
  return eol === '\n' ? lf : lf.replace(/\n/g, '\r\n');
}

function main(): void {
  const check = process.argv.includes('--check');
  const source = readFileSync(SOURCE, 'utf-8');
  let drifted = 0;

  for (const target of TARGETS) {
    const rel = relative(REPO, target).replace(/\\/g, '/');
    const current = readFileSync(target, 'utf-8');
    const eol = detectEol(current);

    const begin = current.indexOf(BEGIN);
    const end = current.indexOf(END);
    if (begin === -1 || end === -1 || end < begin) {
      console.error(`✗ ${rel}: embed markers missing or out of order.`);
      console.error(`  Expected a region delimited by:\n    ${BEGIN}\n    ${END}`);
      process.exit(1);
    }

    const head = current.slice(0, begin + BEGIN.length);
    const tail = current.slice(end);
    const body = toEol(source, eol);
    const next = head + eol + body + (body.endsWith(eol) ? '' : eol) + tail;

    if (next === current) {
      if (!check) console.log(`✓ ${rel}: already in sync`);
      continue;
    }

    drifted++;
    if (check) {
      console.error(`✗ ${rel}: embedded aimeat-viewport has drifted from public/cortex-bundled/aimeat-viewport.js`);
    } else {
      writeFileSync(target, next, 'utf-8');
      console.log(`✓ ${rel}: embedded region updated`);
    }
  }

  drifted += checkVersions(check);

  if (check) {
    if (drifted > 0) {
      console.error(`\n${drifted} problem(s). Run: pnpm sync:viewport (embed) and align the versions by hand.`);
      process.exit(1);
    }
    console.log('✓ embedded aimeat-viewport is in sync; pack VERSION constants match their manifests');
  }
}

/**
 * A cortex pack that exposes a VERSION constant must report the version its manifest declares.
 * These drift trivially — the manifest gets bumped to make the seeder republish, the constant is
 * forgotten, and from then on the lib lies to anyone reading it from the console. Checking it is
 * three lines; noticing it in production is not.
 */
function checkVersions(check: boolean): number {
  let bad = 0;
  for (const file of readdirSync(BUNDLED)) {
    if (!file.endsWith('.js')) continue;
    const js = readFileSync(join(BUNDLED, file), 'utf-8');
    const yamlPath = join(BUNDLED, file.replace(/\.js$/, '.yaml'));
    if (!existsSync(yamlPath)) continue;

    // Only the pack's OWN constant, not one embedded from another pack.
    const own = js.split(BEGIN)[0] + (js.includes(END) ? js.split(END).slice(1).join(END) : '');
    const m = own.match(/VERSION:\s*'([\d.]+)'/);
    if (!m) continue;

    const y = readFileSync(yamlPath, 'utf-8').match(/^\s*version:\s*"([\d.]+)"/m);
    if (!y) continue;

    if (m[1] !== y[1]) {
      bad++;
      console.error(`✗ ${file}: VERSION constant is ${m[1]} but ${file.replace(/\.js$/, '.yaml')} declares ${y[1]}`);
    } else if (!check) {
      console.log(`✓ ${file}: VERSION ${m[1]} matches its manifest`);
    }
  }
  return bad;
}

main();
