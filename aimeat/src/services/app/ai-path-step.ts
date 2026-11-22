/**
 * @file src/services/app/ai-path-step.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the publish answer says about how the person's own AI uses the app: the app
 *   tools it has, the skills bound to it, and what the bound skill must hold. Quiet for a quick
 *   prototype and for a page whose owner chose no AI part (`<meta name="aimeat-ai-path"
 *   content="none">`, a presentation).
 *
 *   WHY. The answer named four things every app owes, and builds did exactly those four: on
 *   aimeat.io on 2026-11-20, 154 of 245 apps in use had neither app tools nor a bound skill, and
 *   no line of the answer mentioned app tools at all
 *   (wish-atelier-ohjaa-teko-lykiihdytykseen-skilli-suora-kirjoitus-ja). It is a recommendation:
 *   the publish never waits for it.
 * @structure declaresNoAiPath(html) · aiPathStep({ level, noAiPath, toolsCount, boundSkillsCount })
 * @usage ...aiPathStep({ level: declaredLevel(html), noAiPath: declaresNoAiPath(html), toolsCount, boundSkillsCount })
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial.
 */

/** True when the page declares that its owner chose no AI part (a presentation). */
export function declaresNoAiPath(html: string | undefined): boolean {
  if (!html) return false;
  return /<meta\s+name=["']aimeat-ai-path["']\s+content=["']none["']/i.test(html);
}

export interface AiPathFacts {
  /** The level the page declares (`proto`, `plain`, `fine`), or undefined. */
  level?: string;
  noAiPath: boolean;
  toolsCount: number;
  boundSkillsCount: number;
}

const GUIDE = 'aimeat_handbook_get { tier: "build-app-atelier/ai-path" }';

/** The `ai_path` lines of the publish answer. Empty for a quick prototype and a presentation. */
export function aiPathStep(f: AiPathFacts): Record<string, unknown> {
  if (f.level === 'proto' || f.noAiPath) return {};
  const tools = f.toolsCount > 0
    ? `${f.toolsCount} app tool(s): name them in the bound skill, and say they come before a direct write.`
    : 'No app tools. That is right when the person\'s data only grows and a direct write keeps every rule. '
      + 'When the app enforces a rule (a calculation, a limit, money or points, a permission), when several people or agents share the data, or when it produces content, '
      + 'the AI goes through an app tool: aimeat_handbook_get { tier: "build-app-atelier/app-tools" }.';
  const skill = f.boundSkillsCount > 0
    ? 'Check that the bound skill says'
    : 'No bound skill, so no AI can do the person\'s work here. The skill says';
  return {
    ai_path_tools_count: f.toolsCount,
    ai_path: `How the person's own AI uses this app. ${tools} ${skill} where each kind of data is stored (keys or workspace spaces), `
      + 'the record shape with an example and what the app derives itself, the rules the app checks, which acts the person confirms and how the AI proposes them, '
      + `and whether the open app shows a change without a reload (${GUIDE}). `
      + 'A presentation the owner will not change declares <meta name="aimeat-ai-path" content="none"> and this line goes quiet.',
  };
}
