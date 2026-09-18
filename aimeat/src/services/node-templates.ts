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
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { getAppTemplates, getAppTemplateIndex } from '../data/app-templates.js';

const HOW_TO_START = 'This is a starting file the node ships. Write your app on top of `content`: keep its head, its script tags and the way it signs the person in, and replace the body.';

/** One shipped template with its file, or null. The same fields GET /v1/app-templates/:id serves. */
export function nodeTemplateAnswer(id: string): Record<string, unknown> | null {
  const found = getAppTemplates().find(t => t.id === id);
  return found ? { ...found, source: 'node', how_to_start: HOW_TO_START } : null;
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
