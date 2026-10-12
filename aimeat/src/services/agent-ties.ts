/**
 * @file src/services/agent-ties.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an agent's work is tied to: the apps that show it, and the workspace it is
 *   shared with.
 *
 *   TWO TIES, AND WHERE EACH IS WRITTEN DOWN.
 *   - APP: a `held` row of an app's data map that names the agent (data-map-types.ts `agent`,
 *     `madeFor`). The map is the app's own statement of where its data is, so the tie is stated
 *     once, by the app, and goes when the app goes. Nothing is stored on the agent.
 *   - WORKSPACE: one record per agent, `agent-workplace.<name>`, under the owner, on a reserved
 *     prefix so that only the workplace service writes it. It says which workspace the agent's
 *     finished work is shared with; no record means the work stays in the agent's own memory,
 *     which only the owner reads. It is NOT a workspace engagement
 *     (workspace-engagements.ts): that one ties a contract-processing agent to a workspace and
 *     switches its processing loop, which is a different statement.
 *
 *   BOTH ARE READ FOR ALL OF AN OWNER'S AGENTS AT ONCE: one tagged memory query for the data maps,
 *   one for the workplace records, and the app list only when a map names an agent. The home lists
 *   several agents, and a query per agent would grow with the list.
 *
 *   A TIE IS A STATEMENT, NOT A PERMISSION. What an app may read is decided by its grant, and who
 *   may read a workspace by its members, exactly as before.
 * @structure AgentApp · AgentWorkplace · AgentTies · readAgentTies · readTieChoices · WatchableSpace ·
 *   readWatchableSpaces · readWorkplace · placeNames · workplaceKey
 * @usage const ties = await readAgentTies({ config, storage }, owner);
 * @version-history
 *   v1.2.0 — 2026-10-12 — readWatchableSpaces: the record spaces of one workspace whose published
 *     records wake an agent, for the page that makes a contract agent
 *     (wish-sopimuspohjainen-agentti-kodista-luonnos-ehdottaa-sit-ja-koh).
 *   v1.1.0 — 2026-10-12 — readTieChoices takes `tools`: each of the person's apps then carries the
 *     tools an agent of theirs can call on it, for the home's agent draft
 *     (wish-kodin-agenttiluonnos-tuntee-ty-kalujen-kuvaukset-omistajan-s).
 *   v1.0.0 — 2026-10-11 — Initial (wish-agentista-sovellukseen-sovelluksen-teko-agentin-j-lkeen-ja-a,
 *     decision "From an agent to an app").
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { MemoryRecord } from '../storage/types/commerce.js';
import { isValidAgentName } from '../utils/gaii.js';
import { resolveAppUrls } from './app-urls.js';
import { listWorkspaces } from './structure-overview.js';
import { listOwnerAppToolNames, type OwnerAppToolName } from '../commerce/app-tool-catalog.js';
import { decideWorkspaceRead } from './workspace-access.js';
import { isMemoryBackedSpace, type WorkspaceManifest } from './workspace-meta.js';
import { DATA_MAP_SPEC, type DataMap } from './data-map/data-map-types.js';

/** One app that shows an agent's work. */
export interface AgentApp {
  owner: string;
  filename: string;
  /** The app's name as its manifest gives it. */
  name: string;
  /** The address a person opens it at; null when the node could not resolve one. */
  url: string | null;
  /** True when the app was built for this agent's work; false when it uses it among other things. */
  made_for: boolean;
  /** What the row says the app holds from the agent, in the app's own words. May be empty. */
  holds: string;
}

/** The workspace an agent's finished work is shared with. */
export interface AgentWorkplace {
  organism_id: string;
  organism_name: string;
  workspace_id: string;
  workspace_name: string;
  since: string;
}

export interface AgentTies {
  /** By agent name. An agent with no app is absent. */
  apps: Record<string, AgentApp[]>;
  /** By agent name. An agent whose work stays in its own memory is absent. */
  workplaces: Record<string, AgentWorkplace>;
}

/** The stored value of `agent-workplace.<name>`. Self-describing, per memory-contracts.md. */
export interface WorkplaceRecord {
  type: 'aimeat.agent.workplace';
  spec: typeof WORKPLACE_SPEC;
  agentName: string;
  organismId: string;
  workspaceId: string;
  since: string;
  setBy: string;
}

export const WORKPLACE_SPEC = 'aimeat.agent-workplace/1' as const;
export const WORKPLACE_TAG = 'agent-workplace';
/**
 * The key of one agent's workplace record. Its prefix is reserved (utils/reserved-keys.ts): the
 * node ACTS on this record when a task completes, so only services/agent-workplace.ts writes it.
 */
export const WORKPLACE_KEY_PREFIX = 'agent-workplace.';
export const workplaceKey = (agentName: string): string => `${WORKPLACE_KEY_PREFIX}${agentName}`;

const DATAMAP_KEY = /^apps\.(.+)\.datamap$/;

