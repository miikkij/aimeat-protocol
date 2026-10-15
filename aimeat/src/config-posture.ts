/**
 * @file src/config-posture.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   2026-10-16 — The other test-only settings (x402 test facilitator, test mode, dev mode, admin setup
 *     open, Finvoice mock, fake connection address) are reported as ACTIVE on a non-loopback node, as
 *     the test money handler is (utils/test-switches.ts; QA audit D8-01).
 *   v1.4.0 — 2026-10-13 — AIMEAT_TEST_MONEY_HANDLER on a non-loopback node is reported as ACTIVE, not
 *     refused: the flag is in force on any node (ruling decision-testiraha-toimii-julkisella-nodella-kun-operaattori-kytkee-s).
 *   v1.3.0 — 2026-10-12 — AIMEAT_AI_PROVENANCE=false on a public node is reported: refused from 4.0.0,
 *     deprecated before it (Core 2026-11 PROV-07).
 *   v1.2.0 — 2026-10-11 — AIMEAT_TEST_MONEY_HANDLER is reported as refused on any node whose public
 *     URL is not a loopback address, whatever its profile (utils/test-money-guard.ts).
 *   v1.1.0 — 2026-09-28 — AIMEAT_AI_FIXED_BASEURL_OVERRIDES is reported as refused on a public node
 *     (System 2 plan, V3).
 *   v1.0.0 — 2026-08-10 — Extracted from config.ts (max-file-lines), no behaviour change.
 */
import type { AimeatConfig } from './config-types.js';
import { testMoneyHandlerOnPublicNode } from './utils/test-money-guard.js';
import { testSwitchesOnPublicNode } from './utils/test-switches.js';
import { PROVENANCE_SWITCH_LOCAL_ONLY_IN } from './config-ai-label.js';

/**
 * Startup posture self-check. When the resolved security profile is `public`, return a list of
 * unsafe-combination warnings so being insecure on the internet is a conscious operator choice,
 * not an accident. Warn-only by contract (the caller logs them) — never throws, so an operator can
 * still run any combination deliberately. Empty list on a `local` node. See security-development-dna.md.
 */
export function securityPostureWarnings(config: AimeatConfig): string[] {
  const w: string[] = [];
  // Before the profile check: a node with a private LAN address is `local` and still serves people.
  if (testMoneyHandlerOnPublicNode(config)) {
    w.push(`AIMEAT_TEST_MONEY_HANDLER=true is ACTIVE on a public node — ${config.baseUrl} is not a loopback address, and any buyer can complete a EUR or USD checkout without paying through test.money. To turn it off, remove the variable from this node's environment and restart.`);
  }
  // The other test-only settings, the same way and for the same reason (utils/test-switches.ts; QA audit D8-01).
  for (const s of testSwitchesOnPublicNode(config)) w.push(s.message);
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
  // The same kind from 4.0.0, and a notice before it: a public node records provenance whatever
  // AIMEAT_AI_PROVENANCE says (config-ai-label.ts aiProvenanceFromEnv, Core 2026-11 PROV-07).
  if (process.env.AIMEAT_AI_PROVENANCE === 'false') {
    w.push(config.aiProvenance
      ? `AIMEAT_AI_PROVENANCE=false was REFUSED — from ${PROVENANCE_SWITCH_LOCAL_ONLY_IN} a publicly reachable node records how its AI-generated content was made. Only a local node may switch it off.`
      : `AIMEAT_AI_PROVENANCE=false switches provenance recording off on a public node. This is deprecated: from ${PROVENANCE_SWITCH_LOCAL_ONLY_IN} a public node records it whatever the setting says.`);
  }
  // The same kind: a coercion. A fixed provider type's address is why a key sent to it cannot leak,
  // so a public node ignores the override (services/ai/providers.ts fixedBaseUrlOf).
  if (config.aiFixedBaseUrlOverrides?.trim()) {
    w.push('AIMEAT_AI_FIXED_BASEURL_OVERRIDES was REFUSED — on a public node openrouter, openai, anthropic, mistral and xai are reached only at their official addresses. Use an openai-compatible provider for any other address.');
  }
  return w;
}
