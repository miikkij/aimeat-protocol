/**
 * @file organisms.js
 * @description AIMEAT Organisms Service — organism CRUD, membership, join requests, and the
 *   manifest-driven workspace (a "project" is just an organism with a meta.manifest): apply a
 *   template, generate a workspace with AI, read the workspace, write/publish drafts, and
 *   resolve gate approvals.
 * @usage import * as orgService from '/js/services/organisms.js';
 * @version-history
 *   v1.8.0 — 2026-07-16 — Name-invites carry role + workspace grants; addMemberDirect (direct add),
 *     updateInvitation/cancelInvitation (pending name-invites), updateEmailInvitation.
 *   v1.7.0 — 2026-07-13 — Split for max-file-lines: extracted the workspace generator/validation
 *     (organisms.workspace-gen.js), AI access/contract prompts (organisms.prompts.js), Mermaid
 *     charts (organisms.charts.js), image/storage helpers (organisms.images.js), and shared leaf
 *     helpers wsRoot/isMemorySpace/isDocSpace/getObjectSchema (organisms.shared.js). Pure move +
 *     re-export — every previously-exported symbol still resolves from this module.
 *   v1.6.0 — 2026-07-02 — Workspace generator prompt + agent connect prompt teach rich document
 *     markdown: mermaid diagrams and aimeat-memory LIVE data blocks (embed a memory key; fresh on
 *     every open) so AI-authored documentspaces/documents use live embeds instead of static tables.
 *   v1.5.0 — 2026-06-24 — uploadFile(orgId, file): generic blob upload (any document/image) to an
 *     organism's private storage, returning {key,url,mime} — used by the Secretary doc/image intake.
 *   v1.4.0 — 2026-06-23 — Optional color tags: getAllColors()/saveColors() read/write the per-item
 *     color map at …w.{ws}.meta.colors.{type} (mirrors getAllSections/saveSections).
 *   v1.3.0 — 2026-06-22 — Batch endpoints: discoverWorkspaces({include:'enrichment'}) folds the
 *     per-workspace fan-out; new getWaiting() (home widget) and listCommentsBatch() (workspace comments).
 *   v1.2.1 — 2026-06-21 — Decode HTML entities in workspace names on read (listWorkspaces +
 *     discoverWorkspaces) so legacy double-escaped registry names (e.g. "STT &amp; Voice") render
 *     as plain text in the list + breadcrumb.
 *   v1.2.0 — 2026-06-16 — Generator prompt: each objectType gets a one-line "description" and a
 *     matching "type.<name>.desc" i18n key, so generated workspaces are self-describing (the
 *     workspace UI shows the description under each space's title).
 *   v1.1.0 — 2026-06-10 — Generator prompt: per-property "description", "readOnly": true for
 *     agent-filled result fields (never required), "x-default": "currentUser" for requester
 *     fields, and a manifest "i18n" block (en + request language) with flat "{ns}.{field}",
 *     "{ns}.{field}.hint" and "type.{name}" labels the workspace UI renders.
 */
import { api, apiGet, apiPost, apiPut, apiPatch, apiDelete } from '/js/api.js';
import { decodeEntities } from '/js/utils.js';
import { wsRoot, isMemorySpace, isDocSpace } from './organisms.shared.js';
import { mlbl } from './organisms.charts.js';

// ── Re-exports of pieces extracted to sibling modules (pure extraction, max-file-lines) ──
export { wsRoot, isMemorySpace, isDocSpace, getObjectSchema } from './organisms.shared.js';
export {
  PROJECT_OBJECT_TYPES, PROJECT_SCHEMAS, getManifestArchitectPrompt, generatorSystemPrompt,
  buildGeneratorPrompt, parseGenerated, generateRaw, validateGenerated, buildFixPrompt,
  applyGeneratedWorkspace, applyProjectTemplate,
} from './organisms.workspace-gen.js';
export { buildParticipantsMermaid, buildEditFlowMermaid } from './organisms.charts.js';
export { buildAccessPrompt, buildContractAgentPrompt } from './organisms.prompts.js';
export {
  blobToDataUrl, uploadImage, uploadFile, fetchStorageObjectUrl, listStorageVisibilities,
  setImageVisibility, extractStorageImages, applyImageVisibilityUrls,
} from './organisms.images.js';

/** List organisms. */
export async function listOrganisms(opts = {}) {
  const params = new URLSearchParams();
  if (opts.type) params.set('type', opts.type);
  if (opts.city) params.set('city', opts.city);
  if (opts.interest) params.set('interest', opts.interest);
  if (opts.visibility) params.set('visibility', opts.visibility);
  if (opts.member) params.set('member', opts.member);
  if (opts.include) params.set('include', opts.include);   // 'counts' → each org gains workspace_count
  return apiGet(`/v1/organisms?${params.toString()}`);
}

/** Get organism detail. */
export async function getOrganism(id) {
  return apiGet(`/v1/organisms/${encodeURIComponent(id)}`);
}

