/**
 * @file onboarding-prompt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Canonical Hello Integration MCP tool sequence and paste-into-agent
 *   instruction. Single source of truth for the post-connect onboarding hand-off
 *   reused by `auth.ts` (terminal output) and `skill-bundle.ts` (compatibility
 *   BUNDLE.md fallback). If you change the step order or the tool names, change
 *   them here -- not in the consumers.
 * @version-history
 *   v1.3.0 -- 2026-09-18 -- The text lives in src/services/hello-integration-prompt.ts, where a route
 *                            can serve it too; this file re-exports it for the CLI callers. A pure move.
 *   v1.0.0 -- 2026-05-28 -- Initial extraction from auth.ts/skill-bundle.ts duplication.
 *   v1.1.0 -- 2026-06-30 -- Add anti-fabrication rule (only five aimeat_onboarding_* tools exist;
 *                            drive other steps via each step's howTo.tool from aimeat_onboarding_status;
 *                            stop at summary.completable).
 *   v1.2.0 -- 2026-08-17 -- One model-recommendation line at the top: run onboarding on the
 *                            strongest reasoning model, thinking on. Additive; the sequence and
 *                            every step are untouched.
 */

export { HELLO_INTEGRATION_TOOL_SEQUENCE, buildAgentOnboardingInstruction } from '../../services/hello-integration-prompt.js';
