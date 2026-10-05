/**
 * @file src/tool-dispatch/extension-install.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared extension and cortex HTTP installation, independent of MCP registration.
 * @version-history
 *   2026-10-05 — installCortexOverHttp without a manifest asks POST /v1/cortex for the upload offer,
 *     and refuses update without one in the node's words (secaudit 2026-10, M3).
 *   v1.0.0 -- 2026-09-27 -- Pure extraction from connector MCP.
 */
import { parseDocument } from 'yaml';
import type { AimeatClient, ApiResponse } from './api-client.js';

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
  /** Absent: the presigned upload offer for a ZIP (POST /v1/cortex, mode presigned). */
  manifest?: string;
  libs?: Record<string, unknown>;
  update?: boolean;
}

/**
 * Install a cortex, or redeploy one in place with `update`. POST /v1/cortex is create-only; PUT
 * /v1/cortex/:name replaces the installed cortex without a delete, so the lib keeps being served.
 */
export function installCortexOverHttp(client: AimeatClient, input: CortexInstallInput): Promise<ApiResponse> {
  // No manifest: the upload offer, as the node MCP answers it. update:true belongs to the inline
  // redeploy, so a call that sets it without a manifest is told which path does what (secaudit 2026-10, M3).
  if (!input.manifest) {
    if (input.update) {
      return Promise.resolve({ ok: false, error: { code: 'INVALID_INPUT', message:
        'update:true takes the inline manifest: send the manifest YAML and the libs map in this call. '
        + 'To redeploy from a ZIP, call without update and upload the ZIP: one that carries the name of a cortex you installed replaces it in place.' } });
    }
    return client.post('/v1/cortex', { mode: 'presigned' });
  }
  const body: Record<string, unknown> = { manifest: input.manifest };
  if (input.libs) body.libs = input.libs;
  const name = input.update ? manifestNameOf(input.manifest) : undefined;
  return name
    ? client.put(`/v1/cortex/${encodeURIComponent(name)}`, body)
    : client.post('/v1/cortex', body);
}
