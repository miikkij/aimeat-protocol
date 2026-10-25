/**
 * @file public/js/services/goals.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pages' calls to the agent goal routes (src/routes/goals.ts). One function per route,
 *   nothing decided here: the node decides who may do what.
 * @structure listGoals · getGoal · waitingGoals · createGoal · updateGoal · previewGoal · goalAction ·
 *   deleteGoal · addMaterial · addWork · workAction · answerStep
 * @usage const { goals } = (await listGoals('running')).data;
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { apiGet, apiPost, apiDelete, api } from '/js/api.js';

const at = (id) => `/v1/goals/${encodeURIComponent(id)}`;

export function listGoals(status) { return apiGet(`/v1/goals${status ? `?status=${encodeURIComponent(status)}` : ''}`); }
export function getGoal(id) { return apiGet(at(id)); }
export function waitingGoals() { return apiGet('/v1/goals/waiting'); }
export function createGoal(input) { return apiPost('/v1/goals', input); }
export function updateGoal(id, patch) { return api(at(id), { method: 'PATCH', body: JSON.stringify(patch) }); }
export function previewGoal(id, patch) { return api(at(id), { method: 'PATCH', body: JSON.stringify({ ...patch, preview: true }) }); }
export function goalAction(id, action, reason) { return apiPost(`${at(id)}/actions/${action}`, reason ? { reason } : {}); }
export function deleteGoal(id) { return apiDelete(at(id)); }
export function addMaterial(id, material) { return apiPost(`${at(id)}/material`, material); }
export function addWork(id, work, reason) { return apiPost(`${at(id)}/works`, { action: 'add', work, ...(reason ? { reason } : {}) }); }
export function workAction(id, workId, action, body = {}) { return apiPost(`${at(id)}/works/${encodeURIComponent(workId)}/actions/${action}`, body); }
export function answerStep(id, workId, answer) { return apiPost(`${at(id)}/works/${encodeURIComponent(workId)}/answer`, answer); }
