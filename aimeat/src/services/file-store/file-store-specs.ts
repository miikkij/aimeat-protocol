/**
 * @file src/services/file-store/file-store-specs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description From settings to a store a file can be written to. nodeStoreSpec reads the node's own
 *   store from the config (the S3 or Azure rows of config-file-store.ts) and says which setting is
 *   missing when it cannot; storeFor builds the client once per distinct setting and reuses it.
 *
 *   EVERY STORE GOES THROUGH safeFetch, with no redirects; what differs is which private origin it
 *   may reach. The node's own store is the operator's choice and may be on a private network (a
 *   SeaweedFS or MinIO on the same host), so its own endpoint's origin is allowed, exactly. A store a
 *   person connected may reach only the origins the operator listed in file_store.owner_private_origins:
 *   its address was typed by someone who is not the operator, and without the check it could point the
 *   node at its own metadata service or database port.
 * @structure NodeSpecResult · nodeStoreSpec · azureSpecFrom · storeFor · guardedFetch · ownerEndpointAllowed
 * @usage const r = nodeStoreSpec(config); if ('spec' in r) { const store = storeFor(r.spec, 'trusted'); }
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { AzureSpec, BlobFetch, BlobSpec, BlobStore, S3Spec } from '../../storage/blob/blob-types.js';
import { createS3Store } from '../../storage/blob/s3-client.js';
import { createAzureStore, parseAzureConnection } from '../../storage/blob/azure-client.js';
import { safeFetch } from '../../utils/url-validator.js';
import { nodeFilePrefix } from '../../config-file-store.js';

/** How long one request to a store may take. A 1 GB upload over a slow line is the longest case. */
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

export type NodeSpecResult =
  | { kind: 'database' }
  | { kind: 's3' | 'azure'; spec: BlobSpec; prefix: string }
  | { kind: 's3' | 'azure'; missing: string[] };

/** The Azure spec from its parts: the credential may be a key, a connection string or a SAS URL, and
 *  the latter two may carry the account, the endpoint and (a SAS URL) the container themselves. */
export function azureSpecFrom(parts: { account: string; container: string; endpoint: string; credential: string | null }): { spec?: AzureSpec; missing: string[] } {
  const parsed = parts.credential ? parseAzureConnection(parts.credential) : null;
  const sasOnly = parts.credential && !parsed && /(^|&|\?)sig=/.test(parts.credential) ? parts.credential.replace(/^\?/, '') : undefined;
  const spec: AzureSpec = {
    kind: 'azure',
    accountName: parts.account || parsed?.accountName || '',
    container: parts.container || parsed?.container || '',
    endpoint: parts.endpoint || parsed?.endpoint || undefined,
    accountKey: parsed ? parsed.accountKey : (parts.credential && !sasOnly ? parts.credential : undefined),
    sasToken: parsed ? parsed.sasToken : sasOnly,
  };
  const missing: string[] = [];
  if (!spec.accountName) missing.push('account');
  if (!spec.container) missing.push('container');
  if (!spec.accountKey && !spec.sasToken) missing.push('credential');
  return missing.length ? { missing } : { spec, missing };
}

/**
 * The node's store of one kind, from its settings. `kind` defaults to the kind new files go to; the
 * read path names it from the file's reference, so a file written to S3 is still read from S3 after
 * the operator sends new files elsewhere, as long as the S3 settings stay.
 */
