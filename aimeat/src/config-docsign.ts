/**
 * @file src/config-docsign.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's settings for document signing and signature validation
 *   (services/docsign/): whether the feature is on, whether a validation may reach the network
 *   (the EU trusted lists, OCSP responders, CRLs, a missing issuer certificate), where the EU List
 *   of Trusted Lists is fetched from and which certificate must sign it, the operator's own trust
 *   anchors, and the largest file a validation reads.
 *
 *   Its own file because config.ts is at the line ceiling.
 * @structure DocsignConfig · docsignDefaults() · docsignMaxBytes()
 * @usage const config = { ...docsignDefaults(), ... };
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 *   v1.1.0 — 2026-10-10 — Signing with an EU Digital Identity Wallet: docsignEudiEnabled,
 *     docsignEudiRpCredentialPath, docsignEudiTestRoots (wish-allekirjoitus-eudi-lompakolla).
 */

/** Declared here, not picked from AimeatConfig, so this file imports nothing. */
export interface DocsignConfig {
  /** Document signing and signature validation are offered. On by default. */
  docsignEnabled: boolean;
  /**
   * A validation may fetch the EU trusted lists, ask OCSP responders, download CRLs and fetch a
   * missing issuer certificate. On by default; off on a node with no internet access, where a
   * report then says "not checked" instead of guessing.
   */
  docsignOnlineChecks: boolean;
  /** The EU List of Trusted Lists. The Commission's address by default. */
  docsignLotlUrl: string;
  /** SHA-256 fingerprints of the certificates allowed to sign the LOTL. Empty: any certificate the LOTL lists for itself. */
  docsignLotlSignerSha256: string[];
  /** A PEM bundle of the operator's own trust anchors (a company CA, a non-EU scheme). Empty: none. */
  docsignTrustAnchorsPath: string;
  /** The largest file a validation reads, in megabytes (1 to 100). */
  docsignMaxMb: number;
  /**
   * The address of the app where a person signs (the signing request notification links to it with
   * `?request=<id>`). Empty: the notification names the request and carries no link.
   */
  docsignAppUrl: string;
  /**
   * A person may sign a PDF with an EU Digital Identity Wallet (services/docsign/eudi.ts). Off by
   * default: it needs the relying-party access certificate below, which a registrar issues.
   */
  docsignEudiEnabled: boolean;
  /**
   * A PEM file holding this node's wallet relying-party access certificate: the EC private key,
   * then the certificate whose subjectAltName names this node's host name, then its CA. Read at
   * start. Empty: wallet signing is not ready.
   */
  docsignEudiRpCredentialPath: string;
  /**
   * Trust the test certification authorities of the EU reference wallet when checking a signature
   * (src/data/eudi-test-roots.ts). On by default while national wallets are not out; a signature
   * that chains to one is reported as a test with no legal effect, never as qualified.
   */
  docsignEudiTestRoots: boolean;
}

/** The largest file a validation reads, in bytes. */
export function docsignMaxBytes(config: Pick<DocsignConfig, 'docsignMaxMb'>): number {
  return Math.min(Math.max(config.docsignMaxMb || 25, 1), 100) * 1024 * 1024;
}

export function docsignDefaults(): DocsignConfig {
  const mb = parseInt(process.env.AIMEAT_DOCSIGN_MAX_MB ?? '25', 10);
  return {
    docsignEnabled: process.env.AIMEAT_DOCSIGN_ENABLED !== 'false',
    docsignOnlineChecks: process.env.AIMEAT_DOCSIGN_ONLINE_CHECKS !== 'false',
    docsignLotlUrl: (process.env.AIMEAT_DOCSIGN_LOTL_URL ?? 'https://ec.europa.eu/tools/lotl/eu-lotl.xml').trim(),
    docsignLotlSignerSha256: (process.env.AIMEAT_DOCSIGN_LOTL_SIGNER_SHA256 ?? '')
      .split(',').map((s) => s.trim().toLowerCase().replace(/:/g, '')).filter(Boolean),
    docsignTrustAnchorsPath: (process.env.AIMEAT_DOCSIGN_TRUST_ANCHORS ?? '').trim(),
    docsignMaxMb: Number.isFinite(mb) && mb > 0 ? Math.min(mb, 100) : 25,
    docsignAppUrl: (process.env.AIMEAT_DOCSIGN_APP_URL ?? '').trim().replace(/\/+$/, ''),
    docsignEudiEnabled: process.env.AIMEAT_DOCSIGN_EUDI_ENABLED === 'true',
    docsignEudiRpCredentialPath: (process.env.AIMEAT_DOCSIGN_EUDI_RP_CREDENTIAL ?? '').trim(),
    docsignEudiTestRoots: process.env.AIMEAT_DOCSIGN_EUDI_TEST_ROOTS !== 'false',
  };
}
