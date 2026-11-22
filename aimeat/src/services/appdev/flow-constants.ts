/**
 * @file src/services/appdev/flow-constants.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared vocabulary of the research-first appdev flow — imported by the build-app
 *   prompt, the appdev-flow prompt, and the appdev handbook so the step names, the skip phrase,
 *   and the tool list can never drift between surfaces. The flow itself: RESEARCH (what exists)
 *   → FRAME (level, genre or shell, platform sections, packs, iam) → PROPOSE (to the user) → BUILD → FINISH (face, skill, template,
 *   learnings). The user can always skip straight to building.
 * @structure FLOW_* string constants + buildResearchStep()/buildFinishChecklist() fragments
 * @usage import { FLOW_SKIP_PHRASE, buildResearchStep } from './flow-constants.js';
 * @version-history
 *   (2026-11-21) The finish step's "report what bit you" is four questions in order
 *     (PITFALL_FOUR_QUESTIONS): platform defect, this app only, general web craft, else search then report.
 *   (2026-11-20) The level is the finest unless the owner chose a lower one.
 *   (2026-11-19) The research step loads the Atelier skill and frames by level, genre or shell and
 *     platform sections; no tier. It is served as the Atelier platform section `research`.
 *   (2026-11-04) A new app is sent to the Atelier track; Classic stays for an app already on it.
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 7).
 */

/** The five flow phases, in order — the promise an MCP connection makes. */
export const FLOW_PHASES = 'research → frame → propose → build → finish' as const;

/** When the user says anything like this, skip research/framing and build directly. */
export const FLOW_SKIP_PHRASE = 'just build it the usual way' as const;

/** Canonical tool names of the flow (single source for every prompt surface). */
export const FLOW_TOOLS = {
    skill: 'node:aimeat-app-builder',
    atelierSkill: 'node:aimeat-app-builder-atelier',
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
    s += `If you have \`aimeat_*\` MCP tools, follow the ${FLOW_PHASES} flow — it is the promise an MCP connection makes: a better result than building without research.\n`;
    s += `1. RESEARCH: load \`${FLOW_TOOLS.atelierSkill}\` (\`${FLOW_TOOLS.skillGet}\`), then call \`${FLOW_TOOLS.overview}\` (pass your OWN model id — self-identify from your own configuration, never ask the user) — the owner's existing apps and template proposals are usually the fastest correct starting point; read the pitfalls for the areas you will touch.\n`;
    s += '2. FRAME: the level first (the finest, unless the owner chose a quick prototype or an ordinary page), then the genre or the shell, the platform sections the app needs, the capability packs, and whether the app needs its OWN users (the aimeat-iam pack for the gate + AIMEAT.iam for the panel) — decide this NOW, not after the data model exists.\n';
    s += '3. PROPOSE the frame to the user in 3-5 lines, in their words (level, design, start point: fork/template/scratch, who signs in) and adjust to their answer.\n';
    s += `SKIP CLAUSE: if the user says "${FLOW_SKIP_PHRASE}" (or equivalent), skip the research and the framing and build directly — the flow is a default, never a required step. Without MCP tools, go straight to the interview.\n\n`;
    return s;
}

/** The finish checklist appended to the MCP section of the build prompt. */
export function buildFinishChecklist(): string {
    return `FINISH (after a successful publish — the publish response's next_steps shows what is missing): (1) publish the app's agent face + bind a skill (metadata.binding \`app:{owner}/{filename}\`) so the app is agent-facing by default; (2) if anything generalizes, record a template with \`${FLOW_TOOLS.templatePropose}\` (your own model id required — self-identify, never ask the user); (3) for each problem you hit, ask four questions in this order: ${PITFALL_FOUR_QUESTIONS} — the next build starts smarter than this one.\n`;
}

/**
 * What a finished build does with what bit it, as four questions in order. The knowledge base had
 * grown to 195 active entries by 2026-11-21, a sixth of them one app's bugs, general web craft or
 * a repeat of an entry already there, because the finish step asked only to "report what bit you".
 */
export const PITFALL_FOUR_QUESTIONS = `(a) could the platform have prevented it (a check, a default, a refusal with its reason)? Then report it with \`${FLOW_TOOLS.pitfallReport}\` and \`kind: "platform-defect"\`, which answers with a ready wish text for the platform owner; `
    + '(b) is it about this app only? Then it goes in the app\'s own document in App Development Notes, not in the knowledge base; '
    + '(c) is it general web craft (CSS, a browser API, a library from outside AIMEAT)? Then it gets no entry; '
    + `(d) otherwise search the knowledge base first (\`${FLOW_TOOLS.pitfallList}\` with the areas you touched), update the entry that is already there (\`supersedes\`), and report a new one with \`${FLOW_TOOLS.pitfallReport}\` (model, evidence and seen_version) only when none fits`;
