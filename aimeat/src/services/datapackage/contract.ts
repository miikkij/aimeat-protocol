/**
 * @file src/services/datapackage/contract.ts
 * @description THE AIMEAT Data Package contract: what a package is, where it lives, and what its
 *   version is called. Everything else in this directory implements it, and the three bindings
 *   (ctx.datapackage, the browser library, the MCP tools) are doors onto that one implementation.
 *
 *   WHY ONE IMPLEMENTATION AND NOT THREE. A package's identity is a content hash. Two pieces of code
 *   that compute it differently produce two identities for the same bytes, and every consumer pinned
 *   to a hash breaks silently. This node has already paid for that shape once — an app and its
 *   extension hashed the same spreadsheet inputs differently, so every value the app computed looked
 *   stale to the server forever (see EXT_HASH_REFERENCE_JS in services/extension-runtime.ts). So the
 *   hash, the schema inference, the validation and the CSV serialisation live HERE, on the server,
 *   and a browser app reaches them over `/v1/datapackages` rather than reimplementing them.
 *
 *   THE FORMAT is Frictionless Data Package: `datapackage.json` with a Table Schema per tabular
 *   resource, extended under one `aimeat` root key. Nothing is stored twice — the ODPS descriptor,
 *   the OData metadata and an XLSX header row are all projections of the Table Schema, so they
 *   cannot drift from it.
 *
 *   THE ADDRESS is `datapkg/{name}/{contentHash}/datapackage.json`, with `resources[].path` a
 *   sibling relative path (`data/rows.csv`) exactly as Frictionless expects, so `frictionless-py`,
 *   R and the JS client resolve it with no AIMEAT knowledge at all. The hash IS in the path, which
 *   is what makes a published version immutable for free: the same address can never answer with
 *   different bytes. A separate, MUTABLE `datapkg/{name}/latest.json` is the pointer for a consumer
 *   who follows the newest version rather than pinning one.
 *
 *   IT IS ALWAYS THE OWNER'S NAMESPACE. Not the agent's, not `scheduler@node`, not `ext/{name}/`.
 *   A package produced from the app, on a clock, by a workflow step or by an agent has to land at
 *   ONE permanent URL, or "the producer is interchangeable" is not true.
 * @structure DataPackageInput/Descriptor/TableSchema/Field types · packageKeyRoot · descriptorKey ·
 *   resourceKey · latestKey · publicUrl · contentHashOf · buildDescriptor
 * @usage
 *   import { buildDescriptor, contentHashOf, descriptorKey } from './contract.js';
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1, A4/B1/B2).
 */
import { createHash } from 'node:crypto';
import { stableStringify } from '../../utils/stable-json.js';

/** The Frictionless field types this node reads and writes. Deliberately small: a type nobody can
 *  serialise deterministically is a type that produces two different files from one table. */
export type FieldType = 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'datetime' | 'any';

export interface SchemaField {
    name: string;
    type: FieldType;
    /** Present when inference saw no value at all for the field — the publisher should look. */
    description?: string;
}

export interface TableSchema {
    fields: SchemaField[];
    /** Field names that must be present and non-empty on every row. */
    primaryKey?: string[];
}

/** One tabular resource as a producer hands it over: rows plus either a schema or a request to infer. */
export interface ResourceInput {
    name: string;
    rows: Array<Record<string, unknown>>;
    /** 'infer' proposes types from the rows; a TableSchema declares them. See INFERENCE IS A PROPOSAL. */
    schema: 'infer' | TableSchema;
    title?: string;
    description?: string;
}

/** The AIMEAT extension block — one root key, so a Frictionless reader that knows nothing about this
 *  node still parses the descriptor and simply carries an object it does not interpret. */
