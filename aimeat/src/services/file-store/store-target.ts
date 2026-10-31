/**
 * @file src/services/file-store/store-target.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The address of one S3 bucket or Azure container, as a node store and a person's own store
 *   both keep it: read from what someone typed (readStoreInput), turned back into a client spec with its
 *   secret (specFromTarget), and described for a person (whereOf, placeOf).
 *
 *   ONE PLACE, SEVERAL STORES. Two stores can name the same bucket: an operator who adds the bucket the
 *   environment already names, or a person who keeps two folders of one container apart. placeKey
 *   names the bucket itself, so the overlap check (prefixesOverlap) and the daily sweep can see that
 *   two store ids share it. Without that, the sweep of one store would remove the objects of the other,
 *   because no row of its own names them.
 * @structure StoreTarget · STORE_NAME · storeNameProblem · readStoreInput · specFromTarget · targetOfSpec ·
 *   placeKey · prefixesOverlap · whereOf · placeOf · sameTarget
 * @usage const input = readStoreInput(config, body, { reach: 'owner', defaultPrefix });
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial: moved out of owner-file-store-actions.ts and shared with the named node
 *     stores (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 */
import type { AimeatConfig } from '../../config.js';
import type { BlobSpec } from '../../storage/blob/blob-types.js';
import { normalizePrefix } from '../../config-file-store.js';
import { azureSpecFrom, ownerEndpointAllowed } from './file-store-specs.js';

/** The parts of a store that are not secret, as they were given. */
export type StoreTarget =
  | { kind: 's3'; endpoint: string; region: string; bucket: string; addressing: 'auto' | 'path' | 'host' }
  | { kind: 'azure'; account: string; container: string; endpoint: string };

/** A store's name: what a person types to choose it, and the last part of its id. */
export const STORE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Why a name cannot be a store's name, or null. `reserved` are names another store id already uses. */
export function storeNameProblem(name: string, reserved: readonly string[] = []): string | null {
  if (!STORE_NAME.test(name)) return 'name: 1 to 40 characters, lower-case letters, digits and hyphens, starting with a letter or a digit';
  if (reserved.includes(name)) return `name: "${name}" is reserved`;
  return null;
}

const str = (v: unknown, max = 2048) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export type StoreInput = { target: StoreTarget; secret: Record<string, string>; spec: BlobSpec; prefix: string };

/**
 * The target, the secret and the spec from what was typed, or what is missing. `owner` reach takes an
 * https address or one the operator listed (file_store.owner_private_origins); `node` reach is the
 * operator's own entry and may name any http(s) address, as the environment's store may.
 */
export function readStoreInput(
  config: AimeatConfig, body: Record<string, unknown>, opts: { reach: 'owner' | 'node'; defaultPrefix: string },
): StoreInput | { missing: string[] } {
  const kind = str(body.kind);
  const prefix = normalizePrefix(str(body.prefix, 200)) || opts.defaultPrefix;
  const allowed = (endpoint: string) => opts.reach === 'node'
    ? URL.canParse(endpoint) && ['http:', 'https:'].includes(new URL(endpoint).protocol)
    : ownerEndpointAllowed(config, endpoint);
  if (kind === 's3') {
    const endpoint = str(body.endpoint);
    const target: StoreTarget = {
      kind: 's3', endpoint, region: str(body.region, 64) || 'us-east-1', bucket: str(body.bucket, 255),
      addressing: (['path', 'host'] as const).find(a => a === body.addressing) ?? 'auto',
    };
    const secret = { accessKeyId: str(body.access_key_id, 256), secretAccessKey: str(body.secret_access_key, 512) };
    const missing = [!target.bucket && 'bucket', !secret.accessKeyId && 'access_key_id', !secret.secretAccessKey && 'secret_access_key']
      .filter((m): m is string => !!m);
    if (endpoint && !allowed(endpoint)) missing.push(opts.reach === 'node' ? 'endpoint (an http:// or https:// address)' : 'endpoint (an https:// address)');
    if (missing.length) return { missing };
    return { target, secret, spec: specFromTarget(target, secret)!, prefix };
  }
  if (kind === 'azure') {
    const endpoint = opts.reach === 'node' ? str(body.endpoint) : '';
    const r = azureSpecFrom({ account: str(body.account, 64), container: str(body.container, 63), endpoint, credential: str(body.credential, 4096) || null });
    if (!r.spec) return { missing: r.missing };
    if (r.spec.endpoint && !allowed(r.spec.endpoint)) {
      return { missing: [opts.reach === 'node' ? 'endpoint (an http:// or https:// address)' : 'credential (an https:// account address)'] };
    }
    const target: StoreTarget = { kind: 'azure', account: r.spec.accountName, container: r.spec.container, endpoint: r.spec.endpoint ?? '' };
    const secret: Record<string, string> = r.spec.accountKey ? { accountKey: r.spec.accountKey } : { sasToken: r.spec.sasToken! };
    return { target, secret, spec: r.spec, prefix };
  }
  return { missing: ['kind (s3 or azure)'] };
}

