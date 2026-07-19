/**
 * @file appdev-flow-prompt.ts
 * @description The paste-able "research-first" flow prompt served at GET /v1/prompts/appdev-flow —
 *   what a user gives Claude Code / OpenHands / any MCP-connected coding agent to make it build
 *   AIMEAT apps the accelerated way (research → frame → propose → build → finish) instead of
 *   coding cold. This is the user-facing promise of an MCP connection; the flow vocabulary comes
 *   from appdev-flow-constants.ts so it can never drift from the build prompt or the handbook.
 * @structure buildAppdevFlowPrompt(config) → string
 * @usage import { buildAppdevFlowPrompt } from '../services/appdev-flow-prompt.js';
 * @version-history
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 7).
 */

import type { AimeatConfig } from '../config.js';
import { FLOW_PHASES, FLOW_SKIP_PHRASE, FLOW_TOOLS, buildFinishChecklist } from './appdev-flow-constants.js';

export function buildAppdevFlowPrompt(config: AimeatConfig): string {
    const nodeUrl = config.baseUrl.replace(/\/+$/, '');
    let p = '';
    p += '# AIMEAT app development — the research-first flow\n\n';
    p += 'You are an agentic coder connected to an AIMEAT node over MCP (the `aimeat_*` tools). ';
    p += `Whenever I ask you to build, improve, or publish an app on AIMEAT, follow this flow: **${FLOW_PHASES}**. `;
    p += 'The MCP connection is what makes this possible — use it to start from what already exists instead of building cold.\n\n';
    p += '## 1. Research (before any code)\n';
    p += `- Load the paved-path skill: \`${FLOW_TOOLS.skillGet}\` ref \`${FLOW_TOOLS.skill}\`.\n`;
    p += `- Get the big picture in ONE call: \`${FLOW_TOOLS.overview}\` (pass your model id). It returns my existing apps and template proposals (often the fastest correct starting point — fork or copy patterns), library packs with per-model proofs, T1/T2/T3 templates, and the pitfalls (curated + learned) for the areas you will touch.\n`;
    p += `- Fetch the canonical build spec and treat it as law: \`GET ${nodeUrl}/v1/prompts/build-app\` — it always wins on any conflict.\n\n`;
    p += '## 2. Frame\n';
    p += 'Pick the tier (T1 pure client / T2 +cortex / T3 +extension), the capability packs, the starting point (fork a prior app / a template proposal / a shell), and whether the app needs its OWN users → the aimeat-iam pack, decided NOW, not retrofitted.\n\n';
    p += '## 3. Propose\n';
    p += 'Give me the frame in 3-5 lines (tier, packs, start point, iam yes/no, anything you will reuse) and wait for my go-ahead or corrections.\n\n';
    p += '## 4. Build\n';
    p += 'Build within the frame but stay flexible — building teaches; when reality disagrees with the frame, say so and adapt. Verify locally before publishing; publish over MCP (presigned upload for anything over ~1 KB).\n\n';
    p += '## 5. Finish (this is where the acceleration compounds)\n';
    p += buildFinishChecklist();
    p += '\n';
    p += `## Skipping\n`;
    p += `If I say "${FLOW_SKIP_PHRASE}" (or anything to that effect), skip steps 1-3 and build directly — the flow is the default, never a gate.\n`;
    return p;
}
