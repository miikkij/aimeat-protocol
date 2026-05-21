/**
 * Admin API Service
 * All admin dashboard API calls go through this module.
 */
import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from '/js/api.js';

// ── Dashboard & Config ──
export const getDashboard    = ()       => apiGet('/v1/admin/dashboard');
export const getConfig       = ()       => apiGet('/v1/admin/config');
export const saveConfig      = (changes)=> apiPut('/v1/admin/config', { changes });
export const deleteConfig    = (path)   => apiDelete(`/v1/admin/config/${encodeURIComponent(path)}`);

// ── Consul ──
export const getConsulStatus = ()       => apiGet('/v1/admin/consul');
export const consulExport    = ()       => apiPost('/v1/admin/consul/export');
export const consulImport    = ()       => apiPost('/v1/admin/consul/import');
export const getTranslations = (lang)   => apiGet(`/v1/admin/translations?lang=${lang}`);

// ── Agents & Owners ──
export const getAdminAgents  = ()       => apiGet('/v1/admin/agents');
export const getAdminOwners  = ()       => apiGet('/v1/admin/owners');
export const getAgentDetail  = (gaii)   => apiGet(`/v1/agents/${encodeURIComponent(gaii)}`);
export const getOwnerDetail  = (name)   => apiGet(`/v1/owners/${encodeURIComponent(name)}`);
export const grantRole       = (owner, role) => apiPost('/v1/admin/roles/grant', { owner, role });

// ── Actions & Boards ──
export const getActions      = ()       => apiGet('/v1/actions');
export const getBoards       = ()       => apiGet('/v1/boards');
export const getBoardPosts   = (id, limit = 50) => apiGet(`/v1/boards/${encodeURIComponent(id)}/posts?limit=${limit}`);
export const createBoard      = (name, visibility, description) => apiPost('/v1/boards', { name, visibility: visibility || 'public', description });
export const postToBoard     = (id, body, title) => apiPost(`/v1/boards/${encodeURIComponent(id)}/posts`, { body, title: title || 'msg' });
export const patchBoardMembers = (id, body) => apiPatch(`/v1/boards/${encodeURIComponent(id)}/members`, body);

// ── Work ──
export const getAdminWork    = ()       => apiGet('/v1/admin/work');

// ── Maintenance ──
export const getMaintenance  = ()       => apiGet('/v1/admin/maintenance');
export const setMaintenance  = (enabled, message) => apiPost('/v1/admin/maintenance', { enabled, message });

// ── Seed Examples ──
export const seedExamples    = ()       => apiPost('/v1/admin/seed-examples');

// ── Backup & Restore ──
export const getBackup       = ()       => apiGet('/v1/admin/backup');
export const doRestore       = (data)   => apiPost('/v1/admin/restore', data);

// ── Federation ──
export const getFederation   = ()       => apiGet('/v1/admin/federation');
export const getFederationPeers = ()    => apiGet('/v1/federation/peers');
export const getFederationDirectory = () => apiGet('/v1/federation/directory');
export const approvePeeringRequest = (id) => apiPut(`/v1/admin/peering/requests/${encodeURIComponent(id)}`, { decision: 'approve' });
export const rejectPeeringRequest = (id) => apiPut(`/v1/admin/peering/requests/${encodeURIComponent(id)}`, { decision: 'reject' });
export const deletePeeringRequest = (id) => apiDelete(`/v1/admin/peering/requests/${encodeURIComponent(id)}`);
export const activatePeer = (nodeId) => apiPost('/v1/federation/peer/activate', { peer_node_id: nodeId });
export const addPeerDirect = (nodeId, url, publicKey) => apiPost('/v1/federation/peers', { node_id: nodeId, url, public_key: publicKey || undefined });
export const removePeer = (nodeId) => apiDelete(`/v1/federation/peers/${encodeURIComponent(nodeId)}`);
export const removePeerEmergency = (nodeId) => apiDelete(`/v1/federation/peers/${encodeURIComponent(nodeId)}?emergency=true`);
export const testFederationNode = (targetUrl) => apiPost('/v1/federation/test', { target_url: targetUrl });
export const updatePeerPolicy = (nodeId, policy) => apiPut(`/v1/federation/peers/${encodeURIComponent(nodeId)}`, policy);
export const joinGenesisNetwork = (genesisUrl, role) => apiPost('/v1/admin/federation/join', { genesis_url: genesisUrl, role: role || 'contributor' });