/** The client spec from a target and its opened secret; null when the secret lacks what the kind needs. */
export function specFromTarget(t: StoreTarget, secret: Record<string, string>): BlobSpec | null {
  if (t.kind === 's3') {
    if (!secret.accessKeyId || !secret.secretAccessKey) return null;
    return {
      kind: 's3', endpoint: t.endpoint || undefined, region: t.region || 'us-east-1', bucket: t.bucket,
      accessKeyId: secret.accessKeyId, secretAccessKey: secret.secretAccessKey,
      pathStyle: t.addressing === 'auto' ? undefined : t.addressing === 'path',
    };
  }
  if (!secret.accountKey && !secret.sasToken) return null;
  return {
    kind: 'azure', accountName: t.account, container: t.container, endpoint: t.endpoint || undefined,
    accountKey: secret.accountKey || undefined, sasToken: secret.sasToken || undefined,
  };
}

/** The target of a spec, for the store the environment names. */
export function targetOfSpec(spec: BlobSpec): StoreTarget {
  return spec.kind === 's3'
    ? { kind: 's3', endpoint: spec.endpoint ?? '', region: spec.region, bucket: spec.bucket, addressing: spec.pathStyle === undefined ? 'auto' : spec.pathStyle ? 'path' : 'host' }
    : { kind: 'azure', account: spec.accountName, container: spec.container, endpoint: spec.endpoint ?? '' };
}

/** The bucket or container itself, whichever store names it. */
export function placeKey(t: StoreTarget): string {
  const host = (e: string) => (e && URL.canParse(e) ? new URL(e).origin + new URL(e).pathname.replace(/\/+$/, '') : '').toLowerCase();
  return t.kind === 's3'
    ? `s3|${host(t.endpoint) || `aws:${t.region}`}|${t.bucket}`
    : `azure|${t.account.toLowerCase()}|${host(t.endpoint)}|${t.container}`;
}

/** Whether two folders of one bucket share objects: one is the other, or lies inside it. */
export function prefixesOverlap(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a);
}

export function whereOf(t: StoreTarget): string {
  return t.kind === 's3' ? `s3 bucket "${t.bucket}"${t.endpoint ? ` at ${new URL(t.endpoint).host}` : ''}` : `azure container "${t.container}" in account ${t.account}`;
}

/** The same place as parts, so a screen can say it in its reader's language: `name` is the bucket or
 *  container, `at` the service host (S3, empty for Amazon S3) or the storage account (Azure). */
export function placeOf(t: StoreTarget): { kind: 's3' | 'azure'; name: string; at: string } {
  return t.kind === 's3'
    ? { kind: 's3', name: t.bucket, at: t.endpoint ? new URL(t.endpoint).host : '' }
    : { kind: 'azure', name: t.container, at: t.account };
}

export const sameTarget = (a: StoreTarget, b: StoreTarget) => JSON.stringify(a) === JSON.stringify(b);
