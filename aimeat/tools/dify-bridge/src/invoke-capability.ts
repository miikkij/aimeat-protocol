/**
 * @file invoke-capability.ts
 * @description End-to-end test caller: invokes the registered Dify-backed capability through
 *   AIMEAT, proving the AIMEAT → shim → Dify(mock|live) → back loop. Any authenticated caller
 *   (agent or owner) can invoke a public capability. See docs/integrations/dify-hello-integration.md.
 * @structure main() → POST /v1/capabilities/:id/invoke; prints the returned result.
 * @usage
 *   AIMEAT_BASE_URL=http://127.0.0.1:40050 \
 *   AIMEAT_TOKEN=<any-caller-jwt-or-pat> \
 *   CAP_ID=dify-summarize-doc \
 *   INPUT='{"text":"AIMEAT is a protocol for AI agents."}' \
 *   pnpm exec node --import tsx tools/dify-bridge/src/invoke-capability.ts
 * @version-history
 *   v1.0.0 - 2026-06-05 - Initial (Dify integration prototype).
 */
const env = (k: string, d = ''): string => process.env[k] ?? d;

const BASE = env('AIMEAT_BASE_URL', 'http://127.0.0.1:40050').replace(/\/+$/, '');
const TOKEN = env('AIMEAT_TOKEN');
const CAP_ID = env('CAP_ID', 'dify-summarize-doc');
const INPUT = env('INPUT', '{"text":"AIMEAT is a protocol for AI agents."}');

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('ERROR: AIMEAT_TOKEN is required (any caller JWT or PAT).');
    process.exit(1);
  }
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(INPUT);
  } catch (e) {
    console.error('ERROR: INPUT is not valid JSON:', (e as Error).message);
    process.exit(1);
  }

  const resp = await fetch(`${BASE}/v1/capabilities/${encodeURIComponent(CAP_ID)}/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ input }),
  });
  const json = (await resp.json()) as { data?: Record<string, unknown>; error?: unknown };

  if (!resp.ok) {
    console.error(`INVOKE FAILED (${resp.status}):`, json.error ?? json);
    process.exit(1);
  }

  const data = (json.data ?? {}) as Record<string, unknown>;
  console.log('Invoke OK.');
  console.log('  duration_ms:', data.duration_ms);
  console.log('  source     :', JSON.stringify(data.source));
  console.log('  result     :', JSON.stringify(data.result, null, 2));
}

main().catch((e) => {
  console.error('ERROR:', (e as Error).message);
  process.exit(1);
});