// ── Hooks ──
export const getHooks        = ()       => apiGet('/v1/admin/hooks');
export const deleteHook      = (name)   => apiDelete(`/v1/admin/hooks/${encodeURIComponent(name)}`);

// ── Economy ──
export const mintMorsels     = (gaii, amount) => apiPost('/v1/admin/mint', { gaii, amount });

// ── Chat Instances ──
export const getChatInstances = ()      => apiGet('/v1/chat-instances');
export const createChatChannel = (name, platform) => apiPost('/v1/chat-instances', { app_name: name, platform: platform || 'admin' });
export const deleteChatInstance = (id)  => apiDelete(`/v1/chat-instances/${encodeURIComponent(id)}`);

// ── Realtime ──
export const getRealtime     = ()       => apiGet('/v1/admin/realtime');
export const closeRoom       = (id)     => apiDelete(`/v1/realtime/rooms/${encodeURIComponent(id)}`);

// ── GHII ──
export const getGhiiUsers    = ()       => apiGet('/v1/admin/ghii');
export const updateGhiiLevel = (ghii, level) => apiPut(`/v1/admin/ghii/${encodeURIComponent(ghii)}`, { verificationLevel: level });
export const deleteGhii      = (ghii)   => apiDelete(`/v1/admin/ghii/${encodeURIComponent(ghii)}`);
export const removeGhiiEmail = (ghii)   => apiDelete(`/v1/admin/ghii/${encodeURIComponent(ghii)}/email`);
export const clearGhiiCors   = (ghii)   => apiPut(`/v1/admin/ghii/${encodeURIComponent(ghii)}/cors`, { allowed_origins: null });

// ── Email ──
export const getEmailStatus  = ()       => apiGet('/v1/admin/email/status');
export const sendTestEmail   = (to, template, locale) => apiPost('/v1/admin/email/test', { to, template, locale });
export const getEmailTemplates = (locale) => apiGet(`/v1/admin/email/templates?locale=${locale || 'en'}`);
export const saveEmailTemplate = (id, locale, htmlContent, textContent) => apiPut(`/v1/admin/email/templates/${id}`, { locale, html: htmlContent, text: textContent });
export const resetEmailTemplate = (id, locale) => apiDelete(`/v1/admin/email/templates/${id}?locale=${locale || 'en'}`);
export const seedEmailTemplates = () => apiPost('/v1/admin/email/templates/seed');
export const resetAllEmailTemplates = () => apiPost('/v1/admin/email/templates/reset');
export const sendGroupEmail  = (group, subject, body) => apiPost('/v1/admin/email/send-group', { group, subject, body });

// ── Directory ──
export const getDirectoryStats = ()     => apiGet('/v1/admin/directory/stats');
export const rebuildDirectory  = ()     => apiPost('/v1/admin/directory/rebuild');

// ── Matching ──
export const getMatchingStats  = ()     => apiGet('/v1/admin/matching');
export const runMatching       = ()     => apiPost('/v1/admin/matching/run');

// ── Marketplace ──
export const getMarketplaceStats = ()   => apiGet('/v1/admin/marketplace');

