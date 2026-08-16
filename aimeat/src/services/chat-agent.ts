/**
 * @file chat-agent.ts
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
 *   - CHAT_AGENT_NAME — the one place the name lives
 *   - ensureChatAgent() — find or create the agent, returning its GAII and granted scopes
 *   - mintChatAgentToken() — a session-scoped MCP credential for it
 * @usage
 *   const agent = await ensureChatAgent(storage, config, ownerName);
 *   const { token } = await mintChatAgentToken(storage, config, agent);
 * @version-history
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

export interface ChatAgentIdentity {
    gaii: string;
    ownerName: string;
    scopes: string[];
    created: boolean;
}

/**
 * Find, or create, this owner's chat agent.
 *
 * The scopes come from the standard profile rather than from the owner's own roles. That is
 * invariant 12: a role is granted, never inherited at mint time, and a mint that copied the owner's
 * list would hand a scope-limited surface an unscoped credential. The owner can widen or narrow it
 * afterwards in the Agents tab, which is the point of it being a real agent.
 */
export async function ensureChatAgent(
    storage: Storage, config: AimeatConfig, ownerName: string,
): Promise<ChatAgentIdentity> {
    const gaii = buildGAII(CHAT_AGENT_NAME, ownerName, config.nodeId);

    const existing = await storage.getAgent(gaii);
    if (existing) {
        return {
            gaii,
            ownerName,
            scopes: existing.defaultScopes ?? [],
            created: false,
        };
    }

    const scopes = capScopes(config, scopesForProfile('agent'));
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
        mode: 'interactive',
        createdAt: now,
        lastSeen: now,
    } as AgentRecord;
    await storage.createAgent(record);
    emitChange('agents', `${ownerName}@${config.nodeId}`);
    logger.info(`[chat] created ${gaii} with ${scopes.length} scope(s)`);

    return { gaii, ownerName, scopes, created: true };
}

/**
 * Never grant more than the node allows, whatever the profile says. The profile is a convenience;
 * `maxAgentScopes` is the operator's ceiling and it wins.
 */
function capScopes(config: AimeatConfig, wanted: string[]): string[] {
    const max = config.maxAgentScopes;
    if (!Array.isArray(max) || max.length === 0 || max.includes('*')) return wanted;
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
