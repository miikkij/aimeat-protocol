/**
 * @file test/unit/relative-modules.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The modules only a relative import reaches, and their importmap entries: the scan
 *   resolves `from './x.js'`, `import '../y.js'` and `import('./z.js')` against the importing file,
 *   leaves out third-party folders and paths with no file, and the importmap gains an identity entry
 *   for each path it does not name, keeping every entry it had.
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial (performance work, architecture item 5).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { relativeModulePaths, addModulesToImportmap } from '../../src/utils/relative-modules.js';

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'relmods-'));
  for (const d of ['views/profile/dw', 'components', 'lib']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'views/profile/dw/page.js'), "import { a } from './rows.js';\nimport '../shared.js';\nconst m = () => import('./lazy.js');\n// see './gone.js'\n");
  writeFileSync(join(dir, 'views/profile/dw/rows.js'), "export const a = 1;\n");
  writeFileSync(join(dir, 'views/profile/dw/lazy.js'), "export default 1;\n");
  writeFileSync(join(dir, 'views/profile/shared.js'), "import { b } from '/components/B.js';\n");
  writeFileSync(join(dir, 'components/B.js'), "export const b = 1;\n");
  writeFileSync(join(dir, 'lib/vendor.js'), "import './inner.js';\n");
  writeFileSync(join(dir, 'lib/inner.js'), "\n");
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe('relativeModulePaths', () => {
  it('finds every relatively imported module that exists, and none under lib/', () => {
    expect(relativeModulePaths(dir)).toEqual([
      '/views/profile/dw/lazy.js',
      '/views/profile/dw/rows.js',
      '/views/profile/shared.js',
    ]);
  });
});

describe('addModulesToImportmap', () => {
  const html = `<script type="importmap">\n  {\n    "imports": {\n      "preact": "/lib/preact.mjs",\n      "/views/profile/shared.js": "/views/profile/shared.js"\n    }\n  }\n</script>`;

  it('adds an identity entry for each path the map does not name, keeping the rest', () => {
    const out = addModulesToImportmap(html, ['/views/profile/dw/rows.js', '/views/profile/shared.js']);
    const map = JSON.parse(out.replace(/^[\s\S]*?<script type="importmap">/, '').replace(/<\/script>[\s\S]*$/, ''));
    expect(map.imports).toEqual({
      preact: '/lib/preact.mjs',
      '/views/profile/shared.js': '/views/profile/shared.js',
      '/views/profile/dw/rows.js': '/views/profile/dw/rows.js',
    });
  });

  it('leaves the shell as it was when there is nothing to add', () => {
    expect(addModulesToImportmap(html, ['/views/profile/shared.js'])).toBe(html);
    expect(addModulesToImportmap(html, [])).toBe(html);
  });
});
