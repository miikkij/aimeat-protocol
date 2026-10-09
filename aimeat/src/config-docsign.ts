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
  };
}
