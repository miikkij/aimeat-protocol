/**
 * @file test/unit/publish-next-steps-ai-path.test.ts
 * @description How the person's own AI uses an app: the publish answer's `ai_path` line, quiet for a
 *   quick prototype and a declared presentation, and the Atelier texts that teach the path (the core
 *   section and the platform section `app-tools`).
 * @usage cd aimeat && pnpm vitest run test/unit/publish-next-steps-ai-path.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-atelier-ohjaa-teko-lykiihdytykseen-skilli-suora-kirjoitus-ja).
 */
import { describe, it, expect } from 'vitest';
import { aiPathStep, declaresNoAiPath } from '../../src/services/app/ai-path-step.js';
import { ATELIER_AI_PATH_SECTION, AI_PATH_SECTION, APP_TOOLS_SECTION, AI_PATH_NONE_META } from '../../src/services/builder/atelier-ai-path.js';
import { atelierPlatformIds, atelierPlatformPiece } from '../../src/services/builder/atelier-platform.js';
import { buildAtelierPrompt } from '../../src/services/builder/atelier-prompt.js';

const base = { level: undefined, noAiPath: false, toolsCount: 0, boundSkillsCount: 0 };

describe('the ai_path line of the publish answer', () => {
  it('says an app without a skill lets no AI do the work, and points at app-tools', () => {
    const s = aiPathStep(base);
    expect(s.ai_path_tools_count).toBe(0);
    expect(String(s.ai_path)).toMatch(/No bound skill/);
    expect(String(s.ai_path)).toMatch(/build-app-atelier\/app-tools/);
    expect(String(s.ai_path)).toMatch(/which acts the person confirms/);
  });

  it('counts the tools and asks the skill to name them', () => {
    const s = aiPathStep({ ...base, toolsCount: 3, boundSkillsCount: 1 });
    expect(s.ai_path_tools_count).toBe(3);
    expect(String(s.ai_path)).toMatch(/3 app tool\(s\)/);
    expect(String(s.ai_path)).toMatch(/Check that the bound skill says/);
  });

  it('is quiet for a quick prototype and for a declared presentation', () => {
    expect(aiPathStep({ ...base, level: 'proto' })).toEqual({});
    expect(aiPathStep({ ...base, noAiPath: true })).toEqual({});
  });

  it('reads the presentation declaration from the page, and nothing else', () => {
    expect(declaresNoAiPath(`<head>${AI_PATH_NONE_META}</head>`)).toBe(true);
    expect(declaresNoAiPath('<meta name="aimeat-ai-path" content="full">')).toBe(false);
    expect(declaresNoAiPath('<p>aimeat-ai-path none</p>')).toBe(false);
    expect(declaresNoAiPath(undefined)).toBe(false);
  });
});

describe('the Atelier texts that teach the path', () => {
  const full = buildAtelierPrompt({ baseUrl: 'https://node.example' } as never, {}).full;

  it('every Atelier build reads the core section, with the three build styles', () => {
    expect(full).toContain('## How the person\'s own AI uses the app');
    for (const style of ['**AI-accelerated**', '**quick trial**', '**presentation**']) expect(ATELIER_AI_PATH_SECTION).toContain(style);
    expect(ATELIER_AI_PATH_SECTION).toMatch(/build-app-atelier\/ai-path/);
    for (const style of ['**AI-accelerated**', '**Quick trial**', '**Presentation**']) expect(AI_PATH_SECTION).toContain(style);
  });

  it('the platform answers ai-path with the paths, what people keep and what the skill holds', () => {
    expect(atelierPlatformIds()).toContain('ai-path');
    const text = atelierPlatformPiece('ai-path', 'https://node.example')?.text;
    expect(text).toBe(AI_PATH_SECTION);
    expect(AI_PATH_SECTION).toMatch(/What the bound skill holds/);
    expect(AI_PATH_SECTION).toMatch(/aimeat_memory_write/);
    expect(AI_PATH_SECTION).toMatch(/sending anything outward, paying, publishing/);
  });

  it('the platform answers app-tools with the manifest, the extension and the closed space', () => {
    expect(atelierPlatformIds()).toContain('app-tools');
    expect(atelierPlatformPiece('app-tools', 'https://node.example')?.text).toBe(APP_TOOLS_SECTION);
    expect(APP_TOOLS_SECTION).toMatch(/aimeat_app_tools_publish/);
    expect(APP_TOOLS_SECTION).toMatch(/objectTypes\[\]\.extensions/);
    expect(atelierPlatformPiece('platform', 'https://node.example')?.text).toMatch(/`app-tools`/);
  });
});
