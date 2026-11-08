/**
 * @file src/services/dataproduct/sources-io.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data product sources that read something other than memory: an extension action
 *   the node runs, a stored CSV or XLSX file, and another data package (plan doc-mvwxcas3dom3, D9.1).
 *
 *   extension    runExtensionActionAsSystem, the code path a schedule and a workflow extension step
 *                run: the owner's own active extension only. A principal other than the owner in
 *                person needs ext:invoke, as aimeat_extension_invoke asks. The rows are the array at
 *                `rows_at` of the answer. An app whose data map names the extension and marks its data
 *                personal makes every column personal (services/datapackage/personal-guard.ts).
 *   file         resolveFileRef, the check GET /v1/pub and the file references use: a bare key is the
 *                owner's file (an agent's own file first), `<owner ghii>/<key>` another account's, read
 *                only when its visibility admits the caller. CSV is read with the data package parser;
 *                XLSX through the spreadsheet reader, one sheet.
 *   datapackage  openPackage and readAllRows as the caller, so a package's audience decides; the
 *                version read goes into the new version's lineage, and its label source and its file's
 *                label into the new version's (labelSources), as a file source's file label does.
 * @structure readExtensionSource · readFileSource · readDatapackageSource · typedFromStrings
 * @usage const src = await readFileSource(call, exporting);
 * @version-history
 *   v1.2.0 — 2026-11-08 — A datapackage source carries the version's label source and its file's label,
 *     and a file source its file's label, so a derived product keeps the readers of what it copied
 *     (secaudit2026nov08b round 15, dataproduct/sources-io:derived-product-drops-upstream-version-label-source).
 *   v1.1.1 — 2026-11-01 — A package source's audience is the service's record (trustedPackageOf), not
 *     the pointer's visibility (WP9e, incident ...-mvxozs2r).
 *   v1.1.0 — 2026-11-01 — An extension action's output schema gives its columns' types and descriptions,
 *     and another package's Table Schema its descriptions (WP9c, the wizard's step 2).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D9.1).
 */
import type { FieldType } from '../datapackage/contract.js';
import { runExtensionActionAsSystem } from '../extension-system-run.js';
import { personalRowsFor } from '../datapackage/personal-guard.js';
import { resolveFileRef } from '../file-refs.js';
import { readerFor } from '../classification/reader.js';
import { fileTarget } from '../classification/labels.js';
import { extractFileText } from '../file-text/index.js';
import { fromCsv } from '../datapackage/table.js';
import { openPackage, readAllRows } from '../datapackage/store.js';
import { trustedPackageOf } from '../datapackage/audience-record.js';
import { fileCopyTargets, packageCopyTargets } from '../datapackage/source-labels.js';
import { atPath } from '../workflow/engine-step-rows.js';
import { findExtension } from '../component-address.js';
import { logger } from '../../utils/logger.js';
import { descriptionsOfJson, fieldTypeOfJson } from './sources-memory.js';
import {
    type ResolvedSource, type SourceCall, sourceError, needWord, shapeRows, tableOf, audienceOfStored,
} from './source-common.js';

const now = () => new Date().toISOString();

/** An extension action's answer, the array at rows_at. */
export async function readExtensionSource(call: SourceCall): Promise<ResolvedSource> {
    const { deps, caller, spec } = call;
    needWord(call, 'ext:invoke');
    let result: unknown;
    try {
        const out = await runExtensionActionAsSystem(deps, {
            extensionName: spec.ext!, actionId: spec.action!, input: spec.input ?? {},
            ...(spec.instance_id ? { instanceId: spec.instance_id } : {}),
            callerGaii: caller.principal, ownerName: caller.owner, storageOwnerGhii: caller.ownerGhii,
            logLabel: `dataproduct:${call.productName}:${spec.id}`, producerKind: 'extension',
            producerRef: `dataproducts.${call.productName}`,
        });
        result = out.result;
    } catch (err) {
        throw sourceError(spec, 'SOURCE_FAILED', (err as Error).message, 502);
    }
    const found = spec.rows_at ? atPath(result, spec.rows_at) : result;
    if (!Array.isArray(found)) {
        throw sourceError(spec, 'NOT_ROWS', `the answer of ${spec.ext}/${spec.action} has no array${spec.rows_at ? ` at "${spec.rows_at}"` : ''}. Name the path to the rows in rows_at.`);
    }
    // The action's output schema, at the rows: what each column is and its type, where it says so.
    const rowSchema = await actionRowSchema(call);
    const types: Record<string, FieldType | undefined> = {};
    if (!spec.columns) for (const [col, p] of Object.entries(rowSchema ?? {})) types[col] = fieldTypeOfJson(p);
    const table = tableOf(spec.id, shapeRows(found, spec.columns), types);
    const personal = (await personalRowsFor(deps.storage, caller.ownerGhii, call.productName, { extension: spec.ext! })).length > 0;
    return {
        ...table, ...(rowSchema && !spec.columns ? { descriptions: descriptionsOfJson(rowSchema) } : {}),
        personal: personal ? new Set(table.columns) : new Set(), audience: 'public', fetchedAt: now(),
        provenance: { kind: 'extension', address: `ext:${spec.ext}/${spec.action}` },
    };
}

