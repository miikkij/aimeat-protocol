/**
 * @file capability-invoke.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Invoke proxy: routes capability invocations to the correct underlying system: an
 *   extension over a localhost fetch, a manual webhook, an ecosystem app over the connect-tunnel,
 *   or a tool on an MCP server this node has attached.
 * @version-history
 *   v1.8.1 - 2026-10-24 - assertCapabilityRunnable: the three checks before any run, extracted so
 *     ctx.buy asks them when it runs a seller's extension action in-process (secaudit2026oct22,
 *     ext-purchase:buy-forwards-outer-caller-bearer). No behaviour change here.
 *   v1.8.0 - 2026-10-22 - The `ecosystem` case refuses another account's capability unless the
 *     caller's outside app declared the action and the account holder allowed it once with one press
 *     (ECOSYSTEM_CAPABILITY_NEEDS_APPROVAL with the address, ECOSYSTEM_CAPABILITY_NOT_YOURS,
 *     ECO_APP_NOT_FOUND; services/eco-capability-approvals.ts). The registrant chose the action and,
 *     through lockedInput, the arguments the caller's own app ran as the caller (secaudit 2026-10,
 *     capability-invoke.ts:ecosystem-source:app-slug-resolved-in-caller-reach). Own use unchanged.
 *   v1.7.0 - 2026-10-20 - The `mcp` case refuses a capability of ANOTHER owner unless the publisher
 *     reaches the same server row the caller's slug resolves to (MCP_CAPABILITY_NOT_YOURS). The slug
 *     was resolved in the caller's namespace alone, so another owner's capability selected the tool,
 *     and through an app-tool manifest's lockedInput the arguments, of a call made on the caller's
 *     own attached server with the caller's stored credential (secaudit 2026-10,
 *     capability-invoke.ts:mcp-source:server-slug-resolved-in-caller-reach). Adds
 *     appToolBindingRefusal (an app-tool manifest binds only its own owner's capabilities) and
 *     authorityFromToken (a paid path reads the buyer session's own scopes instead of asserting a
 *     list), both used by the WebMCP, MCP and checkout paths.
 *   v1.6.0 - 2026-10-12 - The extension case's loopback request carries the node's loopback pass for
 *     the caller's token (auth/loopback-pass.ts), so aimeat_capabilities_invoke and
 *     aimeat_app_tool_invoke keep working from 4.0.0 for a session whose token is bound to the MCP
 *     endpoint, which `/v1/ext` refuses from outside. Identity, scopes and the paywall are unchanged.
 *   v1.5.0 - 2026-09-24 - `authority` replaces `callerScopes`: the scopes AND whether the caller is the
 *     owner in person, which the `mcp` case hands to the chokepoint. It passed the resolved identity
 *     alone, so an app under a grant was taken for its owner and called the owner's server.
 *   v1.4.1 - 2026-09-24 - `callerScopes` says what a paid path states: the purchase authorises the call.
 *   v1.4.0 - 2026-09-24 - `callerScopes`: the `mcp` case hands the caller's own scopes to the
 *     chokepoint. It passed none, which the chokepoint read as mcp:use, and the invoke door proves
 *     only work:request.
 *   v1.3.1 - 2026-09-24 - The ecosystem branch names the caller's account with localAccountName, so a
 *     visitor's home GHII never binds the local namesake's app tunnel (secaudit 2026-09, F-1).
 *   v1.3.0 - 2026-09-16 - Add `case 'mcp'`: a published capability can be a tool on an attached
 *     remote MCP server. It resolves through the CALLER's own reach and the same callRemoteTool()
 *     chokepoint, so publishing one does not hand anybody access to the server behind it.
 *   v1.0.0 - 2026-05-02 - Initial invoke proxy for extensions and manual webhooks
 *   v1.1.0 - 2026-06-14 - Add `case 'ecosystem'`: route invocation over the tunnel to a bound GEAI.
 *   v1.2.0 - 2026-07-25 - Name the caller-token failures (CALLER_TOKEN_MISSING / CALLER_TOKEN_INVALID)
 *     instead of reporting the route's AUTH_REQUIRED as an opaque EXTENSION_ERROR.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityRecord } from '../storage/interface.js';
import { safeFetch } from '../utils/url-validator.js';
import { INTERNAL_PASS_HEADER } from '../routes/extensions/internal-pass.js';
import { LOOPBACK_PASS_HEADER, mintLoopbackPass, revokeLoopbackPass } from '../auth/loopback-pass.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import { buildGEAI, ownerGhiiOf, localAccountName, localAccountOf } from '../utils/gaii.js';
import { requireUsableServer } from './mcp-client/registry.js';
import { callRemoteTool, statusForRemoteRefusal } from './mcp-client/invoke.js';
import { verifyJWT } from '../auth/jwt.js';
import { callAuthority, withCurrentScopes } from '../auth/effective-scopes.js';
import { resolvePat, PAT_PREFIX } from './access-token.js';
import { ecosystemCallRefusal } from './eco-capability-approvals.js';
import { logger } from '../utils/logger.js';

export interface InvokeResult {
  capability: string;
  result: unknown;
  duration_ms: number;
  source: { type: string; ref: string };
  mode: 'normal' | 'raw';
}

/** What a call may do on the strength of the session making it: see `authority` below. */
export interface CallAuthority { scopes: string[]; ownerInPerson?: boolean }

