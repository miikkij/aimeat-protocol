/**
 * @file strip.ts
 * @description Strip markdown code fences from LLM responses.
 *   Handles single blocks, multi-block (yaml+js), and outer-wrapped blocks.
 * @version-history
 *   v1.0.0 — 2026-04-01 — Ported from public/views/profile/generator-detail.js
 */

/**
 * Strip markdown code fences from an LLM response.
 * Handles: single block, multi-block (yaml+js for extensions), outer-wrapped blocks.
 */
export function stripCodeblock(text: string): string {
  if (!text) return text;
  const trimmed = text.trim();

  const fenceCount = (trimmed.match(/^```/gm) || []).length;

  if (fenceCount === 2) {
    // Try strict match (fence at start and end)
    const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)```\s*$/);
    if (match) return match[1].trim();
    // Fallback: fence may be preceded by explanation text — extract content of the code block
    const looseMatch = trimmed.match(/```[^\n]*\n([\s\S]*?)```/);
    if (looseMatch) return looseMatch[1].trim();
  }

  if (fenceCount > 2) {
    // Check for outer wrapper: ```\n```yaml\n...\n```\n```
    const outerMatch = trimmed.match(/^```\s*\n([\s\S]*)\n```\s*$/);
    if (outerMatch) return outerMatch[1].trim();

    // Extension multi-block: ```yaml\n...\n``` + ```javascript\n...\n```
    const blocks: Array<{ lang: string; content: string }> = [];
    const blockRegex = /```(\w*)\s*\n([\s\S]*?)```/g;
    let match;
    while ((match = blockRegex.exec(trimmed)) !== null) {
      blocks.push({ lang: match[1], content: match[2].trim() });
    }

    if (blocks.length >= 2) {
      const yamlBlock = blocks.find(b => b.lang === 'yaml' || b.lang === 'yml');
      const jsBlocks = blocks.filter(b => b.lang === 'javascript' || b.lang === 'js' || b.lang === '');
      if (yamlBlock && jsBlocks.length > 0) {
        const hasActionMarkers = jsBlocks.some(b => /^\/\/\s*actions\//m.test(b.content));
        if (hasActionMarkers) {
          return yamlBlock.content + '\n' + jsBlocks.map(b => b.content).join('\n');
        }
      }
      return blocks.map(b => b.content).join('\n\n');
    }

    // Fallback for odd fence count: ```yaml\n...YAML...\n```\n...unfenced JS...\n```
    // Common LLM pattern: YAML wrapped in fences, JS unfenced, stray closing fence
    // Strip all ``` lines and return the content
    const stripped = trimmed.replace(/^```\w*\s*$/gm, '').trim();
    if (stripped !== trimmed) return stripped;

    return trimmed;
  }

  return trimmed;
}