// ── Push ──
export const getPushStats        = ()                   => apiGet('/v1/admin/push');
export const savePushTemplate    = (id, locale, fields) => apiPut(`/v1/admin/push/templates/${encodeURIComponent(id)}/${encodeURIComponent(locale)}`, { fields });
export const testPush            = ()                   => apiPost('/v1/admin/push/test');
export const resetPushTemplates  = ()                   => apiPost('/v1/admin/push/templates/reset');
export const getVapidKey         = ()                   => apiGet('/v1/push/vapid-key');
export const subscribePush       = (endpoint, keys)     => apiPost('/v1/push/subscribe', { endpoint, keys });
export const unsubscribePush     = ()                   => apiDelete('/v1/push/subscribe');

// ── CSM ──
export const getCsmTemplates   = ()       => apiGet('/v1/admin/csm');
export const getCsmDetail      = (name)   => apiGet(`/v1/admin/csm/${encodeURIComponent(name)}`);
export const deleteCsm         = (name)   => apiDelete(`/v1/admin/csm/${encodeURIComponent(name)}`);
export const createCsm         = (yaml)   => apiPost('/v1/csm', { yaml });
export const getCsmFileTemplates = ()     => apiGet('/v1/csm/templates');
export const getCsmFileTemplate  = (type) => fetch(`/v1/csm/templates/${encodeURIComponent(type)}`, { headers: { 'Accept': 'application/x-yaml' } }).then(r => r.text());
export const getCsmBuilderPrompt = ()     => apiGet('/v1/portal/prompts/csm-builder');

// ── MSM ──
export const getMsmIntegrations = ()    => apiGet('/v1/admin/msm');
export const getMsmDetail       = (name) => apiGet(`/v1/admin/msm/${encodeURIComponent(name)}`);
export const createMsm          = (yaml, federate) => apiPost('/v1/msm', { yaml, federate });
export const updateMsm          = (name, updates) => apiPut(`/v1/admin/msm/${encodeURIComponent(name)}`, updates);
export const deleteMsm          = (name) => apiDelete(`/v1/admin/msm/${encodeURIComponent(name)}`);
export const getMsmTemplates     = ()    => apiGet('/v1/msm/templates');
export const getMsmTemplate      = (type) => fetch(`/v1/msm/templates/${encodeURIComponent(type)}`, { headers: { 'Accept': 'application/x-yaml' } }).then(r => r.text());

// ── Network Directory ──
export const getNetworkDirectory = (keyword) => apiGet(`/v1/federation/cross-catalogue${keyword ? '?keyword=' + encodeURIComponent(keyword) + '&source=network' : '?source=network'}`);

// ── Genesis ──
export const getGenesisPeers    = ()          => apiGet('/v1/admin/genesis-peers');
export const approveGenesisPeer = (id)        => apiPost(`/v1/admin/genesis-peers/${encodeURIComponent(id)}/approve`);
export const suspendGenesisPeer = (id)        => apiPost(`/v1/admin/genesis-peers/${encodeURIComponent(id)}/suspend`);
export const removeGenesisPeer  = (id)        => apiDelete(`/v1/admin/genesis-peers/${encodeURIComponent(id)}`);

// ── CORS ──
export const clearAgentCors  = (gaii)   => apiPut(`/v1/admin/agents/${encodeURIComponent(gaii)}/cors`, { allowed_origins: null });
export const setAgentCors    = (gaii, origins) => apiPut(`/v1/admin/agents/${encodeURIComponent(gaii)}/cors`, { allowed_origins: origins });
export const setGhiiCors     = (ghii, origins) => apiPut(`/v1/admin/ghii/${encodeURIComponent(ghii)}/cors`, { allowed_origins: origins });

// ── Portal / Site ──
export const getSiteMeta      = ()      => apiGet('/v1/site');
export const getSiteTemplate  = ()      => apiGet('/v1/site/template');
export const saveSiteTemplate = (tmpl)  => apiPost('/v1/site/template', { template: tmpl });
export const deleteSiteTemplate = ()    => apiDelete('/v1/site/template');
export const getSiteChangelog = ()      => apiGet('/v1/site/changelog');
export const getSiteMemoryKeys = ()     => apiGet('/v1/site/memory-keys');
export const clearSiteCache   = ()      => apiPost('/v1/site/cache-invalidate');
export const getSitePrompt    = ()      => apiGet('/v1/site/prompt');
export const triggerLbSync    = ()      => apiPost('/v1/admin/site/sync');

