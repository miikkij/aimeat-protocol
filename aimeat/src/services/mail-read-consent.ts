/**
 * @file src/services/mail-read-consent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The notices about reading mail, sent once per node: to the owners whose apps held
 *   connections:use beside a mailbox this node can read, and to the owners whose agents held it by
 *   name beside a mailbox of their own.
 *
 *   WHY. Until 2026-09-24 connections:use let an app publish, send AND read what is in a connected
 *   account, while the owner was told it publishes. Reading took its own word that day
 *   (connections:read-through), and no existing grant was given it, because their owners approved
 *   them when the screen said "publish". So an app that used to read an owner's mail stopped, and
 *   only the owner may say it can go on. This tells each such owner once, lists the apps, and gives
 *   a button per app that calls the owner's own door (POST /v1/app-grants/:grantId/read-through).
 *
 *   WHICH GRANTS, AND ON WHAT EVIDENCE. The node keeps no record of which app read a mailbox: the
 *   read door writes nothing per app, the usage telemetry records MCP calls and not this HTTP door,
 *   and the refusal log starts only with the split. So the notice names what the node does know:
 *   every live grant that holds connections:use and cannot read yet, for an owner who has a
 *   connection this node could read mail through (not revoked, and granted the scopes its provider's
 *   message list needs). Each of those apps COULD read that owner's mail before, and the text says
 *   exactly that; the owner decides per app.
 *
 *   AGENTS, IN A NOTICE OF THEIR OWN. An agent holding connections:use by name stopped reading its
 *   own mailbox the same day, and an agent reads only the connections that are its own. So the
 *   evidence is a mailbox this node can read under the agent's GAII, and the owner gets one notice
 *   naming those agents, with a button per agent that opens its page, where the owner gives the
 *   word. An agent holding "*" or "connections:*" reads on and is not named (secaudit 2026-09, A5-1).
 *
 *   ONCE. A marker record under the node's own system identity (`system@<node>`, a reserved name no
 *   account can take), key MAIL_READ_CONSENT_KEY, says the run happened: the place every run-once boot
 *   migration records itself (services/operator-admin-migration.ts does the same). It is claimed
 *   before the first notice, so two processes booting together do not both send. A claim left by a
 *   run that stopped half way is taken over after STALE_CLAIM_MS, and an owner who already holds a
 *   notice is not sent that notice again.
 * @structure MAIL_READ_CONSENT_KEY · MAIL_READ_CONSENT_TYPE · MAIL_READ_AGENTS_TYPE ·
 *   isReadableMailbox · isEligibleGrant · mailReadNotice · isEligibleAgent · agentMailReadNotice ·
 *   migrateMailReadConsent
 * @usage migrateMailReadConsent(storage, config).catch(err => logger.error(…));   // once at boot
 * @version-history
 *   v1.2.0 — 2026-09-26 — Agents too: an owner whose agents hold connections:use by name beside a
 *     mailbox of their own gets one notice naming them, with a button per agent that opens its page.
 *     The run reports `agents` beside `grants`, and `owners` counts the owners told anything
 *     (secaudit 2026-09, A5-1).
 *   v1.1.0 — 2026-09-26 — The marker lives under system@<node>, key migrations.mail-read-consent,
 *     beside the operator:admin migration's, instead of under `__node_migrations__`. Nothing had
 *     run on a deployed node, so no old marker is read.
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AppGrantRecord, AgentRecord, MemoryRecord } from '../storage/interface.js';
import type { ConnectionRecord } from '../models/connection-schemas.js';
import { buildOutboundProviders, findProvider, type OutboundProvider } from './connections/providers.js';
import { notify, MAX_NOTIF_ACTIONS, NOTIF_PREFIX, type NotifyInput } from './notify.js';
import { READ_THROUGH_SCOPE } from './app-grant-scopes.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { parseGAII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** The run-once marker, under `system@<node>` (markerOwner) where every boot migration records itself. */
export const MAIL_READ_CONSENT_KEY = 'migrations.mail-read-consent';
/** The node's own system identity: a reserved owner name (utils/gaii.ts RESERVED_NAMES), so no account writes it. */
const markerOwner = (nodeId: string): string => `system@${nodeId}`;
/** Starts with `app_`, so the notice sits in the owner's Apps group (notification-settings.ts). */
export const MAIL_READ_CONSENT_TYPE = 'app_mail_read_consent';
/** The same news about the owner's own agents: a notice of its own, so each kind has one text. */
export const MAIL_READ_AGENTS_TYPE = 'agent_mail_read_consent';
/** A claim older than this belongs to a run that stopped; the next boot takes it over. */
const STALE_CLAIM_MS = 15 * 60_000;