/** Create a new organism. */
export async function createOrganism(data) {
  return apiPost('/v1/organisms', data);
}

/** Update organism. */
export async function updateOrganism(id, data) {
  return api(`/v1/organisms/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** Delete organism. */
export async function deleteOrganism(id) {
  return apiDelete(`/v1/organisms/${encodeURIComponent(id)}`);
}

/** Join an organism. */
export async function joinOrganism(id, message) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/join`, { message });
}

/** Leave an organism. */
export async function leaveOrganism(id) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/leave`, {});
}

/** List members. Optional status filter ('active' | 'banned' | 'invited' | 'pending'). */
export async function listMembers(id, status) {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiGet(`/v1/organisms/${encodeURIComponent(id)}/members${q}`);
}

/** List join requests (admin only). */
export async function listJoinRequests(id) {
  return apiGet(`/v1/organisms/${encodeURIComponent(id)}/join-requests`);
}

/** Review join request (approve/reject). */
export async function reviewJoinRequest(organismId, requestId, decision) {
  return apiPost(`/v1/organisms/${encodeURIComponent(organismId)}/join-requests/${encodeURIComponent(requestId)}/review`, { decision });
}

/** "Waiting for you" — pending reviews + join-requests + invitations aggregated across the caller's
 *  member organisms in ONE request (replaces the home widget's per-org listApprovals/listJoinRequests/
 *  listWorkspaces fan-out). Returns the flat `items` array ({kind:'review'|'join'|'invite', …}). */
export async function getWaiting() {
  try {
    const resp = await apiGet('/v1/organisms/waiting');
    return Array.isArray(resp?.data?.items) ? resp.data.items : [];
  } catch { return []; }
}

/** Agent activity aggregated across every readable workspace in ONE request (organism Agents tab).
 *  Returns { agentName: { count, lastAt, workspaces:[names] } } (replaces per-workspace activity fetches). */
export async function getAgentsActivity(orgId) {
  try {
    const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/agents/activity`);
    return resp?.data?.agents || {};
  } catch { return {}; }
}

/** List the comment thread on a workspace object (record or document). */
export async function listComments(orgId, ws, space, instanceId) {
  const params = new URLSearchParams({ ws, space, instance_id: instanceId });
  return apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/comments?${params.toString()}`);
}

/** Composite key the comments-batch response is keyed by (NUL-joined, never collides with any id). */
export const commentBatchKey = (ws, space, instanceId) => `${ws}\u0000${space}\u0000${instanceId}`;

/** Fetch comment threads for MANY workspace objects in one POST (body, not URL params, so a long
 *  target list never bloats the URL). Returns the raw `{ "ws\0space\0id": {comments,total} }` map. */
export async function listCommentsBatch(orgId, instances) {
  try {
    const resp = await apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/comments/batch`, { instances });
    return (resp?.data?.comments) || {};
  } catch { return {}; }
}

/** Add a comment to a workspace object. anchor: { section?|quote? }; parentId for a threaded reply. */
export async function addComment(orgId, { ws, space, instanceId, body, anchor, parentId }) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/comments`, { ws, space, instance_id: instanceId, body, anchor, parent_id: parentId });
}

/** Delete a comment (author or creator/admin). */
export async function deleteComment(orgId, commentId, ws, space, instanceId) {
  const params = new URLSearchParams({ ws, space, instance_id: instanceId });
  return apiDelete(`/v1/organisms/${encodeURIComponent(orgId)}/comments/${encodeURIComponent(commentId)}?${params.toString()}`);
}

/** Search records + documents across the organism's readable workspaces. Optional ws filter. */
export async function searchOrganism(id, q, ws) {
  const params = new URLSearchParams({ q });
  if (ws) params.set('ws', ws);
  return apiGet(`/v1/organisms/${encodeURIComponent(id)}/search?${params.toString()}`);
}

/** Remove (revoke) a member's organism access. Creator/admin only. Pass ban=true to block re-join. */
export async function removeMember(id, memberGhii, ban = false) {
  const suffix = ban ? '?ban=1' : '';
  return apiDelete(`/v1/organisms/${encodeURIComponent(id)}/members/${encodeURIComponent(memberGhii)}${suffix}`);
}

/** Lift a ban on a previously-blocked owner. Creator/admin only. */
export async function unbanMember(id, memberGhii) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/members/${encodeURIComponent(memberGhii)}/unban`, {});
}

/** Transfer ownership to an existing active member. Creator only. */
export async function transferOwnership(id, toGhii) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/transfer`, { to: toGhii });
}

/** Invite an owner by bare name, optionally with an org role + invite-time workspace grants
 *  ({ role: 'member'|'admin', workspaces: [{ws, role: 'viewer'|'contributor'}] }). Creator/admin only. */
export async function inviteMember(id, invitee, opts = {}) {
  const body = { invitee };
  if (opts.role) body.role = opts.role;
  if (Array.isArray(opts.workspaces) && opts.workspaces.length) body.workspaces = opts.workspaces;
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/invitations`, body);
}

