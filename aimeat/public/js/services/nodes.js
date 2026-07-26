/**
 * @file public/js/services/nodes.js
 * @description Frontend service for personal-node lifecycle: gated by the bootstrap
 *   `personal_nodes_enabled` flag, it lists, anchors (registers), detaches, and changes the
 *   visibility of the owner's personal node via `/v1/personal/*` endpoints.
 *
 * @structure
 *   - isPersonalEnabled: caches the bootstrap flag before any personal-node call
 *   - listNodes: returns the owner's single personal node (or empty array)
 *   - registerNode/detachNode/setVisibility: anchor, delete, and update-visibility actions
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { apiGet, api } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

/** Cached personal_nodes_enabled flag from bootstrap. */
let _personalEnabled = null;

async function isPersonalEnabled() {
  if (_personalEnabled !== null) return _personalEnabled;
  try {
    const data = await apiGet('/');
    _personalEnabled = !!data?.data?.this_node?.personal_nodes_enabled;
  } catch (err) { swallowed('nodes', err); _personalEnabled = false; }
  return _personalEnabled;
}

/** Load personal node status. Returns array (0 or 1 node). */
export async function listNodes() {
  try {
    if (!(await isPersonalEnabled())) return [];
    const data = await apiGet('/v1/personal/status?soft=1');
    return data?.data?.node_id ? [data.data] : [];
  } catch (err) { swallowed('nodes: listNodes', err); return []; }
}

/** Register (anchor) a personal node. */
export async function registerNode(nodeId, ownerName, publicKey, agentGaiis, visibility) {
  let nid = nodeId.trim();
  if (!nid.startsWith('personal-')) nid = 'personal-' + nid;
  return api('/v1/personal/anchor', {
    method: 'POST',
    body: JSON.stringify({
      node_id: nid,
      owner_name: ownerName,
      public_key: publicKey || 'placeholder',
      agent_gaiis: agentGaiis || [],
      visibility: visibility || 'private',
    }),
  });
}

/** Detach (delete) a personal node. */
export async function detachNode(nodeId) {
  return api('/v1/personal/anchor/' + encodeURIComponent(nodeId), { method: 'DELETE' });
}

/** Update a node's visibility. */
export async function setVisibility(nodeId, visibility) {
  return api('/v1/personal/anchor/' + encodeURIComponent(nodeId), {
    method: 'PATCH',
    body: JSON.stringify({ visibility }),
  });
}
