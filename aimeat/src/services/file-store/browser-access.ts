/**
 * @file src/services/file-store/browser-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether a page or an app on this node may send a file straight to an S3 or Azure store
 *   and read it back, without the bytes going through the node (a direct upload, `direct: true` on
 *   POST /v1/storage and aimeat_storage_upload, with a link the node signs for one file). Two things
 *   decide it, and the check reports both:
 *
 *   - The store's CORS rule. A browser asks the store first (an OPTIONS preflight) whether a page on
 *     this origin may PUT and GET there; without a matching rule it refuses before the request is
 *     sent. The check sends the same preflight from the node's own origin and from an app origin
 *     (apps run on one address each, so a made-up subdomain stands for all of them). Agents and curl
 *     send no preflight and need no rule.
 *   - Whether the store's key can sign a time-limited link for one file. Every S3 key can. On Azure
 *     only the account key can: a container SAS cannot sign another SAS, so a store connected with a
 *     SAS sends its files through the node.
 *
 *   The rule to add is the same for every node, so it is answered with the check (corsRuleFor): a
 *   person or an AI connecting a store reads what to paste, and where. The recommended origin is `*`
 *   because each app has its own address; the rule opens nothing by itself, as every transfer still
 *   needs a link the node signs for one file.
 * @structure BrowserAccess · checkBrowserAccess · browserAccessView · corsRuleFor · browserOrigins
 * @usage const access = await checkBrowserAccess(config, spec, prefix, 'guarded');
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial: the connection test reports whether direct browser transfer can work,
 *     and the rule to add when it cannot (Jouni, 2026-10-31).
 */
import type { AimeatConfig } from '../../config.js';
import type { BlobSpec } from '../../storage/blob/blob-types.js';
import { s3Target } from '../../storage/blob/s3-client.js';
import { uriEncode } from '../../storage/blob/blob-http.js';
import { safeFetch } from '../../utils/url-validator.js';
import { logger } from '../../utils/logger.js';
import { appOriginScheme } from '../app/urls.js';
import { endpointOrigin } from './file-store-specs.js';

/** One preflight costs one round trip; a store that does not answer in this time is reported as unknown. */
const PREFLIGHT_TIMEOUT_MS = 10_000;
/** The made-up app subdomain the check asks from: a rule that admits it admits every app. */
const PROBE_SUBDOMAIN = 'aimeat-cors-check';

export interface BrowserAccess {
  at: string;
  /** allowed: every origin may PUT and GET · partial: some may · missing: none may · unknown: no answer. */
  cors: 'allowed' | 'partial' | 'missing' | 'unknown';
  /** The key can sign a time-limited link for one file. */
  signs: boolean;
  /** `origin` is what a person reads (`https://*.apps.example.org`); the check asked from a real one. */
  origins: { origin: string; ok: boolean }[];
  message: string;
}

export interface CorsRule {
  where: string;
  allowed_origins: string[];
  allowed_methods: string[];
  allowed_headers: string[];
  exposed_headers: string[];
  max_age_seconds: number;
  why_any_origin: string;
  /** S3 only: the bucket's CORS configuration as the AWS console and `aws s3api put-bucket-cors` take it. */
  json?: string;
}

const WHY_ANY_ORIGIN = 'Each app on this node runs on its own address, so naming one address is not enough. The rule opens nothing by itself: every transfer still needs a link the node signs for one file, valid for minutes.';

/** The rule a store needs for direct browser transfer, and where it is set. */
export function corsRuleFor(kind: BlobSpec['kind']): CorsRule {
  if (kind === 'azure') {
    return {
      where: 'Azure portal: the storage account, then Settings, Resource sharing (CORS), the Blob service tab',
      allowed_origins: ['*'], allowed_methods: ['GET', 'HEAD', 'PUT', 'OPTIONS'],
      allowed_headers: ['*'], exposed_headers: ['*'], max_age_seconds: 3600, why_any_origin: WHY_ANY_ORIGIN,
    };
  }
  const rule = {
    AllowedOrigins: ['*'], AllowedMethods: ['GET', 'HEAD', 'PUT'], AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag', 'Content-Length', 'Content-Range'], MaxAgeSeconds: 3600,
  };
  return {
    where: 'AWS console: the bucket, then Permissions, Cross-origin resource sharing (CORS). Another S3 service has the same setting on the bucket.',
    allowed_origins: rule.AllowedOrigins, allowed_methods: rule.AllowedMethods,
    allowed_headers: rule.AllowedHeaders, exposed_headers: rule.ExposeHeaders, max_age_seconds: rule.MaxAgeSeconds,
    why_any_origin: WHY_ANY_ORIGIN,
    json: JSON.stringify([rule], null, 2),
  };
}

/** The origins a page of this node sends from: its own, and its apps' when apps have their own addresses. */
export function browserOrigins(config: AimeatConfig): { origin: string; probe: string }[] {
  const out: { origin: string; probe: string }[] = [];
  if (URL.canParse(config.baseUrl)) {
    const own = new URL(config.baseUrl).origin;
    out.push({ origin: own, probe: own });
  }
  if (config.appOriginEnabled && config.appHost) {
    const { scheme, portSuffix } = appOriginScheme(config);
    out.push({ origin: `${scheme}://*.${config.appHost}${portSuffix}`, probe: `${scheme}://${PROBE_SUBDOMAIN}.${config.appHost}${portSuffix}` });
  }
  return out;
}