/** DIRECT ADD: make an existing local owner an ACTIVE member immediately (role + workspace grants
 *  applied, no accept round-trip; the member is notified and can leave). Creator/admin only. */
export async function addMemberDirect(id, ghii, opts = {}) {
  const body = { ghii };
  if (opts.role) body.role = opts.role;
  if (Array.isArray(opts.workspaces) && opts.workspaces.length) body.workspaces = opts.workspaces;
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/members`, body);
}

/** Edit a PENDING name invitation's role/workspace grants. Creator/admin only. */
export async function updateInvitation(id, invitee, updates) {
  return apiPatch(`/v1/organisms/${encodeURIComponent(id)}/invitations/${encodeURIComponent(invitee)}`, updates);
}

/** Withdraw a PENDING name invitation. Creator/admin only. */
export async function cancelInvitation(id, invitee) {
  return apiDelete(`/v1/organisms/${encodeURIComponent(id)}/invitations/${encodeURIComponent(invitee)}`);
}

/** Edit a PENDING email invitation's role/workspace grants. Creator/admin only. */
export async function updateEmailInvitation(id, invId, updates) {
  return apiPatch(`/v1/organisms/${encodeURIComponent(id)}/invitations/email/${encodeURIComponent(invId)}`, updates);
}

/** List outstanding (pending) invitations for an organism. Creator/admin only. */
export async function listInvitations(id) {
  return apiGet(`/v1/organisms/${encodeURIComponent(id)}/invitations`);
}

/** The caller's own pending invitations across all organisms. */
export async function listMyInvitations() {
  return apiGet('/v1/organisms/invitations/mine');
}

/** Accept an invitation to an organism. */
export async function acceptInvitation(id) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/invitations/accept`, {});
}

/** Decline an invitation to an organism. */
export async function declineInvitation(id) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/invitations/decline`, {});
}

/** Invite an external EMAIL (person not yet on the node) into an organism + optional workspaces.
 *  Creator/admin only. payload: { email, orgRole?, workspaces?: [{ ws, role }], message?, expiresInDays? }.
 *  Returns { invitation, email_sent, accept_url } — accept_url is shareable if email is not configured. */
export async function inviteByEmail(id, payload) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/invitations/email`, payload);
}

/** List pending EMAIL invitations for an organism. Creator/admin only. */
export async function listEmailInvitations(id) {
  return apiGet(`/v1/organisms/${encodeURIComponent(id)}/invitations/email`);
}

/** Cancel a pending EMAIL invitation before it is used. Creator/admin only. */
export async function cancelEmailInvitation(id, invId) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/invitations/email/${encodeURIComponent(invId)}/cancel`, {});
}

/** Attach one of your own agents (GAII) to an organism you belong to. */
export async function attachAgent(id, agentGaii) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/agents`, { agent_gaii: agentGaii });
}

/** Detach an agent from an organism. Agent owner or organism admin. */
export async function detachAgent(id, agentGaii) {
  return apiDelete(`/v1/organisms/${encodeURIComponent(id)}/agents/${encodeURIComponent(agentGaii)}`);
}

/** Add admin. */
export async function addAdmin(id, targetGhii) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/admins`, { target_ghii: targetGhii });
}

/** Remove admin. */
export async function removeAdmin(id, ghii) {
  return apiDelete(`/v1/organisms/${encodeURIComponent(id)}/admins/${encodeURIComponent(ghii)}`);
}

/** Archive / unarchive organism content (creator/admin). `target` = { level, ws?, namespace?, key? }.
 *  Archived content is read-only and hidden from AI materials (overview/read/search) but stays in the
 *  archive search; archiving a container cascades, unarchiving uses smart restore. */
export async function archiveContent(orgId, target) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/archive`, target);
}
export async function unarchiveContent(orgId, target) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/unarchive`, target);
}

/** Delete a workspace entirely — removes all organism.{id}.* memory + its schema locks. The
 *  organism stays (returns to "no workspace yet"). Deliberate typed-confirmation lives in the UI. */
export async function deleteWorkspace(orgId, wsId) {
  const r = await apiDelete(`/v1/organisms/${encodeURIComponent(orgId)}/workspace?ws=${encodeURIComponent(wsId)}`);
  // Drop the registry entry so the deleted workspace no longer lists.
  const list = await listWorkspaces(orgId);
  await saveWorkspaceRegistry(orgId, list.filter(w => w.id !== wsId)).catch(() => {});
  return r;
}

/** Participants of a workspace — node → owner → agents, derived from record traces + membership.
 *  Agent names are revealed only for the caller's own agents (others come back anonymized). */
export async function getWorkspaceParticipants(orgId, wsId) {
  try {
    const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/participants?ws=${encodeURIComponent(wsId)}`);
    return r?.data || { nodes: [], viewerOwner: '' };
  } catch { return { nodes: [], viewerOwner: '' }; }
}

