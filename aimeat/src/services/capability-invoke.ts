/**
 * @file capability-invoke.ts
 * @description Invoke proxy: routes capability invocations to the correct underlying system
 *   (extension localhost fetch, manual webhook, or — new — an ecosystem app over the connect-tunnel).
 * @version-history
 *   v1.0.0 - 2026-05-02 - Initial invoke proxy for extensions and manual webhooks
 *   v1.1.0 - 2026-06-14 - Add `case 'ecosystem'`: route invocation over the tunnel to a bound GEAI.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityRecord } from '../storage/interface.js';
import { safeFetch } from '../utils/url-validator.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import { parseGaiiLoose, buildGEAI } from '../utils/gaii.js';

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

      const response = await fetch(`http://127.0.0.1:${config.port}/v1/ext/${extName}/${actionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
        body: JSON.stringify(input),
      });
      const body = await response.json() as Record<string, unknown>;

      if (!(body as any).ok) {
        throw Object.assign(new Error((body as any).error?.message || 'Extension invoke failed'), { statusCode: response.status, code: 'EXTENSION_ERROR' });
      }
      result = mode === 'raw' ? body : (body as any).data;
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
        result = mode === 'raw' ? body : (body as any).result ?? body;
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
      const owner = parseGaiiLoose(callerGhii).owner;
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
