/**
 * @file src/services/data-map/data-map-agent-tie.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Tie an app that already exists to one of the owner's agents, or take the tie away,
 *   by changing one row of the app's data map.
 *
 *   WHY IT IS NOT JUST "SEND THE WHOLE MAP". The map write replaces the document, which is right for
 *   whoever built the app and wrong for a person who presses "this app uses that agent's work" on a
 *   page: they would have to read the map, add a row and send all of it back, and an app with no
 *   map has nothing to send. These two functions do the read, the one-row change and the write, and
 *   the write is the same putProgramMap the full statement uses, so the record, the stamp and the
 *   checks are one implementation.
 *
 *   WHAT THE ROW SAYS AND WHAT IT LEAVES BLANK. A tie made here adds a row whose `agent` names the
 *   agent. Its `why` stays empty and the map of an app that had none keeps an empty purpose: both
 *   are sentences only whoever built the app can write, and the map's own check then lists them as
 *   missing. A guess would sit where the answer belongs and read like one.
 *
 *   The tie is a statement and grants nothing (data-map-types.ts `agent`).
 * @structure tieAgent · untieAgent
 * @usage const out = await tieAgent(storage, config, caller, 'alice/menu.html', 'morning-news', { madeFor: true }, at);
 * @version-history
 *   v1.0.1 — 2026-10-18 — The findings come from putProgramMap, which checks the map against the app's declared scopes.
 *   v1.0.0 — 2026-10-11 — Initial (wish-agentista-sovellukseen-sovelluksen-teko-agentin-j-lkeen-ja-a).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { buildGAII, isValidAgentName } from '../../utils/gaii.js';
import { readAppDataMap } from './data-map-store.js';
import {
  putProgramMap, splitAppRef, type DataMapCaller, type DataMapRefusal, type ProgramMapResult,
} from './data-map-access.js';
import { DATA_MAP_SPEC, type DataMap, type DataMapRow } from './data-map-types.js';

const refusal = (status: number, code: string, message: string): DataMapRefusal => ({ refusal: { status, code, message } });

/** The row family a tie made here writes, so untying can tell its own row from the builder's. */
const tieRowName = (agent: string): string => `agent:${agent}`;

/** A map for an app that has none: every sentence left for whoever built the app to write. */
const emptyMap = (at: string): DataMap => ({
  spec: DATA_MAP_SPEC, what: '', usedFor: '', form: 'unstated', arrangement: '',
  machinery: [], leaves: [], held: [], elsewhere: [], source: 'declared', at,
});

/** The checks both acts share: the caller's own app, the caller's own agent. */
async function ownAppAndAgent(
  storage: Storage, config: AimeatConfig, caller: DataMapCaller, appRef: string, agent: string,
): Promise<DataMapRefusal | { ownerGhii: string; filename: string; appId: string }> {
  const ref = splitAppRef(appRef);
  if (!ref) return refusal(400, 'INVALID_INPUT', 'Name the app as "owner/filename.html".');
  if (caller.ownerName !== ref.owner) return refusal(403, 'FORBIDDEN', 'This map belongs to another account.');
  if (caller.roles.includes('app')) {
    return refusal(403, 'FORBIDDEN', 'A granted app cannot write a data map. The owner states it.');
  }
  if (!isValidAgentName(agent)) return refusal(400, 'INVALID_INPUT', 'Name one of your own agents.');
  const record = await storage.getAppByOwnerName(ref.owner, ref.filename);
  if (!record) return refusal(404, 'NOT_FOUND', `No app "${appRef}" on this node.`);
  return { ownerGhii: record.ownerGaii, filename: ref.filename, appId: ref.filename.replace(/\.html$/i, '') };
}

/**
 * State that an app shows an agent's work. A row that already names the agent keeps everything its
 * builder wrote and takes the new `madeFor`; otherwise one row is added.
 */
export async function tieAgent(
  storage: Storage, config: AimeatConfig, caller: DataMapCaller, appRef: string, agent: string,
  tie: { madeFor?: boolean; holds?: string }, at: string,
): Promise<ProgramMapResult | DataMapRefusal> {
  const own = await ownAppAndAgent(storage, config, caller, appRef, agent);
  if ('refusal' in own) return own;
  // The agent must exist when the tie is made. One that is removed later leaves the row, and the
  // pages that read the tie say that the agent is gone.
  const found = await storage.getAgent(buildGAII(agent, caller.ownerName, config.nodeId));
  if (!found || found.owner !== caller.ownerName) {
    return refusal(404, 'AGENT_NOT_FOUND', `You have no agent called "${agent}".`);
  }

  const map = (await readAppDataMap(storage, own.ownerGhii, own.appId)) ?? emptyMap(at);
  const madeFor = tie.madeFor === true;
  const names = map.held.some(r => r.agent === agent);
  const held: DataMapRow[] = names
    ? map.held.map(r => (r.agent === agent ? { ...r, madeFor } : r))
    : [...map.held, {
        what: tieRowName(agent),
        holds: typeof tie.holds === 'string' && tie.holds.trim() ? tie.holds.trim().slice(0, 200) : `the finished work of the agent ${agent}`,
        kind: 'ai-generated',
        usedFor: 'user-returns-to-read',
        where: 'owner-memory-private',
        whereExactly: `the tasks and results of the owner's agent ${agent}, in that agent's own memory`,
        owner: 'person',
        readers: 'owner-and-their-agents',
        writers: ['an-agent'],
        shape: 'one-per-thing',
        keptFor: 'until-deleted',
        lossRisk: 'only-copy',
        personalData: 'unstated',
        why: '',
        agent,
        madeFor,
      }];

  const put = await putProgramMap(storage, config, caller, own.ownerGhii, own.filename, { ...map, held }, at);
  if ('refusal' in put) return put;
  return { app: appRef, dataMap: put.map, stamp: put.stamp, findings: put.findings };
}

/**
 * Take the tie away. A row this file added goes; a row the builder wrote keeps everything except
 * the agent's name. An app that never named the agent answers with its map unchanged.
 */
export async function untieAgent(
  storage: Storage, config: AimeatConfig, caller: DataMapCaller, appRef: string, agent: string, at: string,
): Promise<ProgramMapResult | DataMapRefusal> {
  const own = await ownAppAndAgent(storage, config, caller, appRef, agent);
  if ('refusal' in own) return own;
  const map = await readAppDataMap(storage, own.ownerGhii, own.appId);
  if (!map || !map.held.some(r => r.agent === agent)) {
    return refusal(404, 'NOT_FOUND', `The app "${appRef}" is not tied to the agent "${agent}".`);
  }
  const held = map.held
    .filter(r => !(r.agent === agent && r.what === tieRowName(agent)))
    .map(r => {
      if (r.agent !== agent) return r;
      const { agent: _agent, madeFor: _madeFor, ...rest } = r;
      void _agent; void _madeFor;
      return rest as DataMapRow;
    });
  const put = await putProgramMap(storage, config, caller, own.ownerGhii, own.filename, { ...map, held }, at);
  if ('refusal' in put) return put;
  return { app: appRef, dataMap: put.map, stamp: put.stamp, findings: put.findings };
}
