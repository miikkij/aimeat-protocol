/**
 * @file src/config-file-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where stored files keep their bytes: in the node's database (the default), or in one S3
 *   or Azure Blob store the operator sets for the whole node; and whether a person may connect a
 *   store of their own for their own files. Its own file because config.ts and config-types.ts are at
 *   the line ceiling. The rows are in services/config-schema-file-store.ts: everything except the
 *   credentials changes from the Config tab or through chat (PUT /v1/admin/config); the credentials
 *   come from the environment only, as the SMTP password does.
 * @structure FileStoreKind · OwnerFileStores · FileStoreConfig · normalizePrefix · nodeFilePrefix · fileStoreDefaults()
 * @usage
 *   import { fileStoreDefaults } from './config-file-store.js';
 *   const config = { ...fileStoreDefaults(), ... };
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */

export type FileStoreKind = 'database' | 's3' | 'azure';

/**
 * Whether a person may connect their own store. `auto` is `operator` on a node whose content is for
 * signed-in accounts only (a company's node) and `self` on any other; `off` lets nobody; `operator`
 * lets only the people an operator approved; `self` lets everyone.
 */
export type OwnerFileStores = 'auto' | 'off' | 'operator' | 'self';

/** Declared here, not picked from AimeatConfig, so this file imports nothing (config-decide.ts gives the reason). */
export interface FileStoreConfig {
  /** AIMEAT_FILE_STORE: database (default), s3 or azure. A file written before a change stays where it was written. */
  fileStore: FileStoreKind;
  /** AIMEAT_FILE_STORE_PREFIX: the folder every object key of the node's store starts with. Empty means
   *  `aimeat/<node id>/files/` (nodeFilePrefix), so two nodes sharing a bucket never share a folder,
   *  which the daily sweep depends on: it removes the objects in its folder that no file names. */
  fileStorePrefix: string;
  /** AIMEAT_FILE_STORE_S3_ENDPOINT: empty for AWS; `https://<host>` for R2, Hetzner, B2, SeaweedFS, MinIO. */
  fileStoreS3Endpoint: string;
  /** AIMEAT_FILE_STORE_S3_REGION, default us-east-1. */
  fileStoreS3Region: string;
  /** AIMEAT_FILE_STORE_S3_BUCKET. */
  fileStoreS3Bucket: string;
  /** AIMEAT_FILE_STORE_S3_ADDRESSING: auto (path style with an endpoint, bucket host name on AWS), path or host. */
  fileStoreS3Addressing: 'auto' | 'path' | 'host';
  /** AIMEAT_FILE_STORE_S3_ACCESS_KEY_ID (secret). */
  fileStoreS3AccessKeyId: string | null;
  /** AIMEAT_FILE_STORE_S3_SECRET_ACCESS_KEY (secret). */
  fileStoreS3SecretAccessKey: string | null;
  /** AIMEAT_FILE_STORE_AZURE_ACCOUNT: the storage account name; may come from the credential instead. */
  fileStoreAzureAccount: string;
  /** AIMEAT_FILE_STORE_AZURE_CONTAINER; may come from a container SAS URL instead. */
  fileStoreAzureContainer: string;
  /** AIMEAT_FILE_STORE_AZURE_ENDPOINT: empty for Azure; the Azurite address for a local test. */
  fileStoreAzureEndpoint: string;
  /** AIMEAT_FILE_STORE_AZURE_CREDENTIAL (secret): the account key, a connection string or a container SAS URL. */
  fileStoreAzureCredential: string | null;
  /** AIMEAT_OWNER_FILE_STORES: auto (default), off, operator or self. */
  ownerFileStores: OwnerFileStores;
  /**
   * AIMEAT_FILE_STORE_OWNER_PRIVATE_ORIGINS: exact origins (`http://10.0.5.20:9000`) a person's own
   * store may be at although they are on a private network, for a company whose S3 service is inside
   * its own network. Comma separated. Empty: a person's store must be a public https address.
   */
  fileStoreOwnerPrivateOrigins: string[];
}

function oneOf<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback;
}

/** A prefix that is empty or ends in exactly one `/`, with no leading `/`. */
export function normalizePrefix(raw: string | undefined): string {
  const s = (raw ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  return s ? `${s}/` : '';
}

/** The folder the node's own store writes into: the setting, or `aimeat/<node id>/files/`. Never empty. */
export function nodeFilePrefix(config: { fileStorePrefix: string; nodeId: string }): string {
  return normalizePrefix(config.fileStorePrefix) || `aimeat/${config.nodeId}/files/`;
}

export function fileStoreDefaults(env: NodeJS.ProcessEnv = process.env): FileStoreConfig {
  return {
    fileStore: oneOf(env.AIMEAT_FILE_STORE, ['database', 's3', 'azure'] as const, 'database'),
    fileStorePrefix: normalizePrefix(env.AIMEAT_FILE_STORE_PREFIX),
    fileStoreS3Endpoint: (env.AIMEAT_FILE_STORE_S3_ENDPOINT ?? '').trim(),
    fileStoreS3Region: (env.AIMEAT_FILE_STORE_S3_REGION ?? '').trim() || 'us-east-1',
    fileStoreS3Bucket: (env.AIMEAT_FILE_STORE_S3_BUCKET ?? '').trim(),
    fileStoreS3Addressing: oneOf(env.AIMEAT_FILE_STORE_S3_ADDRESSING, ['auto', 'path', 'host'] as const, 'auto'),
    fileStoreS3AccessKeyId: env.AIMEAT_FILE_STORE_S3_ACCESS_KEY_ID?.trim() || null,
    fileStoreS3SecretAccessKey: env.AIMEAT_FILE_STORE_S3_SECRET_ACCESS_KEY?.trim() || null,
    fileStoreAzureAccount: (env.AIMEAT_FILE_STORE_AZURE_ACCOUNT ?? '').trim(),
    fileStoreAzureContainer: (env.AIMEAT_FILE_STORE_AZURE_CONTAINER ?? '').trim(),
    fileStoreAzureEndpoint: (env.AIMEAT_FILE_STORE_AZURE_ENDPOINT ?? '').trim(),
    fileStoreAzureCredential: env.AIMEAT_FILE_STORE_AZURE_CREDENTIAL?.trim() || null,
    ownerFileStores: oneOf(env.AIMEAT_OWNER_FILE_STORES, ['auto', 'off', 'operator', 'self'] as const, 'auto'),
    fileStoreOwnerPrivateOrigins: (env.AIMEAT_FILE_STORE_OWNER_PRIVATE_ORIGINS ?? '').split(',')
      .map(s => s.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean),
  };
}
