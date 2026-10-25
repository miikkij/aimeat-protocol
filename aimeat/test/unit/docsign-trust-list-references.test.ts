/**
 * @file test/unit/docsign-trust-list-references.test.ts
 * @description A member-state trusted list is read only where its XML signature covers the whole
 *   document: the empty reference URI, or the Id of the document element. A list whose signed
 *   element is wrapped in a new root that adds a provider is not trusted for that provider; a list
 *   signed by Id over its own root element is read as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/docsign-trust-list-references.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, trust-list.ts:trusted-list-read-outside-signed-references).
 */
import { describe, it, expect } from 'vitest';
import { validatePdf } from '../../src/services/docsign/validate.js';
import { clearTrustListCache } from '../../src/services/docsign/trust-list.js';
import { useTrustWorld, onlineConfig } from '../fixtures/docsign/trust-world-seams.js';
import { makeCertX, signPdfAs, trustedList, signXmlById } from '../fixtures/docsign/trust-fixtures.js';
import { name, newRsa } from '../fixtures/docsign/pdf-sign.js';

const tw = useTrustWorld();

const fresh = (() => {
  const caKey = newRsa();
  const caName = name('Added CA', 'Nobody', 'FI');
  const ca = { key: caKey.privateKey, cert: makeCertX({ subject: caName, issuer: caName, publicKey: caKey.publicKey, signer: caKey.privateKey, ca: true, serial: Buffer.from([0x01, 0x7e, 0x01]) }) };
  const sKey = newRsa();
  const signer = { key: sKey.privateKey, cert: makeCertX({ subject: name('Somebody', 'Nobody', 'FI'), issuer: caName, publicKey: sKey.publicKey, signer: ca.key, ca: false, serial: Buffer.from([0x01, 0x7e, 0x02]), qc: { sscd: true, type: 'esign' } }) };
  return { ca, signer };
})();

const addedService = [{ type: 'CA/QC', name: 'Added CA', cert: fresh.ca.cert, periods: [{ status: 'granted', from: '2020-01-01T00:00:00Z' }] }];

/** Serve `xml` as the FI list for one validation of a PDF signed under the added CA. */
async function validateWithFiList(xml: string) {
  const original = tw.world.files.get('/tl/fi.xml')!;
  tw.world.files.set('/tl/fi.xml', { body: Buffer.from(xml, 'utf8'), type: 'application/xml' });
  clearTrustListCache();
  try {
    const pdf = signPdfAs('ETSI.CAdES.detached', fresh.signer.cert, fresh.signer.key, [fresh.ca.cert], 'Signed under the added CA');
    return (await validatePdf(onlineConfig(), pdf)).signatures[0]!;
  } finally {
    tw.world.files.set('/tl/fi.xml', original);
    clearTrustListCache();
  }
}

describe('a member-state list read outside what its signature covers', () => {
  it('a provider added outside the signed element is not trusted', async () => {
    const { key, cert } = tw.world.keys.fiListSigner;
    const signedInner = signXmlById(trustedList('FI', 'Test QTSP FI', []), key, cert, 'tsl-FI').replace(/^<\?xml[^>]*\?>/, '');
    const added = trustedList('FI', 'Added TSP', addedService);
    const addedProviders = added.slice(added.indexOf('<TrustServiceProviderList>'), added.indexOf('</TrustServiceStatusList>'));
    const wrapped = `<?xml version="1.0" encoding="UTF-8"?><Wrapper xmlns="http://uri.etsi.org/02231/v2#">${signedInner}${addedProviders}</Wrapper>`;
    const s = await validateWithFiList(wrapped);
    expect(s.trust.source).not.toBe('eu-trusted-list');
    expect(s.level).not.toBe('qualified');
  });

  it('a list signed by Id over its own root element is read', async () => {
    const { key, cert } = tw.world.keys.fiListSigner;
    const s = await validateWithFiList(signXmlById(trustedList('FI', 'Test QTSP FI', addedService), key, cert, 'tsl-FI'));
    expect(s.trust.source).toBe('eu-trusted-list');
  });
});
