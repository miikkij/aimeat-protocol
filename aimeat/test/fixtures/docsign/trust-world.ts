/**
 * @file test/fixtures/docsign/trust-world.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One complete, made-up EU trust world for the online half of signature validation,
 *   built at run time from trust-fixtures.ts, and every file a validating node would fetch from it,
 *   keyed by path under `baseUrl`:
 *
 *   - /lotl.xml: the List of Trusted Lists, signed by its own signer, pointing at three territories;
 *   - FI (/tl/fi.xml): a provider with a granted CA/QC service (the FI CA) and a granted TSA/QTST
 *     service (the TSA certificate), signed by the key the LOTL names for FI;
 *   - SE (/tl/se.xml): the SE CA's service, granted in 2020 and withdrawn in 2024;
 *   - DK (/tl/dk.xml): a list signed by a key the LOTL does NOT name for DK;
 *   - /ocsp/<name>: an OCSP response for one signer, signed by the FI CA; /crl/fi.crl: the FI CA's CRL.
 *
 *   The documents: PDFs signed by a qualified signer with a QSCD (OCSP good), the same with SubFilter
 *   adbe.pkcs7.detached, a qualified signer without a QSCD, a signer revoked by OCSP, one revoked by
 *   CRL, one revoked AFTER a qualified signature timestamp, an SE and a DK signer; a detached .p7s
 *   with its document, an attached .p7m, and a PDF document timestamp. The unit test feeds these
 *   through the fetch seams; e2e-docsign-validation.ts serves them over HTTP.
 * @structure TrustWorld · buildTrustWorld(baseUrl)
 * @usage const w = buildTrustWorld('http://127.0.0.1:31500'); w.files.get('/lotl.xml')
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F03b-04).
 */
import { createHash, type KeyObject } from 'node:crypto';
import { name, newRsa } from './pdf-sign.js';
import {
  makeCertX, buildCmsX, timestampToken, signPdfAs, docTimestampPdf, ocspResponse, crl, trustedList, lotl, signXml,
  EKU_TIMESTAMPING,
} from './trust-fixtures.js';

export interface ServedFile { body: Buffer; type: string }

export interface TrustWorld {
  files: Map<string, ServedFile>;
  lotlUrl: string;
  /** SHA-256 of the LOTL signer certificate, for docsignLotlSignerSha256. */
  lotlSignerSha256: string;
  pdf: {
    qualified: Buffer; adbe: Buffer; noQscd: Buffer; revokedOcsp: Buffer; revokedCrl: Buffer;
    revokedAfterTimestamp: Buffer; withdrawn: Buffer; badList: Buffer; docTimestamp: Buffer;
  };
  cms: { detached: Buffer; detachedDocument: Buffer; attached: Buffer; attachedContent: Buffer };
  /** When the qualified signature timestamp says the timestamped signature was made. */
  timestampAt: Date;
  revokedAt: Date;
}

let serial = 0x10;
const nextSerial = () => Buffer.from([0x01, serial++ & 0x7f, ...createHash('sha256').update(String(Math.random())).digest().subarray(0, 6)]);