export interface AimeatBlock {
    packageId: string;
    contentHash: string;
    /** REQUIRED. What changed against the previous version and why. A version nobody explained is a
     *  version a consumer cannot decide about. */
    changes: string;
    producer: { kind: 'workflow' | 'extension' | 'agent' | 'app' | 'manual'; ref?: string; schedule?: string };
    producedBy: { gaii: string; run?: string; at: string };
    /** Whether the Table Schemas were declared by the producer or proposed by inference. A consumer
     *  reading `inferred` knows the types are a guess nobody has confirmed yet. */
    schemaSource: 'declared' | 'inferred' | 'mixed';
    parameters?: Record<string, unknown>;
    sources?: Array<{ url?: string; title?: string; retrievedAt?: string; role?: string }>;
    lineage?: string[];
    transformations?: Array<{ by: string; what: string }>;
    legalBasis?: string;
    consentStatus?: string;
    retention?: string;
    license?: string;
    supersedes?: string;
    retentionPolicy?: { keep: number; unit: 'versions' | 'months' };
    /**
     * The addressable `aimeat.provenance/v1` record for THIS version, when one was minted — an agent
     * publishing is model-touched output and TARGET-058 says that gets declared rather than inferred.
     *
     * Deliberately OUTSIDE the content hash (see contentHashOf's allowlist). A provenance id is a
     * freshly minted UUID, so putting it in the identity would make two identical runs produce two
     * versions and destroy the determinism the whole format leans on. It is a fact ABOUT the version.
     */
    aiProvenanceId?: string;
}

export interface DescriptorResource {
    name: string;
    path: string;
    profile: 'tabular-data-resource';
    format: 'csv';
    mediatype: 'text/csv';
    encoding: 'utf-8';
    schema: TableSchema;
    /** Rows in the resource, so a consumer can size a fetch before making it. */
    rowCount: number;
    bytes: number;
    /** sha256 of the canonical bytes of THIS resource. */
    hash: string;
    title?: string;
    description?: string;
}

export interface Descriptor {
    name: string;
    profile: 'tabular-data-package';
    resources: DescriptorResource[];
    title?: string;
    description?: string;
    licenses?: Array<{ name: string; path?: string }>;
    created: string;
    aimeat: AimeatBlock;
}

/** What a producer hands to `publish`, on every road. */
export interface PublishInput {
    name: string;
    changes: string;
    resources: ResourceInput[];
    title?: string;
    description?: string;
    producer?: Partial<AimeatBlock['producer']>;
    parameters?: Record<string, unknown>;
    provenance?: Pick<AimeatBlock, 'sources' | 'lineage' | 'transformations' | 'legalBasis' | 'consentStatus' | 'retention' | 'license' | 'supersedes'>;
    retentionPolicy?: AimeatBlock['retentionPolicy'];
    /** What the caller said about how this was made (TARGET-058). Threaded to provenanceForWrite. */
    declaredProvenance?: unknown;
    /** An existing provenance record the caller asks to attach instead of minting a new one. */
    declaredProvenanceId?: string;
}

/** A package name is an address segment, so it is constrained like one. */
export const PACKAGE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
/** A resource name becomes a file name under data/. */
export const RESOURCE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

export function validateName(name: string): string | null {
    if (!PACKAGE_NAME_RE.test(name)) {
        return `package name "${name}" must be lowercase letters, digits and dashes, 2-64 characters`;
    }
    return null;
}

/** `datapkg/{name}` — everything about one package lives under this. */
export const packageKeyRoot = (name: string): string => `datapkg/${name}`;
/** The IMMUTABLE address of one version's descriptor. */
export const descriptorKey = (name: string, contentHash: string): string =>
    `${packageKeyRoot(name)}/${bare(contentHash)}/datapackage.json`;
/** The IMMUTABLE address of one version's resource bytes. Matches `resources[].path` relative to
 *  the descriptor, which is what makes a plain Frictionless client resolve it unaided. */
export const resourceKey = (name: string, contentHash: string, resource: string): string =>
    `${packageKeyRoot(name)}/${bare(contentHash)}/${resourcePath(resource)}`;
/** The relative path recorded IN the descriptor. */
export const resourcePath = (resource: string): string => `data/${resource}.csv`;
/** The MUTABLE pointer for a consumer following the newest version. */
export const latestKey = (name: string): string => `${packageKeyRoot(name)}/latest.json`;

/** `sha256:abc…` → `abc…`. Every key uses the bare digest; every field carries the prefix. */
export function bare(hash: string): string {
    return hash.replace(/^sha256:/, '');
}

