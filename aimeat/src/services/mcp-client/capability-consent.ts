/**
 * @file src/services/mcp-client/capability-consent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Another account's capability over a remote MCP server where each person signs in with
 *   their own account runs with the caller's own sign-in only after the caller's account allowed it
 *   with one press (secaudit2026nov02d round 13,
 *   capability-invoke.ts:mcp-source:personal-sign-in-server-spends-caller-credential).
 *
 *   WHY. A capability with the source `mcp` names `<server slug>/<tool>`. capability-invoke.ts lets
 *   another account's capability run when its publisher and the caller resolve the same server row,
 *   on the reasoning that such a row (the node's own server, a group's server) holds one credential
 *   for both. A row with `auth: 'per-user-oauth'` holds none: each person signs in with their own
 *   account at the far side (mcp-server-schemas.ts takesPersonalSignIn), and callRemoteTool presents
 *   the CALLER's sign-in. So the publisher chose the tool, and through an app-tool manifest's
 *   lockedInput the arguments, of a call made as the caller at the far side (for example the
 *   caller's own Jira account).
 *
 *   THE RULE. The caller's own capability, and any capability over a row that holds one shared
 *   credential, run as before. Another account's capability over a personal sign-in row runs when the
 *   caller's account allowed this capability to run this tool on this server; otherwise nothing is
 *   sent, and the account holder is asked once with one press (a request of kind
 *   `mcp-capability-use`; an agent of the account holding mcp:use may answer). Allow: from then on it
 *   runs for the account holder, their agents and their apps, each still under its own mcp:use and
 *   grants. Don't allow, or no answer before the request expires: nothing runs, and a later call asks
 *   again. A capability whose publisher, server or tool changed is a new question.
 *
 *   THE RECORD is service-owned (utils/reserved-keys.ts `mcp-capability-consents.`), in the caller's
 *   account: { uses: { <publisher>|<server id>|<tool>: { allowedAt } | { waiting: { requestId, at } } } }.
 * @structure MCP_CAPABILITY_CONSENTS_PREFIX · MCP_CAPABILITY_USE_KIND · CapabilityUseCall ·
 *   personalSignInCapabilityRefusal · allowCapabilityUse
 * @usage
 *   const refused = await personalSignInCapabilityRefusal(ctx, { capability, publisherOwner, callerOwner, server, tool, requester });
 *   if (refused) throw Object.assign(new Error(refused.message), refused);
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (secaudit2026nov02d round 13).
 */
