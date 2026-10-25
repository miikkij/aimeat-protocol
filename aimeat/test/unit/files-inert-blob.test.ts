/**
 * @file test/unit/files-inert-blob.test.ts
 * @description Profile > Memory > Files opens a private file in a new tab through an object URL on
 *   the node's own origin. A blob whose stored type could run script (HTML, SVG, XML) opens as plain
 *   text, any other type off the inline list as an octet-stream, and images, PDFs, media and plain
 *   text keep their own type, so they still open as themselves.
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, Files view object URL on the node's origin).
 */
import { describe, it, expect } from 'vitest';
import { inertBlob, isInlineSafeType } from '../../public/views/profile/memory-tab/inert-blob.js';

const blob = (type: string) => new Blob(['<h1>x</h1>'], { type });

describe('inertBlob', () => {
  for (const t of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/xml', 'application/xml']) {
    it(`${t} opens as plain text`, () => { expect(inertBlob(blob(t)).type).toBe('text/plain;charset=utf-8'); });
  }
  for (const t of ['application/zip', 'application/octet-stream', 'image/png, text/html']) {
    it(`${t} is saved, not rendered`, () => { expect(inertBlob(blob(t)).type).toBe('application/octet-stream'); });
  }
  for (const t of ['image/png', 'image/jpeg', 'application/pdf', 'video/mp4', 'audio/mpeg', 'text/plain']) {
    it(`${t} keeps its type`, () => {
      const b = blob(t);
      expect(inertBlob(b)).toBe(b);
      expect(isInlineSafeType(t)).toBe(true);
    });
  }
  it('keeps the bytes', async () => { expect(await inertBlob(blob('text/html')).text()).toBe('<h1>x</h1>'); });
});
