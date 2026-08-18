/**
 * @file vendor-three-world.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reproducible builder for the vendored `three-world` bundle: downloads the PINNED
 *   three.js release from npm, bundles three core + OrbitControls + Sky + RGBELoader into ONE
 *   classic IIFE exposing window.THREE (with addons on THREE.Addons), and writes
 *   public/lib/three-world@1.min.js. Per the VENDORED.md policy the output filename carries the
 *   bundle major; a future three upgrade ships as three-world@2, never mutates @1.
 * @usage node scripts/vendor-three-world.mjs   (from aimeat/; needs network + local esbuild)
 * @version-history
 *   v1.0.0 — 2026-08-04 — Initial bundle: three 0.185.1 (r185) + OrbitControls + Sky + RGBELoader.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';

const THREE_VERSION = '0.185.1';
const OUT = path.resolve(import.meta.dirname, '..', 'public', 'lib', 'three-world@1.min.js');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'three-world-'));
const tgz = path.join(work, 'three.tgz');

console.log(`fetching three@${THREE_VERSION} ...`);
const res = await fetch(`https://registry.npmjs.org/three/-/three-${THREE_VERSION}.tgz`);
if (!res.ok) throw new Error(`npm fetch failed: ${res.status}`);
fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
// Relative path + cwd: GNU tar reads "C:\..." as a remote host ("Cannot connect to C:").
execFileSync('tar', ['-xzf', 'three.tgz'], { cwd: work });

const pkg = path.join(work, 'package');
const entry = path.join(work, 'entry.js');
fs.writeFileSync(entry, `
import * as THREE_NS from 'three';
import { OrbitControls } from ${JSON.stringify(path.join(pkg, 'examples/jsm/controls/OrbitControls.js').replace(/\\/g, '/'))};
import { Sky } from ${JSON.stringify(path.join(pkg, 'examples/jsm/objects/Sky.js').replace(/\\/g, '/'))};
import { RGBELoader } from ${JSON.stringify(path.join(pkg, 'examples/jsm/loaders/RGBELoader.js').replace(/\\/g, '/'))};
const THREE = Object.assign(Object.create(null), THREE_NS);
THREE.Addons = { OrbitControls, Sky, RGBELoader };
window.THREE = THREE;
`);

const banner = `/*! three-world@1 — three.js ${THREE_VERSION} (MIT, (c) 2010-2026 three.js authors, https://threejs.org)
 * + addons OrbitControls, Sky, RGBELoader bundled to one classic script: window.THREE, addons on THREE.Addons.
 * Built by aimeat/scripts/vendor-three-world.mjs — regenerate there; NEVER edit or replace in place (VENDORED.md policy). */`;

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  legalComments: 'none',
  banner: { js: banner },
  alias: { three: path.join(pkg, 'build', 'three.module.js') },
  outfile: OUT,
});

const kb = fs.statSync(OUT).size / 1024;
console.log(`wrote ${OUT} (${kb.toFixed(0)} KB)`);
fs.rmSync(work, { recursive: true, force: true });
