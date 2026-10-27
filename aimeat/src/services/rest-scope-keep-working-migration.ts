/**
 * @file src/services/rest-scope-keep-working-migration.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The third once-per-node step of the 4.0.0 scope gates: every agent and approved
 *   ecosystem app that existed before a node first starts as 4.0.x gets each scope word the 4.0.0
 *   gates started to check and it does not hold, so what worked on 3.x keeps working on 4.0.x.
 *
 *   THE RULING. Jouni, 2026-10-13: "miksei tässä ole migraatiota? jos ne oli entuudestaan niiden
 *   pitäisi toimia nytkin. en mä ala käymään 70 agenttia läpi." Recorded as
 *   decision-4-0-x-olemassa-olevat-agentit-saavat-rest-porttien-uudet-san (Lifecycle Central, locked).
 *   It overrides the rule of the two earlier steps (services/rest-scope-gates-migration.ts), which
 *   gave only the words that did not exist before the gates, because the other words also open other
 *   routes and MCP tools. On 3.x none of these words was checked on the gated routes, so an agent held
 *   their reach whatever its list said; giving the words keeps that reach, and the owner narrows
 *   afterwards with the agent editor or aimeat_agent_scope_narrow.
 *
 *   WHICH WORDS. REST_SCOPE_KEEP_WORKING_WORDS: every word a requireRestScope gate names under
 *   src/routes/ (auth/rest-scope-gate.ts, enforced from REST_SCOPE_GATES_ENFORCED_IN), every word an
 *   MCP tool's catalog entry enforces from that release (`scopeEnforcedFrom`, tool-catalog/scopes.ts)
 *   and every word a route refuses inline with denyScope403 (storage:read on GET /v1/pub, S3-03),
 *   the two earlier steps' words included: an agent made on 3.x after those steps ran reached their
 *   routes too. test/unit/rest-scope-keep-working.test.ts derives the same set from the source and
 *   fails when the two differ, so a gate added later fails there until it is listed here. A node that
 *   ran this step before a word joined the list gets it from a step of its own
 *   (services/app-storage-read-keep-migration.ts for storage:read).
 *   - `passedBy`: a word that passes every gate of this word (requireRestScope `orScope` on every one,
 *     and no MCP tool asks the word). A principal holding it already passes, so it gets nothing.
 *   - `agentsOnly`: every REST gate of the word is followed by requireRole('agent') and no MCP tool
 *     asks it, so an ecosystem app could not reach it on 3.x and does not get it.
 *
 *   TO WHOM. Every agent with a recorded scope list and every approved or active ecosystem app with
 *   one, created before the step began (`existedBefore`, taken when the boot schedules it, so an agent
 *   made while the boot steps still run is not handed the words). `*` and a covering domain wildcard
 *   are left alone (scopeIsCovered), an agent with no list of its own holds nothing on a request
 *   (auth/effective-scopes.ts) and is left alone, and nothing is ever removed. Anonymous mode's shared
 *   agent is left alone too: anyone may hold it, and its words are fixed in auth/anonymous-scopes.ts.
 *
 *   PUBLISHED APPS, the second half (the coordinator's follow-up to the same ruling, 2026-10-13: apps
 *   too, and nobody edits sixty apps by hand). An app grant follows its app's `aimeat-scopes`
 *   declaration and a refresh trims what the app does not declare, so a word cannot simply be written
 *   onto a grant. Instead each app published before the step whose code calls a gated route its
 *   declaration (or the default set) does not cover gets an allowance (services/app-scope-allowance.ts
 *   keepWorkingAppsOnce, read by services/app-scope-needs.ts): the words count as declared, and they
 *   go onto the app's live grants. Its own record, APP_SCOPE_KEEP_WORKING_KEY.
 *
 *   WHEN. Only on a node that runs REST_SCOPE_GATES_ENFORCED_IN or later, so a 3.x node does not run it
 *   and its first 4.0.x start does. ONCE per half, recorded under `system@<nodeId>`
 *   (REST_SCOPE_KEEP_WORKING_KEY, APP_SCOPE_KEEP_WORKING_KEY), and a word the owner removes later stays
 *   removed. Each record is claimed before its half and written over the claim after it
 *   (services/once-only-step.ts), so of two node processes starting together one runs each half; a
 *   start whose step fails removes the claims, so the next start runs it again.
 *
 *   WHAT THE OWNER AND THE OPERATOR SEE. One line on each owner's activity feed for the agents
 *   (`scope_words_kept`, linking to the agent list) and one for the published apps
 *   (`app_scope_words_kept`, linking to the App Catalog, where each app's change log names its words
 *   and the code that needs them), public/views/home/feed.js. One incident on the operator's Security
 *   page (`scope_words_kept`, services/security-incident.ts) with the counts per word for both. The
 *   start-up log names every principal and app.
 *
 *   A TOKEN IS A CEILING. A token minted on 3.x carries the list the agent had then, and
 *   withCurrentScopes only narrows it (auth/effective-scopes.ts), so the words take effect from the
 *   agent's next token, which a connector gets when it reconnects to the restarted node.
 * @structure REST_SCOPE_KEEP_WORKING_KEY · KeepWorkingWord · REST_SCOPE_KEEP_WORKING_WORDS ·
 *   wordsToKeepWorking(held, kind, words?) · KeepWorkingResult · migrateRestScopeKeepWorkingOnce(storage, config, opts?)
 * @usage
 *   const before = new Date().toISOString();
 *   migrateRestScopeKeepWorkingOnce(storage, config, { existedBefore: before });
 * @version-history
 *   2026-10-27 — secaudit2026oct26: each half's cutoff is never later than the time its rule first
 *     took effect on the node (once-only-step.ts keptBefore), so a late rerun keeps no principal or
 *     app made meanwhile.
 *   v1.3.0 — 2026-10-20 — storage:read joins the list: S3-03 (2026-10-16) checks it inline on GET /v1/pub,
 *     which the test's scan did not read, so no app kept it (found on originalmiskate.com). tellAppOwners
 *     is exported for the storage:read step and takes the record it reports.
 *   v1.2.0 — 2026-10-18 — Both records are claimed before the work (services/once-only-step.ts) and each
 *     scope list is written on the list that was read (services/scope-list-swap.ts), the take-back from
 *     anonymous mode's shared agent included (check:atomic-writes).
 *   v1.1.0 — 2026-10-13 — The published apps half (APP_SCOPE_KEEP_WORKING_KEY, keepWorkingAppsOnce), its
 *     feed line and its counts in the one incident. The principals half takes back from anonymous mode's
 *     shared agent the words the two earlier steps wrote on it (their run records name it), recorded as
 *     `sharedAnonymousTakenBack` in this step's record.
 *   v1.0.0 — 2026-10-13 — Initial (ruling decision-4-0-x-olemassa-olevat-agentit-saavat-rest-porttien-uudet-san).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { getSoftwareVersion, versionAtLeast } from '../utils/version.js';
import { REST_SCOPE_GATES_ENFORCED_IN } from '../utils/rest-scope-release.js';
import { recordAccountEvent } from './account-events.js';
import { recordSecurityIncident } from './security-incident.js';
import { keepWorkingAppsOnce, type KeptApp } from './app-scope-allowance.js';
import { claimOnceOnlyStep, keptBefore } from './once-only-step.js';
import { changeScopeList } from './scope-list-swap.js';
import {
  AGENT_READ_GRANT_KEY, AGENT_READ_WORDS, REST_SCOPE_GATES_KEY, REST_SCOPE_NEW_WORDS, isSharedAnonymous,
} from './rest-scope-gates-migration.js';

/** The record under `system@<nodeId>` that says this node has run the step for agents and ecosystem apps. */
export const REST_SCOPE_KEEP_WORKING_KEY = 'migrations.rest-scope-gates-4-0-x.keep-working';
/** The record that says it has run the published apps half. */
export const APP_SCOPE_KEEP_WORKING_KEY = 'migrations.rest-scope-gates-4-0-x.app-allowance';