export function nodeStoreSpec(config: AimeatConfig, kind: AimeatConfig['fileStore'] = config.fileStore): NodeSpecResult {
  if (kind === 's3') {
    const missing: string[] = [];
    if (!config.fileStoreS3Bucket) missing.push('file_store.s3_bucket');
    if (!config.fileStoreS3AccessKeyId) missing.push('AIMEAT_FILE_STORE_S3_ACCESS_KEY_ID');
    if (!config.fileStoreS3SecretAccessKey) missing.push('AIMEAT_FILE_STORE_S3_SECRET_ACCESS_KEY');
    if (missing.length) return { kind: 's3', missing };
    const spec: S3Spec = {
      kind: 's3', endpoint: config.fileStoreS3Endpoint || undefined, region: config.fileStoreS3Region || 'us-east-1',
      bucket: config.fileStoreS3Bucket, accessKeyId: config.fileStoreS3AccessKeyId!, secretAccessKey: config.fileStoreS3SecretAccessKey!,
      pathStyle: config.fileStoreS3Addressing === 'auto' ? undefined : config.fileStoreS3Addressing === 'path',
    };
    return { kind: 's3', spec, prefix: nodeFilePrefix(config) };
  }
  if (kind === 'azure') {
    const r = azureSpecFrom({
      account: config.fileStoreAzureAccount, container: config.fileStoreAzureContainer,
      endpoint: config.fileStoreAzureEndpoint, credential: config.fileStoreAzureCredential,
    });
    if (!r.spec) {
      const names: Record<string, string> = { account: 'file_store.azure_account', container: 'file_store.azure_container', credential: 'AIMEAT_FILE_STORE_AZURE_CREDENTIAL' };
      return { kind: 'azure', missing: r.missing.map(m => names[m]) };
    }
    return { kind: 'azure', spec: r.spec, prefix: nodeFilePrefix(config) };
  }
  return { kind: 'database' };
}

/** The bytes as a request body, without copying them: a Buffer is a Uint8Array over the same memory,
 *  and the DOM typing of fetch names only an ArrayBuffer-backed view. */
function bodyOf(data: Buffer | undefined): RequestInit['body'] {
  return data ? (new Uint8Array(data.buffer, data.byteOffset, data.byteLength) as unknown as RequestInit['body']) : undefined;
}

/** The origin of a spec's own endpoint, which the operator named: allowed by safeFetch although it may be private. */
function endpointOrigin(spec: BlobSpec): string[] {
  const e = spec.endpoint?.trim();
  return e && URL.canParse(e) ? [new URL(e).origin.toLowerCase()] : [];
}

/** safeFetch with no redirects; `allowOrigins` are origins the operator named (the node store's own
 *  endpoint, or file_store.owner_private_origins), compared exactly by safeFetch on every request. */
export function guardedFetch(allowOrigins: readonly string[]): BlobFetch {
  return (url, init) => safeFetch(url, {
    method: init.method, headers: init.headers, body: bodyOf(init.body), maxRedirects: 0,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...(allowOrigins.length ? { allowOrigins } : {}),
  });
}

/** Whether a person may give this address for their own store: https, or an origin the operator named. */
export function ownerEndpointAllowed(config: AimeatConfig, endpoint: string): boolean {
  if (!URL.canParse(endpoint)) return false;
  const u = new URL(endpoint);
  return u.protocol === 'https:' || config.fileStoreOwnerPrivateOrigins.includes(u.origin.toLowerCase());
}

const cache = new Map<string, BlobStore>();

/**
 * The client for one spec, built once. Keyed on everything in the spec (the credentials hashed), so a
 * changed key or bucket gets a new client and the old one is dropped. A `guarded` client takes the
 * operator's private origins for a person's store from `config`.
 */
export function storeFor(spec: BlobSpec, reach: 'trusted' | 'guarded', config?: AimeatConfig): BlobStore {
  const origins = reach === 'guarded' ? (config?.fileStoreOwnerPrivateOrigins ?? []) : endpointOrigin(spec);
  const id = createHash('sha256').update(JSON.stringify([reach, origins, spec])).digest('hex');
  let store = cache.get(id);
  if (!store) {
    const send = guardedFetch(origins);
    store = spec.kind === 's3' ? createS3Store(spec, send) : createAzureStore(spec, send);
    if (cache.size >= 200) cache.clear();
    cache.set(id, store);
  }
  return store;
}
