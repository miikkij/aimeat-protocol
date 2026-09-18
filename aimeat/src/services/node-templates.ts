/**
 * @file node-templates.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The templates the node ships (shells, components, use cases, genres), shaped for
 *   the doors that until now answered for agent PROPOSALS only.
 *
 *   Every build text says "start from the shell at GET /v1/app-templates". A chat connected over
 *   MCP cannot make that call, and `aimeat_app_template_get` read proposals only, so a cold-agent
 *   build run asked it for `shell-pure-client` and was told the template did not exist
 *   (2026-09-18). One function, read by the MCP tool and by GET /v1/appdev/templates/:id, which is
 *   what the connector's two doors call, so the three cannot answer differently.
 * @structure nodeTemplateAnswer(id) · nodeTemplateIndex() · unknownTemplateMessage(id)
 * @usage const t = nodeTemplateAnswer('shell-pure-client');   // null when the node ships none by that id
 * @version-history
 *   v1.1.0 — 2026-09-19 — A shipped file over 16 000 characters comes one part at a time (`part`).
 *     Five game-genre templates are 26 to 32 kB and did not reach a chat as one tool result.
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { getAppTemplates, getAppTemplateIndex } from '../data/app-templates.js';

const HOW_TO_START = 'This is a starting file the node ships. Write your app on top of `content`: keep its head, its script tags and the way it signs the person in, and replace the body.';

/**
 * The most a template's `content` carries in one answer. Five game-genre templates are 26 to 32 kB,
 * and a tool result of that size does not reach the model in the Claude client (measured
 * 2026-09-18: 18 kB arrived whole, 66 kB was written to a file a chat cannot read). The margin
 * leaves room for the template's other fields and the JSON escaping.
 */
export const MAX_TEMPLATE_CONTENT_CHARS = 16_000;

/** Cut at line ends, so the parts joined with nothing between them are the file again. */
export function splitAtLines(text: string, max: number): string[] {
  const parts: string[] = [];
  let current = '';
  for (const line of text.split(/(?<=\n)/)) {
    if (current && current.length + line.length > max) { parts.push(current); current = ''; }
    // A single line longer than the limit is cut inside the line rather than sent too large.
    for (let rest = line; rest.length; rest = rest.slice(max)) {
      const piece = rest.slice(0, max);
      if (current.length + piece.length > max) { parts.push(current); current = ''; }
      current += piece;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * One shipped template with its file, or null. The same fields GET /v1/app-templates/:id serves.
 * A file over MAX_TEMPLATE_CONTENT_CHARS comes one part at a time: `part` (1-based, default 1)
 * picks it, and `parts` and `how_to_read` say how many there are and how to put them together.
 * A part number the template does not have is answered with `part_error`, not a wrong slice.
 */
export function nodeTemplateAnswer(id: string, part?: number): Record<string, unknown> | null {
  const found = getAppTemplates().find(t => t.id === id);
  if (!found) return null;
  const base = { ...found, source: 'node', how_to_start: HOW_TO_START };
  if (found.content.length <= MAX_TEMPLATE_CONTENT_CHARS) return base;
  const pieces = splitAtLines(found.content, MAX_TEMPLATE_CONTENT_CHARS);
  const wanted = part === undefined ? 1 : part;
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > pieces.length) {
    return { id: found.id, source: 'node', parts: pieces.length, part_error: `This template has parts 1 to ${pieces.length}. Ask for one of them.` };
  }
  return {
    ...base,
    content: pieces[wanted - 1],
    part: wanted,
    parts: pieces.length,
    how_to_read: `The file is ${found.content.length} characters, more than one answer carries, so \`content\` is part ${wanted} of ${pieces.length}. `
      + `Ask again with part: 2${pieces.length > 2 ? ` up to part: ${pieces.length}` : ''}, and join the \`content\` values in order with nothing between them: the cuts are at line ends.`,
  };
}

/**
 * Every shipped template by id, kind and title. Shorter than the index GET /v1/app-templates
 * serves (no description, no library list): with those it is 21 000 characters for 54 templates,
 * which beside the owner's own proposals is more than one tool result reliably carries.
 */
export function nodeTemplateIndex(): Array<{ id: string; kind: string; tier?: string; track?: string; title: string }> {
  return getAppTemplateIndex().map(({ id, kind, tier, track, title }) => ({
    id, kind, ...(tier ? { tier } : {}), ...(track ? { track } : {}), title,
  }));
}

/** What to say when neither a proposal nor a shipped template carries the id. */
export function unknownTemplateMessage(id: string): string {
  const shells = getAppTemplateIndex().filter(t => t.kind === 'app-shell').map(t => t.id).join(', ');
  return `No template "${id}". aimeat_app_template_list names the ones this node ships and the ones proposed here. The shells are: ${shells}.`;
}