/** One word the 4.0.0 gates check, what it opens there, and who already passes without it. */
export interface KeepWorkingWord {
  word: string;
  /** The routes and MCP tools that ask it from 4.0.0, with the files that gate them. */
  opens: string;
  /** A word that passes every gate of this one; a principal holding it gets nothing. */
  passedBy?: string[];
  /** Every gate also asks the agent role, so an ecosystem app never reached it. */
  agentsOnly?: boolean;
}

/** Every word a 4.0.0 gate newly checks on REST or MCP (test/unit/rest-scope-keep-working.test.ts holds it to the code). */
export const REST_SCOPE_KEEP_WORKING_WORDS: ReadonlyArray<KeepWorkingWord> = [
  {
    word: 'agent:read',
    opens: 'GET /v1/agents (routes/agents/profile-metadata.ts), GET /v1/agents/v2/basic-agents (routes/agents-v2/basic-agents.ts), '
      + 'GET /v1/agents/v2/migrate (routes/agents-v2/migrate.ts); aimeat_agents_list, aimeat_agent_basics_get',
  },
  {
    word: 'agent:write',
    opens: 'POST /v1/agents/v2/enrol (routes/agents-v2/enrolment.ts), PUT and DELETE /v1/chat-instances/:id (routes/chat-instances.ts)',
  },
  {
    word: 'catalogue:read',
    opens: 'GET /v1/cortex/:name, /prompts, /prompts/:promptName, /ontology (routes/cortex.ts)',
  },
  {
    word: 'commerce:buy',
    opens: 'POST /v1/app-store/purchase (routes/app-store.ts), POST /v1/commerce/checkout-sessions/:id/complete (routes/commerce.ts), '
      + 'POST /ucp/v1/checkout-sessions/:id/complete (routes/commerce-ucp.ts)',
    passedBy: ['contract:spend'],
  },
  {
    word: 'commerce:sell',
    opens: 'PUT /v1/agents/:name/offers for another agent (routes/agents/offers.ts)',
    agentsOnly: true,
  },
  {
    word: 'ext:invoke',
    opens: 'POST /v1/ext/:extName/:actionId and /v1/ext/:extName/:instanceId/:actionId (routes/extensions/actions.ts), '
      + 'GET /v1/extensions/:name/instances[/:instanceId] (routes/extensions/instances.ts, also passed by ext:write); aimeat_app_tool_invoke',
  },
  {
    word: 'memory:read',
    opens: 'GET /v1/skills (routes/skills.ts), GET /v1/knowledge/:id/reviews (routes/knowledge/admin.ts), '
      + 'GET /v1/knowledge/:id/broken-links (routes/knowledge/packages-core.ts), GET /v1/memory/discover (routes/memory/bulk.ts), '
      + 'POST /v1/memory/list-remote (routes/memory/federation.ts); aimeat_skill_list',
  },
  {
    word: 'memory:write',
    opens: 'POST /v1/attestations/:id/sign (routes/attestations.ts), POST /v1/knowledge/:id/contribute (routes/knowledge/organism.ts), '
      + 'POST and DELETE /v1/knowledge/:id/link (routes/knowledge/packages-core.ts), PATCH /v1/knowledge/:id/sharing and '
      + '/v1/knowledge/:id/entries/:entryKey/visibility (routes/knowledge/sharing.ts), DELETE /v1/schedules/:id (routes/schedules.ts)',
  },
  {
    word: 'organism:invite',
    opens: 'the organism membership routes: join-request review, admins, owners, members, unban, transfer, invitations, agents '
      + '(routes/organisms/membership.ts); POST and GET /v1/organisms/:id/workspace-access (routes/organisms/workspace-access.ts)',
  },
  {
    word: 'organism:read',
    opens: 'GET /v1/organisms/waiting (routes/organisms/crud.ts), GET /v1/intake/forms (routes/organisms/intake.ts), '
      + 'GET /v1/organisms/:id/join-requests, /v1/organisms/:id/invitations, /v1/organisms/invitations/mine (routes/organisms/membership.ts), '
      + 'GET /v1/organisms/:id/workspaces (routes/organisms/workspace-access.ts); aimeat_organism_invitations, aimeat_workspace_list',
  },
  {
    word: 'organism:write',
    // Not agents-only: the REST routes ask the agent role, but the MCP tool does not.
    opens: 'POST /v1/organisms/:id/invitations/accept and /decline (routes/organisms/membership.ts); aimeat_organism_invitation_respond',
  },
  {
    word: 'packages:read',
    opens: 'GET /v1/instances, /v1/instances/:id, /v1/instances/:id/status (routes/instances/manage.ts); aimeat_package_instances',
  },
  {
    word: 'packages:write',
    opens: 'GET /v1/instances/:id/check-update (routes/instances/manage.ts), POST /v1/instances/:id/migration-prompt (routes/instances/migration.ts)',
  },
  {
    word: 'social:read',
    opens: 'GET /v1/appeals (routes/appeals.ts)',
  },
  {
    word: 'social:write',
    opens: 'POST /v1/flags/:flagId/appeal, POST /v1/appeals/:id/review (routes/appeals.ts)',
  },
  {
    word: 'storage:read',
    // Checked inline, not by requireRestScope, so it is in this list from the inline scan of the test.
    opens: 'GET /v1/pub/:gaii/{key} for a file that is not public, read with a token (routes/storage-files.ts, QA audit S3-03)',
  },
  {
    word: 'task:read',
    opens: 'GET /v1/agents/v2/tasks and /v1/agents/v2/tasks/:taskId (routes/agents-v2/tasks.ts), GET /v1/agui/:owner/:agent/:taskId '
      + '(routes/agui.ts); aimeat_v2_task_list, aimeat_v2_task_get',
  },
  {
    word: 'task:write',
    opens: 'POST /v1/agents/:name/tasks for another agent (routes/agent-tasks/create-read.ts), POST /v1/schedules, '
      + 'POST /v1/schedules/:id/trigger, POST /v1/agents/:name/schedules (routes/schedules.ts)',
  },
  {
    word: 'wallet:read',
    opens: 'GET /v1/app-store/purchases/:txId (routes/app-store.ts), GET /v1/commerce/beneficiary/approvals (routes/commerce-beneficiaries.ts)',
  },
  {
    word: 'work:request',
    opens: 'POST /v1/federation/cross-node/work (routes/federation-sync/routing.ts)',
    agentsOnly: true,
  },
  {
    word: 'workflow:write',
    opens: 'PATCH /v1/schedules/:id (routes/schedules.ts)',
  },
];

