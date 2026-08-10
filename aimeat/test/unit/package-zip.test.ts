/**
 * @file package-zip.test.ts
 * @description The package ZIP serialization/deserialization service — buildZip and parseZip,
 *   including the security validation (magic bytes, size limits, path traversal, zip bomb
 *   detection, manifest validation).
 * @structure
 *   - buildZip tests: valid ZIP output
 *   - parseZip tests: rejection of invalid/malicious inputs, round-trip, full parse
 * @usage pnpm test -- package-zip
 * @version-history
 *   v1.1.0 — 2026-08-10 — Moved from test/e2e-package-zip.ts to test/unit/ and switched from
 *     node:test to vitest. It was never an E2E — it calls the service directly and needs no
 *     server — and it sat between the two runners: run-e2e-ci.ts lists suites by name and never
 *     listed it, while vitest's include covers test/unit/** only. Seven assertions about path
 *     traversal and zip bombs therefore ran nowhere. (e2e-zip-security.ts covers the same ground
 *     over HTTP and has been registered all along, so this was duplication rather than a bare
 *     gap — but silent duplication reads as coverage.)
 *   v1.0.0 — 2026-03-20 — Initial implementation
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { ZipArchive } from 'archiver';
import { buildZip, parseZip, ZipValidationError } from '../../src/services/package-zip.js';
import type { PackageRecord } from '../../src/storage/interface.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePkg(overrides: Partial<PackageRecord> = {}): PackageRecord {
  return {
    id: 'test-pkg-id',
    packageGroupId: 'test-pkg::tester',
    name: 'test-pkg',
    author: 'tester',
    authorGhii: 'tester@node-1',
    version: 'v2026-03-20-1430',
    changelog: 'Initial release',
    description: 'A test package',
    category: 'other',
    tags: ['test', 'demo'],
    visibility: 'public',
    status: 'published',
    components: [
      {
        id: 'csm-test',
        type: 'csm',
        label: 'Test CSM',
        content: 'schema:\n  name: test\n',
        contentHash: 'abc123',
        dependencies: [],
      },
      {
        id: 'app-admin',
        type: 'app',
        label: 'Admin App',
        content: '<html><body>Hello</body></html>',
        contentHash: 'def456',
        dependencies: ['csm-test'],
      },
    ],
    manifest: '',
    createdAt: '2026-03-20T14:30:00Z',
    updatedAt: '2026-03-20T14:30:00Z',
    ...overrides,
  };
}

/** Build a raw ZIP buffer with arbitrary entries (for negative tests). */
async function rawZip(entries: Array<{ name: string; content: string }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 0 } });
    const chunks: Buffer[] = [];
    archive.on('data', (d: Buffer) => chunks.push(d));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    for (const e of entries) {
      archive.append(e.content, { name: e.name });
    }
    archive.finalize();
  });
}

/**
 * Build a ZIP buffer that preserves exact filenames including path traversal.
 * archiver normalizes paths, so we construct the ZIP manually for security tests.
 */
function rawZipManual(entries: Array<{ name: string; content: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const centralDir: Buffer[] = [];
  const offsets: number[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf-8');
    const data = entry.content;
    offsets.push(offset);

    // Local file header (30 + name + data)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);  // local file header signature
    localHeader.writeUInt16LE(20, 4);           // version needed
    localHeader.writeUInt16LE(0, 6);            // flags
    localHeader.writeUInt16LE(0, 8);            // compression: stored
    localHeader.writeUInt16LE(0, 10);           // mod time
    localHeader.writeUInt16LE(0, 12);           // mod date
    localHeader.writeUInt32LE(0, 14);           // crc32 (0 for simplicity)
    localHeader.writeUInt32LE(data.length, 18); // compressed size
    localHeader.writeUInt32LE(data.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26); // filename length
    localHeader.writeUInt16LE(0, 28);           // extra field length

    parts.push(localHeader, nameBytes, data);
    offset += 30 + nameBytes.length + data.length;

    // Central directory entry (46 + name)
    const cdEntry = Buffer.alloc(46);
    cdEntry.writeUInt32LE(0x02014b50, 0);  // central dir signature
    cdEntry.writeUInt16LE(20, 4);          // version made by
    cdEntry.writeUInt16LE(20, 6);          // version needed
    cdEntry.writeUInt16LE(0, 8);           // flags
    cdEntry.writeUInt16LE(0, 10);          // compression
    cdEntry.writeUInt16LE(0, 12);          // mod time
    cdEntry.writeUInt16LE(0, 14);          // mod date
    cdEntry.writeUInt32LE(0, 16);          // crc32
    cdEntry.writeUInt32LE(data.length, 20); // compressed size
    cdEntry.writeUInt32LE(data.length, 24); // uncompressed size
    cdEntry.writeUInt16LE(nameBytes.length, 28); // filename length
    cdEntry.writeUInt16LE(0, 30);          // extra field length
    cdEntry.writeUInt16LE(0, 32);          // comment length
    cdEntry.writeUInt16LE(0, 34);          // disk number start
    cdEntry.writeUInt16LE(0, 36);          // internal attrs
    cdEntry.writeUInt32LE(0, 38);          // external attrs
    cdEntry.writeUInt32LE(offsets[offsets.length - 1], 42); // local header offset

    centralDir.push(cdEntry, nameBytes);
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const cd of centralDir) cdSize += cd.length;

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);              // disk number
  eocd.writeUInt16LE(0, 6);              // disk with central dir
  eocd.writeUInt16LE(entries.length, 8); // entries on disk
  eocd.writeUInt16LE(entries.length, 10);// total entries
  eocd.writeUInt32LE(cdSize, 12);        // central dir size
  eocd.writeUInt32LE(cdOffset, 16);      // central dir offset
  eocd.writeUInt16LE(0, 20);             // comment length

  return Buffer.concat([...parts, ...centralDir, eocd]);
}

