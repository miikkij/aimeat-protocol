/**
 * @file test/unit/content-type-sniff.test.ts
 * @description The stored-file routes declare `charset=utf-8` only after the bytes earn it. This is
 *   the test for the LIMIT rather than for the feature: the interesting case is the cp1252 `.txt`
 *   somebody uploaded, which is served correctly today and would be corrupted by a blanket
 *   declaration. The decode test is the same method the Phase 4 corpus scan settled on after a glyph
 *   signature produced a false positive.
 * @structure one describe for appContentType (node-generated), one for sniffedContentType (uploaded).
 * @usage pnpm exec vitest run test/unit/content-type-sniff.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 5 step 0b.
 */
import { describe, it, expect } from 'vitest';
import { appContentType, sniffedContentType } from '../../src/utils/app-content-type.js';

/** "Tekoälyn tuottama" the way a Windows text editor in western Europe would have written it. */
const CP1252 = Buffer.from([0x54, 0x65, 0x6b, 0x6f, 0xe4, 0x6c, 0x79, 0x6e]);   // Teko<E4>lyn
const UTF8 = Buffer.from('Tekoälyn tuottama', 'utf-8');
const ASCII = Buffer.from('plain ascii', 'utf-8');

describe('appContentType — content the node itself generates', () => {
  it('declares utf-8 on a textual type', () => {
    expect(appContentType('text/html')).toBe('text/html; charset=utf-8');
  });
  it('keeps a charset the author already stated', () => {
    expect(appContentType('text/html; charset=iso-8859-1')).toBe('text/html; charset=iso-8859-1');
  });
  it('says nothing about a binary type', () => {
    expect(appContentType('image/png')).toBe('image/png');
  });
});

describe('sniffedContentType — bytes somebody uploaded', () => {
  it('declares utf-8 when the bytes really are utf-8', () => {
    expect(sniffedContentType('text/plain', UTF8)).toBe('text/plain; charset=utf-8');
  });

  // THE ONE THAT MATTERS. This file renders correctly today because nothing declares an encoding
  // and the browser falls back to the locale default. Declaring utf-8 over it would break it.
  it('leaves a genuinely cp1252 file exactly as it is served today', () => {
    expect(sniffedContentType('text/plain', CP1252)).toBe('text/plain');
    expect(sniffedContentType('text/csv', CP1252)).toBe('text/csv');
  });

  it('declares utf-8 on pure ASCII, which is utf-8', () => {
    expect(sniffedContentType('text/csv', ASCII)).toBe('text/csv; charset=utf-8');
  });

  it('never touches a binary type, whatever the bytes look like', () => {
    expect(sniffedContentType('image/png', CP1252)).toBe('image/png');
    expect(sniffedContentType('application/pdf', UTF8)).toBe('application/pdf');
  });

  it('respects a charset the uploader stated', () => {
    expect(sniffedContentType('text/plain; charset=windows-1252', UTF8))
      .toBe('text/plain; charset=windows-1252');
  });

  it('says nothing when there are no bytes to look at', () => {
    expect(sniffedContentType('text/plain', undefined)).toBe('text/plain');
  });
});
