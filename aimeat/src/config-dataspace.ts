/**
 * @file src/config-dataspace.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The settings of the Eclipse Dataspace Protocol provider (plan doc-mvwxcas3dom3, D8):
 *   whether this node answers DSP 2025-1 at all, how a participant of a data space proves who it is,
 *   which credential issuers each data space trusts, the static tokens of a test lab, the callback
 *   origins on a private network, and the TCK test mode. Every one is off or empty by default: a node
 *   that never set them answers 404 on /.well-known/dspace-version and on /dsp/.
 *
 *   The values are read raw here and parsed where they are used (services/dataspace/settings.ts), so a
 *   save on the Config page takes effect on the next request without a restart.
 * @structure DataspaceConfig · DATASPACE_AUTH_METHODS · DataspaceAuthMethod · DEFAULT_MAX_PROCESSES_PER_PARTICIPANT ·
 *   dataspaceDefaults · parseDataspaceAuth
 * @usage import { dataspaceDefaults } from './config-dataspace.js';   // spread by dataAccessDefaults()
 * @version-history
 *   v1.1.0 — 2026-11-02 — dataspaceMaxProcessesPerParticipant (AIMEAT_DATASPACE_MAX_PROCESSES_PER_PARTICIPANT,
 *     100, 0 no limit of its own): one participant's share of an owner's process room (secaudit2026nov02d
 *     round 13).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8).
 */

/** How a DSP request proves its participant: a DCP self-issued ID token, or a configured static token. */
export const DATASPACE_AUTH_METHODS = ['dcp', 'static'] as const;
export type DataspaceAuthMethod = typeof DATASPACE_AUTH_METHODS[number];

/** The DSP provider settings, mixed into AimeatConfig. */
export interface DataspaceConfig {
    /** AIMEAT_DATASPACE_ENABLED: answer DSP 2025-1 (catalog, negotiation, transfer). Off by default. */
    dataspaceEnabled: boolean;
    /** AIMEAT_DATASPACE_AUTH: the verifiers a DSP request may pass, comma-separated. Default `dcp`. */
    dataspaceAuth: string;
    /**
     * AIMEAT_DATASPACE_TRUSTED_ISSUERS: the credential issuers each data space trusts.
     * `<dataspace>=<issuer DID>,<issuer DID>;<dataspace>=…`, or a bare DID list for one data space.
     * Empty: a participant that proves its DID is enough, and no credential is asked for.
     */
    dataspaceTrustedIssuers: string;
    /** AIMEAT_DATASPACE_STATIC_TOKENS (secret): `<participant id>=<token>;…`, for a test lab and the TCK. */
    dataspaceStaticTokens: string;
    /** AIMEAT_DATASPACE_CALLBACK_ORIGINS: private origins a callback may reach (a lab on 10.x or loopback). */
    dataspaceCallbackOrigins: string;
    /** AIMEAT_DATASPACE_PARTICIPANT_ID: the node's participant id. Empty: did:web of the public address. */
    dataspaceParticipantId: string;
    /** AIMEAT_DATASPACE_TCK_MODE: seed the TCK's ids and script its scenarios. Refused on a public node. */
    dataspaceTckMode: boolean;
    /**
     * AIMEAT_DATASPACE_MAX_PROCESSES_PER_PARTICIPANT: the most live negotiations and transfers one
     * participant holds with one owner, so one participant cannot take every process slot an owner has
     * (services/dataspace/store.ts processRoom). 0: no limit of its own. Default 100.
     */
    dataspaceMaxProcessesPerParticipant: number;
}

/** The default of AIMEAT_DATASPACE_MAX_PROCESSES_PER_PARTICIPANT: a quarter of an owner's process room. */
export const DEFAULT_MAX_PROCESSES_PER_PARTICIPANT = 100;

/** A count from the environment: a whole number from 0 up, else the default. */
function countOr(v: string | undefined, dflt: number): number {
    const n = Number((v ?? '').trim());
    return (v ?? '').trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 100_000 ? n : dflt;
}

/** The DSP provider settings, from the environment. */
export function dataspaceDefaults(): DataspaceConfig {
    return {
        dataspaceEnabled: process.env.AIMEAT_DATASPACE_ENABLED === 'true',
        dataspaceAuth: (process.env.AIMEAT_DATASPACE_AUTH ?? 'dcp').trim() || 'dcp',
        dataspaceTrustedIssuers: (process.env.AIMEAT_DATASPACE_TRUSTED_ISSUERS ?? '').trim(),
        dataspaceStaticTokens: (process.env.AIMEAT_DATASPACE_STATIC_TOKENS ?? '').trim(),
        dataspaceCallbackOrigins: (process.env.AIMEAT_DATASPACE_CALLBACK_ORIGINS ?? '').trim(),
        dataspaceParticipantId: (process.env.AIMEAT_DATASPACE_PARTICIPANT_ID ?? '').trim(),
        dataspaceTckMode: process.env.AIMEAT_DATASPACE_TCK_MODE === 'true',
        dataspaceMaxProcessesPerParticipant: countOr(process.env.AIMEAT_DATASPACE_MAX_PROCESSES_PER_PARTICIPANT, DEFAULT_MAX_PROCESSES_PER_PARTICIPANT),
    };
}

/** The verifiers a value names, in order; an unknown name is dropped, and none at all is `dcp`. */
export function parseDataspaceAuth(v: unknown): DataspaceAuthMethod[] {
    const names = typeof v === 'string' ? v.split(',').map(s => s.trim().toLowerCase()) : [];
    const out = names.filter((n): n is DataspaceAuthMethod => (DATASPACE_AUTH_METHODS as readonly string[]).includes(n));
    return out.length ? [...new Set(out)] : ['dcp'];
}
