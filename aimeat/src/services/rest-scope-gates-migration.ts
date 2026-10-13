/**
 * @file src/services/rest-scope-gates-migration.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one-time grant that goes with the REST scope gates of 4.0.0 (auth/rest-scope-gate.ts;
 *   ruling decision-core-2026-11-avoimet-kysymykset-ja-agenttien-automaattinen-l Q21: "grant the new
 *   scope words once to every existing agent that used those routes").
 *
 *   SUPERSEDED IN PART, 2026-10-13. Jouni overruled the "only new words" rule below: "jos ne oli
 *   entuudestaan niiden pitäisi toimia nytkin. en mä ala käymään 70 agenttia läpi." (ruling
 *   decision-4-0-x-olemassa-olevat-agentit-saavat-rest-porttien-uudet-san). A third step,
 *   services/rest-scope-keep-working-migration.ts, runs on a node's first start as 4.0.x and gives
 *   every agent and approved ecosystem app that existed before it EVERY word the 4.0.0 gates check on
 *   REST and MCP, the existing words included, so nobody reviews agents by hand; the owner is told on
 *   the activity feed and narrows afterwards. The two steps here stay as they are and still run on any
 *   release: they ran on nodes before 4.0.0, and their records keep them from running twice. The text
 *   below is the reasoning they were written with.
 *
 *   WHICH WORDS. Only the words that did not exist before the gates: one, `packages:read`. Every other
 *   word the gates ask (task:write, organism:invite, memory:read and the rest) already existed and
 *   already opens other routes and MCP tools. Writing one of those onto a principal that did not hold
 *   it would hand it those other routes and tools too, which its owner never granted, so they are not
 *   written: a principal that used a newly gated route without the word sees the Deprecation header
 *   and the count in GET /v1/stats until 4.0.0, and its owner ticks the word in the agent editor.
 *   `packages:read` opens nothing but the three install reads (GET /v1/instances, /v1/instances/:id,
 *   /v1/instances/:id/status) and aimeat_package_instances, all of which asked no word before.
 *
 *   TO WHOM. Usage cannot be known: the node never recorded a REST call per principal before the gates
 *   (services/scope-use.ts records from 2026-10-02 and only what a `*` agent was admitted for). So the
 *   rule is the fallback the brief names: every existing principal that could reach those routes
 *   before, which is every agent and every approved ecosystem app with a recorded scope list, because
 *   the three routes asked nothing but a session. A principal whose words already cover it (`*`,
 *   `packages:*`) is left alone, and nothing is ever removed.
 *
 *   NOT APP GRANTS. A grant follows its app's own declaration (`<meta name="aimeat-scopes">`): every
 *   refresh and silent sign-in trims a word the app does not declare (services/app-grant-scopes.ts), so
 *   a word written here would be gone at the app's next refresh. An app that reads installs declares
 *   packages:read (routes/app-grant-vocabulary.ts lists it), and its owner sees it on the consent screen;
 *   until 4.0.0 the call still works and carries the Deprecation header that says so.
 *
 *   ONCE PER NODE, recorded under `system@<nodeId>` (REST_SCOPE_GATES_KEY) after the principals, so a
 *   boot that stops half way runs it again, and an owner who later takes the word away keeps it away.
 *   A principal made after the run chose from a screen that lists the word.
 * @structure REST_SCOPE_GATES_KEY · REST_SCOPE_NEW_WORDS · AGENT_READ_GRANT_KEY · AGENT_READ_WORDS ·
 *   isSharedAnonymous(owner) · missingNewWords(held, words?) · migrateRestScopeGatesOnce(storage, nodeId) ·
 *   migrateAgentReadGrantOnce(storage, nodeId)
 * @usage migrateRestScopeGatesOnce(storage, config.nodeId).then(() => migrateAgentReadGrantOnce(storage, config.nodeId))
 * @version-history
 *   v1.2.0 — 2026-10-13 — Both steps skip anonymous mode's shared agent (isSharedAnonymous). The words they
 *     already gave it are taken back once by the 4.0.x step (services/rest-scope-keep-working-migration.ts).
 *   v1.1.1 — 2026-10-13 — Header only: the "only new words" rule is superseded for 4.0.x by the third step,
 *     services/rest-scope-keep-working-migration.ts (ruling decision-4-0-x-olemassa-olevat-agentit-saavat-
 *     rest-porttien-uudet-san). No code changed.
 *   v1.1.0 — 2026-10-12 — A second step, migrateAgentReadGrantOnce: agent:read, the word of the owner's
 *     agent list from 4.0.0, once, under its own record so a node that ran the first step runs it too
 *     (ruling decision-4-0-0-siivouksen-23-avointa-p-t-st-suositusten-mukaan, item 11).
 *   v1.0.0 — 2026-10-12 — Initial (wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen).
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';

/** The record under `system@<nodeId>` that says this node has run the grant. */
export const REST_SCOPE_GATES_KEY = 'migrations.rest-scope-gates-4-0-0';

/** The words the REST scope gates introduced, and what each opens. */
export const REST_SCOPE_NEW_WORDS: ReadonlyArray<{ word: string; opens: string }> = [
  {
    word: 'packages:read',
    opens: 'GET /v1/instances, GET /v1/instances/:id, GET /v1/instances/:id/status and aimeat_package_instances',
  },
];

