/**
 * @file workspaces.ts
 * @description Connector MCP tools for organism WORKSPACES — the local `aimeat connect serve`
 *   counterpart to the server's src/mcp/workspaces.ts. Thin wrappers over the node's REST API
 *   (the routes enforce membership, schema validation, and the publish gate), so crewaimeat-style
 *   agents using `connect serve` get the same list/read/write_draft/publish/add_document surface.
 *   Tool names/descriptions/annotations come from the shared catalog, so they stay in lockstep with
 *   the server and the v2 surface allowlists (appdev/agent/service).
 * @version-history
 *   v1.0.0 -- 2026-06-08 -- Initial: 5 workspace tools as REST wrappers for the connector.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerWorkspaceTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const root = (orgId: string, ws: string) => `organism.${orgId}.w.${ws}`;
  const text = (obj: unknown, isError = false) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }],
    ...(isError ? { isError: true } : {}),
  });

  mcp.tool('aimeat_workspace_list', descriptionFor('aimeat_workspace_list'),
    { organism_id: z.string().describe('Organism id') },
    annotationsFor('aimeat_workspace_list'),
    async ({ organism_id }) => {
      const key = `organism.${organism_id}.meta.workspaces`;
      const resp = await client.get(`/v1/memory?prefix=${encodeURIComponent(key)}`);
      const items = (resp.data as { items?: { key: string; value?: { workspaces?: unknown[] } }[] } | undefined)?.items ?? [];
      const reg = items.find(i => i.key === key);
      return text({ organism_id, workspaces: reg?.value?.workspaces ?? [] });
    });

  mcp.tool('aimeat_workspace_read', descriptionFor('aimeat_workspace_read'),
    { organism_id: z.string(), ws: z.string().describe('Workspace id (from aimeat_workspace_list)') },
    annotationsFor('aimeat_workspace_read'),
    async ({ organism_id, ws }) => {
      const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace?ws=${encodeURIComponent(ws)}`);
      return text(resp.ok === false ? (resp.error ?? resp) : (resp.data ?? resp), resp.ok === false);
    });

  mcp.tool('aimeat_workspace_write_draft', descriptionFor('aimeat_workspace_write_draft'),
    {
      organism_id: z.string(), ws: z.string(),
      namespace: z.string().describe("The objectType's namespace, e.g. shared.deliverables"),
      id: z.string().describe('Instance id (new or existing to overwrite)'),
      value: z.any().describe('The record/document object. Records must match the schema; documents are { id, title, markdown }.'),
    },
    annotationsFor('aimeat_workspace_write_draft'),
    async ({ organism_id, ws, namespace, id, value }) => {
      const v = (value && typeof value === 'object' && !Array.isArray(value)) ? { ...(value as Record<string, unknown>), id } : value;
      const key = `${root(organism_id, ws)}.${namespace}.${id}.draft`;
      const resp = await client.post('/v1/memory', { key, value: v, visibility: 'private' });
      return text(resp.ok === false ? (resp.error ?? resp) : { written: key }, resp.ok === false);
    });

  mcp.tool('aimeat_workspace_publish', descriptionFor('aimeat_workspace_publish'),
    { organism_id: z.string(), ws: z.string(), namespace: z.string(), id: z.string() },
    annotationsFor('aimeat_workspace_publish'),
    async ({ organism_id, ws, namespace, id }) => {
      const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/publish`, { ws, namespace, id });
      return text(resp.ok === false ? (resp.error ?? resp) : (resp.data ?? resp), resp.ok === false);
    });

  mcp.tool('aimeat_workspace_add_document', descriptionFor('aimeat_workspace_add_document'),
    {
      organism_id: z.string(), ws: z.string(),
      type: z.string().describe('Name of a document-mode objectType (a wiki space)'),
      title: z.string(), markdown: z.string(),
      section: z.string().optional().describe('Optional section id/name to file the document under'),
    },
    annotationsFor('aimeat_workspace_add_document'),
    async ({ organism_id, ws, type, title, markdown, section }) => {
      const wsResp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace?ws=${encodeURIComponent(ws)}`);
      const manifest = (wsResp.data as { manifest?: { objectTypes?: { name: string; namespace?: string; mode?: string }[] } } | undefined)?.manifest;
      const ot = (manifest?.objectTypes ?? []).find(o => o.name === type && o.mode === 'document');
      if (!ot || !ot.namespace) return text({ error: `No document space named "${type}" in this workspace.` }, true);
      const docId = 'doc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const key = `${root(organism_id, ws)}.${ot.namespace}.${docId}.draft`;
      const wr = await client.post('/v1/memory', { key, value: { id: docId, title, markdown }, visibility: 'private' });
      if (wr.ok === false) return text(wr.error ?? wr, true);
      if (section) {
        const secKey = `${root(organism_id, ws)}.meta.sections.${type}`;
        const secResp = await client.get(`/v1/memory?prefix=${encodeURIComponent(secKey)}`);
        const secItems = (secResp.data as { items?: { key: string; value?: { sections?: { id: string; name?: string; documents?: string[] }[] } }[] } | undefined)?.items ?? [];
        const sections = secItems.find(i => i.key === secKey)?.value?.sections ?? [];
        const target = sections.find(s => s.id === section || s.name === section);
        if (target) {
          target.documents = [...(target.documents ?? []).filter(d => d !== docId), docId];
          await client.post('/v1/memory', { key: secKey, value: { sections }, visibility: 'private' });
        }
      }
      return text({ written: key, doc_id: docId, type, section: section ?? null });
    });
}