/** The words a principal of `kind` holding `held` lacks: none for `*`, a covering domain wildcard or a `passedBy` word. */
export function wordsToKeepWorking(
  held: readonly string[], kind: 'agent' | 'ecosystem', words: ReadonlyArray<KeepWorkingWord> = REST_SCOPE_KEEP_WORKING_WORDS,
): string[] {
  return words
    .filter(w => kind === 'agent' || !w.agentsOnly)
    .filter(w => !scopeIsCovered(held, w.word) && !(w.passedBy ?? []).some(p => scopeIsCovered(held, p)))
    .map(w => w.word);
}

/** One principal the step changed. */
export interface KeptPrincipal { id: string; owner: string; name: string; words: string[] }

export interface KeepWorkingResult {
  /** False on a node before 4.0.0 and on a node that ran it before: nothing was read or written. */
  ran: boolean;
  agents: KeptPrincipal[];
  ecosystemApps: KeptPrincipal[];
  /** Published apps that got an allowance (services/app-scope-allowance.ts). */
  apps: KeptApp[];
}

export interface KeepWorkingOptions {
  /** The release the node runs; the running one when omitted. */
  version?: string;
  /** Only principals created before this ISO time; the step's own start when omitted. */
  existedBefore?: string;
}

/**
 * Take back from anonymous mode's shared agent the words the two earlier steps wrote on it, once:
 * a word goes only when that step's own run record names this agent, which is the evidence that the
 * step wrote it. Anyone may hold the shared identity (auth/anonymous-scopes.ts), and the node makes it
 * at every start with anonymous mode on, so isSharedAnonymous also keeps this step's own words off it.
 */