/**
 * The authority of the session that holds `token`, for a path that has the buyer's token but no
 * `req.auth` to ask: a checkout fulfilment.
 *
 * It is read from the credential rather than asserted, because asserting is the defect this
 * replaces: the paid paths stated `{ scopes: ['mcp:use'] }` for the buyer, so an agent the owner
 * never gave `mcp:use` caused a call on an attached server that the same agent is refused on
 * `POST /v1/mcp-servers/:id/call` (secaudit 2026-10). Both credential shapes a buyer can complete a
 * checkout with are read: a session JWT, narrowed to the agent record exactly as the auth
 * middleware narrows it, and a raw PAT. Anything else (no token at all, a PSP callback completing
 * the session for a buyer who is not there) holds nothing and is not the owner in person, which is
 * the safe direction: the call is then refused unless the capability needs no remote server.
 */
export async function authorityFromToken(storage: Storage, token: string | undefined): Promise<CallAuthority> {
  const none: CallAuthority = { scopes: [], ownerInPerson: false };
  if (!token) return none;
  if (token.startsWith(PAT_PREFIX)) {
    const pat = await resolvePat(storage, token).catch((err: unknown) => {
      logger.warn('capability-invoke: the access token could not be read, so the call carries nothing', { error: String(err) });
      return null;
    });
    return pat ? callAuthority({ roles: pat.roles, scopes: pat.scopes }) : none;
  }
  const verified = await verifyJWT(token).catch((err: unknown) => {
    logger.warn('capability-invoke: the session token could not be verified, so the call carries nothing', { error: String(err) });
    return null;
  });
  if (!verified) return none;
  return callAuthority(await withCurrentScopes(storage, verified));
}

/**
 * Why this app-tool binding may not be run, or null when it is the app owner's own capability.
 *
 * `action_id` in an `apps.{appId}.tools` manifest is a bare id in a node-wide registry, and the only
 * thing that supplied it is the app owner's own memory record. So an owner could name SOMEBODY
 * ELSE'S capability there and have every caller of their tool invoke it, with the manifest's
 * `lockedInput` deciding the arguments. `services/extension-purchase.ts` has refused that since the
 * August 2026 audit (H-17); the WebMCP route, its MCP twin and the checkout resolver loaded the
 * capability by id and checked nothing (secaudit 2026-10).
 *
 * Ownership is the whole test, and it subsumes the visibility question the direct invoke route asks
 * (`POST /v1/capabilities/:id/invoke` hides a private capability from everyone but its owner). What
 * is left after this check is the app owner's own capability, named by them in their own PUBLIC
 * manifest, which is a publication rather than a leak — and refusing a private one there would turn
 * off every app tool on a node whose `capabilityPublishing` is `self_only`, where a capability
 * cannot be public at all.
 */