/** A stored record's value as a workplace, or null when it is not one. */
function asWorkplace(rec: MemoryRecord | null | undefined): WorkplaceRecord | null {
  const v = rec?.value as Partial<WorkplaceRecord> | undefined;
  if (!v || typeof v !== 'object' || v.spec !== WORKPLACE_SPEC) return null;
  if (typeof v.agentName !== 'string' || typeof v.organismId !== 'string' || typeof v.workspaceId !== 'string') return null;
  return v as WorkplaceRecord;
}

/**
 * The names of the organisms and workspaces a set of places points at: `org` by organism id, `ws`
 * by `<organism id>::<workspace id>`. An organism that is gone is absent from `org`.
 */
export async function placeNames(
  storage: Storage, records: Array<{ organism_id: string }>,
): Promise<{ org: Map<string, string>; ws: Map<string, string> }> {
  const org = new Map<string, string>();
  const ws = new Map<string, string>();
  const orgIds = [...new Set(records.map(r => r.organism_id))];
  // A point read and one registry read per organism. The count is the organisms one person's
  // agents share into, or the organisms one person is in: small by nature.
  for (const id of orgIds) {
    const o = await storage.getOrganism(id);
    if (!o) continue;
    org.set(id, o.name ?? id);
    // The organism's workspaces as the workspace routes list them (services/structure-overview.ts).
    for (const w of await listWorkspaces(storage, id)) {
      if (!w.archived) ws.set(`${id}::${w.id}`, w.name ?? w.id);
    }
  }
  return { org, ws };
}

/** What a person can pick for an agent's ties: where its work may go, and which apps may show it. */
export interface TieChoices {
  /** The workspaces of the organisms the person is an active member of. */
  places: Array<{ organism_id: string; organism_name: string; workspace_id: string; workspace_name: string }>;
  /**
   * The person's own apps. With `tools` asked for, each app carries the tools an agent of the
   * person can call on it (commerce/app-tool-catalog.ts listOwnerAppToolNames), empty when it
   * publishes none.
   */
  apps: Array<{ filename: string; name: string; tools?: OwnerAppToolName[] }>;
}

/**
 * The places and the apps a person may tie an agent to, for the two pickers on the agent's page.
 * Three reads whatever the person has: the memberships, the organisms' workspace registries in one
 * key-IN read, and the app list. `tools` adds a fourth, the person's public tool manifests, for the
 * page that drafts a new agent: its model has to be told which tools the person's apps publish.
 */