async function takeBackFromSharedAnonymous(storage: Storage, system: string): Promise<{ id: string; removed: string[] } | null> {
  const steps: Array<[string, ReadonlyArray<{ word: string }>]> = [[REST_SCOPE_GATES_KEY, REST_SCOPE_NEW_WORDS], [AGENT_READ_GRANT_KEY, AGENT_READ_WORDS]];
  for (const agent of await storage.listAgents()) {
    if (!isSharedAnonymous(agent.owner)) continue;
    const written: string[] = [];
    for (const [key, words] of steps) {
      const rec = await storage.getMemory(system, key);
      const named = (rec?.value as { agents?: unknown } | undefined)?.agents;
      if (Array.isArray(named) && named.includes(agent.gaii)) written.push(...words.map(w => w.word));
    }
    const changed = await changeScopeList(storage, { kind: 'agent', id: agent.gaii }, agent.defaultScopes ?? [], held => {
      const removed = written.filter(w => held.includes(w));
      return removed.length ? held.filter(w => !removed.includes(w)) : null;
    });
    if (!changed) continue;
    return { id: agent.gaii, removed: changed.before.filter(w => !changed.after.includes(w)) };
  }
  return null;
}

/** Created before `cutoff`; a record without a readable time is taken as existing. */
function existed(createdAt: string | undefined, cutoff: number): boolean {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isNaN(t) || t < cutoff;
}

