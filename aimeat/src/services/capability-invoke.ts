/**
 * @file capability-invoke.ts
 * @description Invoke proxy: routes capability invocations to the correct underlying system.
 * @version-history
 *   v1.0.0 - 2026-05-02 - Initial invoke proxy for extensions and manual webhooks
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityRecord } from '../storage/interface.js';

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

      // Webhook security: validate URL
      try {
        const url = new URL(capability.webhookUrl);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
          throw new Error('only http/https');
        }
        const host = url.hostname;
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
          throw Object.assign(new Error('Webhook URL cannot target localhost'), { statusCode: 400, code: 'WEBHOOK_LOCALHOST' });
        }
        if (host === '169.254.169.254') {
          throw Object.assign(new Error('Webhook URL cannot target metadata endpoint'), { statusCode: 400, code: 'WEBHOOK_METADATA' });
        }
      } catch (urlErr: any) {
        if (urlErr.statusCode) throw urlErr;
        throw Object.assign(new Error('Invalid webhook URL'), { statusCode: 400, code: 'INVALID_WEBHOOK' });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      try {
        const response = await fetch(capability.webhookUrl, {
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
