/**
 * @file scripts/vendor-three-loaders.mjs
 * @description Builds the model-loader companion for the three-world bundle: GLTFLoader (the
 *   .glb/.gltf reader) and RoomEnvironment (the neutral studio light that makes PBR materials
 *   look like themselves) from the SAME pinned three release (0.185.1), aliased onto the
 *   already-loaded window.THREE — the bundle adds loaders, never a second three. Output:
 *   public/lib/three-world-loaders@1.min.js, attaching THREE.Addons.GLTFLoader and
 *   THREE.Addons.RoomEnvironment. The universe app proved this exact shape.
 * @usage  node scripts/vendor-three-loaders.mjs
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial (scene3d kind "model": the loadable-model showcase).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'lib', 'three-world-loaders@1.min.js');
const VERSION = '0.185.1';

const work = mkdtempSync(join(tmpdir(), 'three-loaders-'));
async function fetchTo(name, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const path = join(work, name);
  writeFileSync(path, await res.text());
  return path;
}

// The examples keep their own directory shape (loaders/ imports ../utils/): mirror it.
for (const dir of ['loaders', 'utils', 'environments']) mkdirSync(join(work, dir), { recursive: true });
await fetchTo('loaders/GLTFLoader.js', `https://cdn.jsdelivr.net/npm/three@${VERSION}/examples/jsm/loaders/GLTFLoader.js`);
await fetchTo('environments/RoomEnvironment.js', `https://cdn.jsdelivr.net/npm/three@${VERSION}/examples/jsm/environments/RoomEnvironment.js`);
await fetchTo('utils/BufferGeometryUtils.js', `https://cdn.jsdelivr.net/npm/three@${VERSION}/examples/jsm/utils/BufferGeometryUtils.js`);
await fetchTo('utils/SkeletonUtils.js', `https://cdn.jsdelivr.net/npm/three@${VERSION}/examples/jsm/utils/SkeletonUtils.js`);

// 'three' resolves to the page's already-loaded bundle — one renderer, one class identity.
writeFileSync(join(work, 'three-shim.js'), 'module.exports = window.THREE;\n');
writeFileSync(join(work, 'entry.js'), [
  "import { GLTFLoader } from './loaders/GLTFLoader.js';",
  "import { RoomEnvironment } from './environments/RoomEnvironment.js';",
  "if (!window.THREE || !window.THREE.Addons) throw new Error('three-world-loaders: load three-world@1 first');",
  'window.THREE.Addons.GLTFLoader = GLTFLoader;',
  'window.THREE.Addons.RoomEnvironment = RoomEnvironment;',
].join('\n'));

await esbuild.build({
  entryPoints: [join(work, 'entry.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  outfile: OUT,
  alias: { three: join(work, 'three-shim.js') },
  banner: { js: `/* three ${VERSION} examples: GLTFLoader + RoomEnvironment (MIT, https://threejs.org) — companion to three-world@1; attaches to THREE.Addons. */` },
  logLevel: 'silent',
});
rmSync(work, { recursive: true, force: true });
console.log(`✓ wrote ${OUT}`);