/**
 * Give every principal that existed before this step the words the 4.0.0 gates check and it lacks,
 * tell each owner and the operator, and record the run. Does nothing before 4.0.0 or a second time.
 * Throws when a write fails, and then leaves no record, so the next start tries again.
 */
export async function migrateRestScopeKeepWorkingOnce(
  storage: Storage,
  config: Pick<AimeatConfig, 'nodeId' | 'accountEventWindow'>,
  opts: KeepWorkingOptions = {},
): Promise<KeepWorkingResult> {
  const result: KeepWorkingResult = { ran: false, agents: [], ecosystemApps: [], apps: [] };
  if (!versionAtLeast(opts.version ?? getSoftwareVersion(), REST_SCOPE_GATES_ENFORCED_IN)) return result;
  const system = `system@${config.nodeId}`;
  // Each half's record is claimed before its work (services/once-only-step.ts), so of two node
  // processes starting together one runs each half, and nobody is told twice.
  const principals = await claimOnceOnlyStep(storage, system, REST_SCOPE_KEEP_WORKING_KEY);
  const apps = await claimOnceOnlyStep(storage, system, APP_SCOPE_KEEP_WORKING_KEY);
  if (!principals && !apps) return result;

  try {
    // Each half keeps what existed before its own rule first took effect here, also when it runs at a
    // later start after a failed one (keptBefore; secaudit2026oct26).
    if (principals) await keepPrincipals(storage, keptBefore(principals, opts.existedBefore), result);
    const anonymous = principals ? await takeBackFromSharedAnonymous(storage, system) : null;
    // The apps, under their own record, so a node that ran the principals' half before apps were part
    // of this step still runs the apps' half once.
    if (apps) result.apps = await keepWorkingAppsOnce(storage, config, keptBefore(apps, opts.existedBefore));

    const changed = [...result.agents, ...result.ecosystemApps];
    if (principals) await tellOwners(storage, config, changed);
    if (apps) await tellAppOwners(storage, config, result.apps);
    if (changed.length + result.apps.length > 0) await tellOperator(storage, config, result);

    const at = new Date().toISOString();
    await principals?.finish({
      at,
      words: REST_SCOPE_KEEP_WORKING_WORDS.map(w => w.word),
      agents: result.agents.map(a => ({ id: a.id, words: a.words })),
      ecosystemApps: result.ecosystemApps.map(a => ({ id: a.id, words: a.words })),
      sharedAnonymousTakenBack: anonymous,
    });
    await apps?.finish({ at, apps: result.apps.map(a => ({ id: a.appId, words: a.words, grants: a.grants })) });
  } catch (err) {
    await principals?.release();
    await apps?.release();
    throw err;
  }
  result.ran = true;
  const changed = [...result.agents, ...result.ecosystemApps];
  if (changed.length + result.apps.length > 0) {
    logger.info(`REST scope gates: ${result.agents.length} agent(s), ${result.ecosystemApps.length} ecosystem app(s) `
      + `and ${result.apps.length} published app(s) kept working from 3.x with the words 4.0.0 checks`,
    { principals: changed.map(p => `${p.id}: ${p.words.join(', ')}`), apps: result.apps.map(a => `${a.appId}: ${a.words.join(', ')}`) });
  }
  return result;
}

/** The words `held` lacks, as the new list, or null when it lacks none. */
function withKeptWords(kind: 'agent' | 'ecosystem') {
  return (held: readonly string[]): string[] | null => {
    const missing = wordsToKeepWorking(held, kind);
    return missing.length ? [...held, ...missing] : null;
  };
}

/**
 * The agents and ecosystem apps half: each missing word onto each principal that existed before. Each
 * list is written on the list that was read (services/scope-list-swap.ts), so a word another step or
 * the owner adds meanwhile stays.
 */