/** The public, permanent, auth-free URL of a stored key under an owner. */
export function publicUrl(baseUrl: string, ownerGhii: string, key: string): string {
    const path = key.split('/').map(encodeURIComponent).join('/');
    return `${baseUrl.replace(/\/+$/, '')}/v1/pub/${encodeURIComponent(ownerGhii)}/${path}`;
}

/** `pkg:{owner}/{name}` — the package's stable identity, independent of any one version. */
export const packageId = (ownerName: string, name: string): string => `pkg:${ownerName}/${name}`;

/**
 * THE VERSION IS THE CONTENT HASH, and this is the one function that decides it.
 *
 * Computed over the descriptor serialised with object keys sorted (utils/stable-json.ts), so a round
 * trip through Postgres `jsonb` — which normalises key order — cannot change a package's identity.
 * Each resource's own bytes are already summarised by `resources[].hash`, so hashing the descriptor
 * covers both the schema and the data: change one value in one row and the resource hash moves,
 * which moves this one.
 *
 * WHAT IS DELIBERATELY OUTSIDE IT, and why each one:
 *
 * - `created` and `producedBy.at`. Two identical runs of a deterministic producer must agree, or
 *   "same input, same output" is a claim the node itself breaks every time a clock fires.
 *
 * - THE WHOLE PRODUCER BLOCK — `producer` and `producedBy`. This one was learned the hard way: with
 *   it inside, the same rows published by a schedule and by a workflow step hashed differently, so
 *   they landed at two addresses and "the producer is interchangeable" was false. The E2E that
 *   asserts a second producer reaches the SAME version is what caught it. WHO made a version is a
 *   fact ABOUT the version, not part of what the version IS — the same table is the same table
 *   whether a clock, a workflow, an agent or a person produced it.
 *
 *   The consequence is deliberate and is what makes the address immutable: a later identical run
 *   finds the descriptor already stored, answers `unchanged`, and does NOT rewrite it. So the
 *   producer recorded at an address is whoever produced it FIRST, and one address can never hold
 *   two different byte sequences.
 *
 * What IS inside: the data, every Table Schema, the change description (a version is partly its
 * explanation), the provenance block, and `schemaSource` — because "declared" and "inferred" are a
 * real difference to whoever reads the types.
 */
export function contentHashOf(descriptor: Omit<Descriptor, 'aimeat'> & { aimeat: Omit<AimeatBlock, 'contentHash'> }): string {
    // Rebuilt by naming what IS in the identity, rather than by removing what is not: a field added
    // to AimeatBlock later must be considered on purpose, and an allowlist forces that. A denylist
    // would quietly pull the next field in and move every existing version's hash.
    const a = descriptor.aimeat;
    const canonical = {
        name: descriptor.name,
        profile: descriptor.profile,
        resources: descriptor.resources,
        title: descriptor.title,
        description: descriptor.description,
        licenses: descriptor.licenses,
        aimeat: {
            packageId: a.packageId,
            changes: a.changes,
            schemaSource: a.schemaSource,
            parameters: a.parameters,
            sources: a.sources,
            lineage: a.lineage,
            transformations: a.transformations,
            legalBasis: a.legalBasis,
            consentStatus: a.consentStatus,
            retention: a.retention,
            license: a.license,
            supersedes: a.supersedes,
            retentionPolicy: a.retentionPolicy,
        },
    };
    return 'sha256:' + createHash('sha256').update(stableStringify(canonical)).digest('hex');
}

/** sha256 of one resource's canonical bytes. */
export function bytesHash(data: Buffer): string {
    return 'sha256:' + createHash('sha256').update(data).digest('hex');
}

/** What `latest.json` holds — small on purpose, so following the newest version is one cheap GET. */
export interface LatestPointer {
    packageId: string;
    name: string;
    contentHash: string;
    descriptorUrl: string;
    updatedAt: string;
    /** The last run that FAILED, if the newest attempt did. The package stays on the version below,
     *  and this is how a consumer learns the difference between "unchanged" and "broken". */
    lastError?: { at: string; message: string };
}