import type { Storage, CapabilityRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { McpServerRecord } from '../../models/mcp-server-schemas.js';
import { localAccountName, ownerGhiiOf } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { fileAsk } from '../publish-requests/ask.js';
import { readPublishRequest, effectiveState, approveUrl, type PublishRequester } from '../publish-requests/store.js';

/** The record, in the caller's account GHII namespace. Service-owned (utils/reserved-keys.ts). */
export const MCP_CAPABILITY_CONSENTS_PREFIX = 'mcp-capability-consents.';
/** The publish-request kind the account holder answers (publish-requests/apply-mcp-capability-use.ts). */
export const MCP_CAPABILITY_USE_KIND = 'mcp-capability-use';
/** The word an agent of the account holds to answer: the one that calls a remote MCP server at all. */
const APPROVE_SCOPE = 'mcp:use';

type Ctx = { storage: Storage; config: AimeatConfig };
interface UseState { allowedAt?: string; waiting?: { requestId: string; at: string } }
interface Consents { uses: Record<string, UseState> }

/** One call of another account's capability, as invokeCapability resolved it. */
export interface CapabilityUseCall {
  capability: Pick<CapabilityRecord, 'id' | 'name'>;
  /** The publisher's account GHII. */
  publisherOwner: string;
  /** The caller's account GHII: whose sign-in the call presents, and who is asked. */
  callerOwner: string;
  server: Pick<McpServerRecord, 'id' | 'slug'>;
  tool: string;
  /** Who made the call: the account holder in person, their agent, or their app. */
  requester: PublishRequester;
}

/** The refusal, shaped as invokeCapability throws it. */
export interface CapabilityUseRefusal { statusCode: 403; code: 'MCP_CAPABILITY_NEEDS_APPROVAL'; message: string; requestId?: string }

const recordKey = (capabilityId: string) => `${MCP_CAPABILITY_CONSENTS_PREFIX}${capabilityId}`;
const bindingOf = (publisher: string, serverId: string, tool: string) => `${publisher}|${serverId}|${tool}`;
const parseConsents = (v: unknown): Consents => {
  const u = (v && typeof v === 'object' ? (v as { uses?: unknown }).uses : null);
  return { uses: u && typeof u === 'object' ? { ...(u as Record<string, UseState>) } : {} };
};

async function writeConsents(ctx: Ctx, ownerGhii: string, capabilityId: string, mutate: (cur: Consents) => Consents | typeof UNCHANGED): Promise<void> {
  await updateRecord(ctx.storage, ownerGhii, recordKey(capabilityId), parseConsents, mutate, { tag: 'mcp', visibility: 'private' });
}

function refusal(call: CapabilityUseCall, tail: string, requestId?: string): CapabilityUseRefusal {
  const name = call.capability.name || call.capability.id;
  return {
    statusCode: 403, code: 'MCP_CAPABILITY_NEEDS_APPROVAL', ...(requestId ? { requestId } : {}),
    message: `"${name}" from ${localAccountName(call.publisherOwner)} runs the tool "${call.tool}" on "${call.server.slug}", `
      + `where everyone signs in with their own account, so it would run with your own sign-in there. `
      + `Nothing was sent. ${tail}`,
  };
}

/**
 * Whether another account's capability may run `call.tool` with the caller's own sign-in. null: the
 * caller's account allowed it. Otherwise the refusal, after asking the account holder once. Never
 * throws: a failure to decide refuses, and nothing is sent.
 */
export async function personalSignInCapabilityRefusal(ctx: Ctx, call: CapabilityUseCall): Promise<CapabilityUseRefusal | null> {
  const binding = bindingOf(call.publisherOwner, call.server.id, call.tool);
  const asked = (id: string) => refusal(call, `Your account has been asked to allow it with one press (request ${id}, `
    + `${approveUrl(ctx.config.baseUrl)}). If you are an AI, give the person that address in their own language, `
    + 'and call again once they allow it.', id);
  try {
    const state = parseConsents((await ctx.storage.getMemory(call.callerOwner, recordKey(call.capability.id)))?.value).uses[binding] ?? {};
    if (state.allowedAt) return null;
    if (state.waiting) {
      const request = await readPublishRequest(ctx.storage, call.callerOwner, state.waiting.requestId);
      const now = request ? effectiveState(request) : 'outdated';
      if (now === 'approved') return null;
      if (now === 'awaiting_owner') return asked(state.waiting.requestId);
      // Declined, expired or gone: this call asks again.
    }
    const name = call.capability.name || call.capability.id;
    const publisher = localAccountName(call.publisherOwner);
    const filed = await fileAsk(ctx, localAccountName(call.callerOwner), call.requester, {
      kind: MCP_CAPABILITY_USE_KIND,
      target: { capability: call.capability.id, publisher: call.publisherOwner, server: call.server.id, tool: call.tool },
      title: `the capability "${name}" from ${publisher}`,
      name,
      change: { field: 'mcp.capability.use', from: null, to: 'allowed' },
      approval: {
        approver: 'owner',
        asks: `let "${name}" from ${publisher} run the tool ${call.tool} on ${call.server.slug} with your own sign-in there`,
        why: `Everyone signs in to ${call.server.slug} with their own account, and ${publisher} chose which tool runs. `
          + 'It would act there as you. If you do not allow it, it does not run and nothing is sent.',
        approve_scope: APPROVE_SCOPE,
        i18n: { key: 'approval_mcp_capability_use', vars: { capability: name, publisher, tool: call.tool, server: call.server.slug } },
      },
    });
    if (!filed.ok) return refusal(call, `Your account could not be asked now: ${filed.message}`);
    const requestId = filed.request.id;
    await writeConsents(ctx, call.callerOwner, call.capability.id, cur => {
      const s = cur.uses[binding];
      if (s?.allowedAt || s?.waiting?.requestId === requestId) return UNCHANGED;
      return { uses: { ...cur.uses, [binding]: { waiting: { requestId, at: new Date().toISOString() } } } };
    });
    return asked(requestId);
  } catch (err) {
    logger.warn('mcp capability consent: whether the call may use the caller\'s sign-in could not be decided; refused', {
      capability: call.capability.id, server: call.server.slug, error: String(err),
    });
    return refusal(call, 'Whether your account allowed it could not be decided now. Try again.');
  }
}

/**
 * The account holder allowed request `requestId` (apply-mcp-capability-use.ts). The capability must
 * still be the publisher's and still name the same tool; the server id is part of the binding, so a
 * capability resolved to another server later asks again. False when nothing was allowed.
 */
export async function allowCapabilityUse(
  ctx: Ctx, ownerGhii: string, target: { capability: string; publisher: string; server: string; tool: string }, requestId: string,
): Promise<boolean> {
  const cap = await ctx.storage.getCapability(target.capability);
  if (!cap || cap.source?.type !== 'mcp') return false;
  const ref = String(cap.source.ref ?? '');
  const at = ref.indexOf('/');
  const registrant = ownerGhiiOf(cap.ownerGhii);
  const publisher = registrant.includes('@') ? registrant : `${registrant}@${ctx.config.nodeId}`;
  if (publisher !== target.publisher || at <= 0 || ref.slice(at + 1) !== target.tool) return false;
  const binding = bindingOf(target.publisher, target.server, target.tool);
  let changed = false;
  await writeConsents(ctx, ownerGhii, target.capability, cur => {
    const s = cur.uses[binding];
    if (s?.allowedAt) return UNCHANGED;
    if (s?.waiting && s.waiting.requestId !== requestId) return UNCHANGED;
    changed = true;
    return { uses: { ...cur.uses, [binding]: { allowedAt: new Date().toISOString() } } };
  });
  return changed;
}
