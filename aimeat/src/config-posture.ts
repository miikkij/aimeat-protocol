/**
 * @file src/config-posture.ts
 * @description The startup security-posture self-check, extracted from config.ts by pure move when
 *   that file reached the 800-line limit. Body verbatim.
 *
 *   It reads a resolved config and reports the unsafe combinations, so being insecure on the public
 *   internet is a conscious operator choice rather than an accident. Warn-only by contract: the
 *   caller logs what comes back and the node still starts, because an operator is allowed to run any
 *   combination deliberately.
 * @structure securityPostureWarnings(config) — one sentence per unsafe setting, empty on a local node
 * @usage
 *   import { securityPostureWarnings } from './config-posture.js';
 *   for (const w of securityPostureWarnings(config)) logger.warn(w);
 * @version-history
 *   v1.0.0 — 2026-08-10 — Extracted from config.ts (max-file-lines), no behaviour change.
 */
import type { AimeatConfig } from './config-types.js';

/**
 * Startup posture self-check. When the resolved security profile is `public`, return a list of
 * unsafe-combination warnings so being insecure on the internet is a conscious operator choice,
 * not an accident. Warn-only by contract (the caller logs them) — never throws, so an operator can
 * still run any combination deliberately. Empty list on a `local` node. See security-development-dna.md.
 */
export function securityPostureWarnings(config: AimeatConfig): string[] {
  const w: string[] = [];
  if (config.securityProfile !== 'public') return w;
  if (config.anonymousMode) w.push('AIMEAT_ANONYMOUS=true — anyone can act as the shared anonymous identity.');
  if (config.allowPrivateEgress) w.push('AIMEAT_ALLOW_PRIVATE_EGRESS=true — server-side fetches can reach loopback/internal services (SSRF).');
  if (config.federationOpenJoin) w.push('AIMEAT_FEDERATION_OPEN_JOIN=true — any peer can federate without operator approval.');
  if (!config.encryptionKey) w.push('AIMEAT_ENCRYPTION_KEY is unset — secrets (AI keys, TOTP) cannot be encrypted at rest.');
  if (config.corsAllowedOrigins.includes('*')) w.push('AIMEAT_CORS_ALLOWED_ORIGINS=* — with credentials this is a CSRF / data-exfil footgun.');
  if (config.statsAccess === 'public') w.push('AIMEAT_STATS_ACCESS=public — internal metrics are exposed to anyone.');
  // Not "you chose something unsafe" but "your choice was not honoured" — the one entry here that
  // reports a coercion rather than a risk, so an operator who set it never believes it took effect.
  if (process.env.AIMEAT_AI_LABEL_PUBLIC?.trim().toLowerCase() === 'off') {
    w.push('AIMEAT_AI_LABEL_PUBLIC=off was REFUSED and reset to `strict` — a publicly reachable node may not hide the visible AI label (EU AI Act Art. 50). Use `light` to label only what the law requires.');
  }
  return w;
}
