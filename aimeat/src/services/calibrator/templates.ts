/**
 * @file src/services/calibrator/templates.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Prompt Calibrator's four default prompt templates (analysis, reflection,
 *   self-reflection, synthesis), the shapes of its stored records, and the lazy backfill of a stored
 *   project's missing or outdated templates. Moved unchanged out of routes/calibrator.ts so the
 *   route and the MCP tool aimeat_calibrator share them (services/calibrator/projects.ts).
 * @structure DEFAULT_*_TEMPLATE · CalibratorDimension · CalibratorBatchModel ·
 *   CalibratorCandidateModel · PROJECT_TAGS · fillTemplates
 * @usage import { fillTemplates, DEFAULT_ANALYSIS_TEMPLATE } from './templates.js';
 * @version-history
 *   v1.0.0 — 2026-11-19 — Pure extraction from routes/calibrator.ts (feature audit 2026-11-19, 4.4
 *     item 5). Only `export` was added.
 */

export const DEFAULT_ANALYSIS_TEMPLATE = `You are evaluating whether a candidate AI model's output is STRUCTURALLY CORRECT compared to a reference output.

CRITICAL RULES:
- Focus ONLY on structural correctness — does the output WORK, not whether it looks identical
- Ignore ALL cosmetic differences: label text, descriptions, key ordering, naming style, whitespace
- Limit to 5-8 dimensions maximum — only the ones that actually matter for correctness
- A dimension PASSES if the candidate achieves the structural goal, even if the specific implementation differs
- Be GENEROUS with passing — if the structure is functionally equivalent, it passes

REFERENCE OUTPUT (the structurally correct target):
{TARGET_OUTPUT}

CANDIDATE OUTPUT (produced by {MODEL_NAME}):
{CANDIDATE_OUTPUT}

THE PROMPT that was given (for context):
{PROMPT_USED}

Evaluate ONLY these structural aspects (skip any that don't apply):
1. TOP-LEVEL STRUCTURE: Does it have the required top-level keys/sections? (critical)
2. COMPONENT COUNT: Does it have the right number and types of major elements? (critical)
3. DATA PIPELINE: Do data flows form valid chains (producer → consumer)? (critical)
4. REQUIRED SECTIONS: Are all mandatory sections present? (major)
5. DATA MODEL: Are data structures defined with correct types? (major)
6. NO UNNECESSARY EXTRAS: Did the candidate add things that shouldn't be there? (major)
7. RELATIONSHIPS: Are cross-references and dependencies valid? (minor)
8. CONFIGURATION: Are settings, schedules, and config correct? (minor)

Output as JSON with 5-8 dimensions:
{
  "dimensions": [
    {
      "name": "short_snake_case_name",
      "description": "What this measures",
      "category": "structure|data_model|missing|extra|quality",
      "severity": "critical|major|minor",
      "expected": "brief: what reference has",
      "actual": "brief: what candidate has",
      "pass": true or false
    }
  ],
  "analysis": "2-3 paragraph analysis. What works well? What's structurally broken? What's the most impactful fix?",
  "proposals": [
    "Concrete GENERIC prompt fix — what to add/change to prevent this structural error in any similar prompt"
  ]
}`;

export const DEFAULT_REFLECTION_TEMPLATE = `You are helping improve an AI prompt based on test results.

THE PROMPT being calibrated:
{PROMPT_USED}

THE DESIRED OUTPUT (reference — what a perfect response looks like):
{TARGET_OUTPUT}

WHAT THE CANDIDATE MODEL ({MODEL_NAME}) ACTUALLY PRODUCED:
{CANDIDATE_OUTPUT}

ANALYSIS OF WHAT WENT WRONG:
{ANALYSIS_TEXT}

Based on this analysis, suggest concrete improvements to the prompt that would make the candidate model produce output closer to the reference.

Rules:
- Suggest GENERIC prompt modifications — do NOT reference project-specific names, APIs, or domain concepts
- Each fix must work for ANY prompt calibration task, not just this one
- Explain WHAT to add/change and WHERE in the prompt
- Be specific — show the actual text to add or modify
- Focus on the root causes identified in the analysis, not symptoms

Output as JSON:
{
  "proposals": [
    "1. Description of what to change and where — because [reason]",
    "2. Description of what to change and where — because [reason]"
  ],
  "reasoning": "Multi-paragraph explanation of why these specific changes should help, what root causes they address, and how they relate to the analysis findings."
}`;

