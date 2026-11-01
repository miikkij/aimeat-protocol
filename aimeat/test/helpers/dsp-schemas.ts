/**
 * @file test/helpers/dsp-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Validate a Dataspace Protocol body against the normative DSP 2025-1 JSON Schemas copied
 *   into test/fixtures/dsp/ (Apache-2.0, see the NOTICE there). Every schema is loaded under its own
 *   `$id`, so the cross-file `$ref`s resolve without the network. The schema is picked by the body's
 *   `@type`, as the TCK picks it.
 * @structure dspSchemaErrors(body, type?) → string[]
 * @usage const errs = dspSchemaErrors(catalog); assert(!errs.length, errs.join('; '));
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2019 from 'ajv/dist/2019.js';
import addFormats from 'ajv-formats';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'dsp');
const ajv = new Ajv2019({ strict: false, allErrors: true });
(addFormats as unknown as (a: unknown) => void)(ajv);
for (const dir of ['common', 'catalog', 'negotiation', 'transfer']) {
    for (const f of readdirSync(join(ROOT, dir)).filter(n => n.endsWith('-schema.json'))) {
        // Three transfer schemas write a fragment without its leading slash (`#definitions/…`), which a
        // JSON Pointer needs; the TCK's validator tolerates it and Ajv does not. Read with the slash,
        // the files themselves stay as published.
        ajv.addSchema(JSON.parse(readFileSync(join(ROOT, dir, f), 'utf8').replace(/\.json#definitions\//g, '.json#/definitions/')));
    }
}

const BASE = 'https://w3id.org/dspace/2025/1/';
const BY_TYPE: Record<string, string> = {
    Catalog: 'catalog/catalog-schema.json',
    Dataset: 'catalog/dataset-schema.json',
    CatalogError: 'catalog/catalog-error-schema.json',
    ContractNegotiation: 'negotiation/contract-negotiation-schema.json',
    ContractNegotiationError: 'negotiation/contract-negotiation-error-schema.json',
    ContractOfferMessage: 'negotiation/contract-offer-message-schema.json',
    ContractAgreementMessage: 'negotiation/contract-agreement-message-schema.json',
    ContractNegotiationEventMessage: 'negotiation/contract-negotiation-event-message-schema.json',
    ContractNegotiationTerminationMessage: 'negotiation/contract-negotiation-termination-message-schema.json',
    TransferProcess: 'transfer/transfer-process-schema.json',
    TransferError: 'transfer/transfer-error-schema.json',
    TransferStartMessage: 'transfer/transfer-start-message-schema.json',
    TransferCompletionMessage: 'transfer/transfer-completion-message-schema.json',
    TransferSuspensionMessage: 'transfer/transfer-suspension-message-schema.json',
    TransferTerminationMessage: 'transfer/transfer-termination-message-schema.json',
    VersionResponse: 'common/protocol-version-schema.json',
};

/** The schema errors of `body` for its `@type` (or the type given); [] when it validates. */
export function dspSchemaErrors(body: unknown, type?: string): string[] {
    const t = type ?? String((body as { '@type'?: unknown })?.['@type'] ?? '');
    const file = BY_TYPE[t];
    if (!file) return [`no DSP schema for @type ${t || '(none)'}`];
    const validate = ajv.getSchema(BASE + file);
    if (!validate) return [`schema ${file} did not load`];
    return validate(body) ? [] : (validate.errors ?? []).map(e => `${e.instancePath || '(root)'} ${e.message}${e.params ? ` ${JSON.stringify(e.params)}` : ''}`);
}
