/**
 * @file appdev-flow-constants.ts
 * @description Shared vocabulary of the research-first appdev flow — imported by the build-app
 *   prompt, the appdev-flow prompt, and the appdev handbook so the step names, the skip phrase,
 *   and the tool list can never drift between surfaces. The flow itself: RESEARCH (what exists)
 *   → FRAME (tier, packs, iam) → PROPOSE (to the user) → BUILD → FINISH (face, skill, template,
 *   learnings). The user can always skip straight to building.
 * @structure FLOW_* string constants + buildResearchStep()/buildFinishChecklist() fragments
 * @usage import { FLOW_SKIP_PHRASE, buildResearchStep } from './appdev-flow-constants.js';
 * @version-history
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 7).
 */

/** The five flow phases, in order — the promise an MCP connection makes. */
export const FLOW_PHASES = 'research → frame → propose → build → finish' as const;

/** When the user says anything like this, skip research/framing and build directly. */
export const FLOW_SKIP_PHRASE = 'just build it the usual way' as const;

/** Canonical tool names of the flow (single source for every prompt surface). */
export const FLOW_TOOLS = {
    skill: 'node:aimeat-app-builder',
    skillGet: 'aimeat_skill_get',
    overview: 'aimeat_appdev_overview',
    pitfallList: 'aimeat_appdev_pitfall_list',
    pitfallReport: 'aimeat_appdev_pitfall_report',
    templatePropose: 'aimeat_app_template_propose',
    templateList: 'aimeat_app_template_list',
    appList: 'aimeat_app_list',
    appFork: 'aimeat_app_fork',
} as const;

/** The Step 0 research instruction (MCP agents; humans in a chat skip it naturally). */
export function buildResearchStep(): string {
    let s = '## Step 0 — Research first (agents with AIMEAT MCP tools)\n';
    s += `If you have \`aimeat_*\` MCP tools, follow the ${FLOW_PHASES} flow — it is the promise an MCP connection makes: a better result than building cold.\n`;
    s += `1. RESEARCH: load \`${FLOW_TOOLS.skill}\` (\`${FLOW_TOOLS.skillGet}\`), then call \`${FLOW_TOOLS.overview}\` (pass your model id) — the owner's existing apps and template proposals are usually the fastest correct starting point; read the pitfalls for the areas you will touch.\n`;
    s += '2. FRAME: pick the tier (decision tree in Step 2), the capability packs, and whether the app needs its OWN users (aimeat-iam) — decide this NOW, not after the data model exists.\n';
    s += '3. PROPOSE the frame to the user in 3-5 lines (tier, packs, start point: fork/template/scratch, iam yes/no) and adjust to their answer.\n';
    s += `SKIP CLAUSE: if the user says "${FLOW_SKIP_PHRASE}" (or equivalent), skip Steps 0-1 and build directly — the flow is a default, never a gate. Without MCP tools, go straight to Step 1.\n\n`;
    return s;
}

/** The finish checklist appended to the MCP section of the build prompt. */
export function buildFinishChecklist(): string {
    return `FINISH (after a successful publish — the publish response's next_steps shows what is missing): (1) publish the app's agent face + bind a skill (metadata.binding \`app:{owner}/{filename}\`) so the app is agent-facing by default; (2) if anything generalizes, record a template with \`${FLOW_TOOLS.templatePropose}\` (your model id required); (3) report what bit you with \`${FLOW_TOOLS.pitfallReport}\` (model required) — the next build starts smarter than this one.\n`;
}
