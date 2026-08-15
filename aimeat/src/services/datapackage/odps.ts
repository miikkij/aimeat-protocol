/**
 * @file src/services/datapackage/odps.ts
 * @description The product sheet, as a projection of the descriptor. `odps.yaml` is generated into
 *   every published version so a package is describable to a buyer without anyone authoring a second
 *   document about it.
 *
 *   ONE SCHEMA, MANY PROJECTIONS, and this is one of the projections. The Table Schema is the only
 *   place columns and types are declared; the ODPS sheet, the CSV header and an agent's view of the
 *   package are all derived from it, so they cannot drift. Nothing here is authored — every field
 *   traces to something the descriptor already holds, which is why it stays true when the package
 *   changes and why it needs no mapping layer to maintain.
 *
 *   THREE PLACES THE SPEC'S CLOSED ENUMS DO NOT FIT, handled the same way each time: state it under
 *   `x-aimeat` rather than bend a field to nearly mean it.
 *   - `dataAccess[].format` is `TOON|JSON|XML|CSV|Excel|zip|plain text|GraphQL|MCP`. CSV is on it, so
 *     today's canonical form declares itself honestly. Parquet is not, and when Parquet arrives it
 *     goes in the extension block rather than being called `zip`.
 *   - `specification` is `OAS|RAML|Slate|MCP`. A plain file has no API specification, so the field is
 *     simply absent rather than filled with the closest wrong answer.
 *   - `updateFrequency` IS in the SLA dimension enum, and it is filled from the producer's cron —
 *     recorded, not described. A package nobody schedules gets no SLA block at all: an unstated
 *     service level is an absent one, never a promise of daily.
 * @structure descriptorToOdps · odpsYamlKey
 * @usage const doc = descriptorToOdps({ descriptor, ownerGhii, baseUrl, resourceUrls });
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1: "the package is sellable").
 */
import { stringify as yamlStringify } from 'yaml';
import { ODPS_VERSION, ODPS_SCHEMA_URL_YAML } from '../exchange-odps.js';
import { bare, packageKeyRoot, type Descriptor } from './contract.js';

/** Where the generated sheet sits, beside the descriptor it was projected from. */
export const odpsYamlKey = (name: string, contentHash: string): string =>
    `${packageKeyRoot(name)}/${bare(contentHash)}/odps.yaml`;

/**
 * A cron expression as an ODPS `updateFrequency` objective.
 *
 * Deliberately coarse: the SLA dimension takes a number and a unit, and a cron says more than that
 * shape can hold. What a buyer needs from it is the ORDER OF MAGNITUDE — is this refreshed daily or
 * quarterly — and an expression it cannot express is answered with null rather than a rounded
 * fiction. `unit: 'never'` is the enum's own word for "no cadence", which is not the same as a
 * cadence nobody stated.
 */
function updateFrequencyFrom(cron: string | undefined): { objective: number; unit: 'days' | 'weeks' | 'months' } | null {
    if (!cron) return null;
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5) return null;
    const [, , dom, month, dow] = parts;
    if (month !== '*') return { objective: 1, unit: 'months' };
    if (dom !== '*') return { objective: 1, unit: 'months' };
    if (dow !== '*') {
        // A single weekday is weekly; a list of them is more often than that, and "days" is the
        // honest floor rather than a fraction of a week.
        return /^[0-7]$/.test(dow) ? { objective: 1, unit: 'weeks' } : { objective: 1, unit: 'days' };
    }
    return { objective: 1, unit: 'days' };
}

export interface OdpsProjectionInput {
    descriptor: Descriptor;
    ownerGhii: string;
    baseUrl: string;
    /** The permanent, session-free URL of each resource's CSV, keyed by resource name. */
    resourceUrls: Record<string, string>;
    descriptorUrl: string;
    /** ISO 639-1 language the `details` block is keyed by. v4.1 requires the map. */
    lang?: string;
}

/**
 * Project one published version into an ODPS v4.1 document.
 *
 * Everything traces to the descriptor. `status` is 'production' because a published version at a
 * permanent immutable address is exactly that — a draft is a thing that has not been published, and
 * this function only ever sees published ones.
 */