export function appToolBindingRefusal(
  capability: CapabilityRecord, appOwnerName: string, appRef: string, toolName: string,
): { statusCode: number; code: string; message: string } | null {
  if (localAccountOf(capability.ownerGhii) === appOwnerName) return null;
  return {
    statusCode: 403,
    code: 'CAPABILITY_NOT_OWNED_BY_APP',
    message: `Tool "${toolName}" on app "${appRef}" is bound to a capability "${appOwnerName}" does not own, so it cannot be run from this app.`,
  };
}

/** The owner GHII behind a capability's registrant, whose stored form may be a bare account name. */
function registrantOwnerGhii(principal: string, nodeId: string): string {
  const owner = ownerGhiiOf(principal);
  return owner.includes('@') ? owner : `${owner}@${nodeId}`;
}

/**
 * Throws when the capability may not be run at all: not directly callable, disabled by the
 * operator, or withdrawn. Asked by invokeCapability and by ctx.buy, which runs a seller's extension
 * action in-process (services/extension-purchase.ts).
 */
export function assertCapabilityRunnable(capability: CapabilityRecord): void {
  if (!capability.callable) {
    const msg = capability.source.type === 'action'
      ? `This capability uses the async work queue. ${capability.usage}`
      : capability.source.type === 'cortex'
        ? `This capability is browser-only. ${capability.usage}`
        : `This capability is not directly callable. ${capability.usage}`;
    throw Object.assign(new Error(msg), { statusCode: 400, code: 'NOT_CALLABLE' });
  }

  if (capability.operatorOverride?.disabled) {
    throw Object.assign(new Error('This capability has been disabled by the operator'), { statusCode: 403, code: 'CAPABILITY_DISABLED' });
  }

  if (capability.status === 'disabled') {
    throw Object.assign(new Error('This capability is no longer available'), { statusCode: 410, code: 'CAPABILITY_GONE' });
  }
}

