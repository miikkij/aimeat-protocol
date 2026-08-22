/**
 * @file chat-agent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The person's built-in chat agent: `chat#<owner>@<node>`, a real GAII principal like
 *   any other, and the short-lived MCP token one chat session hands to goose.
 *
 *   It is a real agent on purpose. It appears in the owner's Agents tab beside the ones they
 *   connected themselves, its scopes are edited in the same place, and every tool call it makes is
 *   authorised against its own identity by the same MCP surface Claude Desktop talks to. A private
 *   side-channel would have been less code and a second permission model.
 *
 *   The token is minted per chat session and kept out of storage. It is a bearer credential for the
 *   whole of the person's tool surface, and it needs to live exactly as long as the goose session
 *   that carries it — the session row makes it revocable, and deleting the agent ends it.
 * @structure
 *   - CHAT_AGENT_NAME / CHAT_AGENT_MODE — the one place the name and the scope profile live
 *   - ensureChatAgent() — find or create the agent, returning its GAII and granted scopes
 *   - repairChatScopes() — widen an agent minted by the broken profile lookup, once
 *   - mintChatAgentToken() — a session-scoped MCP credential for it
 * @usage
 *   const agent = await ensureChatAgent(storage, config, ownerName);
 *   const { token } = await mintChatAgentToken(storage, config, agent);
 * @version-history
 *   v1.1.0 — 2026-08-22 — It gets the scopes of the mode it registers in, which is the same list a
 *     Claude Desktop gets from the same person. The record said `interactive` and the scopes were
 *     asked for a profile named `agent`, which is in no profile table, so the lookup fell through to
 *     memory read and write: the person's own chat could interview them and write down the answers
 *     and could not publish an app, install a package or create an organism. Agents minted inside
 *     that window are widened once. A node with a scope ceiling now gets the ceiling rather than an
 *     empty list, which is what filtering `*` against a list that lacks the word produced.
 *   v1.0.1 — 2026-08-16 — Write every column the agents table requires. `morselBalance` and `mode`
 *     were left off a partial record, which the sqlite schema refuses with a NOT NULL error, so
 *     starting a conversation was a 500 on any node with the shipped schema. Found by the first E2E
 *     run of the chat routes, not by the developer's own database.
 *   v1.0.0 — 2026-08-16 — Initial.
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { buildGAII } from '../utils/gaii.js';
import { generateKeyPair } from '../auth/keypair.js';
import { issueJWT } from '../auth/jwt.js';
import { scopesForProfile } from '../mcp/catalog/scopes.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';

/** The agent's name component. One place, because it appears in a GAII, a UI and a log line. */
export const CHAT_AGENT_NAME = 'chat';

/**
 * The mode it registers in, and the ONE name the scope profile is looked up by.
 *
 * These were two separate strings once, and they disagreed: the record said `interactive` while the
 * scopes were fetched for a profile called `agent`, which does not exist in MCP_SCOPE_PROFILES, so
 * `scopesForProfile` fell through to its conservative fallback and the person's own chat agent held
 * memory read and write and nothing else. It could interview them and write down the answers; it
 * could not publish an app, install a package or create an organism — everything a Claude Desktop
 * that the same person connected does without being asked twice.
 */
export const CHAT_AGENT_MODE = 'interactive' as const;

/**
 * The scope list the fallback used to produce. It is the SIGNATURE of that defect, and the only
 * shape repairChatScopes() will touch.
 */
const BROKEN_FALLBACK_SCOPES = ['memory:read', 'memory:write'];

/**
 * The day the profile lookup was fixed. A chat agent created after it is minted correctly, so it is
 * never a candidate for repair — the window this touches is closed and cannot grow.
 */
const SCOPE_FIX_DATE = '2026-08-22';

export interface ChatAgentIdentity {
    gaii: string;
    ownerName: string;
    scopes: string[];
    created: boolean;
}

/**
 * Find, or create, this owner's chat agent.
 *
 * The scopes come from the standard profile for the mode it registers in — the same profile, and so
 * the same list, that a Claude Desktop or a Cursor gets when the same person connects it. It is
 * still a GRANT and not an inheritance: invariant 12 forbids copying the owner's own roles onto an
 * agent at mint time, and this copies a named profile that says what an interactive agent may do.
 * The owner widens or narrows it afterwards in the Agents tab, which is the point of it being a
 * real agent rather than a private side-channel.
 *
 * WHY FULL ACCESS IS THE RIGHT DEFAULT HERE. This is the person's own chat, in their own browser,
 * in a session they are already signed into as the owner. An agent that can only read and write
 * memory turns every other request into "log in and click it yourself", which is the fallback this
 * project exists to stop being the destination. The scopes a wildcard deliberately does NOT carry
 * (utils/scope-coverage.ts: the account's password and recovery, the server-trusted keys, the
 * payout credentials, rewriting an agent's own permissions) are unaffected — those still cost one
 * tick per agent, for the chat agent exactly as for a connected one.
 */