async function keepPrincipals(storage: Storage, cutoff: number, result: KeepWorkingResult): Promise<void> {
  const added = (c: { before: readonly string[]; after: string[] }) => c.after.slice(c.before.length);
  for (const agent of await storage.listAgents()) {
    if (!existed(agent.createdAt, cutoff) || isSharedAnonymous(agent.owner)) continue;
    const changed = await changeScopeList(storage, { kind: 'agent', id: agent.gaii }, agent.defaultScopes, withKeptWords('agent'));
    if (changed) result.agents.push({ id: agent.gaii, owner: agent.owner, name: agent.name, words: added(changed) });
  }

  for (const owner of await storage.listOwners()) {
    if (isSharedAnonymous(owner.name)) continue;
    for (const app of await storage.getEcosystemAppsByOwner(owner.name)) {
      if (app.status !== 'approved' && app.status !== 'active') continue;
      if (!existed(app.createdAt, cutoff)) continue;
      const changed = await changeScopeList(storage, { kind: 'ecosystem-app', id: app.geai }, app.scopes, withKeptWords('ecosystem'));
      if (changed) result.ecosystemApps.push({ id: app.geai, owner: app.owner, name: app.displayName || app.app, words: added(changed) });
    }
  }
}

/** One feed line per app owner: the published apps that kept words, and the words. `subject` is the step's record. */
export async function tellAppOwners(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId' | 'accountEventWindow'>, apps: KeptApp[],
  subject: string = APP_SCOPE_KEEP_WORKING_KEY,
): Promise<void> {
  const byOwner = new Map<string, KeptApp[]>();
  for (const a of apps) byOwner.set(a.owner, [...(byOwner.get(a.owner) ?? []), a]);
  for (const [owner, kept] of byOwner) {
    await recordAccountEvent(storage, {
      ownerGhii: owner.includes('@') ? owner : `${owner}@${config.nodeId}`,
      kind: 'app_scope_words_kept',
      subject,
      // The App Catalog, where each app's change log names the words and why it got them.
      link: '/v1/appcat',
      data: {
        names: kept.map(a => a.name).join(', '), count: String(kept.length),
        words: [...new Set(kept.flatMap(a => a.words))].sort().join(', '),
      },
    }, config);
  }
}

/** One feed line per owner: the agents and apps that got words, and the words. */
async function tellOwners(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId' | 'accountEventWindow'>, changed: KeptPrincipal[],
): Promise<void> {
  const byOwner = new Map<string, KeptPrincipal[]>();
  for (const p of changed) byOwner.set(p.owner, [...(byOwner.get(p.owner) ?? []), p]);
  for (const [owner, principals] of byOwner) {
    const words = [...new Set(principals.flatMap(p => p.words))].sort();
    await recordAccountEvent(storage, {
      ownerGhii: owner.includes('@') ? owner : `${owner}@${config.nodeId}`,
      kind: 'scope_words_kept',
      subject: REST_SCOPE_KEEP_WORKING_KEY,
      link: '/v1/profile?tab=agents',
      data: { names: principals.map(p => p.name).join(', '), count: String(principals.length), words: words.join(', ') },
    }, config);
  }
}

/** One incident on the Security page with the counts, so the operator sees the whole node at once. */
async function tellOperator(storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, result: KeepWorkingResult): Promise<void> {
  const changed = [...result.agents, ...result.ecosystemApps];
  const tally = (items: Array<{ words: string[] }>) => {
    const perWord = new Map<string, number>();
    for (const p of items) for (const w of p.words) perWord.set(w, (perWord.get(w) ?? 0) + 1);
    return [...perWord.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([w, n]) => `${w} ${n}`).join(', ') || 'none';
  };
  const owners = new Set([...changed.map(p => p.owner), ...result.apps.map(a => a.owner)]).size;
  const grants = result.apps.reduce((n, a) => n + a.grants, 0);
  await recordSecurityIncident(storage, config, {
    type: 'scope_words_kept',
    code: 'SCOPE_WORDS_KEPT',
    actorGhii: `system@${config.nodeId}`,
    actorName: 'node',
    source: 'boot',
    detail: `On its first start as ${REST_SCOPE_GATES_ENFORCED_IN} or later the node gave ${result.agents.length} agent(s), `
      + `${result.ecosystemApps.length} ecosystem app(s) and ${result.apps.length} published app(s) of ${owners} owner(s) the `
      + 'permission words that version started to check, so each keeps working as it did on 3.x. '
      + `Agents and ecosystem apps per word: ${tally(changed)}. Published apps per word: ${tally(result.apps)}; `
      + `${grants} live app grant(s) got the words. Each owner sees one line on the activity feed per kind. An agent `
      + 'is narrowed in its settings or with aimeat_agent_scope_narrow; an app\'s kept words are removed by its owner with '
      + 'aimeat_app_manage scope_allowance_remove, and the app\'s change log in the App Catalog says why each was kept.',
  });
}
