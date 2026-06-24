/**
 * @file pull.js
 * @description rest-connector `pull` action. Reads the per-instance secret API key (decrypted by
 *   the host from `{ encrypted }` at rest into a plaintext string), optionally fetches a configured
 *   endpoint via ctx.fetch (which enforces the SSRF guard), and caches a summary into ext: memory
 *   under `latest`. Never logs or returns the raw secret — only its type/length/last-2-chars, so a
 *   caller can prove the secret was decrypted without exposing it.
 * @version-history
 *   v1.0.0 — 2026-06-24 — Initial reference connector (Secretary P5 S-C: encrypted secret config)
 */
export default async function (ctx, input) {
  // Bring-your-own-key per instance: apiKey/baseUrl come from the instance config (falls back to
  // extension-level config for a shared-key deployment). Secret fields arrive already decrypted.
  const cfg = (ctx.instance && ctx.instance.config) || ctx.config || {};
  const apiKey = typeof cfg.apiKey === 'string' ? cfg.apiKey : '';
  const target = (input && typeof input.url === 'string' && input.url) || cfg.baseUrl || '';

  let httpStatus = null;
  let preview = null;
  if (target) {
    // ctx.fetch validates the URL and every redirect hop — internal/link-local hosts are rejected.
    const headers = {};
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    const resp = await ctx.fetch(target, { method: 'GET', headers: headers });
    httpStatus = resp.status;
    preview = resp.text ? resp.text.slice(0, 500) : null;
  }

  const record = {
    syncedAt: new Date().toISOString(),
    apiKeyType: typeof apiKey,            // 'string' once decrypted; never the {encrypted} object
    apiKeyConfigured: apiKey.length > 0,
    apiKeyLen: apiKey.length,
    apiKeyTail: apiKey ? apiKey.slice(-2) : null,
    fetched: target || null,
    httpStatus: httpStatus,
    preview: preview,
  };
  await ctx.memory.set('latest', record);
  return record;
}