export async function ensureChatAgent(
    storage: Storage, config: AimeatConfig, ownerName: string,
): Promise<ChatAgentIdentity> {
    const gaii = buildGAII(CHAT_AGENT_NAME, ownerName, config.nodeId);

    const existing = await storage.getAgent(gaii);
    if (existing) {
        const scopes = await repairChatScopes(storage, config, existing);
        return { gaii, ownerName, scopes, created: false };
    }

    const scopes = capScopes(config, scopesForProfile(CHAT_AGENT_MODE));
    const keyPair = await generateKeyPair();
    const now = new Date().toISOString();

    // Every field the agents table requires, in the same shape the device-authorization path writes.
    // `morselBalance` is zero and stays zero: the human pays, and an agent's balance resolves to the
    // owner's GHII everywhere it is spent.
    const record: AgentRecord = {
        name: CHAT_AGENT_NAME,
        owner: ownerName,
        gaii,
        displayName: 'Chat',
        description: 'The built-in chat agent. Talks to you in the browser and works through this node.',
        capabilities: ['memory', 'apps'],
        publicKey: keyPair.publicKey,
        defaultScopes: scopes,
        trustScore: 50,
        morselBalance: 0,
        mode: CHAT_AGENT_MODE,
        createdAt: now,
        lastSeen: now,
    } as AgentRecord;
    await storage.createAgent(record);
    emitChange('agents', `${ownerName}@${config.nodeId}`);
    logger.info(`[chat] created ${gaii} with ${scopes.length} scope(s)`);

    return { gaii, ownerName, scopes, created: true };
}

/**
 * Hand a chat agent minted by the broken profile lookup the scopes it should have had.
 *
 * The condition is deliberately narrow, because widening an agent's permissions without the owner
 * asking is the shape of an escalation and not of a fix. All three must hold: the agent was created
 * before the lookup was fixed, its scope list is byte-identical to what the fallback produced, and
 * the profile actually grants more than that. A list the owner has touched differs from the
 * signature in at least one word, so it is left exactly as they left it.
 *
 * The window is closed: an agent created after SCOPE_FIX_DATE gets the right list at creation and
 * can never enter this branch. What remains is one residual, stated rather than hidden — an owner
 * who narrows a pre-fix chat agent back to precisely those two words gets it widened again on their
 * next chat. Closing that would cost a stored marker, and the marker would outlive the six days of
 * records it protects.
 */
async function repairChatScopes(
    storage: Storage, config: AimeatConfig, agent: AgentRecord,
): Promise<string[]> {
    const held = agent.defaultScopes ?? [];
    const untouched = held.length === BROKEN_FALLBACK_SCOPES.length
        && BROKEN_FALLBACK_SCOPES.every((s) => held.includes(s));
    if (!untouched || agent.createdAt >= SCOPE_FIX_DATE) return held;

    const wanted = capScopes(config, scopesForProfile(CHAT_AGENT_MODE));
    if (wanted.length === held.length && wanted.every((s) => held.includes(s))) return held;

    const updated = await storage.updateAgent(agent.gaii, { defaultScopes: wanted });
    if (!updated) {
        logger.warn(`[chat] could not widen ${agent.gaii} past the old fallback scopes`);
        return held;
    }
    emitChange('agents', `${agent.owner}@${config.nodeId}`);
    logger.info(`[chat] ${agent.gaii} widened from the pre-${SCOPE_FIX_DATE} fallback to ${wanted.join(', ')}`);
    return wanted;
}

/**
 * Never grant more than the node allows, whatever the profile says. The profile is a convenience;
 * `maxAgentScopes` is the operator's ceiling and it wins.
 *
 * On a node WITH a ceiling, "everything" means everything that node allows — the ceiling list
 * itself. Filtering `*` against a list that does not contain the word leaves an agent holding
 * nothing at all, which is how full access turns into no access on exactly the nodes that thought
 * about permissions hardest.
 */
function capScopes(config: AimeatConfig, wanted: string[]): string[] {
    const max = config.maxAgentScopes;
    if (!Array.isArray(max) || max.length === 0 || max.includes('*')) return wanted;
    if (wanted.includes('*')) return [...max];
    return wanted.filter((s) => max.includes(s));
}

export interface ChatAgentToken {
    token: string;
    sessionId: string;
    expiresAt: string;
}

/**
 * Mint an MCP credential for one chat session.
 *
 * The session row is what makes it revocable: requireAuth checks the token's `jti` against it, and a
 * token whose session row never existed answers "not revoked" forever. That was a real hole on the
 * device-authorization path once, and this is the same shape of credential.
 *
 * `mcp_client` marks where the session came from, which is what makes the chat show up in the
 * owner's connected-clients list as itself rather than as an anonymous agent.
 */
export async function mintChatAgentToken(
    storage: Storage, config: AimeatConfig, agent: ChatAgentIdentity,
): Promise<ChatAgentToken> {
    const sessionId = `chat-${randomBytes(16).toString('hex')}`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + config.agentJwtTtlSeconds * 1000).toISOString();

    const token = await issueJWT({
        sub: agent.gaii,
        owner: agent.ownerName,
        node: config.nodeId,
        roles: ['agent'],
        scopes: agent.scopes,
        mcp_client: 'aimeat-chat',
    } as never, config.agentJwtTtlSeconds, sessionId);

    await storage.createSession({
        sessionId,
        gaii: agent.gaii,
        owner: agent.ownerName,
        issuedAt: now,
        expiresAt,
    });

    return { token, sessionId, expiresAt };
}