/**
 * The second step, with its own record (ruling decision-4-0-0-siivouksen-23-avointa-p-t-st-suositusten-
 * mukaan, item 11): `agent:read`, the word the owner's agent list asks from 4.0.0. A step of its own so
 * that a node which already ran the first step (and wrote REST_SCOPE_GATES_KEY) still runs this one,
 * once. The same rule as the first step: GET /v1/agents asked nothing but a session before, so every
 * agent and approved ecosystem app with a recorded list could reach it, and the word opens nothing
 * else. It is also in the node's default agent scopes (config.ts SHIPPED_DEFAULT_AGENT_SCOPES).
 */
export const AGENT_READ_GRANT_KEY = 'migrations.rest-scope-gates-4-0-0.agent-read';

/** The word the second step grants, and what it opens. */
export const AGENT_READ_WORDS: ReadonlyArray<{ word: string; opens: string }> = [
  {
    word: 'agent:read',
    opens: 'GET /v1/agents, GET /v1/agents/v2/basic-agents, GET /v1/agents/v2/migrate, aimeat_agents_list and aimeat_agent_basics_get',
  },
];

/**
 * The account of anonymous mode's shared agent (`shared#anonymous@<node>`, server-bootstrap/service-init.ts).
 * Anyone may hold that identity, so its words are fixed in auth/anonymous-scopes.ts (no work, no social
 * write, nothing granted away) and no grant step adds to them.
 */
export function isSharedAnonymous(owner: string): boolean {
  return owner === 'anonymous' || owner.startsWith('anonymous@');
}

/** The new words a principal holding `held` lacks; none for a wildcard or a domain wildcard that covers them. */
export function missingNewWords(held: readonly string[], words: ReadonlyArray<{ word: string }> = REST_SCOPE_NEW_WORDS): string[] {
  return words.map(w => w.word).filter(w => !scopeIsCovered(held, w));
}

export interface RestScopeGatesMigrationResult {
  ran: boolean;
  agents: string[];
  ecosystemApps: string[];
}

/** Give the new words (packages:read) to every existing principal that could reach their routes, unless this node has run it. */
export async function migrateRestScopeGatesOnce(storage: Storage, nodeId: string): Promise<RestScopeGatesMigrationResult> {
  const system = `system@${nodeId}`;
  if (await storage.getMemory(system, REST_SCOPE_GATES_KEY)) return { ran: false, agents: [], ecosystemApps: [] };
  return grantWords(storage, system, REST_SCOPE_GATES_KEY, REST_SCOPE_NEW_WORDS);
}

/** Give agent:read to every existing principal that could reach the agent list, unless this node has run it. */
export async function migrateAgentReadGrantOnce(storage: Storage, nodeId: string): Promise<RestScopeGatesMigrationResult> {
  const system = `system@${nodeId}`;
  if (await storage.getMemory(system, AGENT_READ_GRANT_KEY)) return { ran: false, agents: [], ecosystemApps: [] };
  return grantWords(storage, system, AGENT_READ_GRANT_KEY, AGENT_READ_WORDS);
}

/** One step, not yet run: the words to every agent and approved ecosystem app with a recorded list, recorded under `key`. */
async function grantWords(
  storage: Storage, system: string, key: string, words: ReadonlyArray<{ word: string; opens: string }>,
): Promise<RestScopeGatesMigrationResult> {
  const result: RestScopeGatesMigrationResult = { ran: false, agents: [], ecosystemApps: [] };

  for (const agent of await storage.listAgents()) {
    // Anonymous mode's shared agent: anyone may hold it, and its words are fixed in
    // auth/anonymous-scopes.ts. Until 2026-10-13 these steps gave it their word too; the 4.0.x step
    // takes those back once (services/rest-scope-keep-working-migration.ts).
    if (isSharedAnonymous(agent.owner)) continue;
    const held = agent.defaultScopes;
    // No recorded list: the agent is minted from config.defaultAgentScopes, and writing a list here
    // would replace that fallback rather than extend it (services/scope-vocabulary-migration.ts).
    if (!Array.isArray(held)) continue;
    const missing = missingNewWords(held, words);
    if (!missing.length) continue;
    await storage.updateAgent(agent.gaii, { defaultScopes: [...held, ...missing] });
    result.agents.push(agent.gaii);
  }

  for (const owner of await storage.listOwners()) {
    if (isSharedAnonymous(owner.name)) continue;
    for (const app of await storage.getEcosystemAppsByOwner(owner.name)) {
      if (app.status !== 'approved' && app.status !== 'active') continue;
      const held = app.scopes;
      if (!Array.isArray(held)) continue;
      const missing = missingNewWords(held, words);
      if (!missing.length) continue;
      await storage.updateEcosystemApp(app.geai, { scopes: [...held, ...missing] });
      result.ecosystemApps.push(app.geai);
    }
  }

  const now = new Date().toISOString();
  await storage.setMemory({
    key,
    ownerGaii: system,
    value: {
      at: now,
      words: words.map(w => w.word),
      agents: result.agents,
      ecosystemApps: result.ecosystemApps,
    },
    visibility: 'private',
    tags: ['migration'],
    // Never swept: a record that expired would run the grant again at the next boot.
    ttlHours: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  result.ran = true;
  if (result.agents.length + result.ecosystemApps.length > 0) {
    logger.info(`REST scope gates: gave ${words.map(w => w.word).join(', ')} to ${result.agents.length} agent(s) `
      + `and ${result.ecosystemApps.length} ecosystem app(s) that could already reach `
      + `${words.map(w => w.opens).join('; ')}`, { agents: result.agents, ecosystemApps: result.ecosystemApps });
  }
  return result;
}
