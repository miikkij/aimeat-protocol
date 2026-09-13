/**
 * @file extensions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for extension lifecycle management --
 *   listing, installing, invoking actions, activating, deactivating, and deleting.
 * @structure
 *   - manifestNameOf() -- metadata.name out of a manifest YAML string, the address a redeploy uses
 *   - installExtensionOverHttp() -- install, redeploy (update) and activate over the connector's
 *     HTTP doors. Shared with the CLI dispatch (tool-call-defs-apps.ts) so the two cannot drift.
 *   - installCortexOverHttp() -- the cortex install, and its redeploy through PUT /v1/cortex/:name.
 *     Shared the same way; the connector's cortex MCP registration is its third caller.
 *   - extensionDetailPath() -- GET /v1/extensions/:name, with the scripts when include_source is set
 *   - registerExtensionsTools() -- the connector MCP tools
 * @version-history
 *   v1.3.0 -- 2026-09-13 -- aimeat_extension_install declares update, activate and an optional
 *     manifest. update redeploys through PUT /v1/extensions/:name, activate follows with the activate
 *     route, and no manifest asks POST /v1/extensions for an upload URL carrying both flags. This door
 *     took manifest and scripts only, so zod stripped both flags, an installed name answered 409
 *     ALREADY_EXISTS, and upload mode was unreachable. aimeat_extension_get takes include_source and
 *     reads ?full=true, which answers the scripts only to the installer's own sessions.
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-05-30 -- F10 drift reconciliation: extension_invoke name->extension_name +instance_id
 *     (instance-scoped route); extension_install now takes manifest (YAML string) + scripts map to match
 *     REST ExtensionInstallSchema (connector was sending name + manifest object the route rejects).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { parseDocument } from 'yaml';
import type { AgentRegistry } from '../../agent-registry.js';
import type { AimeatClient, ApiResponse } from '../../api-client.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';
import { envelopeResult } from './_registry.js';

/**
 * The manifest's metadata.name, or undefined when the YAML does not parse or names nothing.
 *
 * A redeploy is addressed by name (PUT /v1/extensions/:name, PUT /v1/cortex/:name) and the name
 * lives inside the manifest, so the caller never has to state it twice. Undefined sends the call to
 * the install route instead, which refuses a broken manifest with the node's own message.
 */
export function manifestNameOf(manifest: string): string | undefined {
  // parseDocument collects YAML errors instead of throwing them. A manifest that does not parse has
  // no name to address, and the install route is the one that tells the caller what is wrong with it.
  const parsed = parseDocument(manifest);
  if (parsed.errors.length) return undefined;
  const doc = parsed.toJS() as { metadata?: { name?: unknown } } | null;
  const name = doc?.metadata?.name;
  return typeof name === 'string' && name.trim() ? name : undefined;
}

const refuse = (code: string, message: string): ApiResponse => ({ ok: false, error: { code, message } });

export interface ExtensionInstallInput {
  manifest?: string;
  scripts?: Record<string, unknown>;
  update?: boolean;
  activate?: boolean;
}

/**
 * Install or redeploy an extension, and activate it when asked, over the doors a connector has.
 *
 * The node's own tool does this in one call (mcp/extensions.ts). Over HTTP it is up to three:
 * POST /v1/extensions never replaces an installed name and reads neither flag, so `update` is PUT
 * /v1/extensions/:name, the redeploy route, and `activate` is the activate route afterwards.
 */
export async function installExtensionOverHttp(client: AimeatClient, input: ExtensionInstallInput): Promise<ApiResponse> {
  const { manifest, scripts, update, activate } = input;
  // Same refusal as the node's tool: scripts with no manifest were meant as an inline install, and
  // answering with an upload URL would drop the code in silence.
  if (!manifest && scripts) {
    return refuse('INVALID_INPUT', 'Inline mode needs BOTH manifest and scripts. Scripts were provided without a manifest, '
      + 'so nothing was installed. Send the manifest YAML too, or omit scripts to get an upload URL for a ZIP.');
  }
  // Upload mode. The flags ride in the upload token, so the PUT of the ZIP honours them.
  if (!manifest) {
    return client.post('/v1/extensions', {
      mode: 'presigned',
      ...(update ? { update: true } : {}),
      ...(activate ? { activate: true } : {}),
    });
  }

  const body: Record<string, unknown> = { manifest };
  if (scripts) body.scripts = scripts;
  const name = update ? manifestNameOf(manifest) : undefined;
  const written = name
    ? await client.put(`/v1/extensions/${encodeURIComponent(name)}`, body)
    : await client.post('/v1/extensions', body);
  if (written.ok === false || !activate) return written;

  const data = (written.data ?? {}) as { extension?: { name?: string; status?: string } };
  if (data.extension?.status === 'active') return written;
  const installedName = data.extension?.name ?? name ?? manifestNameOf(manifest);
  if (!installedName) return written;
  const activated = await client.post(`/v1/extensions/${encodeURIComponent(installedName)}/activate`);
  if (activated.ok === false) {
    return refuse(activated.error?.code ?? 'ACTIVATE_FAILED',
      `Extension "${installedName}" was written, but activating it was refused: ${activated.error?.message ?? 'no reason given'}`);
  }
  const activatedExt = (activated.data as { extension?: unknown } | undefined)?.extension;
  return { ...written, data: { ...data, ...(activatedExt ? { extension: activatedExt } : {}), activated: true } };
}

