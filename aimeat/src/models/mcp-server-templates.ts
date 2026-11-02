/**
 * @file mcp-server-templates.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Ready-made MCP servers: a person says "Atlassian" and the node knows the address, the
 *   transport and how one signs in, so nobody types or guesses an address. One list, read by every
 *   attach door (POST /v1/mcp-servers, /organism, /node, aimeat_mcp_attach) and by the MCP page,
 *   which sends the template's name rather than a copy of its address.
 *
 *   ON A SHARED SERVER EACH PERSON SIGNS IN THEMSELVES. A template for a team tool everybody already
 *   has an account on (Jira, Confluence) attaches a group's or the node's server with
 *   `per-user-oauth`, so the far side's own permissions and audit apply to each person; a person's
 *   own server signs in once with `oauth`.
 *
 *   A TEMPLATE IS A STARTING POINT, NEVER AN OVERRIDE. A field the caller sent (a name, a title)
 *   wins; the template fills only what was left out. The address is the one exception: it comes from
 *   the template alone, because a template whose address the caller could replace would be a way to
 *   attach any address under a trusted name.
 * @structure McpServerTemplate · MCP_SERVER_TEMPLATES · applyMcpTemplate
 * @usage const t = applyMcpTemplate(body, 'organism'); if (!t.ok) return 400;
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial: Atlassian (wish-jira-ja-confluence-valmiina-atlassian-pohja-ja-oauth-liitos-).
 */

export interface McpServerTemplate {
  /** The short name it is attached under unless the caller names another. */
  name: string;
  title: string;
  description: string;
  url: string;
  transport: 'http' | 'sse';
  /** How a person's own server signs in, and how a shared one does. */
  ownAuth: 'oauth';
  sharedAuth: 'per-user-oauth' | 'oauth';
}

/**
 * The templates. Atlassian's address is the one its own documentation names for Streamable HTTP
 * with OAuth 2.1 (`/v1/mcp/authv2`; the older `/v1/sse` stopped on 2026-06-30). Its protected-resource
 * metadata names auth.atlassian.com, whose RFC 8414 document offers dynamic client registration and
 * S256, which is the walk the MCP client's OAuth half makes (read 2026-11-02). Cloud only.
 */
export const MCP_SERVER_TEMPLATES: Readonly<Record<string, McpServerTemplate>> = Object.freeze({
  atlassian: {
    name: 'atlassian',
    title: 'Atlassian (Jira, Confluence)',
    description: 'Jira issues, Confluence pages and Compass components in Atlassian Cloud, with each person\'s own Atlassian rights.',
    url: 'https://mcp.atlassian.com/v1/mcp/authv2',
    transport: 'http',
    ownAuth: 'oauth',
    sharedAuth: 'per-user-oauth',
  },
});

/** What an attach door takes from a template: the fields filled in, or why the name is unknown. */
export type AppliedTemplate =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * Fill an attach request from its `template`, when it names one. Without `template` the body comes
 * back as it was sent. `where` decides the sign-in: a person's own server signs in once, a group's or
 * the node's lets each person sign in with their own account.
 */
export function applyMcpTemplate(body: Record<string, unknown>, where: 'owner' | 'organism' | 'node'): AppliedTemplate {
  const name = typeof body.template === 'string' ? body.template.trim() : '';
  if (!name) return { ok: true, body };
  const t = MCP_SERVER_TEMPLATES[name];
  if (!t) {
    return { ok: false, message: `There is no ready-made server called "${name}". These are: ${Object.keys(MCP_SERVER_TEMPLATES).join(', ')}.` };
  }
  const filled: Record<string, unknown> = { ...body, url: t.url, transport: t.transport };
  delete filled.token;
  delete filled.header;
  delete filled.peer;
  if (typeof body.name !== 'string' || !body.name) filled.name = t.name;
  if (typeof body.title !== 'string' || !body.title) filled.title = t.title;
  if (typeof body.description !== 'string' || !body.description) filled.description = t.description;
  // A shared server may be told to sign in once for everybody (`oauth`); a person's own never takes
  // per-user-oauth, which is refused at its door.
  if (where === 'owner') filled.auth = t.ownAuth;
  else if (body.auth !== 'oauth') filled.auth = t.sharedAuth;
  return { ok: true, body: filled };
}