export const DEFAULT_SELF_REFLECTION_TEMPLATE = `You are reviewing your own output to help improve the prompt that produced it.

THE PROMPT you were given:
{PROMPT_USED}

THE DESIRED OUTPUT (reference — what a perfect response looks like):
{TARGET_OUTPUT}

YOUR OUTPUT (what you actually produced):
{CANDIDATE_OUTPUT}

ANALYSIS OF THE DIFFERENCES:
{ANALYSIS_TEXT}

You know your own tendencies better than any external reviewer. Based on this analysis, suggest concrete improvements to the prompt that would help YOU produce output closer to the reference next time.

Think about:
- What in the prompt was ambiguous or easy to misinterpret?
- What assumptions did you make that turned out to be wrong?
- What additional instructions or examples would have guided you better?

Rules:
- Suggest GENERIC prompt modifications — do NOT reference project-specific names, APIs, or domain concepts
- Each fix must work for ANY prompt calibration task, not just this one
- Explain WHAT to add/change and WHERE in the prompt
- Be specific — show the actual text to add or modify

Output as JSON:
{
  "proposals": [
    "1. Description of what to change and where — because [reason]",
    "2. Description of what to change and where — because [reason]"
  ],
  "reasoning": "Multi-paragraph explanation from your perspective as the model that produced this output — why these changes would help you specifically, what confused you about the original prompt, and how the proposed changes address that."
}`;

export const DEFAULT_SYNTHESIS_TEMPLATE = `You are reviewing prompt improvement proposals from multiple AI models.

THE PROMPT being calibrated:
{PROMPT_USED}

PROPOSALS FROM THE REASONING MODEL (the judge):
{JUDGE_PROPOSALS}

PROPOSALS FROM THE CANDIDATE MODELS (self-reflection):
{CANDIDATE_PROPOSALS}

Your task:
1. GROUP overlapping proposals — if the judge and a candidate both suggest the same fix, note this overlap (overlapping proposals are more likely to be correct)
2. SCORE each unique proposal: how much would it actually improve the prompt? (high/medium/low impact)
3. Create 2-3 OPTION SETS:
   - Option A (conservative): only high-impact, low-risk changes
   - Option B (moderate): high + medium impact changes
   - Option C (aggressive): all changes including experimental ones
4. RECOMMEND which option to try first and explain why

Output as JSON:
{
  "groupedProposals": [
    {
      "proposal": "Description of the fix",
      "sources": ["judge:model1", "self:model2"],
      "overlap": true,
      "impact": "high",
      "risk": "low",
      "explanation": "Why this would help"
    }
  ],
  "options": {
    "A": {
      "label": "Conservative — high-confidence fixes only",
      "proposalIds": [0, 2],
      "expectedImpact": "Should fix the most critical dimension failures"
    },
    "B": {
      "label": "Moderate — likely improvements",
      "proposalIds": [0, 1, 2, 4],
      "expectedImpact": "Should address most gaps"
    },
    "C": {
      "label": "Aggressive — all suggestions",
      "proposalIds": [0, 1, 2, 3, 4, 5],
      "expectedImpact": "Maximum change, might introduce new issues"
    }
  },
  "recommendation": "Start with Option B because...",
  "analysis": "Multi-paragraph synthesis of all proposals, what overlaps, what's unique to specific models, and what the overall calibration strategy should be."
}`;

/** Loosely-typed shapes for the dynamic calibrator JSON stored in memory records. */
export interface CalibratorDimension {
  name?: string;
  description?: unknown;
  category?: unknown;
  [key: string]: unknown;
}

export interface CalibratorBatchModel {
  modelId?: string;
  modelLabel?: string;
  step2_analysis?: { overallScore?: number | null; dimensions?: CalibratorDimension[] };
  [key: string]: unknown;
}

export interface CalibratorCandidateModel {
  id: string;
  label: string;
  [key: string]: unknown;
}

export const PROJECT_TAGS = ['calibrator', 'project'];

/** Fill in a missing or outdated template field of a stored project. Answers whether one changed. */
export function fillTemplates(project: Record<string, unknown>): boolean {
  let changed = false;
  // Update analysis template if it contains old versions (line-by-line or verbose structural)
  const analysisStr = (project.analysisPromptTemplate as string) || '';
  if (!analysisStr || analysisStr.includes('For each difference between A and B') || analysisStr.includes('Do NOT create dimensions for')) {
    project.analysisPromptTemplate = DEFAULT_ANALYSIS_TEMPLATE; changed = true;
  }
  if (!project.reflectionPromptTemplate) { project.reflectionPromptTemplate = DEFAULT_REFLECTION_TEMPLATE; changed = true; }
  if (!project.selfReflectionPromptTemplate) { project.selfReflectionPromptTemplate = DEFAULT_SELF_REFLECTION_TEMPLATE; changed = true; }
  if (!project.synthesisPromptTemplate) { project.synthesisPromptTemplate = DEFAULT_SYNTHESIS_TEMPLATE; changed = true; }
  return changed;
}