export async function invokeCapability(
  config: AimeatConfig,
  storage: Storage,
  capability: CapabilityRecord,
  input: Record<string, unknown>,
  callerGhii: string,
  jwt: string,
  mode: 'normal' | 'raw' = 'normal',
  /**
   * One-shot proof that a route which knows the purchased product already settled this call.
   * Minted in-process, single use, seconds long — see `routes/extensions/internal-pass.ts`.
   */
  internalPass?: string,
  /**
   * What authorises this call, asked only by a capability over a remote MCP tool: every scope the
   * caller holds, and whether it is the account holder in person (only then does the server's own
   * owner pass without mcp:use). A door with a session states callAuthority(req.auth); a paid path
   * with none (a checkout fulfilling a purchase) reads the buyer's own token with
   * authorityFromToken(); a purchase made for an extension holds nothing of its buyer's session.
   * Left out, nothing is held and the caller is nobody in person.
   */
  authority: CallAuthority = { scopes: [] },
): Promise<InvokeResult> {
  const start = Date.now();
  assertCapabilityRunnable(capability);

  let result: unknown;

  switch (capability.source.type) {
    case 'extension': {
      const parts = capability.source.ref.split(':');
      const extName = parts[1];
      const actionId = parts[2];

      // The extension runs behind the node's own AUTHENTICATED HTTP surface, so the caller's token
      // travels with the invocation. A caller that hands us no token cannot be served here — say so
      // before the round trip, because the route's generic AUTH_REQUIRED surfaces as an opaque
      // "extension failed" and sends the reader hunting inside the extension instead.
      if (!jwt) {
        throw Object.assign(
          new Error(`Cannot invoke "${capability.id}": no caller token was supplied. An extension-backed capability runs as the caller, so the invocation needs the caller's current bearer token.`),
          { statusCode: 401, code: 'CALLER_TOKEN_MISSING' },
        );
      }

      // `internalPass` (when present) tells the paywall on the other end that this call was already
      // settled by the route that knows which product was bought. Absent on every other path, so a
      // capability reached any other way is charged normally.
      // The loopback pass (auth/loopback-pass.ts) says the node sent this request for the caller's
      // own token. A session that signed in over MCP OAuth holds a token bound to the MCP endpoint,
      // which `/v1/ext` refuses from 4.0.0 when it comes from outside; with the pass the route reads
      // the same token, so the caller's identity, scopes and the paywall are as before.
      const loopbackPass = mintLoopbackPass(jwt);
      try {
        const response = await fetch(`http://127.0.0.1:${config.port}/v1/ext/${extName}/${actionId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}`,
            [LOOPBACK_PASS_HEADER]: loopbackPass,
            ...(internalPass ? { [INTERNAL_PASS_HEADER]: internalPass } : {}),
          },
          body: JSON.stringify(input),
        });
        const body = await response.json() as Record<string, unknown>;

        if (!body.ok) {
          if (response.status === 401) {
            throw Object.assign(
              new Error(`Cannot invoke "${capability.id}": the caller's token was rejected (expired or revoked). Refresh the session token and call again.`),
              { statusCode: 401, code: 'CALLER_TOKEN_INVALID' },
            );
          }
          throw Object.assign(new Error((body.error as { message?: string } | undefined)?.message || 'Extension invoke failed'), { statusCode: response.status, code: 'EXTENSION_ERROR' });
        }
        result = mode === 'raw' ? body : body.data;
      } finally {
        revokeLoopbackPass(loopbackPass);
      }
      break;
    }

    case 'mcp': {
      // `{serverSlug}/{tool}`. Split on the FIRST slash: a tool name may contain one, a slug may
      // not, so this is unambiguous in the direction that matters.
      const at = capability.source.ref.indexOf('/');
      const slug = at > 0 ? capability.source.ref.slice(0, at) : '';
      const toolName = at > 0 ? capability.source.ref.slice(at + 1) : '';
      if (!slug || !toolName) {
        throw Object.assign(new Error('This capability does not name a server and a tool'), {
          statusCode: 500, code: 'BAD_MCP_REF',
        });
      }

      // The caller's OWN reach, not the publisher's. A capability names a tool; it does not carry
      // access with it, so somebody who publishes one over their Jira has not given the world a
      // Jira. Absent and not-yours answer alike, as everywhere else here.
      const callerOwner = ownerGhiiOf(callerGhii);
      const server = await requireUsableServer(storage, callerOwner, slug, config);
      if (!server) {
        throw Object.assign(new Error(`You have no MCP server called "${slug}"`), {
          statusCode: 404, code: 'NO_MCP_SERVER',
        });
      }

      // THE OTHER DIRECTION OF THE SAME RULE, and the one this resolution was missing. A bare slug
      // means whatever it means to whoever is calling, so another owner's capability resolved to a
      // server only the CALLER has attached: the publisher then chose the tool, and through an
      // app-tool manifest's lockedInput the arguments, of a call made with the caller's own stored
      // credential (secaudit 2026-10, capability-invoke.ts:mcp-source:server-slug-resolved-in-
      // caller-reach). capability-record.ts accepts the `mcp` source on the reasoning that naming
      // somebody else's server buys the publisher nothing, which covers only the direction where a
      // publisher's server is exposed to the world.
      //
      // So a capability over a remote tool runs for another owner only on a server the PUBLISHER
      // reaches under that same slug and that resolves to the same row: the node's own server and a
      // group's server are one server for both, and an operator's capability over the node's server
      // keeps working for every owner it is offered to, free and paid. A personal server of the
      // caller's resolves to a different row and is refused.
      const publisherOwner = registrantOwnerGhii(capability.ownerGhii, config.nodeId);
      if (publisherOwner !== callerOwner) {
        const publisherServer = await requireUsableServer(storage, publisherOwner, slug, config);
        if (!publisherServer || publisherServer.id !== server.id) {
          throw Object.assign(
            new Error(`"${capability.name}" runs on an MCP server its publisher attached, and "${slug}" is not that server for you. Publish your own capability over your own server, or ask its publisher for one on a server you both reach.`),
            { statusCode: 403, code: 'MCP_CAPABILITY_NOT_YOURS' },
          );
        }
      }

      // The same chokepoint every other door uses: the grant, the locked arguments, the price and
      // the usage row all happen in there and cannot be skipped by arriving this way. The door
      // above proved work:request, not mcp:use, so the caller's own scopes go with the call.
      const called = await callRemoteTool({
        storage, config, server, tool: toolName,
        args: (input && typeof input === 'object' ? input : {}) as Record<string, unknown>,
        caller: callerGhii,
        scopes: authority.scopes,
        // `callerGhii` is the resolved identity, which for an app under a grant is its owner's
        // GHII. Whether the caller is that owner IN PERSON is the door's to say, never this name's.
        ownerInPerson: authority.ownerInPerson === true,
      });
      if (!called.ok) {
        throw Object.assign(new Error(called.message), {
          statusCode: statusForRemoteRefusal(called.code), code: called.code,
        });
      }
      result = called.content;
      break;
    }

    case 'manual': {
      if (!capability.webhookUrl) {
        throw Object.assign(new Error('Webhook URL not configured'), { statusCode: 500, code: 'NO_WEBHOOK' });
      }

      // safeFetch validates the URL AND re-validates every redirect hop (throws `Fetch blocked: …`),
      // closing the redirect-bounce SSRF on the owner-configured webhookUrl.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      try {
        const response = await safeFetch(capability.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-AIMEAT-Node': config.nodeId,
            'X-AIMEAT-Timestamp': new Date().toISOString(),
          },
          body: JSON.stringify({ input, caller: callerGhii, capability: capability.id }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw Object.assign(new Error('Webhook returned ' + response.status), { statusCode: 502, code: 'WEBHOOK_ERROR' });
        }

        const body = await response.json() as Record<string, unknown>;
        result = mode === 'raw' ? body : body.result ?? body;
      } finally {
        clearTimeout(timeout);
      }
      break;
    }

    case 'ecosystem': {
      // ref = 'eco:{app}:{capId}'. Resolve the bound GEAI tunnel for (app, caller's owner) on this
      // node and forward the invoke over it; the reverse `invoke_result` carries the reply back.
      // AIMEAT authenticates the caller + may bill, but the ecosystem enforces its OWN ACL — a refusal
      // returns as a normal { ok: false } reply, mapped to ECOSYSTEM_ERROR.
      const refParts = capability.source.ref.split(':'); // ['eco', app, capId]
      const app = refParts[1];
      const capId = refParts[2] ?? capability.id;
      if (!app) {
        throw Object.assign(new Error('Malformed ecosystem capability ref'), { statusCode: 500, code: 'BAD_ECOSYSTEM_REF' });
      }
      // The tunnel below is the CALLER's own app, so the action and the input are the caller's to
      // allow. Another account's capability chose both and the caller's app ran them as the caller
      // (secaudit 2026-10, capability-invoke.ts:ecosystem-source:app-slug-resolved-in-caller-reach).
      // It now runs only for an action the app declared and after the account holder allowed it once
      // with one press; the account's own capability is unchanged (services/eco-capability-approvals.ts).
      const refusal = await ecosystemCallRefusal({ storage, config }, { capability, app, action: capId, callerGhii, input });
      if (refusal) throw Object.assign(new Error(refusal.message), refusal);
      const owner = localAccountName(callerGhii);
      const geai = buildGEAI(app, owner, config.nodeId);
      const mgr = getActiveConnectTunnelManager();
      if (!mgr) {
        throw Object.assign(new Error('Connector tunnel unavailable'), { statusCode: 503, code: 'TUNNEL_UNAVAILABLE' });
      }
      const reply = await mgr.invokeOnPrincipal(geai, { capability: capId, input, caller: callerGhii });
      if (!reply.ok) {
        throw Object.assign(new Error('The ecosystem app refused or failed the call'), { statusCode: 502, code: 'ECOSYSTEM_ERROR' });
      }
      result = reply.result;
      break;
    }

    case 'cortex':
      throw Object.assign(new Error(`This capability is browser-only. Use it in an AIMEAT app: ${capability.usage}`), { statusCode: 400, code: 'BROWSER_ONLY' });

    default:
      throw Object.assign(new Error(`Cannot invoke source type: ${capability.source.type}`), { statusCode: 400, code: 'UNSUPPORTED_SOURCE' });
  }

  return {
    capability: capability.id,
    result,
    duration_ms: Date.now() - start,
    source: { type: capability.source.type, ref: capability.source.ref },
    mode,
  };
}
