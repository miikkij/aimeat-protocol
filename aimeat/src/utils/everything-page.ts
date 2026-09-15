/**
 * @file everything-page.ts
 * @description Read the build-generated feature guide for the existing public page registry.
 *   Both src/utils and dist/utils resolve to the package's public/data directory. Missing artifacts
 *   fail startup instead of silently serving an incomplete guide. check:everything verifies freshness.
 * @version-history
 *   v1.0.0 - 2026-09-15 - Full feature content for Markdown and initial HTML.
 */
import { readFileSync } from 'node:fs';

export const everythingMarkdown = readFileSync(new URL('../../public/data/everything.md', import.meta.url), 'utf8');
export const everythingHtml = readFileSync(new URL('../../public/data/everything.html', import.meta.url), 'utf8');
