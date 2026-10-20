/**
 * @file extensions.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description V8 sandboxed extension API service — list, activate, deactivate,
 *   manage instances, and invoke actions on AIMEAT V8 extensions.
 *   Separate from Cortex extensions (cortex.js) which handle UI/schema bundles.
 * @structure
 *   - listV8Extensions(): list installed V8 extensions
 *   - getV8Extension(name): get extension detail
 *   - activateV8Extension(name): activate extension
 *   - deactivateV8Extension(name): deactivate extension
 *   - deleteV8Extension(name): uninstall extension
 *   - listInstances(name): list instances of an extension
 *   - createInstance(name, config): create a new instance
 *   - deleteInstance(name, instanceId): delete an instance
 *   - getUnattendedReader(name) / setUnattendedReader(name, authority): what the extension reads
 *     when it runs with nobody present
 * @usage import { listV8Extensions, activateV8Extension } from '/js/services/extensions.js';
 * @version-history
 *   v1.1.0 — 2026-10-20 — getUnattendedReader and setUnattendedReader: the account holder's choice of
 *     whose permissions an unattended run reads files with (/v1/extensions/:name/unattended-reader).
 *   v1.0.0 — 2026-03-14 — Initial V8 extension API service
 */
import { apiGet, apiPatch, apiPost, apiDelete } from '/js/api.js';

export async function listV8Extensions() {
  const resp = await apiGet('/v1/extensions');
  return resp?.data?.extensions || [];
}

export async function getV8Extension(name) {
  const resp = await apiGet(`/v1/extensions/${encodeURIComponent(name)}`);
  return resp?.data?.extension || resp?.data || null;
}

export async function activateV8Extension(name) {
  return apiPost(`/v1/extensions/${encodeURIComponent(name)}/activate`);
}

export async function deactivateV8Extension(name) {
  return apiPost(`/v1/extensions/${encodeURIComponent(name)}/deactivate`);
}

export async function deleteV8Extension(name) {
  return apiDelete(`/v1/extensions/${encodeURIComponent(name)}`);
}

export async function listInstances(name) {
  const resp = await apiGet(`/v1/extensions/${encodeURIComponent(name)}/instances`);
  return resp?.data?.instances || [];
}

export async function createInstance(name, id, config = {}) {
  return apiPost(`/v1/extensions/${encodeURIComponent(name)}/instances`, { id, config });
}

export async function deleteInstance(name, instanceId) {
  return apiDelete(`/v1/extensions/${encodeURIComponent(name)}/instances/${encodeURIComponent(instanceId)}`);
}

/**
 * The wire answer of /v1/extensions/:name/unattended-reader in the names the views use. The route
 * answers in snake_case (is_default, installed_by_kind, installed_by_principal, narrowing_is_inert),
 * so the two spellings stop here rather than in every view.
 *
 * `summary` is left out on purpose: the server writes it in English for AI callers, and the page says
 * the same thing in the reader's own language.
 */
function readerView(data) {
  if (!data) return null;
  return {
    name: data.name,
    authority: data.authority === 'installer' ? 'installer' : 'owner',
    isDefault: data.is_default === true,
    installedByKind: data.installed_by_kind || 'unknown',
    installedByPrincipal: data.installed_by_principal || '',
    narrowingIsInert: data.narrowing_is_inert === true,
  };
}

/**
 * What the extension reads when it runs with nobody present. Only the account holder signed in in
 * person reaches this door: an agent or an app grant gets 403.
 */
export async function getUnattendedReader(name) {
  const resp = await apiGet(`/v1/extensions/${encodeURIComponent(name)}/unattended-reader`);
  return readerView(resp?.data);
}

/** `authority`: 'owner' (the account holder's own permissions) or 'installer' (whoever wrote the code). */
export async function setUnattendedReader(name, authority) {
  const resp = await apiPatch(`/v1/extensions/${encodeURIComponent(name)}/unattended-reader`, { authority });
  return readerView(resp?.data);
}

export async function executeAction(name, actionId, input = {}, instanceId = null) {
  const path = instanceId
    ? `/v1/ext/${encodeURIComponent(name)}/${encodeURIComponent(instanceId)}/${encodeURIComponent(actionId)}`
    : `/v1/ext/${encodeURIComponent(name)}/${encodeURIComponent(actionId)}`;
  return apiPost(path, input);
}
