/**
 * @file src/services/config-schema-docsign.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The config rows for document signing and signature validation (config-docsign.ts).
 *   Its own file because config-schema.ts is near the line ceiling; spread into the schema beside
 *   the identity verification rows.
 * @structure DOCSIGN_CONFIG_FIELDS
 * @usage import { DOCSIGN_CONFIG_FIELDS } from './config-schema-docsign.js';
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 */
import type { DocsignConfig } from '../config-docsign.js';
import type { ConfigFieldShape } from './config-field-def.js';

const isHttps = (v: unknown) => typeof v === 'string' && /^https:\/\/[^\s]+$/i.test(v);

export const DOCSIGN_CONFIG_FIELDS: ConfigFieldShape<keyof DocsignConfig>[] = [
  { key: 'docsignEnabled', dotPath: 'docsign.enabled', envVar: 'AIMEAT_DOCSIGN_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'People and agents can sign documents here, and anyone can check the signatures on a signed PDF or file. Off answers 404 on every signing and checking route and tool' },
  { key: 'docsignOnlineChecks', dotPath: 'docsign.online_checks', envVar: 'AIMEAT_DOCSIGN_ONLINE_CHECKS', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'A signature check may fetch the EU trusted lists, ask the certificate issuer whether a certificate was revoked (OCSP, CRL), and fetch a missing issuer certificate. Off on a node without internet access: a check then says trust and revocation were not checked' },
  { key: 'docsignLotlUrl', dotPath: 'docsign.lotl_url', envVar: 'AIMEAT_DOCSIGN_LOTL_URL', type: 'string', validate: isHttps, immutable: false, description: 'Where the EU list of trusted lists is fetched from. The European Commission\'s address by default; change it only to a mirror you trust' },
  { key: 'docsignLotlSignerSha256', dotPath: 'docsign.lotl_signer_sha256', envVar: 'AIMEAT_DOCSIGN_LOTL_SIGNER_SHA256', type: 'object', validate: v => Array.isArray(v) && v.every(s => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)), immutable: false, description: 'SHA-256 fingerprints of the certificates allowed to sign the EU list (published in the Official Journal of the EU, series C). Empty accepts any certificate the list names for itself, over HTTPS from the Commission' },
  { key: 'docsignTrustAnchorsPath', dotPath: 'docsign.trust_anchors', envVar: 'AIMEAT_DOCSIGN_TRUST_ANCHORS', type: 'string', validate: v => typeof v === 'string' && (v as string).length <= 1024, immutable: true, description: 'A file of extra root certificates to trust (PEM), for a company CA or a scheme outside the EU. Empty trusts only the EU lists' },
  { key: 'docsignMaxMb', dotPath: 'docsign.max_mb', envVar: 'AIMEAT_DOCSIGN_MAX_MB', type: 'number', validate: v => typeof v === 'number' && v >= 1 && v <= 100, immutable: false, description: 'The largest file a signature check reads, in megabytes (1 to 100)' },
  { key: 'docsignAppUrl', dotPath: 'docsign.app_url', envVar: 'AIMEAT_DOCSIGN_APP_URL', type: 'string', validate: v => typeof v === 'string' && ((v as string) === '' || /^https?:\/\/[^\s]+$/i.test(v as string)), immutable: false, description: 'The address of the signing app. A person asked to sign gets a notification that opens it on the request. Empty: the notification names the request without a link' },
];