export function buildTrustWorld(baseUrl: string): TrustWorld {
  const files = new Map<string, ServedFile>();
  const xml = (path: string, body: string) => files.set(path, { body: Buffer.from(body, 'utf8'), type: 'application/xml' });
  const url = (path: string) => `${baseUrl}${path}`;

  const selfSigned = (cn: string, o: string, c: string, ca = true) => {
    const k = newRsa();
    const n = name(cn, o, c);
    return { key: k.privateKey, cert: makeCertX({ subject: n, issuer: n, publicKey: k.publicKey, signer: k.privateKey, ca, serial: nextSerial() }), name: n };
  };
  const issued = (issuer: { key: KeyObject; name: ReturnType<typeof name> }, cn: string, c: string, extra: Partial<Parameters<typeof makeCertX>[0]> = {}) => {
    const k = newRsa();
    return { key: k.privateKey, cert: makeCertX({ subject: name(cn, 'Testi Oy', c), issuer: issuer.name, publicKey: k.publicKey, signer: issuer.key, ca: false, serial: nextSerial(), ...extra }) };
  };

  // ── the authorities ──
  const lotlSigner = selfSigned('Test LOTL Signer', 'Test Commission', 'BE', false);
  const fiListSigner = selfSigned('Test FI List Signer', 'Test Supervisor FI', 'FI', false);
  const seListSigner = selfSigned('Test SE List Signer', 'Test Supervisor SE', 'SE', false);
  const dkListSigner = selfSigned('Test DK List Signer', 'Test Supervisor DK', 'DK', false);
  const dkImpostor = selfSigned('Not The DK List Signer', 'Somebody', 'DK', false);
  const fiCa = selfSigned('Test Qualified CA FI', 'Test QTSP FI', 'FI');
  const seCa = selfSigned('Test CA SE', 'Test TSP SE', 'SE');
  const dkCa = selfSigned('Test CA DK', 'Test TSP DK', 'DK');
  const tsa = issued(fiCa, 'Test Qualified TSA FI', 'FI', { eku: [EKU_TIMESTAMPING] });

  // ── the signers ──
  const qes = { sscd: true, type: 'esign' as const };
  const good = issued(fiCa, 'Laura Laillinen', 'FI', { qc: qes, ocspUrl: url('/ocsp/good') });
  const noQscd = issued(fiCa, 'Pekka Pehmeä', 'FI', { qc: { sscd: false, type: 'esign' }, ocspUrl: url('/ocsp/noqscd') });
  const revokedOcsp = issued(fiCa, 'Rauno Revokoitu', 'FI', { qc: qes, ocspUrl: url('/ocsp/revoked') });
  const revokedCrl = issued(fiCa, 'Kaarina Kumottu', 'FI', { qc: qes, crlUrl: url('/crl/fi.crl') });
  const lateRevoked = issued(fiCa, 'Timo Aikaleima', 'FI', { qc: qes, ocspUrl: url('/ocsp/late') });
  const seSigner = issued(seCa, 'Sven Svensson', 'SE', { qc: qes });
  const dkSigner = issued(dkCa, 'Dorte Dansk', 'DK', { qc: qes });

  // ── revocation answers ──
  const now = Date.now();
  const revokedAt = new Date(now - 2 * 3600_000);
  const timestampAt = new Date(now - 3 * 3600_000);
  const lateRevokedAt = new Date(now - 3600_000);
  files.set('/ocsp/good', { body: ocspResponse(good.cert, fiCa.cert, fiCa.key), type: 'application/ocsp-response' });
  files.set('/ocsp/noqscd', { body: ocspResponse(noQscd.cert, fiCa.cert, fiCa.key), type: 'application/ocsp-response' });
  files.set('/ocsp/revoked', { body: ocspResponse(revokedOcsp.cert, fiCa.cert, fiCa.key, { revokedAt }), type: 'application/ocsp-response' });
  files.set('/ocsp/late', { body: ocspResponse(lateRevoked.cert, fiCa.cert, fiCa.key, { revokedAt: lateRevokedAt }), type: 'application/ocsp-response' });
  files.set('/crl/fi.crl', { body: crl(fiCa.cert, fiCa.key, [{ cert: revokedCrl.cert, at: revokedAt }]), type: 'application/pkix-crl' });

  // ── the lists ──
  const lotlUrl = url('/lotl.xml');
  xml('/lotl.xml', signXml(lotl(lotlUrl, lotlSigner.cert, [
    { territory: 'FI', url: url('/tl/fi.xml'), signer: fiListSigner.cert },
    { territory: 'SE', url: url('/tl/se.xml'), signer: seListSigner.cert },
    { territory: 'DK', url: url('/tl/dk.xml'), signer: dkListSigner.cert },
  ]), lotlSigner.key, lotlSigner.cert));
  xml('/tl/fi.xml', signXml(trustedList('FI', 'Test QTSP FI', [
    { type: 'CA/QC', name: 'Test Qualified CA FI', cert: fiCa.cert, periods: [{ status: 'granted', from: '2020-01-01T00:00:00Z' }] },
    { type: 'TSA/QTST', name: 'Test Qualified TSA FI', cert: tsa.cert, periods: [{ status: 'granted', from: '2020-01-01T00:00:00Z' }] },
  ]), fiListSigner.key, fiListSigner.cert));
  xml('/tl/se.xml', signXml(trustedList('SE', 'Test TSP SE', [
    { type: 'CA/QC', name: 'Test CA SE', cert: seCa.cert, periods: [{ status: 'withdrawn', from: '2024-01-01T00:00:00Z' }, { status: 'granted', from: '2020-01-01T00:00:00Z' }] },
  ]), seListSigner.key, seListSigner.cert));
  xml('/tl/dk.xml', signXml(trustedList('DK', 'Test TSP DK', [
    { type: 'CA/QC', name: 'Test CA DK', cert: dkCa.cert, periods: [{ status: 'granted', from: '2020-01-01T00:00:00Z' }] },
  ]), dkImpostor.key, dkImpostor.cert));

  // ── the documents ──
  const sign = (s: { cert: Buffer; key: KeyObject }, chain: Buffer[], text: string) => signPdfAs('ETSI.CAdES.detached', s.cert, s.key, chain, text);
  const stamp = (sig: Buffer) => timestampToken(sig, tsa.cert, tsa.key, [fiCa.cert], timestampAt);
  const detachedDocument = Buffer.from('Sopimus, allekirjoitettu erillisellä .p7s-tiedostolla.\n', 'utf8');
  const attachedContent = Buffer.from('Sopimus, joka kulkee allekirjoituksen sisällä (.p7m).\n', 'utf8');
  return {
    files, lotlUrl,
    lotlSignerSha256: createHash('sha256').update(lotlSigner.cert).digest('hex'),
    pdf: {
      qualified: sign(good, [fiCa.cert], 'Qualified signature'),
      adbe: signPdfAs('adbe.pkcs7.detached', good.cert, good.key, [fiCa.cert], 'adbe.pkcs7.detached signature'),
      noQscd: sign(noQscd, [fiCa.cert], 'Qualified certificate without QSCD'),
      revokedOcsp: sign(revokedOcsp, [fiCa.cert], 'Revoked by OCSP'),
      revokedCrl: sign(revokedCrl, [fiCa.cert], 'Revoked by CRL'),
      revokedAfterTimestamp: signPdfAs('ETSI.CAdES.detached', lateRevoked.cert, lateRevoked.key, [fiCa.cert], 'Revoked after a qualified timestamp', stamp),
      withdrawn: sign(seSigner, [seCa.cert], 'Withdrawn service'),
      badList: sign(dkSigner, [dkCa.cert], 'List with a bad signature'),
      docTimestamp: docTimestampPdf(tsa.cert, tsa.key, [fiCa.cert], 'Document timestamp', new Date(now - 60_000)),
    },
    cms: {
      detached: buildCmsX(detachedDocument, good.cert, good.key, [fiCa.cert]),
      detachedDocument,
      attached: buildCmsX(attachedContent, good.cert, good.key, [fiCa.cert], { attached: true }),
      attachedContent,
    },
    timestampAt, revokedAt,
  };
}
