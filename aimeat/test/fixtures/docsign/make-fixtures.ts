/**
 * @file test/fixtures/docsign/make-fixtures.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Writes the signed-PDF fixtures the docsign tests read: a test CA, a signer
 *   certificate it issued, and a one-page PDF carrying a PAdES (ETSI.CAdES.detached) signature made
 *   with that certificate, plus a copy with one signed byte changed and a copy with a page appended
 *   after signing. Also the wallet relying-party credential the E2E node boots with
 *   (eudi-rp-test.txt: a TEST-ONLY EC key and a certificate naming localhost, from a test CA of our
 *   own that no wallet trusts). Our own material, so the fixtures carry no third-party licence, and
 *   reproducible: run it again and the tests still pass (the keys and the signing time change,
 *   nothing else). The builders are in pdf-sign.ts.
 * @usage cd aimeat && pnpm exec tsx test/fixtures/docsign/make-fixtures.ts
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 *   v1.1.0 — 2026-10-10 — The builders moved to pdf-sign.ts; writes eudi-rp-test.txt
 *     (wish-allekirjoitus-eudi-lompakolla).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { name, makeCert, signPdf, pem, newRsa, makeRpCredential } from './pdf-sign.js';

const here = dirname(fileURLToPath(import.meta.url));

const ca = newRsa();
const signer = newRsa();
const caName = name('AIMEAT Test Root CA', 'AIMEAT Test');
const caCert = makeCert({ subject: caName, issuer: caName, publicKey: ca.publicKey, signer: ca.privateKey, ca: true, serial: 1 });
const signerCert = makeCert({ subject: name('Testi Allekirjoittaja', 'AIMEAT Test'), issuer: caName, publicKey: signer.publicKey, signer: ca.privateKey, ca: false, serial: 2 });

const signed = signPdf(signerCert, signer.privateKey, [caCert], 'Testisopimus: AIMEAT docsign fixture');
// One byte inside the first signed span changed: the page text.
const tampered = Buffer.from(signed);
const at = tampered.indexOf('Testisopimus');
tampered.write('Testisopimuz', at, 'latin1');
// An incremental update after signing that adds a page: a content change the signature does not cover.
const added = Buffer.concat([signed, Buffer.from('8 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n%%EOF\n', 'latin1')]);

// A .txt, because the repository ignores *.pem and *.crt (key material). This is the test CA's public
// certificate only, in the PEM bundle form AIMEAT_DOCSIGN_TRUST_ANCHORS reads.
writeFileSync(join(here, 'trust-anchors.txt'), pem(caCert));
writeFileSync(join(here, 'signed.pdf'), signed);
writeFileSync(join(here, 'signed-tampered.pdf'), tampered);
writeFileSync(join(here, 'signed-page-added.pdf'), added);
// TEST-ONLY key material for the E2E node's wallet access certificate (AIMEAT_DOCSIGN_EUDI_RP_CREDENTIAL).
writeFileSync(join(here, 'eudi-rp-test.txt'), makeRpCredential('localhost'));
console.log('wrote trust-anchors.txt, signed.pdf, signed-tampered.pdf, signed-page-added.pdf, eudi-rp-test.txt');
