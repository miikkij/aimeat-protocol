/**
 * @file rust-notices.test.mjs
 * @description Checks licence alternatives, required notices and missing-text refusal.
 * @version-history v1.0.0 - 2026-11-09 - Cover the Desktop Rust notices generator.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { selectLicense, renderRustNotices, readCrateLicenseTexts } from '../scripts/rust-notices.mjs';

test('permissive alternatives avoid GPL and preserve every AND obligation', () => {
  assert.deepEqual(selectLicense('Apache-2.0 OR GPL-2.0-only'), ['Apache-2.0']);
  assert.deepEqual(selectLicense('(MIT OR Apache-2.0) AND Unicode-3.0'), ['MIT', 'Unicode-3.0']);
  assert.deepEqual(selectLicense('MIT/Apache-2.0'), ['MIT']);
  assert.throws(() => selectLicense('GPL-3.0-only'), /Unsupported/);
});

test('notices carry the locked package version, source and actual copyright text', async () => {
  const packages = [{ name: 'fixture-library', version: '1.2.3', license: 'MIT', source: 'registry+https://github.com/rust-lang/crates.io-index' }];
  const text = 'MIT License\nCopyright (c) 2026 Fixture Author\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.';
  const notice = await renderRustNotices(packages, async () => [
    { name: 'LICENSE', text, source: 'crate:LICENSE' },
    { name: 'NOTICE.txt', text: 'Required fixture attribution from upstream.', source: 'crate:NOTICE.txt' },
  ]);
  assert.match(notice, /fixture-library 1\.2\.3/);
  assert.match(notice, /https:\/\/crates.io\/api\/v1\/crates\/fixture-library\/1.2.3\/download/);
  assert.match(notice, /Copyright \(c\) 2026 Fixture Author/);
  assert.match(notice, /Required fixture attribution from upstream\./);
});

test('a missing licence text fails the stage instead of producing an empty notice', async () => {
  const packages = [{ name: 'missing-text', version: '1.0.0', license: 'MIT', source: 'registry+https://github.com/rust-lang/crates.io-index' }];
  await assert.rejects(renderRustNotices(packages, async () => []), /missing-text.*MIT/);
});

test('a crate licence-file declaration cannot read outside its own source folder', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'aimeat-rust-notices-test-'));
  try {
    const root = join(fixture, 'crate');
    mkdirSync(root);
    writeFileSync(join(fixture, 'private.txt'), 'not a redistributable licence');
    assert.throws(() => readCrateLicenseTexts({ name: 'fixture', manifest_path: join(root, 'Cargo.toml'), license_file: '../private.txt' }), /outside its published crate/);
  } finally {
    assert.equal(dirname(resolve(fixture)), resolve(tmpdir()));
    rmSync(fixture, { recursive: true });
  }
});
