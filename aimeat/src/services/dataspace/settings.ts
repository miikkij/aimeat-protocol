/**
 * @file src/services/dataspace/settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The DSP provider's settings as the code uses them (plan doc-mvwxcas3dom3, D8): the
 *   node's own participant id and did:web, the verifiers in force, the trusted issuers of each data
 *   space, the static tokens, the callback origins, whether the TCK mode is in force, and each owner's
 *   per-package choice to agree on their own (`dsp.settings`). The raw values live in the config
 *   (config-dataspace.ts) and are parsed on each use, so a save on the Config page needs no restart.
 *
 *   THE TCK MODE IS NEVER ON IN PRODUCTION. It is in force only when it is set AND the node's public
 *   address is a loopback address AND the node is a test node (AIMEAT_TEST_MODE, AIMEAT_DEV_MODE, the
 *   sandbox's dev mode, or NODE_ENV=test). A public node that sets it is told so in the admin status and
 *   acts as if it were off.
 * @structure nodeParticipantId · nodeDidWeb · authMethods · trustedIssuers · staticParticipantFor ·
 *   callbackOrigins · maxProcessesPerParticipant · processRoomRefusal · tckModeVerdict · tckModeOn ·
 *   PackageDspSettings · OwnerDspSettings · readOwnerSettings · writeOwnerSettings · autoAgreeFor
 * @usage if (tckModeOn(config)) …;  const did = nodeParticipantId(config);
 * @version-history
 *   v1.1.0 — 2026-11-02 — maxProcessesPerParticipant and processRoomRefusal: one participant's share of an
 *     owner's process room, and the refusal that names the setting (secaudit2026nov02d round 13).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8).
 */
import { timingSafeEqual, createHash } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { DEFAULT_MAX_PROCESSES_PER_PARTICIPANT, parseDataspaceAuth, type DataspaceAuthMethod } from '../../config-dataspace.js';
import { isLoopbackBaseUrl } from '../../utils/test-money-guard.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { SETTINGS_KEY } from './contract.js';
import { processRoom } from './store.js';

type Cfg = Pick<AimeatConfig, 'baseUrl'> & Partial<Pick<AimeatConfig,
    'dataspaceParticipantId' | 'dataspaceAuth' | 'dataspaceTrustedIssuers' | 'dataspaceStaticTokens' |
    'dataspaceCallbackOrigins' | 'dataspaceTckMode' | 'dataspaceMaxProcessesPerParticipant' | 'testMode' | 'devMode'>>;

/** did:web of the node's public address: the host, a port percent-encoded, a path as colons. */
export function nodeDidWeb(baseUrl: string): string {
    const u = new URL(baseUrl);
    const host = u.port ? `${u.hostname}%3A${u.port}` : u.hostname;
    const path = u.pathname.split('/').filter(Boolean).map(encodeURIComponent);
    return ['did:web', host, ...path].join(':');
}

/** The node's participant id in a data space: the configured one, else its did:web. */
export function nodeParticipantId(config: Cfg): string {
    return config.dataspaceParticipantId?.trim() || nodeDidWeb(config.baseUrl);
}

export function authMethods(config: Cfg): DataspaceAuthMethod[] {
    return parseDataspaceAuth(config.dataspaceAuth ?? 'dcp');
}

/**
 * The trusted issuers of each data space: `ds=did1,did2;ds2=did3`, or a bare list for one data space
 * named `default`. Empty map: no credential is asked for.
 */
export function trustedIssuers(config: Cfg): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const raw = (config.dataspaceTrustedIssuers ?? '').trim();
    if (!raw) return out;
    for (const part of raw.split(';').map(s => s.trim()).filter(Boolean)) {
        const eq = part.indexOf('=');
        // A data space name holds no colon; a DID always does, so `did:web:x` alone is a bare list.
        const named = eq > 0 && !part.slice(0, eq).includes(':');
        const name = named ? part.slice(0, eq).trim() : 'default';
        const list = (named ? part.slice(eq + 1) : part).split(',').map(s => s.trim()).filter(s => s.startsWith('did:'));
        if (list.length) out.set(name, [...(out.get(name) ?? []), ...list]);
    }
    return out;
}

const digest = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

/**
 * The participant a static token belongs to, or null. `id=token;id2=token2`; the id is up to the first
 * `=`. Every configured token is compared, in constant time over their digests.
 */
