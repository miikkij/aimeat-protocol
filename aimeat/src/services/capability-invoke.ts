/**
 * @file capability-invoke.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Invoke proxy: routes capability invocations to the correct underlying system: an
 *   extension over a localhost fetch, a manual webhook, an ecosystem app over the connect-tunnel,
 *   or a tool on an MCP server this node has attached.
 * @version-history
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
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import { buildGEAI, ownerGhiiOf, localAccountName } from '../utils/gaii.js';
import { requireUsableServer } from './mcp-client/registry.js';
import { callRemoteTool, statusForRemoteRefusal } from './mcp-client/invoke.js';

export interface InvokeResult {
  capability: string;
  result: unknown;
  duration_ms: number;
  source: { type: string; ref: string };
  mode: 'normal' | 'raw';
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
   * with none (a checkout fulfilling a purchase, one capability buying from another) states mcp:use,
   * because the purchase authorises the call, and never the owner in person. Left out, nothing is
   * held and the caller is nobody in person.
   */
  authority: { scopes: string[]; ownerInPerson?: boolean } = { scopes: [] },
): Promise<InvokeResult> {
  const start = Date.now();

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
      const response = await fetch(`http://127.0.0.1:${config.port}/v1/ext/${extName}/${actionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}`,
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

      // The caller's OWN reach, not the publisher's. A capability is a signpost; it does not carry
      // access with it, so somebody who publishes one over their Jira has not given the world a
      // Jira. Absent and not-yours answer alike, as everywhere else here.
      const server = await requireUsableServer(storage, ownerGhiiOf(callerGhii), slug, config);
      if (!server) {
        throw Object.assign(new Error(`You have no MCP server called "${slug}"`), {
          statusCode: 404, code: 'NO_MCP_SERVER',
        });
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
