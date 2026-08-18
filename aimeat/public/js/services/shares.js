/**
 * @file shares.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Frontend API service for key-space shares — letting a sharing group read a
 *   pattern of the owner's memory. The group says who; a share says what they reach.
 * @structure
 *   - listOutgoing()        -- GET    /v1/shares            (what I have shared)
 *   - listIncoming()        -- GET    /v1/shares/incoming   (what has been shared with me)
 *   - listForGroup(groupId) -- GET    /v1/groups/:id/shares
 *   - createShare(groupId)  -- POST   /v1/groups/:id/shares
 *   - revokeShare(shareId)  -- DELETE /v1/shares/:id
 * @usage
 *   import { listIncoming, createShare } from '/js/services/shares.js';
 * @version-history
 *   v1.0.0 -- 2026-08-11 -- Initial, alongside the key-space share table.
 */
import { apiGet, apiPost, apiDelete } from '/js/api.js';

export async function listOutgoing() {
  return apiGet('/v1/shares');
}

export async function listIncoming() {
  return apiGet('/v1/shares/incoming');
}

export async function listForGroup(groupId) {
  return apiGet(`/v1/groups/${encodeURIComponent(groupId)}/shares`);
}

export async function createShare(groupId, data) {
  return apiPost(`/v1/groups/${encodeURIComponent(groupId)}/shares`, data);
}

export async function revokeShare(shareId) {
  return apiDelete(`/v1/shares/${encodeURIComponent(shareId)}`);
}

/**
 * The pattern to offer for a key the user picked, as a prefix glob one level up.
 *
 * `news.daily.2026-08-11` suggests `news.daily.**`, because the thing a person means by "share
 * this" is almost always the run of keys it belongs to rather than that one record — and a share
 * covering only today's key would go stale tomorrow, silently, which is the failure this whole
 * feature exists to remove. A key with no dot has no space to widen into, so it is offered exactly.
 */
export function suggestPattern(key) {
  const lastDot = String(key || '').lastIndexOf('.');
  if (lastDot < 1) return String(key || '');
  return `${key.slice(0, lastDot)}.**`;
}

/**
 * Does this pattern cover this key? Mirrors the server's consentMatchPattern: `*` is one segment,
 * `**` is the rest, and every other character is a literal. Kept in step with
 * `src/storage/pattern-utils.ts` — this one only decides what the UI SHOWS as shared; the server
 * decides what is actually readable, and it is the one that counts.
 */
export function patternCoversKey(pattern, key) {
  const regex = String(pattern)
    .split(/([./])/)
    .map(tok => {
      if (tok === '**') return '.*';
      if (tok === '*') return '[^./]+';
      if (tok === '.') return '\\.';
      if (tok === '/') return '/';
      return tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${regex}$`).test(String(key));
}