/**
 * The properties of one row in an extension action's declared output schema: the schema walked down
 * `rows_at`, then into the array's items. Null when the action declares none, or the path leads to no
 * array of objects.
 */
async function actionRowSchema(call: SourceCall): Promise<Record<string, unknown> | null> {
    const { deps, caller, spec } = call;
    // The schema only describes the columns: a lookup that fails leaves them undescribed, said in the log.
    const ext = await findExtension(deps.storage, spec.ext!, caller.owner, 'manage').catch((err: unknown) => {
        logger.debug('dataproduct: the extension\'s output schema could not be read', { ext: spec.ext, error: String(err) });
        return null;
    });
    let node = (ext?.actions.find(a => a.id === spec.action) as { outputSchema?: unknown } | undefined)?.outputSchema as Record<string, unknown> | undefined;
    for (const seg of (spec.rows_at ?? '').split('.').filter(Boolean)) {
        node = (node?.properties as Record<string, Record<string, unknown>> | undefined)?.[seg];
    }
    const items = node?.type === 'array' ? node.items as Record<string, unknown> | undefined : undefined;
    const props = items?.properties;
    return props && typeof props === 'object' ? props as Record<string, unknown> : null;
}

/** Strings from a CSV, typed: a column whose every value is a number becomes a number column. */
export function typedFromStrings(rows: Array<Record<string, unknown>>, columns: string[]): { rows: Array<Record<string, unknown>>; types: Record<string, FieldType> } {
    const types: Record<string, FieldType> = {};
    for (const c of columns) {
        const values = rows.map(r => r[c]).filter(v => v !== null && v !== undefined && v !== '').map(String);
        if (values.length && values.every(v => /^-?\d+$/.test(v.trim()))) types[c] = 'integer';
        else if (values.length && values.every(v => /^-?\d+([.,]\d+)?([eE][-+]?\d+)?$/.test(v.trim()))) types[c] = 'number';
        else if (values.length && values.every(v => /^(true|false)$/i.test(v.trim()))) types[c] = 'boolean';
        else if (values.length && values.every(v => /^\d{4}-\d{2}-\d{2}$/.test(v.trim()))) types[c] = 'date';
        else types[c] = 'string';
    }
    return { rows, types };
}

/** The CSV block of one sheet in the spreadsheet reader's text. */
function sheetCsv(text: string, sheet: string | undefined): string | null {
    const blocks = text.split(/^## Sheet: /m).filter(Boolean).map(b => {
        const nl = b.indexOf('\n');
        return { name: b.slice(0, nl).trim(), csv: b.slice(nl + 1).replace(/^\n/, '') };
    });
    const hit = sheet ? blocks.find(b => b.name === sheet) : blocks[0];
    return hit ? hit.csv : null;
}