// ── Memory (for portal memory keys) ──
export const addMemory       = (key, value) => apiPost('/v1/memory', { key, value, visibility: 'private' });
export const deleteMemory    = (key)        => apiDelete(`/v1/memory/${encodeURIComponent(key)}`);

// ── Admin Memory (all-owner memory browser) ──
export const getAdminMemory = (params = {}) => {
  const q = new URLSearchParams();
  if (params.prefix) q.set('prefix', params.prefix);
  if (params.owner) q.set('owner', params.owner);
  if (params.visibility) q.set('visibility', params.visibility);
  if (params.limit) q.set('limit', String(params.limit));
  if (params.offset) q.set('offset', String(params.offset));
  return apiGet('/v1/admin/memory?' + q.toString());
};
export const deleteAdminMemory = (owner, key) => apiDelete(`/v1/admin/memory/${encodeURIComponent(owner)}/${encodeURIComponent(key)}`);

// ── Stats ──
export const getStats = (from, to) => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return apiGet('/v1/stats' + (qs ? '?' + qs : ''));
};

// ── Extensions & Instances ──
export const getAvailableExtensions   = ()              => apiGet('/v1/admin/extensions/available');
export const installBundledExtension  = (name)          => apiPost(`/v1/admin/extensions/available/${encodeURIComponent(name)}/install`);
export const uninstallExtension       = (name)          => apiDelete(`/v1/extensions/${encodeURIComponent(name)}`);
export const activateExtension        = (name)          => apiPost(`/v1/extensions/${encodeURIComponent(name)}/activate`);
export const getExtensions            = ()              => apiGet('/v1/extensions');
export const getExtensionInstances    = (name)          => apiGet(`/v1/extensions/${encodeURIComponent(name)}/instances`);
export const createExtensionInstance  = (name, body)    => apiPost(`/v1/extensions/${encodeURIComponent(name)}/instances`, body);
export const updateExtensionInstance  = (name, id, body)=> apiPatch(`/v1/extensions/${encodeURIComponent(name)}/instances/${encodeURIComponent(id)}`, body);
export const deleteExtensionInstance  = (name, id)      => apiDelete(`/v1/extensions/${encodeURIComponent(name)}/instances/${encodeURIComponent(id)}`);
export const getActionScript         = (name, actionId) => apiGet(`/v1/extensions/${encodeURIComponent(name)}/actions/${encodeURIComponent(actionId)}`);
export const updateActionScript      = (name, actionId, scriptContent) => apiPatch(`/v1/extensions/${encodeURIComponent(name)}/actions/${encodeURIComponent(actionId)}`, { scriptContent });
export const scaffoldExtension       = (body)           => apiPost('/v1/admin/extensions/scaffold', body);
export const getDiskScript           = (name, actionId) => apiGet(`/v1/admin/extensions/available/${encodeURIComponent(name)}/scripts/${encodeURIComponent(actionId)}`);
export const saveDiskScript          = (name, actionId, scriptContent) => apiPut(`/v1/admin/extensions/available/${encodeURIComponent(name)}/scripts/${encodeURIComponent(actionId)}`, { scriptContent });
export const addDiskAction           = (name, body)      => apiPost(`/v1/admin/extensions/available/${encodeURIComponent(name)}/actions`, body);
export const reinstallExtension      = (name)           => apiPost(`/v1/admin/extensions/available/${encodeURIComponent(name)}/reinstall`);

