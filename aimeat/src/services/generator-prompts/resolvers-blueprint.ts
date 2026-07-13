/**
 * @file src/services/generator-prompts/resolvers-blueprint.ts
 * @description Per-prompt resolvers for the blueprint and requirements-interview prompts
 *   (language notes, cortex catalog, interview language instructions). Extracted from
 *   resolvers.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from resolvers.ts (max-file-lines)
 */

import type { PromptRuntimeData } from './types.js';
import type { Vars } from './resolver-helpers.js';

export function resolveBlueprint(data: PromptRuntimeData): Vars {
  const interviewSpec = data.interviewSpec;
  const interviewSpecSection = interviewSpec
    ? `\n## Refined Specification (from requirements interview)\n\`\`\`json\n${JSON.stringify(interviewSpec, null, 2)}\n\`\`\`\n\nUse the specification above to determine the exact components needed. The data sources, entities, views, and constraints have been validated with the user.\n`
    : '';

  const specLocale = (interviewSpec as Record<string, unknown>)?.locale as string | undefined;
  const languageNote = specLocale && specLocale !== 'en'
    ? `\n## LANGUAGE\n\nThe user's language is "${specLocale}". Write all human-readable labels and descriptions in that language.\nJSON keys and technical identifiers stay in English.\n`
    : '';

  // Cortex catalog built from data.cortexCatalog if available
  let cortexCatalog = '';
  const libs = (data as unknown as Record<string, unknown>).cortexCatalog as Array<Record<string, unknown>> | undefined;
  if (libs && libs.length > 0) {
    cortexCatalog = '\n## Available Cortex Libraries (reuse these — do NOT recreate)\n\n' +
      libs.map(lib => {
        const libComps = ((lib.components as Array<Record<string, unknown>>) || []).filter(c => c.type === 'lib');
        const exports = libComps.map(c => (c.exports as string[]) || []).flat();
        const apiSurface = libComps.map(c => (c.api_surface as string) || '').filter(Boolean).join('\n');
        return `### ${lib.name as string} — ${(lib.description as string) || 'no description'}\n- **Exports:** ${exports.join(', ') || 'none'}\n${apiSurface ? `- **API:**\n\`\`\`\n${apiSurface.trim()}\n\`\`\`` : ''}\n- **Load:** \`<script src="/v1/cortex/${lib.name as string}/libs/${(libComps[0]?.filename as string) || (lib.name as string) + '.js'}"></script>\``;
      }).join('\n\n') +
      '\n\nWhen the blueprint\'s cortex component needs an existing library, add a "uses" field listing the library names.\n';
  }

  return {
    description: data.projectDescription || '',
    interview_spec_section: interviewSpecSection,
    language_note: languageNote,
    cortex_catalog: cortexCatalog,
  };
}

export function resolveInterview(data: PromptRuntimeData): Vars {
  const locale = ((data as unknown as Record<string, unknown>).locale as string) || 'en';
  const langMap: Record<string, string> = { fi: 'Finnish (suomi)', en: 'English', sv: 'Swedish (svenska)', de: 'German (Deutsch)', fr: 'French (français)', es: 'Spanish (español)', ja: 'Japanese (日本語)', zh: 'Chinese (中文)' };
  const langName = langMap[locale] || locale;
  const languageInstruction = locale !== 'en'
    ? `\n## LANGUAGE\n\nCONDUCT THIS ENTIRE INTERVIEW IN ${langName.toUpperCase()}.\nAll your questions, summaries, options, and explanations must be in ${langName}.\nThe final JSON specification field values (descriptions, titles, notes) should also be in ${langName}.\nJSON keys and technical identifiers (field names, type values) stay in English.\nInclude "locale": "${locale}" in the output JSON root so downstream prompts continue in the same language.\n`
    : '';

  return {
    description: data.projectDescription || '',
    language_instruction: languageInstruction,
    locale,
  };
}
