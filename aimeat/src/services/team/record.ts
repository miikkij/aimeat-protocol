/**
 * @file src/services/team/record.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The team record: one memory record per team at `organism.{id}.meta.team`, which marks
 *   an organism as a team and says what the team setup made for it. Its names in every language,
 *   the working language, the three workspaces, where the team context is, the team skill, and the
 *   invitations that make their accepter a lead.
 *
 *   WHY A META RECORD. A team is an organism; nothing about the organism changes. The organism's
 *   meta namespace is written by its owners and admins only (services/organism-namespace-access.ts),
 *   which is the rule the names and the pending leads need: a member's AI must not rename the team
 *   or make itself a lead. The record is owned by the organism's creator, as the README is
 *   (services/organism-readme.ts), and written on its version.
 * @structure TEAM_RECORD_TYPE · TeamRecord · PendingLead · teamRecordKey · readTeamRecord ·
 *   writeTeamRecord · teamDisplayName · teamContextKey
 * @usage
 *   const team = await readTeamRecord(storage, orgId);
 *   const name = team ? teamDisplayName(team, 'en', organism.name) : organism.name;
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { TEAM_CONTEXT_ID, TEAM_CONTEXT_SPACE, TEAM_LANGS, type TeamLang } from '../../data/team-kit.js';

export const TEAM_RECORD_TYPE = 'aimeat.team/v1';

/** An invitation whose accepter becomes a lead: `email:<invitation id>` or `name:<membership id>`. */
export interface PendingLead { invitation: string; who: string }

export interface TeamRecord {
    type: typeof TEAM_RECORD_TYPE;
    names: Partial<Record<TeamLang, string>>;
    language: TeamLang;
    kind: 'team' | 'virtual';
    workspaces: { shared: string; decisions: string; waiting: string };
    skill: { name: string; ref: string } | null;
    leadsPending: PendingLead[];
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}

export function teamRecordKey(orgId: string): string {
    return `organism.${orgId}.meta.team`;
}

/** The key of the team context record in the shared-knowledge workspace. */
export function teamContextKey(orgId: string, sharedWs: string): string {
    return `organism.${orgId}.w.${sharedWs}.${TEAM_CONTEXT_SPACE}.${TEAM_CONTEXT_ID}`;
}

async function findRecord(storage: Storage, key: string): Promise<MemoryRecord | null> {
    const { items } = await storage.listAllMemory({ prefix: key, limit: 5 });
    return items.find(r => r.key === key) ?? null;
}

function asTeam(value: unknown): TeamRecord | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Partial<TeamRecord>;
    if (v.type !== TEAM_RECORD_TYPE || !v.workspaces || !v.language) return null;
    return { ...v, leadsPending: Array.isArray(v.leadsPending) ? v.leadsPending : [], names: v.names ?? {} } as TeamRecord;
}

/** The team record of an organism with its version, or null when the organism is not a team. */
export async function readTeamRecordWithVersion(storage: Storage, orgId: string): Promise<{ team: TeamRecord; version: number; ownerGaii: string } | null> {
    const rec = await findRecord(storage, teamRecordKey(orgId));
    const team = rec ? asTeam(rec.value) : null;
    return rec && team ? { team, version: rec.version ?? 1, ownerGaii: rec.ownerGaii } : null;
}

export async function readTeamRecord(storage: Storage, orgId: string): Promise<TeamRecord | null> {
    return (await readTeamRecordWithVersion(storage, orgId))?.team ?? null;
}

/**
 * Write the team record. A new record is owned by the organism's creator; an update keeps the
 * stored owner and is written on the version it was read at, so two writers never overwrite each
 * other's pending leads. Answers false when the version moved.
 */
export async function writeTeamRecord(
    storage: Storage, config: AimeatConfig, orgId: string, team: TeamRecord,
    prev: { version: number; ownerGaii: string } | null, creatorOwner: string,
): Promise<boolean> {
    const now = new Date().toISOString();
    const record = {
        key: teamRecordKey(orgId),
        ownerGaii: prev?.ownerGaii ?? (creatorOwner.includes('@') ? creatorOwner : `${creatorOwner}@${config.nodeId}`),
        value: { ...team, updatedAt: now },
        visibility: 'private' as const,
        tags: ['team'],
        ttlHours: null,
        version: (prev?.version ?? 0) + 1,
        createdAt: team.createdAt,
        updatedAt: now,
    };
    if (!prev) return (await storage.createMemoryIfAbsent(record)) !== null;
    return (await storage.setMemoryIfVersion(record, prev.version)) !== null;
}

/** The team's name in the reader's language, then the working language, then the organism's name. */
export function teamDisplayName(team: Pick<TeamRecord, 'names' | 'language'> | null, lang: string | null | undefined, fallback: string): string {
    if (!team) return fallback;
    const two = (lang ?? '').slice(0, 2).toLowerCase() as TeamLang;
    return (TEAM_LANGS.includes(two) ? team.names[two] : undefined) ?? team.names[team.language] ?? fallback;
}
