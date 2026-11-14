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
 *   v1.1.0 — 2026-11-14 — The record keeps each workspace's name and the description in every
 *     language (workspaceNames, descriptionByLang); teamNamesFor serves them, so a page shows the whole
 *     team in its reader's language. A team made before has its workspace names from the kit.
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { TEAM_CONTEXT_ID, TEAM_CONTEXT_SPACE, TEAM_KIT, TEAM_LANGS, TEAM_WS, type TeamLang } from '../../data/team-kit.js';

export const TEAM_RECORD_TYPE = 'aimeat.team/v1';

/** An invitation whose accepter becomes a lead: `email:<invitation id>` or `name:<membership id>`. */
export interface PendingLead { invitation: string; who: string }

export interface TeamRecord {
    type: typeof TEAM_RECORD_TYPE;
    names: Partial<Record<TeamLang, string>>;
    language: TeamLang;
    kind: 'team' | 'virtual';
    workspaces: { shared: string; decisions: string; waiting: string };
    /** Each workspace's name in every language, by workspace id (data/team-kit.ts). */
    workspaceNames?: Record<string, Partial<Record<TeamLang, string>>>;
    /** The team's description in every language the AI wrote it in; the working language's is the organism's own. */
    descriptionByLang?: Partial<Record<TeamLang, string>>;
    skill: { name: string; ref: string } | null;
    leadsPending: PendingLead[];
    /** The day (YYYY-MM-DD) a person's membership ends, keyed `account:<name>` or `email:<hash>` (expiry.ts). */
    until?: Record<string, string>;
    /** The day the whole team ends and is archived (expiry.ts). */
    endsOn?: string;
    /** The day it ended, once the sweep archived it. */
    endedOn?: string;
    /** Which endings the leads were already told about, so each is told once. */
    noticed?: Record<string, string>;
    /** Teams this team depends on, by organism id, with what it needs from each (the team map). */
    dependsOn?: { organism_id: string; what: string }[];
    /** The team type the setup made it as (data/team-kit.ts TEAM_TYPES). */
    teamType?: string;
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

/** The organism types a team setup writes (setup.ts); only these are read for a team record. */
export const TEAM_ORGANISM_TYPES = new Set(['team', 'virtual team']);

/** Each team workspace's name in every language: the stored map, or, for a team set up before it was
 *  stored, the kit's names by the workspace's place. */
export function teamWorkspaceNames(team: Pick<TeamRecord, 'workspaces' | 'workspaceNames'>): Record<string, Partial<Record<TeamLang, string>>> {
    if (team.workspaceNames && Object.keys(team.workspaceNames).length) return team.workspaceNames;
    return {
        [team.workspaces.shared]: TEAM_KIT.workspaces[TEAM_WS.shared].name,
        [team.workspaces.decisions]: TEAM_KIT.workspaces[TEAM_WS.decisions].name,
        [team.workspaces.waiting]: TEAM_KIT.workspaces[TEAM_WS.waiting].name,
    };
}

/** What a page needs to show a team in its reader's language. */
export interface TeamNames {
    names: TeamRecord['names'];
    language: TeamLang;
    workspaces: Record<string, Partial<Record<TeamLang, string>>>;
    descriptions: Partial<Record<TeamLang, string>>;
}

/**
 * The team names of the listed organisms that are teams, by organism id: the team's name, its
 * workspaces' names and its description in every language. Organisms of other types cost no read.
 */
export async function teamNamesFor(storage: Storage, organisms: readonly { id: string; type?: string | null }[]): Promise<Map<string, TeamNames>> {
    const out = new Map<string, TeamNames>();
    for (const o of organisms) {
        if (!TEAM_ORGANISM_TYPES.has(String(o.type ?? ''))) continue;
        const team = await readTeamRecord(storage, o.id);
        if (team) out.set(o.id, { names: team.names, language: team.language, workspaces: teamWorkspaceNames(team), descriptions: team.descriptionByLang ?? {} });
    }
    return out;
}

/** The team's name in the reader's language, then the working language, then the organism's name. */
export function teamDisplayName(team: Pick<TeamRecord, 'names' | 'language'> | null, lang: string | null | undefined, fallback: string): string {
    if (!team) return fallback;
    const two = (lang ?? '').slice(0, 2).toLowerCase() as TeamLang;
    return (TEAM_LANGS.includes(two) ? team.names[two] : undefined) ?? team.names[team.language] ?? fallback;
}