export async function readTieChoices(
  deps: { config: AimeatConfig; storage: Storage }, owner: string, opts: { tools?: boolean } = {},
): Promise<TieChoices> {
  const { config, storage } = deps;
  const ownerGhii = `${owner}@${config.nodeId}`;
  const [memberships, listed, toolsByApp] = await Promise.all([
    storage.listMembershipsByGhii(owner),
    storage.listApps({ ownerGaii: ownerGhii, viewerGhii: ownerGhii, limit: 1000 }),
    opts.tools ? listOwnerAppToolNames(storage, ownerGhii) : Promise.resolve(null),
  ]);
  const orgs = memberships.filter(m => m.status === 'active').map(m => ({ organism_id: m.organismId }));
  const names = await placeNames(storage, orgs);
  const places: TieChoices['places'] = [];
  for (const [key, workspaceName] of names.ws) {
    const [organismId, workspaceId] = key.split('::');
    const organismName = names.org.get(organismId);
    if (!organismName) continue;
    places.push({ organism_id: organismId, organism_name: organismName, workspace_id: workspaceId, workspace_name: workspaceName });
  }
  places.sort((a, b) => a.organism_name.localeCompare(b.organism_name) || a.workspace_name.localeCompare(b.workspace_name));
  // A manifest is keyed by the published filename. Older ones were written without the ".html"
  // (apps.company-brief.tools on aimeat.io), so that spelling is read as well.
  const toolsOf = (filename: string) => toolsByApp?.get(filename) ?? toolsByApp?.get(filename.replace(/\.html$/i, '')) ?? [];
  const apps = listed.apps
    .map(a => ({ filename: a.filename, name: a.manifest?.name || a.filename, ...(toolsByApp ? { tools: toolsOf(a.filename) } : {}) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { places, apps };
}

/** One space of a workspace whose published records wake an agent that watches it. */
export interface WatchableSpace {
  /** The space's name, as the workspace's structure and its tools call it. */
  name: string;
  /** The namespace a record subscription names (`record_spaces[].space` in a crew definition). */
  namespace: string;
  description: string;
}

/**
 * The spaces of one workspace an agent can watch, for the owner in person: the record spaces whose
 * data lives in memory keys. A published record there is a memory write, and that write is what the
 * node pushes to a subscribed agent as `workspace.record` (services/connect-tunnel-push.ts). A row
 * space also says `mode: "records"`, and an appended row is no memory write, so it is left out by
 * the shared predicate isMemoryBackedSpace. A document space is left out: the crew runtime
 * subscribes record spaces only.
 *
 * Null when the organism or the workspace does not exist or the person may not read the workspace.
 * The decision is decideWorkspaceRead, the one place a workspace read is decided, and the manifest
 * is the copy it read.
 */
export async function readWatchableSpaces(
  deps: { config: AimeatConfig; storage: Storage }, owner: string, organismId: string, workspaceId: string,
): Promise<WatchableSpace[] | null> {
  const { config, storage } = deps;
  const organism = await storage.getOrganism(organismId);
  if (!organism) return null;
  const decision = await decideWorkspaceRead(storage, config, organism, owner, owner, `${owner}@${config.nodeId}`, workspaceId);
  if (!decision.canRead || !decision.manRec) return null;
  const objectTypes = (decision.manRec.value as WorkspaceManifest | null)?.objectTypes ?? [];
  const spaces: WatchableSpace[] = [];
  for (const ot of objectTypes) {
    const name = typeof ot.name === 'string' ? ot.name : '';
    const namespace = typeof ot.namespace === 'string' ? ot.namespace : '';
    // A manifest that names no mode is a records space (services/manifest-schema.ts).
    if (!name || !namespace || !isMemoryBackedSpace(ot) || (ot.mode ?? 'records') !== 'records') continue;
    spaces.push({ name, namespace, description: typeof ot.description === 'string' ? ot.description : '' });
  }
  return spaces;
}

/** One agent's workplace record, or null when its work stays in its own memory. */
export async function readWorkplace(
  storage: Storage, ownerGhii: string, agentName: string,
): Promise<WorkplaceRecord | null> {
  return asWorkplace(await storage.getMemory(ownerGhii, workplaceKey(agentName)));
}

/**
 * Every tie of one owner's agents.
 *
 * An app that no longer exists is left out even while its map record is still there, so a page
 * never offers a link that opens nothing. An organism that is gone leaves the workplace out for the
 * same reason; the record stays until the owner changes it.
 */
export async function readAgentTies(
  deps: { config: AimeatConfig; storage: Storage }, owner: string,
): Promise<AgentTies> {
  const { config, storage } = deps;
  const ownerGhii = `${owner}@${config.nodeId}`;
  const [mapRecords, placeRecords] = await Promise.all([
    storage.listMemory(ownerGhii, { tags: ['datamap'] }),
    storage.listMemory(ownerGhii, { tags: [WORKPLACE_TAG] }),
  ]);

  // agent name → app id → the tie that app's map states.
  const named = new Map<string, Map<string, { madeFor: boolean; holds: string }>>();
  for (const rec of mapRecords) {
    const appId = DATAMAP_KEY.exec(rec.key)?.[1];
    const map = rec.value as DataMap | undefined;
    if (!appId || !map || map.spec !== DATA_MAP_SPEC || !Array.isArray(map.held)) continue;
    for (const row of map.held) {
      if (!row || !isValidAgentName(row.agent)) continue;
      const apps = named.get(row.agent) ?? new Map<string, { madeFor: boolean; holds: string }>();
      const prior = apps.get(appId);
      apps.set(appId, {
        madeFor: (prior?.madeFor ?? false) || row.madeFor === true,
        holds: prior?.holds || (typeof row.holds === 'string' ? row.holds : ''),
      });
      named.set(row.agent, apps);
    }
  }

  const apps: Record<string, AgentApp[]> = {};
  if (named.size > 0) {
    const { apps: listed } = await storage.listApps({ ownerGaii: ownerGhii, viewerGhii: ownerGhii, limit: 1000 });
    const byId = new Map(listed.map(a => [a.filename.replace(/\.html$/i, ''), a]));
    const urls = await resolveAppUrls(config, storage, listed.map(a => ({ owner, filename: a.filename })));
    for (const [agent, ties] of named) {
      const rows: AgentApp[] = [];
      for (const [appId, tie] of ties) {
        const app = byId.get(appId);
        if (!app) continue;
        rows.push({
          owner,
          filename: app.filename,
          name: app.manifest?.name || appId,
          url: urls[`${owner}/${app.filename}`] ?? null,
          made_for: tie.madeFor,
          holds: tie.holds,
        });
      }
      // The apps made for the agent first, then by name: the order a person looks for them in.
      rows.sort((a, b) => Number(b.made_for) - Number(a.made_for) || a.name.localeCompare(b.name));
      if (rows.length > 0) apps[agent] = rows;
    }
  }

  const places = placeRecords.map(asWorkplace).filter((r): r is WorkplaceRecord => r !== null);
  const workplaces: Record<string, AgentWorkplace> = {};
  if (places.length > 0) {
    const names = await placeNames(storage, places.map(p => ({ organism_id: p.organismId })));
    for (const p of places) {
      const organismName = names.org.get(p.organismId);
      if (!organismName) continue;
      workplaces[p.agentName] = {
        organism_id: p.organismId,
        organism_name: organismName,
        workspace_id: p.workspaceId,
        workspace_name: names.ws.get(`${p.organismId}::${p.workspaceId}`) ?? p.workspaceId,
        since: p.since,
      };
    }
  }

  return { apps, workplaces };
}
