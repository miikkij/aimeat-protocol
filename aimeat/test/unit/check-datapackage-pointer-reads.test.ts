/**
 * @file test/unit/check-datapackage-pointer-reads.test.ts
 * @description Proof that `pnpm check:datapackage-pointer-reads` finds a data package audience read off
 *   the `latest.json` pointer, the shape of the GET /v1/pub hole fixed in d75ad0ca2, and stays quiet for
 *   the trusted record, for comments, and for a `.latest` or `latest.json` that is not a package's. The
 *   findings function is pure, so every case is a source string in and a list out.
 * @usage cd aimeat && pnpm exec vitest run test/unit/check-datapackage-pointer-reads.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial, with the gate (secaudit2026oct31w2, after round 10).
 */
import { describe, it, expect } from 'vitest';
import { pointerFindings, compareWithAllowed, type Finding } from '../../scripts/check-datapackage-pointer-reads.js';

describe('check:datapackage-pointer-reads findings', () => {
  it('finds the decision d75ad0ca2 removed: a typed pointer\'s visibility inside the service', () => {
    const before = [
      "import { latestKey, type LatestPointer } from './contract.js';",
      'const pointer = pointerFile ? parseJson<LatestPointer>(pointerFile.data, latestKey(name)) : null;',
      'if (!(await datapackageReadable(storage, ownerGhii, pointer?.visibility, reader))) return closed;',
    ].join('\n');
    const found = pointerFindings('src/services/datapackage/file-read.ts', before);
    expect(found.map((f) => [f.line, f.shape, f.text])).toEqual([[3, 'pointer-visibility', 'pointer?.visibility']]);
  });

  it('finds a pointer read outside the service, and the visibility read off it', () => {
    const outside = [
      "import { readPointer } from '../datapackage/version-audience.js';",
      'const p = await readPointer(deps, owner, name);',
      'if (p?.visibility === \'public\') open();',
      "const key = `datapkg/${name}/latest.json`;",
    ].join('\n');
    expect(pointerFindings('src/routes/thing.ts', outside).map((f) => f.shape))
      .toEqual(['pointer-source', 'pointer-visibility', 'pointer-source']);
  });

  it('stays quiet for the record, for comments, and for another module\'s latest', () => {
    const good = [
      "import { trustedAudienceOf } from '../datapackage/audience-record.js';",
      '// the old read was pointer.visibility from datapkg/x/latest.json',
      'const trusted = await trustedAudienceOf(storage, nodeId, owner, name, undefined);',
      'if (trusted.visibility === \'public\') open();',
    ].join('\n');
    expect(pointerFindings('src/routes/thing.ts', good)).toEqual([]);
    // A workspace document's `.latest` record in a file that has nothing to do with packages.
    const workspace = [
      'const latest = items.find(r => r.key === `${base}.latest`);',
      'await write({ visibility: latest.visibility });',
      'const latestKey = (b: string) => `${b}.latest`;',
      'await storage.getMemory(owner, latestKey(base));',
    ].join('\n');
    expect(pointerFindings('src/routes/organisms/record-helpers.ts', workspace)).toEqual([]);
  });
});

describe('check:datapackage-pointer-reads against ALLOWED', () => {
  const f = (line: number, text: string): Finding => ({ line, shape: 'pointer-visibility', text });

  it('lets an allowed expression through and reports a new one and a stale entry', () => {
    const found = new Map([['src/a.ts', [f(1, 'pointer.visibility'), f(2, 'latest.visibility')]]]);
    const verdict = compareWithAllowed(found, {
      'src/a.ts': { 'pointer.visibility': 'shown only' },
      'src/b.ts': { 'pointer?.visibility': 'gone' },
    });
    expect(verdict.allowedHits).toBe(1);
    expect(verdict.fresh.map((x) => x.finding.text)).toEqual(['latest.visibility']);
    expect(verdict.stale).toEqual([{ file: 'src/b.ts', text: 'pointer?.visibility' }]);
  });

  it('refuses an entry with no reason', () => {
    const found = new Map([['src/a.ts', [f(1, 'pointer.visibility')]]]);
    expect(compareWithAllowed(found, { 'src/a.ts': { 'pointer.visibility': ' ' } }).empty).toHaveLength(1);
  });
});
