/**
 * @file src/config-ai-label.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The visible AI-label posture (AIMEAT_AI_LABEL_PUBLIC) and the provenance recording
 *   switch (AIMEAT_AI_PROVENANCE), read from the environment. Both are settings that a public node
 *   may not turn off. The label posture was a PURE EXTRACTION from config.ts on 2026-10-09 to keep
 *   that file under the 800-line ceiling; the rule and its reasons are unchanged.
 * @structure aiLabelPublicFromEnv · PROVENANCE_SWITCH_LOCAL_ONLY_IN · aiProvenanceFromEnv
 * @usage
 *   const aiLabelPublic = aiLabelPublicFromEnv(securityProfile);
 *   const aiProvenance = aiProvenanceFromEnv(securityProfile);
 * @version-history
 *   v1.1.0 — 2026-10-12 — aiProvenanceFromEnv: from PROVENANCE_SWITCH_LOCAL_ONLY_IN (4.0.0) a public
 *     node records provenance whatever AIMEAT_AI_PROVENANCE says; a local node keeps the switch
 *     (Core 2026-11 PROV-07, ruling Q17).
 *   v1.0.0 — 2026-10-09 — Moved from config.ts unchanged.
 */
import { getSoftwareVersion, versionAtLeast } from './utils/version.js';

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

/** The release from which only a local node may switch provenance recording off (Core 2026-11 PROV-07). */
export const PROVENANCE_SWITCH_LOCAL_ONLY_IN = '4.0.0';

/**
 * Whether the node records provenance for what it generates with AI. On unless AIMEAT_AI_PROVENANCE
 * is `false`; from PROVENANCE_SWITCH_LOCAL_ONLY_IN a public node records whatever it says, the way
 * `off` is refused for the visible label above. securityPostureWarnings() reports the coercion, and
 * before that release it says the switch stops working on a public node.
 */
export function aiProvenanceFromEnv(securityProfile: string, version: string = getSoftwareVersion()): boolean {
  if (process.env.AIMEAT_AI_PROVENANCE !== 'false') return true;
  return securityProfile === 'public' && versionAtLeast(version, PROVENANCE_SWITCH_LOCAL_ONLY_IN);
}