/** A connection this node could read mail through: not revoked, and granted what its message list needs. */
export function isReadableMailbox(conn: ConnectionRecord, providers: OutboundProvider[]): boolean {
  if (conn.status === 'revoked') return false;
  const messages = findProvider(providers, conn.provider)?.resources?.messages;
  if (!messages) return false;
  const granted = new Set(conn.scopes ?? []);
  return messages.requiresScopes.every(s => granted.has(s));
}

/** A live grant that may publish and send through the owner's accounts and may not read them yet. */
export function isEligibleGrant(grant: AppGrantRecord): boolean {
  const held = grant.scopes ?? [];
  return !grant.revoked && held.includes('connections:use') && !scopeIsCovered(held, READ_THROUGH_SCOPE);
}

/**
 * An agent that may publish and send through its own accounts and may not read them yet: it holds
 * connections:use by name. An agent holding "*" or "connections:*" reads on, because the new word is
 * inside both.
 */
export function isEligibleAgent(agent: AgentRecord): boolean {
  const held = agent.defaultScopes ?? [];
  return held.includes('connections:use') && !scopeIsCovered(held, READ_THROUGH_SCOPE);
}

/**
 * The notice for one owner about their agents: every agent named, and a button per agent, as many as
 * one notification carries, that opens that agent's page, where the owner gives the word. There is no
 * one-tap door here as there is for an app: an agent's permissions are the owner's own list, changed
 * on the agent's page.
 */
export function agentMailReadNotice(agents: AgentRecord[]): NotifyInput {
  const names = agents.map(a => a.name).join(', ');
  return {
    type: MAIL_READ_AGENTS_TYPE,
    title: 'Your agents need their own permission to read mail',
    body: `These agents have a mailbox of their own connected here, and permission to publish and send through it: ${names}. `
      + 'Until now that permission also let them read the mail in it. Reading has its own permission now: open the page of '
      + 'each agent that should keep reading its mail, and allow it to read what is in its connected accounts.',
    link: '/v1/profile#agents',
    i18n: { key: MAIL_READ_AGENTS_TYPE, vars: { agents: names } },
    actions: agents.slice(0, MAX_NOTIF_ACTIONS).map((a, i) => ({
      id: `open_agent_${i + 1}`,
      label: `Open ${a.name}`,
      kind: 'navigate' as const,
      link: `/v1/profile?tab=agents&agent=${encodeURIComponent(a.name)}`,
      i18n: { key: `${MAIL_READ_AGENTS_TYPE}.open`, vars: { agent: a.name } },
    })),
  };
}

/** The notice for one owner: every app named, a button for as many as one notification carries. */
export function mailReadNotice(grants: AppGrantRecord[]): NotifyInput {
  const apps = grants.map(g => g.appName || g.app).join(', ');
  const buttons = grants.slice(0, MAX_NOTIF_ACTIONS);
  const more = grants.length > buttons.length;
  return {
    type: MAIL_READ_CONSENT_TYPE,
    title: 'Reading your mail now takes a permission of its own',
    body: `These apps have permission to publish and send through the accounts you have connected: ${apps}. `
      + 'Until now that permission also let them read your mail. Reading has its own permission now: '
      + 'allow it for each app that should keep reading your mail.'
      + (more ? ` There is a button here for ${buttons.length} of them. The others can ask you for it themselves, `
        + 'and the Access page shows every app and what it may do.' : ''),
    link: '/v1/profile#access',
    i18n: { key: more ? `${MAIL_READ_CONSENT_TYPE}_more` : MAIL_READ_CONSENT_TYPE, vars: { apps, shown: buttons.length } },
    actions: buttons.map((g, i) => ({
      id: `allow_mail_read_${i + 1}`,
      label: `Allow reading: ${g.appName || g.app}`,
      kind: 'api' as const,
      method: 'POST' as const,
      endpoint: `/v1/app-grants/${encodeURIComponent(g.grantId)}/read-through`,
      style: 'primary' as const,
      i18n: { key: `${MAIL_READ_CONSENT_TYPE}.allow`, vars: { app: g.appName || g.app } },
    })),
  };
}