/** Activity feed for a workspace (who did what / where / draft-edit vs publish / when). */
export async function getWorkspaceActivity(orgId, wsId) {
  try {
    const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/activity?ws=${encodeURIComponent(wsId)}`);
    return r?.data || { events: [], total: 0 };
  } catch { return { events: [], total: 0 }; }
}

/** Read the manifest-driven workspace. Returns null if the workspace has no manifest yet. */
export async function getWorkspace(orgId, wsId, opts) {
  let url = `/v1/organisms/${encodeURIComponent(orgId)}/workspace?ws=${encodeURIComponent(wsId)}`;
  if (opts?.archived === 'only') url += '&archived=only';
  else if (opts?.includeArchived) url += '&includeArchived=true';
  const resp = await apiGet(url);
  return resp?.data || null;
}

/** OKF-style STRUCTURE OVERVIEW (Markdown) of the whole organism — every workspace's space
 *  breakdown + totals, deterministic, size-bounded. Returns '' on failure (caller shows a notice). */
export async function getOrganismOverview(orgId) {
  try {
    const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/overview`);
    return r?.data?.markdown || '';
  } catch { return ''; }
}

/** OKF-style STRUCTURE OVERVIEW (Markdown) of ONE workspace — per space the most-recent entries
 *  (ids + titles) and totals. Returns '' on failure. */
export async function getWorkspaceOverview(orgId, wsId) {
  try {
    const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/overview?ws=${encodeURIComponent(wsId)}`);
    return r?.data?.markdown || '';
  } catch { return ''; }
}

/** Full workspace overview payload in ONE call: the OKF markdown PLUS the measurability `objectives`
 *  (each KPI with its resolved `current` — computed from records where the source allows, else the
 *  declared value). Lets a caller render both the table-of-contents seed and the objectives card
 *  without two requests to the same endpoint. Returns safe empties on failure. */
export async function getWorkspaceOverviewFull(orgId, wsId) {
  try {
    const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/overview?ws=${encodeURIComponent(wsId)}`);
    return { markdown: r?.data?.markdown || '', objectives: Array.isArray(r?.data?.objectives) ? r.data.objectives : [], readable: r?.data?.readable !== false };
  } catch { return { markdown: '', objectives: [], readable: false }; }
}

/** Deterministic GRAPH of the whole organism (workspaces → spaces + counts/last-activity, members,
 *  agents) — the data behind the interactive mindmap. Returns null on failure. */
export async function getOrganismGraph(orgId) {
  try {
    const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/graph`);
    return r?.data?.graph || null;
  } catch { return null; }
}

/** Deterministic GRAPH of ONE workspace (root = workspace, with its spaces). Returns null on failure. */
export async function getWorkspaceGraph(orgId, wsId) {
  try {
    const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/graph?ws=${encodeURIComponent(wsId)}`);
    return r?.data?.graph || null;
  } catch { return null; }
}

/** Organism STRUCTURE TIMELINE: { current, history } — the trackable structure fingerprint's current
 *  value + archived prior versions (newest first). Returns { current: null, history: [] } on failure. */
export async function getStructureHistory(orgId) {
  try {
    const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/structure/history`);
    return r?.data || { current: null, history: [] };
  } catch { return { current: null, history: [] }; }
}

/** Save a workspace's free-form README (markdown). Creator/admin only (enforced server-side). */
export async function saveWorkspaceReadme(orgId, wsId, readme) {
  return apiPut(`/v1/organisms/${encodeURIComponent(orgId)}/workspace?ws=${encodeURIComponent(wsId)}`, { ws: wsId, readme });
}

/** Replace the workspace's pinned-apps list (FULL replace; [] clears). Each entry references a
 *  published app ({ owner, filename, label? }). Creator/admin only (enforced server-side). */
export async function saveWorkspaceApps(orgId, wsId, apps) {
  return apiPut(`/v1/organisms/${encodeURIComponent(orgId)}/workspace?ws=${encodeURIComponent(wsId)}`, { ws: wsId, apps });
}

/** Overwrite a workspace's manifest (e.g. edited name/summary/policy from Settings). */
export async function saveManifest(orgId, wsId, manifest) {
  return apiPost('/v1/memory', { key: `${wsRoot(orgId, wsId)}.meta.manifest`, value: manifest, visibility: 'private' });
}

/* ── Workspace registry: one organism lists its workspaces at organism.{id}.meta.workspaces =
 *    { workspaces: [{ id, name, createdAt }] }. A workspace appears here even before it has a
 *    manifest (so a freshly-created, not-yet-generated workspace is openable). ── */

/** List an organism's workspaces (registry order). */
export async function listWorkspaces(orgId) {
  const key = `organism.${orgId}.meta.workspaces`;
  try {
    const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(key)}`);
    const item = (resp?.data?.items || []).find(i => i.key === key);
    const list = Array.isArray(item?.value?.workspaces) ? item.value.workspaces : [];
    // Names are plain text; legacy import paths stored them HTML-escaped. Decode for display.
    return list.map(w => (w && w.name ? { ...w, name: decodeEntities(w.name) } : w));
  } catch { return []; }
}

