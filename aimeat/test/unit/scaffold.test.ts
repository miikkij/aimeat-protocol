import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeFileHash, readManifest, writeManifest, scaffoldFiles } from '../../src/cli/scaffold.js';
import type { ScaffoldManifest } from '../../src/cli/scaffold.js';

describe('scaffold', () => {
  let srcDir: string;
  let targetDir: string;

  beforeEach(() => {
    srcDir = mkdtempSync(join(tmpdir(), 'scaffold-src-'));
    targetDir = mkdtempSync(join(tmpdir(), 'scaffold-target-'));

    // Create source asset structure
    mkdirSync(join(srcDir, 'public', 'css'), { recursive: true });
    mkdirSync(join(srcDir, 'public', 'js'), { recursive: true });
    mkdirSync(join(srcDir, 'locales'), { recursive: true });
    mkdirSync(join(srcDir, 'static', 'icons'), { recursive: true });

    writeFileSync(join(srcDir, 'public', 'css', 'theme.css'), 'body { color: red; }');
    writeFileSync(join(srcDir, 'public', 'js', 'app.js'), 'console.log("hi")');
    writeFileSync(join(srcDir, 'locales', 'en.json'), '{"hello":"world"}');
    writeFileSync(join(srcDir, 'static', 'manifest.json'), '{"name":"test"}');
    writeFileSync(join(srcDir, 'static', 'icons', 'icon.svg'), '<svg/>');
  });

  afterEach(() => {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  });

  describe('computeFileHash', () => {
    it('returns consistent SHA256 hex for file content', () => {
      const path = join(srcDir, 'public', 'css', 'theme.css');
      const hash1 = computeFileHash(path);
      const hash2 = computeFileHash(path);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('readManifest / writeManifest', () => {
    it('returns null when no manifest exists', () => {
      expect(readManifest(targetDir)).toBeNull();
    });

    it('round-trips a manifest', () => {
      const manifest: ScaffoldManifest = {
        version: '1.2.0',
        scaffoldedAt: '2026-03-07T00:00:00Z',
        files: { 'public/css/theme.css': 'abc123' },
      };
      writeManifest(targetDir, manifest);
      expect(readManifest(targetDir)).toEqual(manifest);
    });
  });

  describe('scaffoldFiles', () => {
    it('copies all files on fresh scaffold', () => {
      const result = scaffoldFiles(srcDir, targetDir, '1.2.0');
      expect(result.copied).toBeGreaterThanOrEqual(5);
      expect(result.skippedModified).toBe(0);
      expect(result.updated).toBe(0);
      expect(existsSync(join(targetDir, 'public', 'css', 'theme.css'))).toBe(true);
      expect(existsSync(join(targetDir, 'locales', 'en.json'))).toBe(true);
      expect(existsSync(join(targetDir, 'static', 'manifest.json'))).toBe(true);
      const manifest = readManifest(targetDir);
      expect(manifest).not.toBeNull();
      expect(manifest!.files['public/css/theme.css']).toBeDefined();
    });

    it('updates unmodified files on re-scaffold', () => {
      scaffoldFiles(srcDir, targetDir, '1.2.0');
      writeFileSync(join(srcDir, 'public', 'css', 'theme.css'), 'body { color: blue; }');
      const result = scaffoldFiles(srcDir, targetDir, '1.3.0');
      expect(result.updated).toBeGreaterThanOrEqual(1);
      expect(readFileSync(join(targetDir, 'public', 'css', 'theme.css'), 'utf-8')).toBe('body { color: blue; }');
    });

    it('skips user-modified files', () => {
      scaffoldFiles(srcDir, targetDir, '1.2.0');
      writeFileSync(join(targetDir, 'public', 'css', 'theme.css'), 'body { color: green; /* custom */ }');
      writeFileSync(join(srcDir, 'public', 'css', 'theme.css'), 'body { color: blue; }');
      const result = scaffoldFiles(srcDir, targetDir, '1.3.0');
      expect(result.skippedModified).toBeGreaterThanOrEqual(1);
      expect(readFileSync(join(targetDir, 'public', 'css', 'theme.css'), 'utf-8')).toBe('body { color: green; /* custom */ }');
    });

    it('copies new files that did not exist before', () => {
      scaffoldFiles(srcDir, targetDir, '1.2.0');
      writeFileSync(join(srcDir, 'public', 'js', 'new.js'), 'new file');
      const result = scaffoldFiles(srcDir, targetDir, '1.3.0');
      expect(result.copied).toBeGreaterThanOrEqual(1);
      expect(existsSync(join(targetDir, 'public', 'js', 'new.js'))).toBe(true);
    });
  });
});