export function descriptorToOdps(input: OdpsProjectionInput): Record<string, unknown> {
    const { descriptor: d, resourceUrls, descriptorUrl } = input;
    const lang = input.lang ?? 'en';
    const a = d.aimeat;

    const columns = d.resources.flatMap(r => r.schema.fields.map(f => `${r.name}.${f.name} (${f.type})`));
    const rowTotal = d.resources.reduce((n, r) => n + r.rowCount, 0);

    const details: Record<string, unknown> = {
        name: d.title ?? d.name,
        productID: a.packageId,
        // v4.1 `type`: this is a dataset delivered as files, which is what 'dataset' means here.
        type: 'dataset',
        status: 'production',
        visibility: 'public',
        version: bare(a.contentHash).slice(0, 12),
        description: d.description
            ?? `${rowTotal} rows across ${d.resources.length} resource(s), as a Frictionless Data Package.`,
        // The change note is the version's own explanation, and ODPS has a field that means exactly
        // that. It is required on every AIMEAT version, so this is never empty.
        versionNotes: a.changes,
        // The columns, from the ONE place they are declared. A buyer reading the sheet knows the
        // shape before contracting, and this line cannot drift from the data.
        tags: ['frictionless', 'data-package', d.name],
        outputFileFormats: ['CSV'],
        ...(a.sources?.length ? {
            recommendedDataProducts: a.sources.filter(s => s.url).map(s => s.url as string),
        } : {}),
        // A free sample without a separate artefact: the first resource IS the file, and it is
        // world-readable. Nobody buys data blind, and here they do not have to.
        ...(Object.values(resourceUrls)[0] ? { contentSample: Object.values(resourceUrls)[0] } : {}),
    };

    const dataAccess: Record<string, unknown> = {
        default: {
            name: { [lang]: 'Permanent file address' },
            description: {
                [lang]: 'The resource CSV at a permanent, immutable URL. No authentication, no API key, '
                    + 'byte ranges supported. The version is the content hash in the path, so this address '
                    + 'can never answer with different bytes.',
            },
            outputPortType: 'file',
            format: 'CSV',
            authenticationMethod: 'none',
            accessURL: Object.values(resourceUrls)[0] ?? descriptorUrl,
            documentationURL: descriptorUrl,
            hashType: 'SHA-256',
            checksum: bare(d.resources[0]?.hash ?? a.contentHash),
        },
        descriptor: {
            name: { [lang]: 'Frictionless descriptor' },
            description: {
                [lang]: 'datapackage.json with a Table Schema per resource. frictionless-py, R and the JS '
                    + 'client resolve the resources from it with no AIMEAT knowledge.',
            },
            outputPortType: 'file',
            format: 'JSON',
            authenticationMethod: 'none',
            accessURL: descriptorUrl,
            documentationURL: descriptorUrl,
        },
    };

    const freq = updateFrequencyFrom(a.producer.schedule);
    const sla = freq
        ? {
            declarative: [{
                name: { [lang]: 'Producer cadence' },
                description: {
                    [lang]: `Refreshed by a ${a.producer.kind} producer on the schedule "${a.producer.schedule}". `
                        + 'A run that fails writes no version: the package stays on its previous one and the '
                        + 'failure is recorded on the package pointer.',
                },
                dimensions: [{
                    dimension: 'updateFrequency',
                    objective: String(freq.objective),
                    unit: freq.unit,
                }],
            }],
        }
        : null;

    return {
        schema: ODPS_SCHEMA_URL_YAML,
        version: ODPS_VERSION,
        product: {
            details: { [lang]: details },
            dataAccess,
            ...(a.license ? { license: { scope: { definition: a.license } } } : {}),
            ...(sla ? { SLA: sla } : {}),
            // Everything the closed enums cannot hold, stated rather than bent into a near-fit.
            'x-aimeat': {
                packageId: a.packageId,
                contentHash: a.contentHash,
                descriptorUrl,
                profile: 'aimeat.datapackage/v1',
                schemaSource: a.schemaSource,
                producer: a.producer,
                producedBy: a.producedBy,
                resources: d.resources.map(r => ({
                    name: r.name, rowCount: r.rowCount, bytes: r.bytes, hash: r.hash,
                    url: resourceUrls[r.name] ?? null,
                    fields: r.schema.fields.map(f => ({ name: f.name, type: f.type })),
                })),
                columns,
                ...(a.legalBasis ? { legalBasis: a.legalBasis } : {}),
                ...(a.consentStatus ? { consentStatus: a.consentStatus } : {}),
                ...(a.retention ? { retention: a.retention } : {}),
                ...(a.retentionPolicy ? { retentionPolicy: a.retentionPolicy } : {}),
                ...(a.lineage?.length ? { lineage: a.lineage } : {}),
                ...(a.transformations?.length ? { transformations: a.transformations } : {}),
                ...(a.supersedes ? { supersedes: a.supersedes } : {}),
                ...(a.aiProvenanceId ? { aiProvenanceId: a.aiProvenanceId } : {}),
            },
        },
    };
}

/** The generated sheet as YAML — the format ODPS leads with. */
export function odpsToYamlDocument(doc: Record<string, unknown>): string {
    return yamlStringify(doc, { lineWidth: 0 });
}
