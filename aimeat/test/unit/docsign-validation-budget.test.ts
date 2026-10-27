/**
 * @file test/unit/docsign-validation-budget.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One public signature check does work bounded by the file it was given. A PDF may name
 *   any number of distinct /ByteRange arrays over one signature, and each became a field that copied
 *   the signed bytes and asked the certificate's issuer and revocation addresses again. Now a file
 *   with more fields than docsign.max_signatures is refused with a sentence that names the setting, a
 *   field holds no copy of its signed bytes, and one check makes at most docsign.max_fetches outbound
 *   requests, saying so in the report when it stops. Both settings have a no-limit value (0), and a
 *   real signed PDF validates exactly as before (secaudit2026oct26:
 *   extractPdfSignatures:unbounded-field-count and validatePdf:no-outbound-budget).
 * @usage cd aimeat && pnpm exec vitest run test/unit/docsign-validation-budget.test.ts
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, expect, it } from 'vitest';
import { extractPdfSignatures } from '../../src/services/docsign/pdf-extract.js';
import { validatePdf, ValidationInputError } from '../../src/services/docsign/validate.js';
import type { AimeatConfig } from '../../src/config.js';
import { onlineConfig, useTrustWorld } from '../fixtures/docsign/trust-world-seams.js';

const state = useTrustWorld();

/** The PDF with `extra` more distinct /ByteRange arrays over its first signature's /Contents gap. */
function multiField(pdf: Buffer, extra: number): Buffer {
  const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(pdf.toString('latin1'))!;
  const [b, c, d] = [Number(m[2]), Number(m[3]), Number(m[4])];
  const lines = Array.from({ length: extra }, (_, k) => `\n/ByteRange [0 ${b} ${c} ${d - 1 - k}]`).join('');
  return Buffer.concat([pdf, Buffer.from(lines, 'latin1')]);
}

const withSettings = (s: Record<string, number>): AimeatConfig => ({ ...onlineConfig(), ...s }) as AimeatConfig;
const outbound = () => state.fetched.filter((u) => /\/(ocsp|crl)\//.test(u)).length;

describe('a real signed PDF validates as before', () => {
  it('the qualified PDF is valid, qualified, with OCSP good, under the default settings', async () => {
    const r = await validatePdf(onlineConfig(), state.world.pdf.qualified);
    expect(r.verdict).toBe('valid');
    expect(r.signatures).toHaveLength(1);
    expect(r.signatures[0]!.level).toBe('qualified');
    expect(r.signatures[0]!.revocation.status).toBe('good');
  });

  it('the document timestamp PDF keeps its verdict', async () => {
    const r = await validatePdf(onlineConfig(), state.world.pdf.docTimestamp);
    expect(r.signatures.some((s) => s.kind === 'document-timestamp')).toBe(true);
    expect(r.verdict).not.toBe('invalid');
  });
});

describe('the number of signature fields', () => {
  it('a file naming more fields than docsign.max_signatures is refused, and the refusal names the setting', async () => {
    const pdf = multiField(state.world.pdf.qualified, 150);
    const started = performance.now();
    const err = await validatePdf(onlineConfig(), pdf, { online: false }).catch((e: unknown) => e);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(err).toBeInstanceOf(ValidationInputError);
    expect((err as ValidationInputError).code).toBe('TOO_MANY_SIGNATURES');
    expect((err as Error).message).toMatch(/docsign\.max_signatures/);
  });

  it('0 is no limit', async () => {
    const r = await validatePdf(withSettings({ docsignMaxSignatures: 0 }), multiField(state.world.pdf.qualified, 60), { online: false });
    expect(r.signatures).toHaveLength(61);
  }, 60_000);

  it('a field holds no copy of the bytes it signs; they are made when read', () => {
    const [f] = extractPdfSignatures(state.world.pdf.qualified);
    expect(typeof Object.getOwnPropertyDescriptor(f!, 'signedBytes')?.get).toBe('function');
    expect(f!.signedBytes.length).toBe(f!.byteRange[1] + f!.byteRange[3]);
  });
});

describe('the outbound requests of one check', () => {
  it('stop at docsign.max_fetches, and the report says why', async () => {
    const before = outbound();
    const r = await validatePdf(withSettings({ docsignMaxFetches: 5 }), multiField(state.world.pdf.qualified, 30));
    expect(outbound() - before).toBeLessThanOrEqual(5);
    expect(r.signatures.some((s) => s.revocation.notes.some((n) => /docsign\.max_fetches/.test(n)))).toBe(true);
  });

  it('0 is no limit', async () => {
    const before = outbound();
    await validatePdf(withSettings({ docsignMaxFetches: 0 }), multiField(state.world.pdf.qualified, 30));
    expect(outbound() - before).toBeGreaterThan(5);
  });
});