function objectUrl(spec: BlobSpec, key: string): string {
  if (spec.kind === 's3') return s3Target(spec, key).url;
  const endpoint = (spec.endpoint?.trim() || `https://${spec.accountName}.blob.core.windows.net`).replace(/\/+$/, '');
  return `${endpoint}/${uriEncode(spec.container, false)}/${uriEncode(key, true)}`;
}

/** true: the store lets `origin` send `method`; false: it does not; null: it did not answer. */
async function preflight(url: string, origin: string, method: 'PUT' | 'GET', kind: BlobSpec['kind'], allowOrigins: string[]): Promise<boolean | null> {
  const requestHeaders = method === 'PUT' ? (kind === 'azure' ? 'content-type,x-ms-blob-type' : 'content-type') : '';
  try {
    const res = await safeFetch(url, {
      method: 'OPTIONS', maxRedirects: 0, signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS),
      headers: {
        origin, 'access-control-request-method': method,
        ...(requestHeaders ? { 'access-control-request-headers': requestHeaders } : {}),
      },
      ...(allowOrigins.length ? { allowOrigins } : {}),
    });
    await res.body?.cancel();
    if (!res.ok) return false;
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const allowMethods = (res.headers.get('access-control-allow-methods') ?? '').toUpperCase().split(/\s*,\s*/);
    // A CORS answer's `*` is the store admitting any method; it is not a permission scope.
    return (allowOrigin === '*' || allowOrigin === origin) && allowMethods.some(m => m === method || m === '*');
  } catch (err) {
    logger.warn('file store browser check: the preflight got no answer', { origin, method, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function messageOf(cors: BrowserAccess['cors'], signs: boolean, origins: BrowserAccess['origins'], kind: BlobSpec['kind']): string {
  const signNote = signs ? '' : ' The store is connected with a SAS, which cannot sign a link for one file, so its files go through the node: connect it with the account key or a connection string for direct transfer.';
  if (cors === 'allowed') {
    return signs
      ? 'A page or an app on this node may send files straight to this store (an upload with direct: true) and read them back.'
      : `The CORS rule is in place.${signNote}`;
  }
  const where = kind === 'azure' ? 'on the storage account' : 'on the bucket';
  if (cors === 'partial') {
    const missing = origins.filter(o => !o.ok).map(o => o.origin).join(', ');
    return `The CORS rule ${where} does not admit ${missing}, so a page or an app there cannot send files straight to the store. Add the rule this answer gives.${signNote}`;
  }
  if (cors === 'unknown') return `The store did not answer the browser check, so whether a page may send to it directly is not known. Uploads through the node are not affected.${signNote}`;
  return `There is no CORS rule ${where} for this node, so a page or an app on this node cannot send files straight to the store and sends them through the node, which is slower and limits the size. Add the rule this answer gives. Agents and scripts send directly without it.${signNote}`;
}

/**
 * Ask the store from each origin of this node whether a browser may PUT and GET there. `reach` is the
 * same as the store's own client: a person's store may reach only the private origins the operator
 * listed, the node's store its own endpoint.
 */
export async function checkBrowserAccess(config: AimeatConfig, spec: BlobSpec, prefix: string, reach: 'trusted' | 'guarded'): Promise<BrowserAccess> {
  const allowOrigins = reach === 'guarded' ? [...config.fileStoreOwnerPrivateOrigins] : endpointOrigin(spec);
  const url = objectUrl(spec, `${prefix}aimeat-browser-check`);
  const results = await Promise.all(browserOrigins(config).map(async o => {
    const [put, get] = await Promise.all([
      preflight(url, o.probe, 'PUT', spec.kind, allowOrigins),
      preflight(url, o.probe, 'GET', spec.kind, allowOrigins),
    ]);
    return { origin: o.origin, answered: put !== null && get !== null, ok: put === true && get === true };
  }));
  const signs = spec.kind === 's3' || !!spec.accountKey;
  const cors: BrowserAccess['cors'] = results.some(r => !r.answered) ? 'unknown'
    : results.every(r => r.ok) ? 'allowed' : results.some(r => r.ok) ? 'partial' : 'missing';
  const origins = results.map(r => ({ origin: r.origin, ok: r.ok }));
  return { at: new Date().toISOString(), cors, signs, origins, message: messageOf(cors, signs, origins, spec.kind) };
}

/** What the views answer: the last check, whether direct transfer is ready, and the rule while it is not. */
export function browserAccessView(access: BrowserAccess | undefined, kind: BlobSpec['kind']) {
  if (!access) {
    return {
      checked_at: null, ready: null, cors: 'not_checked' as const, signs: null, origins: [],
      message: 'Not checked yet. Test the store again to learn whether a browser may send files to it directly.',
      rule: corsRuleFor(kind),
    };
  }
  return {
    checked_at: access.at, ready: access.cors === 'allowed' && access.signs, cors: access.cors, signs: access.signs,
    origins: access.origins, message: access.message,
    rule: access.cors === 'allowed' ? null : corsRuleFor(kind),
  };
}