/** Persist the workspace registry. */
export async function saveWorkspaceRegistry(orgId, workspaces) {
  return apiPost('/v1/memory', { key: `organism.${orgId}.meta.workspaces`, value: { workspaces }, visibility: 'private' });
}

/* ── Workspace access (per-workspace, creator-controlled, consent-backed) ──
 * Organism membership lets you DISCOVER every workspace (names + creator + your access status);
 * reading a workspace's content needs the creator's approval. ── */

/** Discover all workspaces in the org with your access status ('owner' | 'granted' | 'none').
 *  opts.include='enrichment' folds the per-workspace getWorkspace+activity+participants fan-out into
 *  one response: each readable row gains `enrichment:{hasManifest,recs,docs,lastEvent,participants,pendingReviews}`. */
export async function discoverWorkspaces(orgId, opts = {}) {
  try {
    const qs = opts.include ? `?include=${encodeURIComponent(opts.include)}` : '';
    const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspaces${qs}`);
    const list = Array.isArray(resp?.data?.workspaces) ? resp.data.workspaces : [];
    // Names are plain text; legacy import paths stored them HTML-escaped. Decode for display.
    return list.map(w => (w && w.name ? { ...w, name: decodeEntities(w.name) } : w));
  } catch { return []; }
}

/** Request access to a workspace you can see but not read. */
export async function requestWorkspaceAccess(orgId, ws, message) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/workspace-access`, { ws, message: message || '' });
}

/** List access requests for a workspace you created (creator/admin only). */
export async function listWorkspaceRequests(orgId, ws) {
  try {
    const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace-access?ws=${encodeURIComponent(ws)}`);
    return Array.isArray(resp?.data?.requests) ? resp.data.requests : [];
  } catch { return []; }
}

/** Approve or deny a member's access request to your workspace. decision: 'approve'|'deny'|'viewer'|'contributor'. */
export async function decideWorkspaceAccess(orgId, ws, requester, decision) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/workspace-access/decision`, { ws, requester, decision });
}

/** Full access state for a workspace you manage: pending requests + current members with their roles. */
export async function getWorkspaceAccess(orgId, ws) {
  try {
    const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace-access?ws=${encodeURIComponent(ws)}`);
    return { requests: Array.isArray(resp?.data?.requests) ? resp.data.requests : [], members: Array.isArray(resp?.data?.members) ? resp.data.members : [] };
  } catch { return { requests: [], members: [] }; }
}

/** Access rosters for ALL of my owned workspaces in one request (Members tab — replaces a per-owned-
 *  workspace getWorkspaceAccess fan-out). Returns [{ ws, name, members, requests }]. */
export async function getWorkspaceAccessAll(orgId) {
  try {
    const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace-access?all=1`);
    return Array.isArray(resp?.data?.workspaces) ? resp.data.workspaces : [];
  } catch { return []; }
}

/** Directly add (or re-role) a member: role 'viewer' (read) | 'contributor' (read+write). grantee = an
 *  owner name, GHII, or GAII — the grant applies to that owner (so all their agents inherit it). */
export async function grantWorkspaceRole(orgId, ws, grantee, role) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/workspace-access/grant`, { ws, grantee, role });
}

/** Remove a member's access to a workspace you manage. */
export async function revokeWorkspaceRole(orgId, ws, grantee) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/workspace-access/revoke`, { ws, grantee });
}

/* ── Contract engagements — the first-class (agent × contract × workspace) binding with an
 * active/retired lifecycle. Adopt writes `active`; Retire flips to `retired` (kept as history).
 * Distinct from the derived "active here" trace: the engagement is the deactivatable INTENT. ── */

/** List the contract engagements declared in a workspace (active + retired). Returns array. */
export async function getWorkspaceEngagements(orgId, ws) {
  try {
    const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/engagements?ws=${encodeURIComponent(ws)}`);
    return Array.isArray(resp?.data?.engagements) ? resp.data.engagements : [];
  } catch { return []; }
}

/** Activate (adopt) a contract engagement for one of your agents. `agent` = full GAII. */
export async function activateEngagement(orgId, ws, agent, contract) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/engagements`, { ws, agent, contract });
}

/** Retire a contract engagement — the agent's loop then skips this workspace (real off-switch).
 *  Allowed for the agent's owner or the workspace creator. `agent` = full GAII. */
