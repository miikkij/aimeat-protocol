/**
 * @file test/unit/finance-core.test.ts
 * @description Unit tests for the finance domain's pure core: payment references
 *   (Finnish viite 7-3-1 + ISO 11649 RF with published test vectors), VAT line math,
 *   the Finnish VAT seed registry's date-windowed resolution (14 % vs 13.5 % across
 *   the 2026-01-01 rate change), and Finvoice 3.0 XML generation validated against
 *   the official vendored Finanssiala XSD (invoice, credit note and minimal variants).
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 1.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateXML } from 'xmllint-wasm';
import {
  finnishReference, isValidFinnishReference, rfReference, isValidRfReference,
} from '../../src/services/finance/reference-number.js';
import { buildFinvoiceXml } from '../../src/services/finance/finvoice.js';
import type { InvoiceRecord } from '../../src/models/finance-schemas.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { vatCodesValidOn, requireVatCode, resetVatSeedCache } from '../../src/services/finance/vat-codes.js';

const here = dirname(fileURLToPath(import.meta.url));
const XSD = readFileSync(join(here, '../../resources/finvoice/Finvoice3.0.xsd'), 'utf-8');

describe('finnish reference (viitenumero)', () => {
  it('computes the 7-3-1 check digit', () => {
    // Weights from the right: 3*7 + 2*3 + 1*1 = 28 → check (10 - 8) % 10 = 2
    expect(finnishReference('123')).toBe('1232');
    // 4*7 + 9*3 + 4*1 = 59 → check (10 - 9) % 10 = 1
    expect(finnishReference('494')).toBe('4941');
  });
  it('round-trips through the validator', () => {
    for (const base of ['123', '1000014', '99999999', '2026000042']) {
      expect(isValidFinnishReference(finnishReference(base))).toBe(true);
    }
    expect(isValidFinnishReference('1233')).toBe(false);
    expect(isValidFinnishReference('abc')).toBe(false);
  });
  it('rejects out-of-range bases', () => {
    expect(() => finnishReference('12')).toThrow();
    expect(() => finnishReference('1'.repeat(20))).toThrow();
  });
});

describe('RF creditor reference (ISO 11649)', () => {
  it('matches the published ISO 11649 test vector', () => {
    expect(rfReference('539007547034')).toBe('RF18539007547034');
  });
  it('round-trips through the validator', () => {
    for (const base of ['539007547034', '1000014', 'ABC123']) {
      expect(isValidRfReference(rfReference(base))).toBe(true);
    }
    expect(isValidRfReference('RF19539007547034')).toBe(false);
  });
});

describe('VAT code registry', () => {
  it('resolves 14 % for a 2025 date and 13.5 % for a 2026 date', async () => {
    resetVatSeedCache();
    const s = new SqliteStorage(':memory:') as unknown as Storage;
    const on2025 = await vatCodesValidOn(s, '2025-06-15');
    const on2026 = await vatCodesValidOn(s, '2026-08-06');
    expect(on2025.some((c) => c.rateBp === 1400)).toBe(true);
    expect(on2025.some((c) => c.rateBp === 1350)).toBe(false);
    expect(on2026.some((c) => c.rateBp === 1350)).toBe(true);
    expect(on2026.some((c) => c.rateBp === 1400)).toBe(false);
    // A 2026 document may not book the expired 14 % code.
    await expect(requireVatCode(s, 'fi-red-1400', '2026-08-06')).rejects.toThrow(/not valid/);
    await expect(requireVatCode(s, 'fi-red-1350', '2026-08-06')).resolves.toMatchObject({ rateBp: 1350 });
    (s as unknown as SqliteStorage).close();
  });
});

function sentInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  const now = new Date().toISOString();
  return {
    id: 'inv-1', ownerGhii: 'o@n', organismId: null, type: 'invoice', creditsInvoiceId: null,
    status: 'sent', numberSeq: 14, invoiceNumber: '2026-14',
    seller: {
      name: 'Overscale Solutions Oy', businessId: '3323553-5', vatId: 'FI33235535',
      streetAddress: 'Testikatu 1', postalCode: '02100', city: 'Espoo', country: 'FI',
      iban: 'FI2112345600000785', bic: 'NDEAFIHH',
    },
    buyer: {
      name: 'Ostaja Oy', businessId: '1234567-8',
      streetAddress: 'Ostajankuja 2', postalCode: '00100', city: 'Helsinki', country: 'FI',
    },
    lines: [
      { description: 'Konsultointi & kehitys <erikoismerkit>', quantityMilli: 1500, unit: 'h', unitPriceMinor: 10000, vatCodeId: 'fi-std-2550', vatRateBp: 2550, netMinor: 15000, vatMinor: 3825, grossMinor: 18825 },
      { description: 'Lisenssi', quantityMilli: 1000, unit: 'kpl', unitPriceMinor: 4990, vatCodeId: 'fi-std-2550', vatRateBp: 2550, netMinor: 4990, vatMinor: 1272, grossMinor: 6262 },
    ],
    currency: 'EUR', totalNetMinor: 19990, totalVatMinor: 5097, totalGrossMinor: 25087,
    vatBreakdown: [{ vatCodeId: 'fi-std-2550', vatRateBp: 2550, netMinor: 19990, vatMinor: 5097 }],
    referenceNumber: '10000141', paymentTermsDays: 14, invoiceDate: '2026-08-06', dueDate: '2026-08-20',
    deliveryMethod: 'finvoice', sentAt: now, deliveryStatus: 'pending',
    operatorMessageId: null, finvoiceXmlKey: null, paidAt: null, paidTrackingCode: null,
    externalRef: null, fiscalYearId: 'fy', notes: null, createdAt: now, updatedAt: now,
    ...overrides,
  };
}

async function expectValid(xml: string): Promise<void> {
  const result = await validateXML({ xml: [{ fileName: 'invoice.xml', contents: xml }], schema: [XSD] });
  const errors = result.valid ? '' : result.errors.map((e) => e.message).join('\n');
  expect(errors).toBe('');
  expect(result.valid).toBe(true);
}

describe('Finvoice 3.0 generation', () => {
  it('a full invoice validates against the official XSD', async () => {
    const xml = buildFinvoiceXml(sentInvoice());
    await expectValid(xml);
    expect(xml).toContain('<InvoiceTypeCode>INV01</InvoiceTypeCode>');
    expect(xml).toContain('<InvoiceTotalVatIncludedAmount AmountCurrencyIdentifier="EUR">250,87<');
    expect(xml).toContain('<RowVatRatePercent>25,5</RowVatRatePercent>');
    expect(xml).toContain('IdentificationSchemeName="SPY">10000141<');
    expect(xml).toContain('&amp; kehitys &lt;erikoismerkit&gt;');
  });

  it('a credit note carries INV02 + the original number and validates', async () => {
    const xml = buildFinvoiceXml(
      sentInvoice({ type: 'credit_note', creditsInvoiceId: 'inv-1', invoiceNumber: '2026-15', referenceNumber: 'RF181000015' }),
      { originalInvoiceNumber: '2026-14' },
    );
    await expectValid(xml);
    expect(xml).toContain('<InvoiceTypeCode>INV02</InvoiceTypeCode>');
    expect(xml).toContain('<OriginalInvoiceNumber>2026-14</OriginalInvoiceNumber>');
    expect(xml).toContain('IdentificationSchemeName="ISO">RF181000015<');
  });

  it('a minimal invoice (no addresses, no business ids) validates', async () => {
    const xml = buildFinvoiceXml(sentInvoice({
      seller: { name: 'Myyjä Tmi', iban: 'FI2112345600000785' },
      buyer: { name: 'Yksityishenkilö Asiakas' },
    }));
    await expectValid(xml);
  });

  it('refuses to generate for a draft (no number assigned)', () => {
    expect(() => buildFinvoiceXml(sentInvoice({ invoiceNumber: null }))).toThrow(/sent invoice/);
  });

  it('refuses without a seller IBAN (payment instructions are mandatory)', () => {
    expect(() => buildFinvoiceXml(sentInvoice({ seller: { name: 'Myyjä Tmi' } }))).toThrow(/iban/i);
  });
});
