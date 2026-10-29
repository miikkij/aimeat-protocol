/**
 * @file src/storage/blob/blob-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shapes shared by the object stores a stored file's bytes can live in (S3 and Azure
 *   Blob), and the reference a StorageFile row keeps to its object. A row with a `blobRef` holds no
 *   bytes of its own: the bytes are one object in the store the reference names.
 *
 *   THE REFERENCE. `<storeId>|<objectKey>`. `storeId` is `node:s3` or `node:azure` for the store the
 *   operator set for the whole node, or `owner:<ghii>` for the store one person connected. The
 *   reference names the store by its role and not by its bucket, so an operator who copies every
 *   object to a new bucket under the same keys and points the node at it changes nothing in the
 *   database. The object key is new for every write (a random id under the store's prefix), so a
 *   re-upload never overwrites the object an older download handle was minted for.
 * @structure BlobSpec · S3Spec · AzureSpec · BlobFetch · BlobStore · BlobListPage · BlobStoreError ·
 *   formatBlobRef · parseBlobRef · nodeStoreId · ownerStoreId
 * @usage
 *   const ref = formatBlobRef(nodeStoreId('s3'), 'aimeat/files/1f0c…');
 *   const { storeId, objectKey } = parseBlobRef(row.blobRef)!;
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */

/** An S3-compatible store: AWS S3, Cloudflare R2, Hetzner, Backblaze B2, SeaweedFS, MinIO. */
export interface S3Spec {
  kind: 's3';
  /** `https://host[:port]`. Empty for AWS, which is then `https://s3.<region>.amazonaws.com`. */
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** For temporary AWS credentials only. */
  sessionToken?: string;
  /** `<endpoint>/<bucket>/<key>` instead of `<bucket>.<endpoint>/<key>`. Default: on with an endpoint. */
  pathStyle?: boolean;
}

/** An Azure Blob Storage container. One of `accountKey` and `sasToken` is set. */
export interface AzureSpec {
  kind: 'azure';
  accountName: string;
  container: string;
  /** Base64 account key: requests are signed with Shared Key. */
  accountKey?: string;
  /** A container SAS (`sv=…&sig=…`, no leading `?`): appended to every request instead of signing. */
  sasToken?: string;
  /** The blob service address. Default `https://<account>.blob.core.windows.net`; Azurite is
   *  `http://127.0.0.1:10000/<account>`. */
  endpoint?: string;
}

export type BlobSpec = S3Spec | AzureSpec;

/** The HTTP client a store sends through. The node's own store uses fetch; a store a person connected
 *  goes through safeFetch, so a configured address cannot reach the node's private network. */
export type BlobFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: Buffer }) => Promise<Response>;

export interface BlobListPage {
  objects: { key: string; lastModified: string; size: number }[];
  /** Pass back to list() for the next page; absent on the last page. */
  next?: string;
}

/** One container of objects. Keys are full object keys; the caller adds its prefix. */
export interface BlobStore {
  readonly kind: BlobSpec['kind'];
  /** What a person reads in a message: `s3 bucket "x" at host` or `azure container "x" in account y`. */
  describe(): string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** The whole object, or null when there is none. */
  get(key: string): Promise<Buffer | null>;
  /** `length` bytes from byte `start`; shorter at the end of the object, empty past it; null when
   *  there is no object. */
  getRange(key: string, start: number, length: number): Promise<Buffer | null>;
  /** Removes the object. An object that is already gone is not an error. */
  delete(key: string): Promise<void>;
  list(prefix: string, next?: string): Promise<BlobListPage>;
}

/** A store answered something other than success. `status` is the HTTP status, 0 when none came. */
export class BlobStoreError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'BlobStoreError';
  }
}

/** `node:s3` or `node:azure`: the kind is part of the name, so an operator who sends new files back to
 *  the database (or to the other kind) still has the old files read with the settings they were
 *  written with. */
export function nodeStoreId(kind: BlobSpec['kind']): string {
  return `node:${kind}`;
}

export function ownerStoreId(ownerGhii: string): string {
  return `owner:${ownerGhii}`;
}

export function formatBlobRef(storeId: string, objectKey: string): string {
  return `${storeId}|${objectKey}`;
}

/** The store and object a reference names, or null for a value that is not a reference. */
export function parseBlobRef(ref: string | null | undefined): { storeId: string; objectKey: string } | null {
  if (!ref) return null;
  const bar = ref.indexOf('|');
  if (bar <= 0 || bar === ref.length - 1) return null;
  return { storeId: ref.slice(0, bar), objectKey: ref.slice(bar + 1) };
}
