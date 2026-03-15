/**
 * AIMEAT Nodes Service
 * Personal node registration, detachment, visibility.
 */
import { apiGet, api } from '/js/api.js';

/** Cached personal_nodes_enabled flag from bootstrap. */
let _personalEnabled = null;

async function isPersonalEnabled() {
  if (_personalEnabled !== null) return _personalEnabled;
  try {
    const data = await apiGet('/v1/');
    _personalEnabled = !!data?.data?.this_node?.personal_nodes_enabled;
  } catch { _personalEnabled = false; }
  return _personalEnabled;
}

/** Load personal node status. Returns array (0 or 1 node). */
export async function listNodes() {
  try {
    if (!(await isPersonalEnabled())) return [];
    const data = await apiGet('/v1/personal/status');
    return data?.data?.node_id ? [data.data] : [];
  } catch { return []; }
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