/** GET /v1/extensions/:name, and ?full=true for the scripts, which the route answers only to the installer. */
export function extensionDetailPath(name: string, includeSource?: boolean): string {
  return `/v1/extensions/${encodeURIComponent(name)}${includeSource ? '?full=true' : ''}`;
}

export interface CortexInstallInput {
  manifest: string;
  libs?: Record<string, unknown>;
  update?: boolean;
}

/**
 * Install a cortex, or redeploy one in place with `update`. POST /v1/cortex is create-only; PUT
 * /v1/cortex/:name replaces the installed cortex without a delete, so the lib keeps being served.
 */
export function installCortexOverHttp(client: AimeatClient, input: CortexInstallInput): Promise<ApiResponse> {
  const body: Record<string, unknown> = { manifest: input.manifest };
  if (input.libs) body.libs = input.libs;
  const name = input.update ? manifestNameOf(input.manifest) : undefined;
  return name
    ? client.put(`/v1/cortex/${encodeURIComponent(name)}`, body)
    : client.post('/v1/cortex', body);
}

export function registerExtensionsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_extension_list', descriptionFor('aimeat_extension_list'), {}, annotationsFor('aimeat_extension_list'), async () => {
    const resp = await client.get('/v1/extensions');
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_extension_invoke', descriptionFor('aimeat_extension_invoke'), {
    extension_name: z.string().describe('Name of the extension to invoke'),
    action_id: z.string().describe('Action identifier'),
    input: z.record(z.string(), z.unknown()).optional().describe('Input parameters'),
    instance_id: z.string().optional().describe('Instance ID for instance-scoped action execution'),
  }, annotationsFor('aimeat_extension_invoke'), async ({ extension_name, action_id, input, instance_id }) => {
    const enc = encodeURIComponent(extension_name);
    const url = instance_id
      ? `/v1/ext/${enc}/${encodeURIComponent(instance_id)}/${encodeURIComponent(action_id)}`
      : `/v1/ext/${enc}/${encodeURIComponent(action_id)}`;
    const resp = await client.post(url, input ?? {});
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_extension_install', descriptionFor('aimeat_extension_install'), {
    manifest: z.string().optional().describe('Extension manifest in YAML format. Omit to get an upload URL for a ZIP bundle.'),
    scripts: z.record(z.string(), z.string()).optional().describe('Map of script filename to JavaScript source code. Omit for upload mode.'),
    update: z.boolean().optional().describe('Redeploy the installed extension of the manifest\'s metadata.name in place. Without this an existing name is an error.'),
    activate: z.boolean().optional().describe('Activate it once installed or updated.'),
  }, annotationsFor('aimeat_extension_install'), async ({ manifest, scripts, update, activate }) => {
    const resp = await installExtensionOverHttp(client, { manifest, scripts, update, activate });
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_extension_activate', descriptionFor('aimeat_extension_activate'), {
    name: z.string().describe('Extension name'),
  }, annotationsFor('aimeat_extension_activate'), async ({ name }) => {
    const resp = await client.post(`/v1/extensions/${encodeURIComponent(name)}/activate`);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_extension_deactivate', descriptionFor('aimeat_extension_deactivate'), {
    name: z.string().describe('Extension name'),
  }, annotationsFor('aimeat_extension_deactivate'), async ({ name }) => {
    const resp = await client.post(`/v1/extensions/${encodeURIComponent(name)}/deactivate`);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_extension_delete', descriptionFor('aimeat_extension_delete'), {
    name: z.string().describe('Extension name'),
  }, annotationsFor('aimeat_extension_delete'), async ({ name }) => {
    const resp = await client.delete(`/v1/extensions/${encodeURIComponent(name)}`);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_extension_get', descriptionFor('aimeat_extension_get'), {
    name: z.string().describe('Extension name'),
    include_source: z.boolean().optional().describe('Also return each action\'s installed script (installer\'s own sessions holding ext:write only).'),
  }, annotationsFor('aimeat_extension_get'), async ({ name, include_source }) => {
    const resp = await client.get(extensionDetailPath(name, include_source));
    return envelopeResult(resp);
  });
}
