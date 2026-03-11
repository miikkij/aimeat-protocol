import type { SystemPromptRecord } from '../storage/interface.js';

/**
 * Replace {{variable_name}} placeholders in prompt content with actual values.
 * Unknown variables are left as-is (not stripped).
 */
export function substituteVariables(
  content: string,
  vars: Record<string, string | number | undefined>,
): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const val = vars[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

/**
 * Resolve prompt content based on Accept-Language header.
 * 1. Exact match: "fi" → locales.fi
 * 2. Language prefix: "fi-FI" → locales.fi
 * 3. Fallback: content (English default)
 * Empty locale override ("") is treated as absent.
 */
export function resolvePromptContent(
  record: SystemPromptRecord,
  acceptLanguage?: string,
): string {
  if (!acceptLanguage || !record.locales) return record.content;
  // Parse first language tag (e.g., "fi-FI,fi;q=0.9,en;q=0.8" → "fi-FI")
  const tag = acceptLanguage.split(',')[0].trim().split(';')[0].trim().toLowerCase();
  if (!tag) return record.content;
  // Exact match
  if (record.locales[tag] && record.locales[tag].length > 0) return record.locales[tag];
  // Language prefix (e.g., "fi-fi" → "fi")
  const lang = tag.split('-')[0];
  if (lang !== tag && record.locales[lang] && record.locales[lang].length > 0) return record.locales[lang];
  return record.content;
}