export async function retireEngagement(orgId, ws, agent, contract) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/engagements/retire`, { ws, agent, contract });
}

/* ── Public document-space sharing (meta.share) ──
 * Independent of the access roles above: this controls what PUBLISHED document-space pages are
 * readable by ANYONE with the public viewer link (no login). Creator/admin manages it. ── */

const normalizeShare = (s) => ({
  public: !!s.public, spaces: s.spaces || {}, docs: s.docs || {},
  access: s.access === 'password' || s.access === 'account' ? s.access : 'open',
  has_password: !!s.has_password,
});

/** Current public-sharing state:
 *  { public, spaces: {name:bool}, docs: {"type/id":bool}, access: 'open'|'password'|'account', has_password }. */
export async function getWorkspaceShare(orgId, ws) {
  try {
    const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/share?ws=${encodeURIComponent(ws)}`);
    return normalizeShare(resp?.data?.share || {});
  } catch { return normalizeShare({}); }
}

/** Merge a patch ({ public?, spaces?, docs?, access?, password? }) into the workspace's public-sharing
 *  state. `password` string sets a new share password (the server stores only a scrypt hash and
 *  responses carry only has_password), null clears it, absent keeps the previous one. */
export async function setWorkspaceShare(orgId, ws, patch) {
  const resp = await apiPut(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/share?ws=${encodeURIComponent(ws)}`, patch);
  return normalizeShare(resp?.data?.share || {});
}

/** The public, no-login viewer URL for a workspace (whole space) or a single document. */
export function publicViewerUrl(orgId, ws, doc) {
  const base = `/v1/publicworkspaceviewer?org=${encodeURIComponent(orgId)}&ws=${encodeURIComponent(ws)}`;
  return doc ? `${base}&type=${encodeURIComponent(doc.type)}&id=${encodeURIComponent(doc.id)}` : base;
}

/** Create a new (empty) workspace: register it, return its { id, name }. The manifest is written
 *  later by setup/generate. */
export async function createWorkspace(orgId, name) {
  const id = 'ws-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const createdBy = (currentGhii().split('@')[0]) || '';   // bare owner name — who controls this workspace's access
  const entry = { id, name: String(name || '').trim() || 'Workspace', createdAt: new Date().toISOString(), createdBy };
  const list = await listWorkspaces(orgId);
  await saveWorkspaceRegistry(orgId, [...list, entry]);
  return entry;
}

/** kebab-case a free-typed name into a safe namespace segment / type name. */
function slug(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

/** Chart 1 — organism dependency overview: who/what uses this organism. Async (aggregates members,
 *  agents, workspaces + their structure, and knowledge packages). Returns Mermaid source text. */
export async function buildOrganismOverviewMermaid(orgId) {
  const nodeId = (currentGhii().split('@')[1]) || '';
  const [orgResp, memResp, wsList] = await Promise.all([
    getOrganism(orgId).catch(() => null),
    listMembers(orgId).catch(() => null),
    listWorkspaces(orgId).catch(() => []),
  ]);
  const org = orgResp?.data?.organism || {};
  const members = memResp?.data?.members || [];
  const agents = org.agentGaiis || [];
  const wsData = [];
  for (const w of wsList) {
    const ws = await getWorkspace(orgId, w.id).catch(() => null);
    const sources = await getWorkspaceSources(orgId, w.id).catch(() => []);
    const types = (ws?.manifest?.objectTypes || []).filter(isMemorySpace)
      .map(o => `${o.name} (${isDocSpace(o) ? 'doc' : 'rec'})`);
    const knowledge = sources.filter(s => s.type === 'knowledge').map(s => s.label || s.packageId);
    wsData.push({ name: w.name || w.id, types, knowledge });
  }

  const nodes = [`  ORG(["🏢 ${mlbl(org.name || orgId)}"])`];
  const edges = [];
  const externalIds = new Set();

  if (members.length) {
    nodes.push('  subgraph USERS["👥 Users"]', '  direction TB');
    members.forEach((m, i) => {
      // External = a member whose GHII names a DIFFERENT node (federated). Local members are keyed by
      // the bare owner name (no @node), so only an explicit @other-node counts as external.
      const isExt = !!m.ghii && m.ghii.includes('@') && !!nodeId && !m.ghii.endsWith('@' + nodeId);
      if (isExt) externalIds.add('U' + i);
      nodes.push(`    U${i}["👤 ${mlbl(m.ghii)}${m.role ? ' · ' + mlbl(m.role) : ''}${isExt ? ' · 🌐 external' : ''}"]`);
    });
    nodes.push('  end');
    members.forEach((m, i) => edges.push(externalIds.has('U' + i) ? `  U${i} -. consent .-> ORG` : `  U${i} --> ORG`));
  }
  if (agents.length) {
    nodes.push('  subgraph AGENTS["🤖 Agents"]', '  direction TB');
    agents.forEach((a, i) => nodes.push(`    A${i}["🤖 ${mlbl(a)}"]`));
    nodes.push('  end');
    agents.forEach((a, i) => edges.push(`  A${i} --> ORG`));
  }

  const kmap = new Map();   // knowledge label -> node id
  for (const w of wsData) for (const k of w.knowledge) if (!kmap.has(k)) kmap.set(k, 'K' + kmap.size);
  if (kmap.size) {
    nodes.push('  subgraph KNOWLEDGE["📚 Knowledge packages"]', '  direction TB');
    for (const [label, kid] of kmap) nodes.push(`    ${kid}["📚 ${mlbl(label)}"]`);
    nodes.push('  end');
  }
  if (wsData.length) {
    nodes.push('  subgraph WORKSPACES["🗂️ Workspaces"]', '  direction TB');
    wsData.forEach((w, i) => {
      nodes.push(`    W${i}["🗂️ ${mlbl(w.name)}"]`);
      if (w.types.length) nodes.push(`    W${i}S["${mlbl(w.types.join(' · '))}"]`);
    });
    nodes.push('  end');
    wsData.forEach((w, i) => {
      edges.push(`  ORG --> W${i}`);
      if (w.types.length) edges.push(`  W${i} --> W${i}S`);
      for (const k of w.knowledge) edges.push(`  W${i} -. uses .-> ${kmap.get(k)}`);
    });
  }
  if (!members.length && !agents.length && !wsData.length) {
    edges.push('  EMPTY["No members, agents or workspaces yet"] --> ORG');
  }
  return ['graph LR', ...nodes, ...edges].join('\n');
}

/** Manually add an object type to the manifest (no AI). mode 'document' needs no schema;
 *  'records' gets a starter {id,title} schema that can be refined later via Restructure. */
export async function addSpace(orgId, wsId, manifest, name, mode) {
  const base = slug(name);
  const plural = base.endsWith('s') ? base : base + 's';
  const existing = new Set((manifest.objectTypes || []).map(o => o.namespace));
  let namespace = `shared.${plural}`;
  for (let i = 2; existing.has(namespace); i++) namespace = `shared.${plural}-${i}`;
  const ot = { name: base, schemaRef: `schema:${base}@1`, namespace, backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode };
  if (mode === 'records') {
    await apiPut(`/v1/memory/${encodeURIComponent(`${wsRoot(orgId, wsId)}.${namespace}`)}/schema`, {
      schema: { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' } } },
      apply_to: 'prefix', schema_mode: 'open',   // tolerate extra fields; enforce required/types only (see applyGeneratedWorkspace)
    });
  }
  return saveManifest(orgId, wsId, { ...manifest, objectTypes: [...(manifest.objectTypes || []), ot] });
}

/** Remove an object type from the manifest by name. Its data is left in memory (orphaned, not
 *  deleted) — re-adding the type surfaces it again; a full wipe is the workspace-delete path. */
export async function removeSpace(orgId, wsId, manifest, typeName) {
  return saveManifest(orgId, wsId, { ...manifest, objectTypes: (manifest.objectTypes || []).filter(o => o.name !== typeName) });
}

/** Write/overwrite an object's draft (`…w.{wsId}.{namespace}.{id}.draft`). */
export async function writeDraft(orgId, wsId, namespace, instanceId, value) {
  return apiPost('/v1/memory', { key: `${wsRoot(orgId, wsId)}.${namespace}.${instanceId}.draft`, value, visibility: 'private' });
}

/** Publish a draft → new version + latest (or a pending approval if the publish gate is on). */
export async function publishDraft(orgId, wsId, namespace, instanceId) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/publish`, { ws: wsId, namespace, id: instanceId });
}

