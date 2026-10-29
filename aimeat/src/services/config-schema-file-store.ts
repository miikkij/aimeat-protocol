/**
 * @file src/services/config-schema-file-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The config rows of config-file-store.ts: where stored files keep their bytes, and
 *   whether a person may connect a store of their own. Its own file because config-schema.ts is at
 *   the line ceiling; spread into the schema after the storage quota rows. The store's address,
 *   bucket and the owner rule change from the Config tab or through chat; the three credentials are
 *   read from the environment only and shown as configured, as the SMTP password is.
 * @structure FILE_STORE_CONFIG_FIELDS
 * @usage import { FILE_STORE_CONFIG_FIELDS } from './config-schema-file-store.js';
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import type { FileStoreConfig } from '../config-file-store.js';
import type { ConfigFieldShape } from './config-field-def.js';
import { oneOf } from './config-schema-validators.js';

/** A short single-line value, or empty. */
const shortText = (max: number) => (v: unknown): boolean => typeof v === 'string' && v.length <= max && !/[\r\n]/.test(v);

/** Empty, or an http(s) address with no path, query or credentials beyond a base path. */
const emptyOrBaseUrl = (v: unknown): boolean => {
  if (typeof v !== 'string') return false;
  if (v.trim() === '') return true;
  if (!URL.canParse(v)) return false;
  const u = new URL(v);
  return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password && !u.search && !u.hash;
};

export const FILE_STORE_CONFIG_FIELDS: ConfigFieldShape<keyof FileStoreConfig>[] = [
  { key: 'fileStore', dotPath: 'file_store.kind', envVar: 'AIMEAT_FILE_STORE', type: 'string', ...oneOf('database', 's3', 'azure'), immutable: false,
    description: 'Where a new stored file keeps its bytes. database: in this node\'s own database. s3: in one S3 bucket (AWS, Cloudflare R2, Hetzner, Backblaze B2 or any S3-compatible service). azure: in one Azure Blob Storage container. A file written before a change stays where it was written and is still read from there; the operator moves older files with the Move files button. The file\'s owner, visibility and quota stay the same wherever its bytes are',
    range: 'database|s3|azure' },
  { key: 'fileStorePrefix', dotPath: 'file_store.prefix', envVar: 'AIMEAT_FILE_STORE_PREFIX', type: 'string', validate: shortText(200), immutable: false,
    description: 'The folder inside the bucket or container that this node\'s files go into. Empty: aimeat/<node id>/files. Give each node its own folder when nodes share a bucket: the daily cleanup removes the objects in this folder that no file of this node names' },
  { key: 'fileStoreS3Endpoint', dotPath: 'file_store.s3_endpoint', envVar: 'AIMEAT_FILE_STORE_S3_ENDPOINT', type: 'string', validate: emptyOrBaseUrl, immutable: false,
    description: 'The address of the S3 service, for example https://<account>.r2.cloudflarestorage.com. Empty for Amazon S3 itself, which is then reached through the region' },
  { key: 'fileStoreS3Region', dotPath: 'file_store.s3_region', envVar: 'AIMEAT_FILE_STORE_S3_REGION', type: 'string', validate: shortText(64), immutable: false,
    description: 'The S3 region, for example eu-north-1. Cloudflare R2 uses auto; most other services accept us-east-1' },
  { key: 'fileStoreS3Bucket', dotPath: 'file_store.s3_bucket', envVar: 'AIMEAT_FILE_STORE_S3_BUCKET', type: 'string', validate: shortText(255), immutable: false,
    description: 'The S3 bucket the files go into. The node does not create it: make it first, private, with no public access' },
  { key: 'fileStoreS3Addressing', dotPath: 'file_store.s3_addressing', envVar: 'AIMEAT_FILE_STORE_S3_ADDRESSING', type: 'string', ...oneOf('auto', 'path', 'host'), immutable: false,
    description: 'How the bucket is named in the address. path: <endpoint>/<bucket>/<file>. host: <bucket>.<endpoint>/<file>. auto: path when an endpoint is set, host for Amazon S3',
    range: 'auto|path|host' },
  { key: 'fileStoreS3AccessKeyId', dotPath: 'file_store.s3_access_key_id', envVar: 'AIMEAT_FILE_STORE_S3_ACCESS_KEY_ID', type: 'string', validate: () => true, immutable: true,
    description: 'The access key id of an S3 key that may read, write, delete and list in the bucket (secret)', adminDisplay: 'configured' },
  { key: 'fileStoreS3SecretAccessKey', dotPath: 'file_store.s3_secret_access_key', envVar: 'AIMEAT_FILE_STORE_S3_SECRET_ACCESS_KEY', type: 'string', validate: () => true, immutable: true,
    description: 'The secret of that S3 key (secret)', adminDisplay: 'configured' },
  { key: 'fileStoreAzureAccount', dotPath: 'file_store.azure_account', envVar: 'AIMEAT_FILE_STORE_AZURE_ACCOUNT', type: 'string', validate: shortText(64), immutable: false,
    description: 'The Azure storage account name. May be left empty when the credential is a connection string or a SAS URL, which name it' },
  { key: 'fileStoreAzureContainer', dotPath: 'file_store.azure_container', envVar: 'AIMEAT_FILE_STORE_AZURE_CONTAINER', type: 'string', validate: shortText(63), immutable: false,
    description: 'The Azure Blob container the files go into. The node does not create it: make it first, private. May be left empty when the credential is a container SAS URL' },
  { key: 'fileStoreAzureEndpoint', dotPath: 'file_store.azure_endpoint', envVar: 'AIMEAT_FILE_STORE_AZURE_ENDPOINT', type: 'string', validate: emptyOrBaseUrl, immutable: false,
    description: 'The blob service address. Empty for Azure itself; set it only for a test against Azurite, for example http://127.0.0.1:10000/devstoreaccount1' },
  { key: 'fileStoreAzureCredential', dotPath: 'file_store.azure_credential', envVar: 'AIMEAT_FILE_STORE_AZURE_CREDENTIAL', type: 'string', validate: () => true, immutable: true,
    description: 'One of: the storage account key, the account\'s connection string, or a container SAS URL with read, add, create, write, delete and list rights (secret)', adminDisplay: 'configured' },
  { key: 'ownerFileStores', dotPath: 'file_store.owner_stores', envVar: 'AIMEAT_OWNER_FILE_STORES', type: 'string', ...oneOf('auto', 'off', 'operator', 'self'), immutable: false,
    description: 'Whether a person may connect their own S3 bucket or Azure container with their own keys, so their files go there instead of the node\'s store and do not count toward the node\'s storage quota. self: everyone may. operator: only the people an operator approved; the others can ask. off: nobody; a store already connected stops taking new files. auto: operator when content access is signed-in (a company\'s node), self otherwise',
    range: 'auto|off|operator|self' },
  { key: 'fileStoreOwnerPrivateOrigins', dotPath: 'file_store.owner_private_origins', envVar: 'AIMEAT_FILE_STORE_OWNER_PRIVATE_ORIGINS', type: 'object', list: true,
    // Any entries are kept as typed; one that is not an exact origin matches no address, because
    // ownerEndpointAllowed (services/file-store/file-store-specs.ts) compares origins exactly.
    validate: v => Array.isArray(v) && v.every(s => typeof s === 'string' && s.trim() !== '' && !s.includes(',') && s.length <= 2048), immutable: false,
    description: 'Addresses on a private network that a person\'s own storage may be at, each an exact origin such as http://10.0.5.20:9000, one per line (comma separated in the environment). For a company whose S3 service runs inside its own network. Empty: a person\'s storage must be a public https address' },
];