// ── Scheduler ──
export const getSchedulerJobs    = ()              => apiGet('/v1/admin/scheduler/jobs');
export const triggerSchedulerJob = (id)            => apiPost(`/v1/admin/scheduler/jobs/${encodeURIComponent(id)}/trigger`);
export const updateSchedulerJob  = (id, updates)   => apiPut(`/v1/admin/scheduler/jobs/${encodeURIComponent(id)}`, updates);
export const deleteSchedulerJob  = (id)            => apiDelete(`/v1/admin/scheduler/jobs/${encodeURIComponent(id)}`);
export async function fetchSchedulerExecutionLog(params = {}) {
  const qs = new URLSearchParams();
  if (params.jobId) qs.set('jobId', params.jobId);
  if (params.extensionName) qs.set('extensionName', params.extensionName);
  if (params.trigger) qs.set('trigger', params.trigger);
  if (params.result) qs.set('result', params.result);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  return apiGet(`/v1/admin/scheduler/execution-log?${qs.toString()}`);
}

// ── Knowledge Management ──
export const getKnowledgePackages = (opts = {}) => {
  const params = new URLSearchParams();
  if (opts.flagged) params.set('flagged', 'true');
  if (opts.author) params.set('author', opts.author);
  if (opts.content_type) params.set('content_type', opts.content_type);
  if (opts.page) params.set('page', String(opts.page));
  return apiGet(`/v1/admin/knowledge?${params.toString()}`);
};
export const createSystemKnowledge = (data) =>
  apiPost('/v1/admin/knowledge/import', data);
export const deleteKnowledgePackage = (packageId) =>
  apiDelete(`/v1/admin/knowledge/${encodeURIComponent(packageId)}`);
export const reviewKnowledgePackage = (packageId, reason, action, customText) =>
  apiPost(`/v1/admin/knowledge/${encodeURIComponent(packageId)}/review`, {
    reason, action, custom_text: customText,
  });

// ── Template Moderation ──
export const listPendingTemplates  = ()           => apiGet('/v1/templates/pending');
export const reviewTemplate        = (id)         => apiGet(`/v1/templates/${encodeURIComponent(id)}/review`);
export const approveTemplate       = (id, comment) => apiPost(`/v1/templates/${encodeURIComponent(id)}/approve`, { comment });
export const rejectTemplate        = (id, reason) => apiPost(`/v1/templates/${encodeURIComponent(id)}/reject`, { reason });
export const suspendTemplate       = (id, reason) => apiPost(`/v1/templates/${encodeURIComponent(id)}/suspend`, { reason });

// ── System Prompts ──
export const getSystemPrompts     = (group) => apiGet('/v1/admin/prompts' + (group ? '?group=' + encodeURIComponent(group) : ''));
export const getSystemPrompt      = (id)    => apiGet(`/v1/admin/prompts/${encodeURIComponent(id)}`);
export const updateSystemPrompt   = (id, body) => apiPatch(`/v1/admin/prompts/${encodeURIComponent(id)}`, body);
export const resetSystemPrompt    = (id)    => apiPost(`/v1/admin/prompts/${encodeURIComponent(id)}/reset`);
export const resetAllSystemPrompts = ()     => apiPost('/v1/admin/prompts/reset-all');
export const resetPromptGroup     = (group) => apiPost(`/v1/admin/prompts/reset-group/${encodeURIComponent(group)}`);
export const getPromptVersions    = (id)    => apiGet(`/v1/admin/prompts/${encodeURIComponent(id)}/versions`);
export const restorePromptVersion = (id, v) => apiPost(`/v1/admin/prompts/${encodeURIComponent(id)}/versions/${v}/restore`);

// ── Agent Tasks (admin) ──
export const getAdminAgentTasks = (params = {}) => {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.agent) q.set('agent', params.agent);
  if (params.page) q.set('page', String(params.page));
  if (params.per_page) q.set('per_page', String(params.per_page));
  return apiGet('/v1/admin/agent-tasks?' + q.toString());
};

// ── Sharing Groups (admin) ──
export const getAdminSharingGroups = () => apiGet('/v1/admin/sharing-groups');