/** Reopen a published record for editing: server copies `.latest` → `.draft` (409 if a draft already
 *  exists). The published version stays live until the edited draft is re-published. */
export async function revertToDraft(orgId, wsId, namespace, instanceId) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/revert`, { ws: wsId, namespace, id: instanceId });
}

/** Delete one workspace object (record or document) — the bare record key, its draft, published
 *  .latest and all .version.N history. Returns the number of keys removed. Prefix `${base}` (no
 *  trailing dot) catches the bare un-suffixed key (which the workspace read surfaces as current);
 *  the per-row guard excludes sibling ids. limit=200 is the REST cap — re-run for a huge version
 *  history (idempotent). */
export async function deleteWorkspaceObject(orgId, wsId, namespace, id) {
  const base = `${wsRoot(orgId, wsId)}.${namespace}.${id}`;
  const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(base)}&limit=200`);
  const items = (resp?.data?.items) || [];
  let deleted = 0;
  for (const it of items) {
    if (it.key !== base && !it.key.startsWith(base + '.')) continue;  // exclude sibling ids
    const role = it.key === base ? '' : it.key.slice(base.length + 1);
    if (role === '' || role === 'draft' || role === 'latest' || /^version\.\d+$/.test(role)) {
      try { await apiDelete(`/v1/memory/${encodeURIComponent(it.key)}`); deleted++; } catch { /* skip */ }
    }
  }
  return deleted;
}

