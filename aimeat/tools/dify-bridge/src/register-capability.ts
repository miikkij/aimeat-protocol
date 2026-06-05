/**
 * @file register-capability.ts
 * @description One-time owner setup: registers a webhook-backed ('manual') AIMEAT capability
 *   that points at the dify-bridge shim, so other AIMEAT agents can invoke a Dify workflow.
 *   See docs/integrations/dify-hello-integration.md §6c. Capability creation is owner-only,
 *   so AIMEAT_TOKEN must be an owner JWT or an owner-grant PAT (aimeat_pat_…).
 * @structure main() → POST /v1/capabilities; prints the created capability id.
 * @usage
 *   AIMEAT_BASE_URL=http://127.0.0.1:40050 \
 *   AIMEAT_TOKEN=<owner-jwt-or-pat> \
 *   WEBHOOK_URL=http://127.0.0.1:8787/invoke \
 *   pnpm exec node --import tsx tools/dify-bridge/src/register-capability.ts
 * @version-history
 *   v1.0.0 - 2026-06-05 - Initial (Dify integration prototype).
 */
const env = (k: string, d = ''): string => process.env[k] ?? d;

const BASE = env('AIMEAT_BASE_URL', 'http://127.0.0.1:40050').replace(/\/+$/, '');
const TOKEN = env('AIMEAT_TOKEN');
const WEBHOOK_URL = env('WEBHOOK_URL', 'http://127.0.0.1:8787/invoke');
const CAP_ID = env('CAP_ID', 'dify-summarize-doc');
const CAP_NAME = env('CAP_NAME', 'Dify: summarize-doc');
const VISIBILITY = env('CAP_VISIBILITY', 'public'); // private | owner | public

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('ERROR: AIMEAT_TOKEN is required (owner JWT or owner-grant PAT).');
    process.exit(1);
  }

  const body = {
    id: CAP_ID,
    name: CAP_NAME,
    summary: 'Summarize a document via a Dify workflow (bridged through dify-bridge).',
    visibility: VISIBILITY,
    status: 'active',
    callable: true,
    source: { type: 'manual', ref: `dify:${CAP_ID}`, version: '1.0.0' },
    authRequired: 'registered',
    webhookUrl: WEBHOOK_URL,
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Document text to summarize' } },
      required: ['text'],
    },
    outputSchema: {
      type: 'object',
      properties: { summary: { type: 'string' } },
    },
    usage: 'Invoke with { "text": "…" }. Returns the Dify workflow outputs.',
    whenToUse: 'When a document needs summarizing via the Dify pipeline.',
    tags: ['dify', 'summarize'],
  };

  const resp = await fetch(`${BASE}/v1/capabilities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const json = (await resp.json()) as { data?: Record<string, unknown>; error?: { code?: string; message?: string } };

  if (!resp.ok) {
    console.error(`FAILED (${resp.status}):`, json.error ?? json);
    const code = json.error?.code;
    if (code === 'PUBLISHING_DISABLED' || code === 'PUBLIC_DISABLED') {
      console.error('→ Set AIMEAT_CAPABILITY_PUBLISHING=open (or register with an operator token).');
    }
    if (code === 'WEBHOOKS_DISABLED' || code === 'WEBHOOK_DOMAIN_NOT_ALLOWED') {
      console.error('→ Set AIMEAT_CAPABILITY_WEBHOOKS=open, or =allowlist_only with the shim host in');
      console.error('  AIMEAT_CAPABILITY_WEBHOOK_DOMAIN_ALLOWLIST. For loopback also set AIMEAT_DEV_MODE=true.');
    }
    process.exit(1);
  }

  const cap = (json.data ?? {}) as Record<string, unknown>;
  console.log('Registered capability:');
  console.log('  id        :', cap.id);
  console.log('  visibility:', cap.visibility);
  console.log('  status    :', cap.status);
  console.log('  webhookUrl:', cap.webhookUrl);
  console.log('\nInvoke it with:');
  console.log(`  CAP_ID=${cap.id} pnpm exec node --import tsx tools/dify-bridge/src/invoke-capability.ts`);
}

main().catch((e) => {
  console.error('ERROR:', (e as Error).message);
  process.exit(1);
});
