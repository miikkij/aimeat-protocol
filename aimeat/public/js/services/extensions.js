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
 * @usage import { listV8Extensions, activateV8Extension } from '/js/services/extensions.js';
 * @version-history
 *   v1.0.0 — 2026-03-14 — Initial V8 extension API service
 */
import { apiGet, apiPost, apiDelete } from '/js/api.js';

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

export async function executeAction(name, actionId, input = {}, instanceId = null) {
  const path = instanceId
    ? `/v1/ext/${encodeURIComponent(name)}/${encodeURIComponent(instanceId)}/${encodeURIComponent(actionId)}`
    : `/v1/ext/${encodeURIComponent(name)}/${encodeURIComponent(actionId)}`;
  return apiPost(path, input);
}