const defaultOpts = { maxSizeMb: 50 };

// ---------------------------------------------------------------------------
// buildZip tests
// ---------------------------------------------------------------------------

describe('buildZip', () => {
  it('produces a valid ZIP buffer with manifest and components', async () => {
    const pkg = makePkg();
    const buf = await buildZip(pkg);
    assert.ok(Buffer.isBuffer(buf), 'result should be a Buffer');
    assert.ok(buf.length > 0, 'buffer should not be empty');
    // PK magic bytes
    assert.equal(buf[0], 0x50, 'first byte should be P');
    assert.equal(buf[1], 0x4b, 'second byte should be K');
    assert.equal(buf[2], 0x03, 'third byte 0x03');
    assert.equal(buf[3], 0x04, 'fourth byte 0x04');
  });
});

// ---------------------------------------------------------------------------
// parseZip tests
// ---------------------------------------------------------------------------

describe('parseZip', () => {
  it('rejects non-ZIP data', async () => {
    const garbage = Buffer.from('this is not a zip file at all');
    await assert.rejects(() => parseZip(garbage, defaultOpts), (err: unknown) => {
      assert.ok(err instanceof ZipValidationError);
      assert.equal(err.code, 'INVALID_FORMAT');
      return true;
    });
  });

  it('rejects ZIP exceeding size limit', async () => {
    const pkg = makePkg();
    const buf = await buildZip(pkg);
    await assert.rejects(() => parseZip(buf, { maxSizeMb: 0.0001 }), (err: unknown) => {
      assert.ok(err instanceof ZipValidationError);
      assert.equal(err.code, 'SIZE_EXCEEDED');
      return true;
    });
  });

  it('rejects ZIP without manifest.yaml', async () => {
    const buf = await rawZip([{ name: 'random.txt', content: 'hello' }]);
    await assert.rejects(() => parseZip(buf, defaultOpts), (err: unknown) => {
      assert.ok(err instanceof ZipValidationError);
      assert.equal(err.code, 'MISSING_MANIFEST');
      return true;
    });
  });

  it('rejects path traversal attempts', async () => {
    // archiver normalizes paths, so we build the ZIP manually to preserve ../
    const buf = rawZipManual([
      { name: 'manifest.yaml', content: Buffer.from('aimeat-package: "1.0"\nname: x\nauthor: x\nversion: v1\ndescription: x\ncategory: x\ncomponents: []\n') },
      { name: '../../../etc/passwd', content: Buffer.from('root:x:0:0') },
    ]);
    try {
      await parseZip(buf, defaultOpts);
      assert.fail('should have thrown');
    } catch (err: unknown) {
      assert.ok(err instanceof ZipValidationError, `Expected ZipValidationError but got: ${err}`);
      assert.equal(err.code, 'PATH_TRAVERSAL');
    }
  });

  it('round-trips through buildZip → parseZip', async () => {
    const pkg = makePkg();
    const buf = await buildZip(pkg);
    const parsed = await parseZip(buf, defaultOpts);

    assert.equal(parsed.name, pkg.name);
    assert.equal(parsed.author, pkg.author);
    assert.equal(parsed.authorGhii, pkg.authorGhii);
    assert.equal(parsed.version, pkg.version);
    assert.equal(parsed.description, pkg.description);
    assert.equal(parsed.category, pkg.category);
    assert.deepEqual(parsed.tags, pkg.tags);
    assert.equal(parsed.changelog, pkg.changelog);
    assert.equal(parsed.components.length, pkg.components.length);
  });

  it('parses valid ZIP with manifest and components', async () => {
    const pkg = makePkg();
    const buf = await buildZip(pkg);
    const parsed = await parseZip(buf, defaultOpts);

    // Check each component
    const csmComp = parsed.components.find(c => c.id === 'csm-test');
    assert.ok(csmComp, 'should have csm-test component');
    assert.equal(csmComp.type, 'csm');
    assert.equal(csmComp.label, 'Test CSM');
    assert.equal(csmComp.content, 'schema:\n  name: test\n');
    assert.ok(csmComp.contentHash.length > 0, 'contentHash should not be empty');
    assert.deepEqual(csmComp.dependencies, []);

    const appComp = parsed.components.find(c => c.id === 'app-admin');
    assert.ok(appComp, 'should have app-admin component');
    assert.equal(appComp.type, 'app');
    assert.equal(appComp.label, 'Admin App');
    assert.equal(appComp.content, '<html><body>Hello</body></html>');
    assert.deepEqual(appComp.dependencies, ['csm-test']);

    // contentHash should be a hex SHA-256
    assert.match(csmComp.contentHash, /^[a-f0-9]{64}$/);
    assert.match(appComp.contentHash, /^[a-f0-9]{64}$/);
  });
});
