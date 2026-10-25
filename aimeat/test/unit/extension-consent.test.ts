/**
 * @file test/unit/extension-consent.test.ts
 * @description extensionConsentHolds (services/extension-consent.ts), the check ctx.notify's
 *   cross-owner delivery and ctx.email's tier 1 ask: a consent counts for the extension installed
 *   under the name now, granted at or after its install, unexpired, of the right purpose and pattern.
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, extension-uninstall:name-keyed-consents-survive-reinstall).
 */
import { describe, it, expect } from 'vitest';
import { extensionConsentHolds } from '../../src/services/extension-consent.js';
import type { ConsentRecord, ExtensionRecord } from '../../src/storage/interface.js';

const OWNER = 'target@node-1';
const INSTALLED = '2026-10-25T10:00:00.000Z';

function consent(over: Partial<ConsentRecord>): ConsentRecord {
  return {
    id: 'c1', ownerGaii: OWNER, dataPattern: 'ext:watch', recipient: '*', purpose: 'extension_email',
    scope: 'local', expires: null, status: 'active', grantedAt: '2026-10-25T11:00:00.000Z', revokedAt: null,
    ...over,
  } as ConsentRecord;
}

function storage(consents: ConsentRecord[], installedAt: string | null) {
  return {
    listConsents: async () => consents,
    getExtension: async (name: string) => (installedAt && name === 'watch' ? { name, installedAt } as ExtensionRecord : null),
  };
}

describe('extensionConsentHolds', () => {
  it('counts a consent granted after the current install', async () => {
    expect(await extensionConsentHolds(storage([consent({})], INSTALLED), OWNER, 'extension_email', 'watch')).toBe(true);
  });
  it('does not count a consent granted before the current install (a freed name taken again)', async () => {
    const c = consent({ grantedAt: '2026-10-25T09:00:00.000Z' });
    expect(await extensionConsentHolds(storage([c], INSTALLED), OWNER, 'extension_email', 'watch')).toBe(false);
  });
  it('does not count an expired consent the sweep has not reached yet', async () => {
    const c = consent({ expires: '2026-10-25T12:00:00.000Z' });
    expect(await extensionConsentHolds(storage([c], INSTALLED), OWNER, 'extension_email', 'watch', new Date('2026-10-25T13:00:00.000Z'))).toBe(false);
    expect(await extensionConsentHolds(storage([c], INSTALLED), OWNER, 'extension_email', 'watch', new Date('2026-10-25T11:30:00.000Z'))).toBe(true);
  });
  it('asks the purpose and the pattern, and answers false when no extension holds the name', async () => {
    expect(await extensionConsentHolds(storage([consent({})], INSTALLED), OWNER, 'extension_notify', 'watch')).toBe(false);
    expect(await extensionConsentHolds(storage([consent({ dataPattern: 'ext:other' })], INSTALLED), OWNER, 'extension_email', 'watch')).toBe(false);
    expect(await extensionConsentHolds(storage([consent({})], null), OWNER, 'extension_email', 'watch')).toBe(false);
  });
});