/** A stored CSV or XLSX file. */
export async function readFileSource(call: SourceCall, exporting: boolean): Promise<ResolvedSource> {
    const { deps, caller, spec } = call;
    needWord(call, 'storage:read');
    const reader = readerFor(deps, caller.auth);
    const accessor = { gaii: caller.principal, sub: caller.auth.sub, owner: caller.owner, reader };
    const key = spec.key!;
    const named = key.includes('@') && key.indexOf('/') > key.indexOf('@');
    // A bare key: an agent's own file first, then the owner's.
    const refs = named ? [key] : [...(caller.principal !== caller.ownerGhii ? [`${caller.principal}/${key}`] : []), `${caller.ownerGhii}/${key}`];
    let resolved: Awaited<ReturnType<typeof resolveFileRef>> | null = null;
    for (const ref of refs) {
        resolved = await resolveFileRef(deps.storage, deps.config, ref, accessor);
        if (resolved.access !== 'missing') break;
    }
    if (!resolved || resolved.access === 'missing') throw sourceError(spec, 'NOT_FOUND', `there is no file "${key}".`, 404);
    if (resolved.access === 'denied' || !resolved.file) throw sourceError(spec, 'FORBIDDEN', `you may not read the file "${key}".`, 403);
    const file = resolved.file;
    if (exporting) {
        const { left } = await reader.leave([file], f => fileTarget(f.ownerGaii, f.key, f.workspaceRef), { kind: 'export', organismId: null });
        if (left.length) throw sourceError(spec, 'CLASSIFIED', `"${key}" is ${left[0]!.reason}, so it is not published.`, 403);
    }
    const isXlsx = /spreadsheetml\.sheet/.test(file.mimeType) || /\.xlsx$/i.test(file.key);
    const isCsv = /csv/.test(file.mimeType) || /\.csv$/i.test(file.key);
    let csv: string | null;
    if (isXlsx) {
        const text = await extractFileText(file.data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', file.key);
        csv = text?.text ? sheetCsv(text.text, spec.sheet) : null;
        if (csv === null) throw sourceError(spec, 'NOT_ROWS', text?.note ?? (spec.sheet ? `the workbook has no sheet "${spec.sheet}".` : 'the workbook has no sheet with data.'));
    } else if (isCsv) {
        csv = file.data.toString('utf8');
    } else {
        throw sourceError(spec, 'INVALID_INPUT', `"${key}" is ${file.mimeType}; a file source reads a CSV or an XLSX file.`);
    }
    const raw = fromCsv(Buffer.from(csv, 'utf8'), { fields: [] });
    const shaped = shapeRows(raw, spec.columns);
    const table = tableOf(spec.id, shaped);
    const typed = typedFromStrings(table.rows, table.columns);
    return {
        ...table, types: typed.types, audience: audienceOfStored(file.visibility), fetchedAt: now(),
        labelSources: await fileCopyTargets(deps.storage, file.ownerGaii, file.key, file.workspaceRef),
        provenance: { kind: 'file', address: `${file.ownerGaii}/${file.key}`, title: file.key.split('/').pop() },
    };
}

/** Another data package: one resource of its newest version. */
export async function readDatapackageSource(call: SourceCall): Promise<ResolvedSource> {
    const { deps, caller, spec } = call;
    const owner = spec.owner ?? caller.owner;
    if (owner === caller.owner && spec.name === call.productName) {
        throw sourceError(spec, 'INVALID_INPUT', 'a product cannot read the package it builds.');
    }
    const ref = `pkg:${owner}/${spec.name}`;
    const opened = await openPackage(deps, ref, deps.config.nodeId, caller.auth);
    if (!opened) throw sourceError(spec, 'NOT_FOUND', `there is no data package ${ref} you may read.`, 404);
    const d = opened.descriptor;
    const resource = spec.resource ?? d.resources[0]?.name;
    const all = resource ? await readAllRows(deps, ref, deps.config.nodeId, resource, caller.auth) : null;
    if (!all) throw sourceError(spec, 'NOT_FOUND', `${ref} has no resource "${resource}". Its resources: ${d.resources.map(r => r.name).join(', ')}.`, 404);
    const types = Object.fromEntries(all.schema.fields.map(f => [f.name, f.type]));
    const shaped = spec.columns ? shapeRows(all.rows, spec.columns) : all.rows;
    const table = tableOf(spec.id, shaped, spec.columns ? {} : types, new Set(), spec.columns ? [] : all.schema.fields.map(f => f.name));
    // The other package's Table Schema says what each column is.
    const descriptions = spec.columns ? {} : Object.fromEntries(all.schema.fields.filter(f => f.description).map(f => [f.name, String(f.description)]));
    // The source's audience bounds the product's: it is the one the service recorded, never the
    // pointer file's word, which an app with storage:write rewrites (./audience-record.ts).
    const ownerGhii = owner.includes('@') ? owner : `${owner}@${deps.config.nodeId}`;
    const pkg = await trustedPackageOf(deps.storage, deps.config.nodeId, ownerGhii, spec.name!);
    const license = d.licenses?.[0]?.name ?? d.aimeat.license;
    // The labels the version read keeps travel with the copy (datapackage/source-labels.ts).
    const labelSources = await packageCopyTargets(deps.storage, ownerGhii, spec.name!, d.aimeat.contentHash, resource!);
    return {
        ...table, descriptions, audience: audienceOfStored(pkg ? pkg.trusted.visibility ?? 'public' : 'private'), fetchedAt: now(), labelSources,
        lineage: `${d.aimeat.packageId}@${d.aimeat.contentHash}`,
        provenance: { kind: 'datapackage', address: opened.descriptorUrl, ...(d.title ? { title: d.title } : {}), ...(license ? { license } : {}) },
    };
}
