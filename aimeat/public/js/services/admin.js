/**
 * Admin API Service
 * All admin dashboard API calls go through this module.
 */
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';

// ── Dashboard & Config ──
export const getDashboard    = ()       => apiGet('/v1/admin/dashboard');
export const getConfig       = ()       => apiGet('/v1/admin/config');
export const saveConfig      = (changes)=> apiPut('/v1/admin/config', { changes });
export const getTranslations = (lang)   => apiGet(`/v1/admin/translations?lang=${lang}`);

// ── Agents & Owners ──
export const getAdminAgents  = ()       => apiGet('/v1/admin/agents');
export const getAgentDetail  = (gaii)   => apiGet(`/v1/agents/${encodeURIComponent(gaii)}`);
export const getOwnerDetail  = (name)   => apiGet(`/v1/owners/${encodeURIComponent(name)}`);
export const grantRole       = (owner, role) => apiPost('/v1/admin/roles/grant', { owner, role });

// ── Actions & Boards ──
export const getActions      = ()       => apiGet('/v1/actions');
export const getBoards       = ()       => apiGet('/v1/boards');
export const getBoardPosts   = (id, limit = 50) => apiGet(`/v1/boards/${encodeURIComponent(id)}/posts?limit=${limit}`);

// ── Work ──
export const getAdminWork    = ()       => apiGet('/v1/admin/work');

// ── Maintenance ──
export const getMaintenance  = ()       => apiGet('/v1/admin/maintenance');
export const setMaintenance  = (enabled, message) => apiPost('/v1/admin/maintenance', { enabled, message });

// ── Backup & Restore ──
export const getBackup       = ()       => apiGet('/v1/admin/backup');
export const doRestore       = (data)   => apiPost('/v1/admin/restore', data);

// ── Federation ──
export const getFederation   = ()       => apiGet('/v1/admin/federation');

// ── Hooks ──
export const getHooks        = ()       => apiGet('/v1/admin/hooks');
export const deleteHook      = (name)   => apiDelete(`/v1/admin/hooks/${encodeURIComponent(name)}`);

// ── Economy ──
export const mintMorsels     = (gaii, amount) => apiPost('/v1/admin/mint', { gaii, amount });

// ── Chat Instances ──
export const getChatInstances = ()      => apiGet('/v1/chat-instances');

// ── Realtime ──
export const getRealtime     = ()       => apiGet('/v1/admin/realtime');
export const closeRoom       = (id)     => apiDelete(`/v1/realtime/rooms/${encodeURIComponent(id)}`);

// ── GHII ──
export const getGhiiUsers    = ()       => apiGet('/v1/admin/ghii');
export const updateGhiiLevel = (ghii, level) => apiPut(`/v1/admin/ghii/${encodeURIComponent(ghii)}`, { verificationLevel: level });
export const deleteGhii      = (ghii)   => apiDelete(`/v1/admin/ghii/${encodeURIComponent(ghii)}`);
export const clearGhiiCors   = (ghii)   => apiPut(`/v1/admin/ghii/${encodeURIComponent(ghii)}/cors`, { allowed_origins: null });

// ── Email ──
export const getEmailStatus  = ()       => apiGet('/v1/admin/email/status');
export const sendTestEmail   = (to)     => apiPost('/v1/admin/email/test', { to });

// ── Directory ──
export const getDirectoryStats = ()     => apiGet('/v1/admin/directory/stats');
export const rebuildDirectory  = ()     => apiPost('/v1/admin/directory/rebuild');

// ── Matching ──
export const getMatchingStats  = ()     => apiGet('/v1/admin/matching');
export const runMatching       = ()     => apiPost('/v1/admin/matching/run');

// ── Marketplace ──
export const getMarketplaceStats = ()   => apiGet('/v1/admin/marketplace');

// ── Push ──
export const getPushStats    = ()       => apiGet('/v1/admin/push');

// ── CSM ──
export const getCsmTemplates = ()       => apiGet('/v1/admin/csm');

// ── MSM ──
export const getMsmIntegrations = ()    => apiGet('/v1/admin/msm');

// ── Genesis ──
export const getGenesisPeers    = ()          => apiGet('/v1/admin/genesis-peers');
export const approveGenesisPeer = (id)        => apiPost(`/v1/admin/genesis-peers/${encodeURIComponent(id)}/approve`);
export const suspendGenesisPeer = (id)        => apiPost(`/v1/admin/genesis-peers/${encodeURIComponent(id)}/suspend`);
export const removeGenesisPeer  = (id)        => apiDelete(`/v1/admin/genesis-peers/${encodeURIComponent(id)}`);

// ── CORS ──
export const clearAgentCors  = (gaii)   => apiPut(`/v1/admin/agents/${encodeURIComponent(gaii)}/cors`, { allowed_origins: null });

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

// ── Stats ──
export const getStats        = ()       => apiGet('/v1/stats');