/** Claim the run. False when it has run, or when another process is running it right now. */
async function claim(storage: Storage, nodeId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const value = { status: 'running', startedAt: now };
  const existing = await storage.getMemory(markerOwner(nodeId), MAIL_READ_CONSENT_KEY);
  if (existing) {
    const v = (existing.value ?? {}) as { status?: string; startedAt?: string };
    const age = Date.now() - Date.parse(v.startedAt ?? '');
    if (v.status !== 'running' || age < STALE_CLAIM_MS) return false;
    await storage.setMemory({ ...existing, value, version: existing.version + 1, updatedAt: now });
    return true;
  }
  const record: MemoryRecord = {
    key: MAIL_READ_CONSENT_KEY, ownerGaii: markerOwner(nodeId), value, visibility: 'private',
    tags: ['migration'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  };
  if (storage.createMemoryIfAbsent) return (await storage.createMemoryIfAbsent(record)) !== null;
  await storage.setMemory(record);
  return true;
}

/** Has this owner been sent this notice already, by a run that stopped before its marker said done? */
async function alreadyTold(storage: Storage, ownerGhii: string, type: string): Promise<boolean> {
  const rows = await storage.listMemory(ownerGhii, { prefix: NOTIF_PREFIX });
  return rows.some(r => (r.value as { type?: unknown } | null)?.type === type);
}

/**
 * The owner's agents that could read mail until the split, by owner name. An agent reads only the
 * connections that are its own, so the evidence is a mailbox this node can read under the agent's
 * own GAII, beside connections:use held by name.
 */
async function eligibleAgentsByOwner(storage: Storage, providers: OutboundProvider[]): Promise<Map<string, AgentRecord[]>> {
  const byOwner = new Map<string, AgentRecord[]>();
  const seen = new Set<string>();
  for (const conn of await storage.listConnections({})) {
    if (seen.has(conn.principal) || !parseGAII(conn.principal) || !isReadableMailbox(conn, providers)) continue;
    seen.add(conn.principal);
    const agent = await storage.getAgent(conn.principal);
    if (!agent || !isEligibleAgent(agent)) continue;
    const list = byOwner.get(agent.owner) ?? [];
    list.push(agent);
    byOwner.set(agent.owner, list);
  }
  return byOwner;
}

/**
 * Send the notices to every owner they concern, once per node: one about their apps, one about their
 * agents. `ran` is false when the marker says it already happened; `owners` counts the owners told
 * anything, and `grants` and `agents` what the stored notices named.
 */
export async function migrateMailReadConsent(
  storage: Storage, config: AimeatConfig,
): Promise<{ ran: boolean; owners: number; grants: number; agents: number }> {
  if (!(await claim(storage, config.nodeId))) return { ran: false, owners: 0, grants: 0, agents: 0 };
  const providers = buildOutboundProviders(config);
  const byOwner = new Map<string, AppGrantRecord[]>();
  for (const grant of await storage.listAppGrants()) {
    if (!isEligibleGrant(grant)) continue;
    const list = byOwner.get(grant.owner) ?? [];
    list.push(grant);
    byOwner.set(grant.owner, list);
  }
  const told = new Set<string>();
  let grants = 0;
  for (const [owner, list] of byOwner) {
    const ownerGhii = `${owner}@${config.nodeId}`;
    const connections = await storage.listConnections({ principal: ownerGhii });
    if (!connections.some(c => isReadableMailbox(c, providers))) continue;
    if (await alreadyTold(storage, ownerGhii, MAIL_READ_CONSENT_TYPE)) continue;
    // Oldest grant first, so the buttons go to the apps the owner has used longest.
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const sent = await notify(storage, ownerGhii, mailReadNotice(list));
    if (sent.stored) { told.add(owner); grants += list.length; }
  }
  let agents = 0;
  for (const [owner, list] of await eligibleAgentsByOwner(storage, providers)) {
    const ownerGhii = `${owner}@${config.nodeId}`;
    if (await alreadyTold(storage, ownerGhii, MAIL_READ_AGENTS_TYPE)) continue;
    // Oldest agent first, as the apps are.
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const sent = await notify(storage, ownerGhii, agentMailReadNotice(list));
    if (sent.stored) { told.add(owner); agents += list.length; }
  }
  const owners = told.size;
  const now = new Date().toISOString();
  const marker = await storage.getMemory(markerOwner(config.nodeId), MAIL_READ_CONSENT_KEY);
  await storage.setMemory({
    key: MAIL_READ_CONSENT_KEY, ownerGaii: markerOwner(config.nodeId),
    value: { status: 'done', finishedAt: now, owners, grants, agents }, visibility: 'private', tags: ['migration'],
    ttlHours: null, version: (marker?.version ?? 0) + 1, createdAt: marker?.createdAt ?? now, updatedAt: now,
  });
  if (owners > 0) logger.info('Mail read notice sent', { owners, grants, agents });
  return { ran: true, owners, grants, agents };
}
