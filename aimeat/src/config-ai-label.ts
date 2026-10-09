/**
 * @file src/config-ai-label.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The visible AI-label posture (AIMEAT_AI_LABEL_PUBLIC), read from the environment.
 *   PURE EXTRACTION from config.ts on 2026-10-09 to keep that file under the 800-line ceiling; the
 *   rule and its reasons are unchanged.
 * @structure aiLabelPublicFromEnv
 * @usage const aiLabelPublic = aiLabelPublicFromEnv(securityProfile);
 * @version-history
 *   v1.0.0 — 2026-10-09 — Moved from config.ts unchanged.
 */

/**
 * Visible-label posture. `off` is REFUSED on a public node rather than obeyed: this knob decides
 * whether a person is told, and the one combination that must be unreachable by accident is
 * "reachable from the internet, labels hidden". An unknown value falls back to the strict default
 * rather than to the permissive one. securityPostureWarnings() reports the coercion at startup.
 */
export function aiLabelPublicFromEnv(securityProfile: string): 'strict' | 'light' | 'off' {
  const requestedLabelPublic = process.env.AIMEAT_AI_LABEL_PUBLIC?.trim().toLowerCase();
  return requestedLabelPublic === 'off' && securityProfile === 'public' ? 'strict'
    : (['strict', 'light', 'off'].includes(requestedLabelPublic ?? '')
      ? (requestedLabelPublic as 'strict' | 'light' | 'off')
      : 'strict');
}
