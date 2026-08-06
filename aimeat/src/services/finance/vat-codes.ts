/**
 * @file src/services/finance/vat-codes.ts
 * @description The Finnish VAT-code seed registry and the resolution helpers. Rates are
 *   DATA with validity windows, never hardcoded into calculations: the reduced rate
 *   changed 14 % → 13.5 % on 2026-01-01 (verified against vero.fi 2026-08-06), so an
 *   invoice dated 2025 books 14 % and one dated 2026 books 13.5 % — both codes exist
 *   side by side and pickVatCode() selects by document date.
 * @structure FI_VAT_SEED — the registry · ensureVatCodesSeeded() — idempotent boot seed ·
 *   vatCodesValidOn() / requireVatCode() — resolution
 * @usage const codes = await vatCodesValidOn(storage, '2026-08-06');
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 1.
 */
import type { Storage } from '../../storage/interface.js';
import type { VatCodeRecord } from '../../models/finance-schemas.js';
import { FinanceError } from './errors.js';

/**
 * Finnish VAT codes as of 2026-08-06 (source: vero.fi / arvonlisäveroprosentit).
 * createdAt/updatedAt are stamped at seed time.
 */
const FI_VAT_SEED: Omit<VatCodeRecord, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'fi-std-2550', countryCode: 'FI', category: 'standard', rateBp: 2550,
    label: { en: 'Standard rate 25.5 %', fi: 'Yleinen verokanta 25,5 %' },
    validFrom: '2024-09-01', validTo: null,
  },
  {
    id: 'fi-red-1400', countryCode: 'FI', category: 'reduced', rateBp: 1400,
    label: { en: 'Reduced rate 14 % (until 2025-12-31)', fi: 'Alennettu verokanta 14 % (31.12.2025 asti)' },
    validFrom: '2013-01-01', validTo: '2025-12-31',
  },
  {
    id: 'fi-red-1350', countryCode: 'FI', category: 'reduced', rateBp: 1350,
    label: { en: 'Reduced rate 13.5 % (food, books, medicine, transport...)', fi: 'Alennettu verokanta 13,5 % (ruoka, kirjat, lääkkeet, henkilökuljetus...)' },
    validFrom: '2026-01-01', validTo: null,
  },
  {
    id: 'fi-red-1000', countryCode: 'FI', category: 'reduced', rateBp: 1000,
    label: { en: 'Reduced rate 10 % (newspapers and magazines)', fi: 'Alennettu verokanta 10 % (sanoma- ja aikakauslehdet)' },
    validFrom: '2013-01-01', validTo: null,
  },
  {
    id: 'fi-zero', countryCode: 'FI', category: 'zero', rateBp: 0,
    label: { en: 'Zero rate 0 % (exports, intra-EU supplies)', fi: 'Nollaverokanta 0 % (vienti, yhteisömyynti)' },
    validFrom: '2013-01-01', validTo: null,
  },
  {
    id: 'fi-exempt', countryCode: 'FI', category: 'exempt', rateBp: 0,
    label: { en: 'VAT exempt (healthcare, financial services...)', fi: 'Arvonlisäveroton (terveydenhuolto, rahoituspalvelut...)' },
    validFrom: '2013-01-01', validTo: null,
  },
  {
    id: 'fi-reverse', countryCode: 'FI', category: 'reverse_charge', rateBp: 0,
    label: { en: 'Reverse charge (construction, EU services)', fi: 'Käännetty verovelvollisuus (rakentaminen, EU-palvelut)' },
    validFrom: '2013-01-01', validTo: null,
  },
];

let seeded: Promise<void> | null = null;

/**
 * Idempotent seed of the Finnish registry. Upserts by id, so a re-boot updates labels but
 * an operator's own added codes are untouched. Cached per process: the first finance
 * request pays one round of upserts, the rest pay nothing.
 */
export function ensureVatCodesSeeded(storage: Storage): Promise<void> {
  if (!seeded) {
    seeded = (async () => {
      const now = new Date().toISOString();
      for (const code of FI_VAT_SEED) {
        await storage.upsertVatCode({ ...code, createdAt: now, updatedAt: now });
      }
    })().catch((e) => {
      seeded = null;   // a failed seed retries on the next request instead of caching the failure
      throw e;
    });
  }
  return seeded;
}

/** Test hook: reset the per-process seed cache (used when the same process boots several storages). */
export function resetVatSeedCache(): void {
  seeded = null;
}

/** Codes whose validity window contains the given ISO date. */
export async function vatCodesValidOn(storage: Storage, isoDate: string): Promise<VatCodeRecord[]> {
  await ensureVatCodesSeeded(storage);
  const all = await storage.listVatCodes();
  return all.filter((c) => c.validFrom <= isoDate && (c.validTo === null || isoDate <= c.validTo));
}

/** Resolves a VAT code id and checks it is valid on the document date. */
export async function requireVatCode(storage: Storage, id: string, isoDate: string): Promise<VatCodeRecord> {
  await ensureVatCodesSeeded(storage);
  const code = await storage.getVatCode(id);
  if (!code) throw new FinanceError('VAT_CODE_UNKNOWN', 422, `Unknown VAT code: ${id}`);
  if (code.validFrom > isoDate || (code.validTo !== null && isoDate > code.validTo)) {
    throw new FinanceError('VAT_CODE_NOT_VALID', 422, `VAT code ${id} is not valid on ${isoDate}`);
  }
  return code;
}