export function staticParticipantFor(config: Cfg, presented: string): string | null {
    const raw = (config.dataspaceStaticTokens ?? '').trim();
    if (!raw || !presented) return null;
    const given = digest(presented);
    let found: string | null = null;
    for (const part of raw.split(';').map(s => s.trim()).filter(Boolean)) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const id = part.slice(0, eq).trim();
        const token = part.slice(eq + 1).trim();
        if (!id || !token) continue;
        if (timingSafeEqual(digest(token), given) && !found) found = id;
    }
    return found;
}

/** The private origins a callback may reach, as exact origins. */
export function callbackOrigins(config: Cfg): string[] {
    return (config.dataspaceCallbackOrigins ?? '').split(',').map(s => s.trim()).filter(s => URL.canParse(s)).map(s => new URL(s).origin);
}

/** The most live processes one participant holds with one owner (AIMEAT_DATASPACE_MAX_PROCESSES_PER_PARTICIPANT); 0 is no limit of its own. */
export function maxProcessesPerParticipant(config: Cfg): number {
    const v = config.dataspaceMaxProcessesPerParticipant;
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : DEFAULT_MAX_PROCESSES_PER_PARTICIPANT;
}

/**
 * The refusal of a new process when the owner has no room for it (./store.ts processRoom), as the
 * consumer reads it: the code and the reason, which names the setting the operator raises. Null: room.
 */
export async function processRoomRefusal(
    storage: Storage, config: Cfg, ownerGhii: string, participantId: string, what: 'negotiations' | 'transfers',
): Promise<{ code: string; reason: string } | null> {
    const limit = maxProcessesPerParticipant(config);
    const room = await processRoom(storage, ownerGhii, participantId, limit);
    if (!room) return null;
    if (room.full === 'provider') return { code: 'PROVIDER_BUSY', reason: `This provider holds too many open ${what}. Try again later.` };
    return {
        code: 'PARTICIPANT_BUSY',
        reason: `You hold ${room.live} open negotiations and transfers with this provider, the most one participant may (AIMEAT_DATASPACE_MAX_PROCESSES_PER_PARTICIPANT is ${limit} on this server). Complete or terminate one first, or ask the operator of this server to raise that setting.`,
    };
}

/** Whether the TCK mode is in force, and when it is set but refused, why. */
export function tckModeVerdict(config: Cfg): { on: boolean; refused?: string } {
    if (!config.dataspaceTckMode) return { on: false };
    if (!isLoopbackBaseUrl(config.baseUrl)) return { on: false, refused: 'The TCK mode is set, and refused: this server\'s public address is not a loopback address, so it is not a test server.' };
    const testNode = config.testMode === true || config.devMode === true || process.env.NODE_ENV === 'test';
    if (!testNode) return { on: false, refused: 'The TCK mode is set, and refused: this server is not in test or development mode.' };
    return { on: true };
}

export const tckModeOn = (config: Cfg): boolean => tckModeVerdict(config).on;

/** One package's DSP choice. */
export interface PackageDspSettings {
    /** Agreements within the published policy are made at once; otherwise they wait for the owner. */
    autoAgree: boolean;
    updatedAt: string;
    updatedBy: string;
}

export interface OwnerDspSettings {
    packages: Record<string, PackageDspSettings>;
}

const parseSettings = (v: unknown): OwnerDspSettings => {
    const p = (v as OwnerDspSettings | null)?.packages;
    return { packages: p && typeof p === 'object' && !Array.isArray(p) ? p : {} };
};

export async function readOwnerSettings(storage: Storage, ownerGhii: string): Promise<OwnerDspSettings> {
    return parseSettings((await storage.getMemory(ownerGhii, SETTINGS_KEY))?.value);
}

/** Set one package's choice; `null` removes it (the package then waits for the owner, the default). */
export async function writeOwnerSettings(
    storage: Storage, ownerGhii: string, pkg: string, autoAgree: boolean | null, by: string,
): Promise<OwnerDspSettings> {
    return updateRecord(storage, ownerGhii, SETTINGS_KEY, parseSettings, cur => {
        const packages = { ...cur.packages };
        if (autoAgree === null) {
            if (!(pkg in packages)) return UNCHANGED;
            delete packages[pkg];
        } else {
            packages[pkg] = { autoAgree, updatedAt: new Date().toISOString(), updatedBy: by };
        }
        return { packages };
    }, { tag: 'dsp-settings' });
}

/** Does this package agree on its own? False unless the owner said so. */
export async function autoAgreeFor(storage: Storage, ownerGhii: string, pkg: string): Promise<boolean> {
    return (await readOwnerSettings(storage, ownerGhii)).packages[pkg]?.autoAgree === true;
}
