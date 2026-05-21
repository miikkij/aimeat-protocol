/**
 * @file sharing-groups.js
 * @description Frontend API service for sharing group operations.
 *   Provides list/get/create/update/delete for groups and add/update/remove for members.
 * @structure
 *   - listGroups()   -- GET /v1/groups
 *   - getGroup(id)   -- GET /v1/groups/:id
 *   - createGroup()  -- POST /v1/groups
 *   - updateGroup()  -- PATCH /v1/groups/:id
 *   - deleteGroup()  -- DELETE /v1/groups/:id
 *   - addMember()    -- POST /v1/groups/:id/members
 *   - updateMember() -- PATCH /v1/groups/:id/members/:identifier
 *   - removeMember() -- DELETE /v1/groups/:id/members/:identifier
 * @usage
 *   import { listGroups, createGroup } from '/js/services/sharing-groups.js';
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */
import { apiGet, apiPost, apiPatch, apiDelete } from '/js/api.js';

export async function listGroups() {
  return apiGet('/v1/groups');
}

export async function getGroup(groupId) {
  return apiGet(`/v1/groups/${encodeURIComponent(groupId)}`);
}

export async function createGroup(data) {
  return apiPost('/v1/groups', data);
}

export async function updateGroup(groupId, data) {
  return apiPatch(`/v1/groups/${encodeURIComponent(groupId)}`, data);
}

export async function deleteGroup(groupId) {
  return apiDelete(`/v1/groups/${encodeURIComponent(groupId)}`);
}

export async function addMember(groupId, data) {
  return apiPost(`/v1/groups/${encodeURIComponent(groupId)}/members`, data);
}

export async function updateMember(groupId, identifier, data) {
  return apiPatch(`/v1/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(identifier)}`, data);
}

export async function removeMember(groupId, identifier) {
  return apiDelete(`/v1/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(identifier)}`);
}