/** List pending approvals (the gate inbox). */
export async function listApprovals(orgId, status = 'pending') {
  const resp = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/approvals${status ? `?status=${status}` : ''}`);
  return resp?.data?.approvals || [];
}

/** Resolve an approval (approve | reject | edit). */
export async function resolveApproval(orgId, aid, decision, note) {
  return apiPost(`/v1/organisms/${encodeURIComponent(orgId)}/approvals/${encodeURIComponent(aid)}`, { decision, note });
}

/** Read the runtime config entry (publish gate toggle, etc.). Uses prefix-list to avoid 404 noise. */
export async function getConfig(orgId) {
  const key = `organism.${orgId}.meta.config`;
  try {
    const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(key)}`);
    return (resp?.data?.items || []).find(i => i.key === key)?.value || {};
  } catch { return {}; }
}

/** The current owner's GHII (`owner@node`). ALWAYS returns a string so callers can safely `.split('@')`.
 *  Prefers the synchronous `auth.storedGhii` accessor; falls back to a sync `getSession()` only when it
 *  returns a session object with a string `ghii` (on some builds `getSession()` is async / returns a
 *  Promise — never return that, or `.split` blows up at call sites). Empty string when unknown. */
export function currentGhii() {
  const auth = (typeof window !== 'undefined' && window.AIMEAT && window.AIMEAT.auth) || null;
  if (!auth) return '';
  if (typeof auth.storedGhii === 'string' && auth.storedGhii) return auth.storedGhii;
  try {
    const s = typeof auth.getSession === 'function' ? auth.getSession() : null;
    if (s && typeof s === 'object' && typeof s.ghii === 'string') return s.ghii;
  } catch { /* ignore */ }
  return '';
}

/** Section indexes for every document-space, keyed by objectType name. A section is
 *  { id, name, parentId, documents:[docId] } — a flat array forming a tree via parentId. */
export async function getAllSections(orgId, wsId) {
  const out = {};
  try {
    const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(`${wsRoot(orgId, wsId)}.meta.sections.`)}`);
    for (const it of (resp?.data?.items || [])) {
      const m = String(it.key || '').match(/\.meta\.sections\.(.+)$/);
      if (m) out[m[1]] = Array.isArray(it.value?.sections) ? it.value.sections : [];
    }
  } catch { /* none yet */ }
  return out;
}

/** Persist the section index for one document-space (…w.{wsId}.meta.sections.{typeName}). */
export async function saveSections(orgId, wsId, typeName, sections) {
  return apiPost('/v1/memory', { key: `${wsRoot(orgId, wsId)}.meta.sections.${typeName}`, value: { sections }, visibility: 'private' });
}

/** Read the optional per-item color tags for every space → { typeName: { instanceId: colorKey } }.
 *  Mirrors getAllSections; stored at …w.{wsId}.meta.colors.{typeName} = { colors: { id: key } }. */
export async function getAllColors(orgId, wsId) {
  const out = {};
  try {
    const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(`${wsRoot(orgId, wsId)}.meta.colors.`)}`);
    for (const it of (resp?.data?.items || [])) {
      const m = String(it.key || '').match(/\.meta\.colors\.(.+)$/);
      if (m) out[m[1]] = (it.value && typeof it.value.colors === 'object' && it.value.colors) || {};
    }
  } catch { /* none yet */ }
  return out;
}

/** Persist the per-item color map for one space (…w.{wsId}.meta.colors.{typeName}). */
export async function saveColors(orgId, wsId, typeName, colors) {
  return apiPost('/v1/memory', { key: `${wsRoot(orgId, wsId)}.meta.colors.${typeName}`, value: { colors }, visibility: 'private' });
}

/* ── Sources: references the workspace draws on (memory / storage / knowledge). Pointers only —
 *  the referenced data is never copied or moved, it stays where it lives. Stored at
 *  organism.{id}.meta.sources = { sources: [{ id, type, label, key?, ownerGaii?, packageId?, external }] }. */

/** Read the workspace's attached source references (empty array if none). */
export async function getWorkspaceSources(orgId, wsId) {
  const key = `${wsRoot(orgId, wsId)}.meta.sources`;
  try {
    const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(key)}`);
    const item = (resp?.data?.items || []).find(i => i.key === key);
    return Array.isArray(item?.value?.sources) ? item.value.sources : [];
  } catch { return []; }
}

/** Persist the workspace's source references. */
export async function saveWorkspaceSources(orgId, wsId, sources) {
  return apiPost('/v1/memory', { key: `${wsRoot(orgId, wsId)}.meta.sources`, value: { sources }, visibility: 'private' });
}

/** List the caller's own storage files (key, size, mime, visibility) — for the storage source picker. */
export async function listOwnStorageFiles() {
  const resp = await apiGet('/v1/storage');
  return resp?.data?.files || [];
}

/** Toggle the publish-review gate in the org's config. */
export async function setPublishGate(orgId, enabled, approverRole = 'owner') {
  const cfg = await getConfig(orgId);
  const next = { ...cfg, gates: { ...(cfg.gates || {}), publish: { enabled: !!enabled, approverRole } } };
  return apiPost('/v1/memory', { key: `organism.${orgId}.meta.config`, value: next, visibility: 'private' });
}
