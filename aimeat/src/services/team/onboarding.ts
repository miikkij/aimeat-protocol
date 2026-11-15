/**
 * @file src/services/team/onboarding.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The team's AI onboarding and its record (team setup T11, EU AI Act article 4). Since
 *   2 February 2025 an organisation that uses AI makes sure the people who use it on its behalf
 *   have sufficient AI literacy, and a supervisor may ask what it did. A team's skill holds how the
 *   team uses AI; the member's own AI goes through it with them (the onboarding section of the skill,
 *   data/team-kit.ts), and when the person confirms they went through it, the node writes who, which
 *   version of the team's guide and when. That entry is the organisation's evidence of one measure
 *   it took for that person. It is a record of the onboarding, not a training course or a test.
 *
 *   ONE RECORD PER TEAM, a collection read as a unit: `organism.<id>.meta.ai-literacy`, under the
 *   team record's owner, written on its version (services/record-cas.ts). One entry per person and
 *   guide version: going through a newer version adds a line, the old one stays. A person whose
 *   membership ends keeps their line, because it says what was done while they were in the team.
 *
 *   WHO WRITES. The person confirms for themselves: the account in person, or their own AI on their
 *   word (`via` records which). Nobody records another person's onboarding.
 * @structure LiteracyEntry · literacyKey · readTeamLiteracy · recordTeamOnboarding · literacySummary
 * @usage const out = await recordTeamOnboarding(deps, caller, orgId);
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T11).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { emitChange } from '../event-bus.js';
import { siemEmit } from '../node-admin/siem-export.js';
import { resolveSkillRef } from '../skills.js';
import { logger } from '../../utils/logger.js';
import { readTeamRecordWithVersion, teamDisplayName } from './record.js';
type Deps = { storage: Storage; config: AimeatConfig };
type TeamDoorFailure = { ok: false; status: number; code: string; message: string };

export const LITERACY_TYPE = 'aimeat.team-ai-literacy/v1' as const;
/** At most this many lines in one team's record; the oldest go first past it. */
const MAX_ENTRIES = 2000;

export interface LiteracyEntry {
    account: string;
    /** When the person confirmed it. */
    at: string;
    /** The team guide that was gone through: the team skill's ref and version. */
    skill: string | null;
    skill_version: string | null;
    /** `person`: confirmed signed in; `ai`: the person's own AI recorded it on their word. */
    via: 'person' | 'ai';
    /** The exact principal that wrote it. */
    by: string;
}
interface LiteracyRecord { type: typeof LITERACY_TYPE; entries: LiteracyEntry[] }

export function literacyKey(orgId: string): string { return `organism.${orgId}.meta.ai-literacy`; }

function parse(v: unknown): LiteracyRecord {
    const entries = Array.isArray((v as LiteracyRecord | null)?.entries) ? (v as LiteracyRecord).entries : [];
    return { type: LITERACY_TYPE, entries: entries.filter(e => e && typeof e.account === 'string' && typeof e.at === 'string') };
}

/** Every onboarding line of the team, oldest first. */
export async function readTeamLiteracy(storage: Storage, orgId: string): Promise<LiteracyEntry[]> {
    const { items } = await storage.listAllMemory({ prefix: literacyKey(orgId), limit: 5 });
    const rec = items.filter(r => r.key === literacyKey(orgId)).sort((a, b) => b.version - a.version)[0];
    return parse(rec?.value).entries;
}

/** Per member of `accounts`: the latest line, or null when they have not gone through it. */
export function literacySummary(entries: LiteracyEntry[], accounts: string[], skillVersion: string | null): { done: number; current: number; of: number; latest: Map<string, LiteracyEntry> } {
    const latest = new Map<string, LiteracyEntry>();
    for (const e of entries) {
        const was = latest.get(e.account);
        if (!was || was.at < e.at) latest.set(e.account, e);
    }
    const members = accounts.filter(a => latest.has(a));
    return {
        done: members.length,
        current: skillVersion ? members.filter(a => latest.get(a)!.skill_version === skillVersion).length : members.length,
        of: accounts.length, latest,
    };
}

/** The team skill's current version, or null when it cannot be read. */
export async function teamSkillVersion(deps: Deps, ref: string | null, ownerName: string): Promise<string | null> {
    if (!ref) return null;
    try {
        const s = await resolveSkillRef(deps.storage, deps.config, ref, { ownerName }, { manifestOnly: true });
        return s.version ?? null;
    } catch (err) {
        // A skill that cannot be read is recorded without a version; the onboarding still counts.
        logger.warn('team onboarding: the team skill version could not be read', { ref, error: String(err) });
        return null;
    }
}

/** The caller confirms they went through the team's AI onboarding. */
export async function recordTeamOnboarding(deps: Deps, caller: CallerContext, orgId: string): Promise<TeamDoorFailure | { ok: true; entry: LiteracyEntry; already: boolean; team: string }> {
    const { storage } = deps;
    if (!caller.owner || caller.visitor) return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Teams belong to an account of this node' };
    const membership = await storage.getMembership(orgId, caller.owner);
    const read = membership?.status === 'active' ? await readTeamRecordWithVersion(storage, orgId) : null;
    const organism = read ? await storage.getOrganism(orgId) : null;
    if (!read || !organism || organism.archived) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'No team with that organism_id that you are in' };
    const skill = read.team.skill?.ref ?? null;
    const version = await teamSkillVersion(deps, skill, caller.owner);
    const entry: LiteracyEntry = {
        account: caller.owner, at: new Date().toISOString(), skill, skill_version: version,
        via: caller.inPerson ? 'person' : 'ai', by: caller.principal,
    };
    let already = false;
    await updateRecord(storage, read.ownerGaii, literacyKey(orgId), parse, (cur) => {
        const same = cur.entries.find(e => e.account === entry.account && e.skill === skill && e.skill_version === version);
        if (same) { already = true; Object.assign(entry, same); return UNCHANGED; }
        return { type: LITERACY_TYPE, entries: [...cur.entries, entry].slice(-MAX_ENTRIES) };
    }, { tag: 'team-ai-literacy' });
    if (!already) {
        emitChange('organisms');
        siemEmit('team', { organism_id: orgId, action: 'team:ai-onboarding', account: caller.owner, skill: skill ?? '', skill_version: version ?? '', via: entry.via });
    }
    const locale = (await storage.getGHIIByOwner(caller.owner))?.locale ?? null;
    return { ok: true, entry, already, team: teamDisplayName(read.team, locale, organism.name) };
}
