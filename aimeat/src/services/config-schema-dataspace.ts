/**
 * @file src/services/config-schema-dataspace.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The config rows of the Eclipse Dataspace Protocol provider (config-dataspace.ts; plan
 *   doc-mvwxcas3dom3, D8), section `dataspace`. Spread into the schema through the data access rows
 *   (config-schema-data-access.ts), because config-schema.ts is at the line ceiling. Each description is
 *   written to be read by the operator on the Config page as the setting's help.
 * @structure DATASPACE_CONFIG_FIELDS
 * @usage import { DATASPACE_CONFIG_FIELDS } from './config-schema-dataspace.js';
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8).
 */
import type { DataspaceConfig } from '../config-dataspace.js';
import { DATASPACE_AUTH_METHODS } from '../config-dataspace.js';
import type { ConfigFieldShape } from './config-field-def.js';

const authListOk = (v: unknown): boolean => typeof v === 'string'
    && v.split(',').map(s => s.trim()).filter(Boolean).every(s => (DATASPACE_AUTH_METHODS as readonly string[]).includes(s));

export const DATASPACE_CONFIG_FIELDS: ConfigFieldShape<keyof DataspaceConfig>[] = [
    { key: 'dataspaceEnabled', dotPath: 'dataspace.enabled', envVar: 'AIMEAT_DATASPACE_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Offer your data packages to data spaces with the Eclipse Dataspace Protocol (DSP 2025-1). On: participants of a data space can read the catalogue, agree on a contract and pull the data. Off (the default): /.well-known/dspace-version and every /dsp/ address answer 404' },
    { key: 'dataspaceAuth', dotPath: 'dataspace.auth', envVar: 'AIMEAT_DATASPACE_AUTH', type: 'string', validate: authListOk, immutable: false, description: 'How a participant proves who it is, comma-separated. dcp: a signed token from its did:web identity (Decentralized Claims Protocol), the way real data spaces work. static: a shared token you give each participant below, for a test lab. Default dcp' },
    { key: 'dataspaceTrustedIssuers', dotPath: 'dataspace.trusted_issuers', envVar: 'AIMEAT_DATASPACE_TRUSTED_ISSUERS', type: 'string', validate: v => typeof v === 'string' && (v as string).length <= 4000, immutable: false, description: 'The credential issuers each data space trusts: <data space>=<issuer DID>,<issuer DID>; separate data spaces with a semicolon. A participant then shows a membership credential from one of them. Empty (the default): a participant that proves its DID is enough' },
    { key: 'dataspaceStaticTokens', dotPath: 'dataspace.static_tokens', envVar: 'AIMEAT_DATASPACE_STATIC_TOKENS', type: 'string', validate: v => typeof v === 'string' && (v as string).length <= 8000, immutable: false, adminDisplay: 'configured', description: 'The shared tokens of the static method: <participant id>=<token>; separate participants with a semicolon. Only for a test lab or the conformance test kit; a real data space uses dcp' },
    { key: 'dataspaceCallbackOrigins', dotPath: 'dataspace.callback_origins', envVar: 'AIMEAT_DATASPACE_CALLBACK_ORIGINS', type: 'string', validate: v => typeof v === 'string' && (v as string).length <= 4000, immutable: false, description: 'Private addresses a participant\'s callback may be at, comma-separated origins such as http://10.0.0.5:8083. Every other callback must be a public https address. Empty by default' },
    { key: 'dataspaceParticipantId', dotPath: 'dataspace.participant_id', envVar: 'AIMEAT_DATASPACE_PARTICIPANT_ID', type: 'string', validate: v => typeof v === 'string' && (v as string).length <= 300, immutable: false, description: 'This server\'s participant id in a data space. Empty (the default): did:web of this server\'s public address, whose document is at /.well-known/did.json' },
    { key: 'dataspaceTckMode', dotPath: 'dataspace.tck_mode', envVar: 'AIMEAT_DATASPACE_TCK_MODE', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Run the Dataspace Protocol conformance test kit (TCK) against this server: it seeds the test kit\'s datasets and agreements and acts out its scenarios. Works only on a test or sandbox server with a loopback address; a public server ignores it' },
];
