/**
 * @file public/views/admin.js
 * @description Admin Dashboard SPA view — sidebar layout with data preloading and tab components.
 * @structure Single `loadAll` fetches all dashboard data; tabs render slices of it. SSE
 *            live-updates trigger a debounced, silent background refresh.
 * @version-history
 *   v1.5.0 — 2026-07-16 — Drop the per-item emoji icons from the sidebar nav and page title
 *     (label-only menu — the icons added visual noise without aiding scanning).
 *   v1.1.0 — 2026-06-18 — Debounce + silence SSE-driven refresh so busy nodes don't flicker "Loading…".
 *   v1.1.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 *   v1.2.0 — 2026-06-24 — Add Applications moderation tab (operator hide/restore apps).
 *   v1.3.0 — 2026-07-05 — Add "AI Apps Usage" tab (operator cross-user AI-spend charts).
 *   v1.4.0 — 2026-07-11 — Replace the "AI Apps Usage" nav entry with a unified "Usage" tab
 *     (agent LLM ledger + AI apps spend, two labeled never-summed sections).
 *   v1.6.0 — 2026-08-17 — Metrics tab: the /v1/metrics Prometheus exposition rendered as a page.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { getSession, onAuthChange } from '/js/services/auth.js';
import * as api from '/js/services/admin.js';
import { connect, disconnect, onUpdate, offUpdate } from '/lib/live-updates.js';

// ── Tab components (loaded eagerly — admin pages are lightweight) ──
import OverviewTab     from './admin/overview-tab.js';
import EconomyTab      from './admin/economy-tab.js';
import ConfigTab       from './admin/config-tab.js';
import SecurityTab     from './admin/security-tab.js';
import CorsTab         from './admin/cors-tab.js';
import MaintenanceTab  from './admin/maintenance-tab.js';
import HooksTab        from './admin/hooks-tab.js';
import PortalTab       from './admin/portal-tab.js';
import StatsTab        from './admin/stats-tab.js';
import DatabaseTab     from './admin/database-tab.js';
import MetricsTab      from './admin/metrics-tab.js';
import UsageTab        from './admin/usage-tab.js';
import OwnersTab       from './admin/owners-tab.js';
import AgentsTab       from './admin/agents-tab.js';
import GhiiTab         from './admin/ghii-tab.js';
import OrganismOwnershipTab from './admin/organism-ownership-tab.js';
import ActionsTab      from './admin/actions-tab.js';
import BoardsTab       from './admin/boards-tab.js';
import ChatInstancesTab from './admin/chat-instances-tab.js';
import RealtimeTab     from './admin/realtime-tab.js';
import WorkTab         from './admin/work-tab.js';
import MessagesAdminTab from './admin/messages-tab.js';
import EmailTab        from './admin/email-tab.js';
import PushTab         from './admin/push-tab.js';
import DirectoryTab    from './admin/directory-tab.js';
import MatchingTab     from './admin/matching-tab.js';
import ServicesTab     from './admin/services-tab.js';
import CortexTab       from './admin/cortex-tab.js';
import CsmTab          from './admin/csm-tab.js';
import MsmTab          from './admin/msm-tab.js';
import FederationTab   from './admin/federation-tab.js';
import GenesisTab      from './admin/genesis-tab.js';
import ConsulTab       from './admin/consul-tab.js';
import SchedulerTab      from './admin/scheduler-tab.js';
import KnowledgeAdminTab from './admin/knowledge-tab.js';
import PromptsTab        from './admin/prompts-tab.js';
import PackagesAdminTab  from './admin/packages-tab.js';
import MemoryAdminTab    from './admin/memory-tab.js';
import CapabilitiesAdminTab from './admin/capabilities-tab.js';
import AgentTasksAdminTab from './admin/agent-tasks-tab.js';
import SharingGroupsAdminTab from './admin/sharing-groups-tab.js';
import AgentIntegrationAdminTab from './admin/agent-integration-tab.js';
import SubdomainsAdminTab from './admin/subdomains-tab.js';
import AppsAdminTab        from './admin/apps-tab.js';
import SkillsAdminTab      from './admin/skills-tab.js';
import { swallowed } from '/js/swallowed.js';

// ── Sidebar nav structure ──
const NAV_GROUPS = [
  { key: 'dashboard.navNode', items: [
    { id: 'overview',     key: 'dashboard.overview',   component: OverviewTab },
    { id: 'economy',      key: 'dashboard.economy',    component: EconomyTab },
    { id: 'config',       key: 'dashboard.config',     component: ConfigTab },
    { id: 'security',     key: 'admin.security.title',  component: SecurityTab },
    { id: 'cors',         key: 'dashboard.cors',       component: CorsTab },
    { id: 'maintenance',  key: 'dashboard.maintenance',component: MaintenanceTab },
    { id: 'hooks',        key: 'dashboard.hooks',      component: HooksTab },
    { id: 'portal',       key: 'dashboard.portal',     component: PortalTab },
    { id: 'subdomains',   key: 'admin.subdomains.title', component: SubdomainsAdminTab },
    { id: 'stats',        key: 'dashboard.stats',      component: StatsTab },
    { id: 'database',     key: 'dashboard.database',   component: DatabaseTab },
    { id: 'metrics',      key: 'dashboard.metrics',    component: MetricsTab },
    { id: 'usage',        key: 'dashboard.usage',      component: UsageTab },
    { id: 'prompts',      key: 'dashboard.promptsTab', component: PromptsTab },
  ]},
  { key: 'dashboard.navIdentity', items: [
    { id: 'owners',  key: 'dashboard.owners',  component: OwnersTab,  count: 'owners' },
    { id: 'agents',  key: 'dashboard.agents',  component: AgentsTab,  count: 'agents' },
    { id: 'ghii',    key: 'dashboard.ghii',    component: GhiiTab,    count: 'ghii' },
    { id: 'agent-integration', key: 'admin.tabs.agentIntegration', component: AgentIntegrationAdminTab },
    { id: 'org-ownership', key: 'admin.tabs.orgOwnership', component: OrganismOwnershipTab },
  ]},
  { key: 'dashboard.navData', items: [
    { id: 'actions',       key: 'dashboard.actions',       component: ActionsTab,        count: 'actions' },
    { id: 'boards',        key: 'dashboard.boards',        component: BoardsTab,         count: 'boards' },
    { id: 'chatInstances', key: 'dashboard.chatInstances', component: ChatInstancesTab,  count: 'chatInstances' },
    { id: 'realtime',      key: 'dashboard.realtime',      component: RealtimeTab,       count: 'rooms' },
    { id: 'work',          key: 'dashboard.work',          component: WorkTab,           count: 'work' },
    { id: 'messages',      key: 'admin.messages.title',    component: MessagesAdminTab },
    { id: 'memory-admin',  key: 'dashboard.memoryAdmin',   component: MemoryAdminTab },
    { id: 'agent-tasks',  key: 'dashboard.agentTasksTab', component: AgentTasksAdminTab },
    { id: 'sharing-groups', key: 'dashboard.sharingGroupsTab', component: SharingGroupsAdminTab },
    { id: 'capabilities', key: 'capabilities.adminTitle', component: CapabilitiesAdminTab },
    { id: 'apps',         key: 'admin.apps.title',        component: AppsAdminTab },
  ]},
  { key: 'dashboard.navInfrastructure', items: [
    { id: 'email',  key: 'dashboard.email',  component: EmailTab },
    { id: 'push',   key: 'dashboard.push',   component: PushTab },
    { id: 'consul',    key: 'dashboard.consul',    component: ConsulTab },
    { id: 'scheduler', key: 'dashboard.scheduler', component: SchedulerTab },
  ]},
  { key: 'dashboard.navServices', items: [
    { id: 'directory',   key: 'dashboard.directory',      component: DirectoryTab },
    { id: 'matching',    key: 'dashboard.matching',       component: MatchingTab },
    { id: 'services',    key: 'dashboard.services',       component: ServicesTab },
    { id: 'cortex',      key: 'dashboard.cortexTab',      component: CortexTab },
    { id: 'csm',         key: 'dashboard.csmManagement',  component: CsmTab },
    { id: 'knowledge',   key: 'knowledge.operator.tabLabel', component: KnowledgeAdminTab },
    { id: 'skills',      key: 'dashboard.skills.tabLabel',  component: SkillsAdminTab },
    { id: 'packages',    key: 'dashboard.packagesTab',      component: PackagesAdminTab },
  ]},
  { key: 'dashboard.navIntegrations', items: [
    { id: 'msm', key: 'dashboard.msmManagement', component: MsmTab, count: 'msm' },
  ]},
  { key: 'dashboard.navFederation', items: [
    { id: 'federation', key: 'dashboard.federation', component: FederationTab, count: 'peers' },
    { id: 'genesis',    key: 'dashboard.genesis',    component: GenesisTab,    count: 'genesis' },
  ]},
];

// Page title lookup
const PAGE_TITLES = {};
NAV_GROUPS.forEach(g => g.items.forEach(i => {
  PAGE_TITLES[i.id] = { key: i.key };
}));

export default function Admin({ navigate, locale }) {
  useViewCSS('/css/views/admin.css');

  const [session, setSession] = useState(null);
  const [activePage, setActivePage] = useState('overview');
  const [data, setData] = useState(null);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const mountRef = useRef(true);
  const retriedRef = useRef(false);
  const reloadTimerRef = useRef(null);

  // Auth listener
  useEffect(() => {
    const s = getSession();
    if (s) setSession(s);
    return onAuthChange(() => {
      const fresh = getSession();
      setSession(fresh);
      // Reset retry flag so loadAll can attempt token refresh again
      retriedRef.current = false;
    });
  }, []);

  // URL tab param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab) {
      const flat = NAV_GROUPS.flatMap(g => g.items);
      if (flat.some(i => i.id === tab)) setActivePage(tab);
    }
  }, []);

  // Cleanup
  useEffect(() => { mountRef.current = true; return () => { mountRef.current = false; }; }, []);

  // Load all data — server-side auth is the source of truth.
  // `silent` skips the loading spinner so SSE-driven background refreshes don't
  // flicker the "Loading…" button on busy nodes (only manual refresh shows it).
  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    setAccessDenied(false);
    try {
      // Phase 1: critical data — getDashboard is the auth gate
      const [dash, agents, actions, boards] = await Promise.all([
        api.getDashboard(), api.getAdminAgents(), api.getActions(), api.getBoards(),
      ]);
      if (!mountRef.current) return;

      // If the dashboard call failed (403/auth), show access denied
      if (!dash.ok) {
        const code = dash.error?.code || '';
        if (code === 'FORBIDDEN' || code === 'AUTH_REQUIRED' || code === 'OPERATOR_REQUIRED' || code === 'ACCESS_DENIED') {
          // Try token refresh once — the stored JWT may be stale (missing operator role)
          const s = getSession();
          if (s?.refresh && !retriedRef.current) {
            retriedRef.current = true;
            try {
              await s.refresh();
              // Retry dashboard call with refreshed token (don't dispatch event to avoid loop)
              const dashRetry = await api.getDashboard();
              if (dashRetry.ok) {
                // Refresh worked — restart loadAll with fresh session
                setSession(getSession());
                setLoading(false);
                return;
              }
            } catch (err) {
              // Refresh failed
              swallowed('admin: Admin', err);
            }
          }
          setAccessDenied(true);
        } else {
          setError(dash.error?.message || 'Failed to load dashboard');
        }
        setLoading(false);
        return;
      }

      const d = {
        dash: dash.data, agents: agents.data, actions: actions.data, boards: boards.data,
      };

      // Update counts from dash
      const c = dash.data?.counts || {};
      const newCounts = {
        owners: c.owners || 0, agents: c.agents || 0,
        actions: c.actions || 0, boards: c.boards || 0,
        chatInstances: c.chat_instances || 0,
      };

      // Phase 2: extras
      const extras = await Promise.allSettled([
        api.getMaintenance(), api.getAdminWork(), api.getFederation(),
        api.getHooks(), api.getChatInstances(), api.getRealtime(),
        api.getFederationPeers(),
      ]);
      if (!mountRef.current) return;

      d.maintenance    = extras[0].status === 'fulfilled' ? extras[0].value.data : null;
      d.workItems      = extras[1].status === 'fulfilled' ? (extras[1].value.data.work || []) : [];
      d.federation     = extras[2].status === 'fulfilled' ? (extras[2].value.data.peers || []) : [];
      d.hooks          = extras[3].status === 'fulfilled' ? (extras[3].value.data.extension_hooks || {}) : {};
      d.chatInstances  = extras[4].status === 'fulfilled' ? (extras[4].value.data.chat_instances || []) : [];
      d.realtime       = extras[5].status === 'fulfilled' ? extras[5].value.data : null;
      d.livePeers      = extras[6].status === 'fulfilled' ? (extras[6].value.data?.peers || []) : [];

      // Phase 3: features
      const features = await Promise.allSettled([
        api.getGhiiUsers(), api.getEmailStatus(), api.getDirectoryStats(),
        api.getMatchingStats(), api.getMarketplaceStats(), api.getPushStats(),
        api.getCsmTemplates(), api.getMsmIntegrations(), api.getGenesisPeers(),
        api.getConfig(),
        api.getConsulStatus().catch(() => ({ data: null })),
        api.getSchedulerJobs().catch(() => ({ data: null })),
        api.getExtensions().catch(() => ({ data: null })),
        api.getSystemPrompts().catch(() => ({ data: null })),
      ]);
      if (!mountRef.current) return;

      d.ghiiUsers       = features[0].status === 'fulfilled' ? (features[0].value.data.ghii_users || []) : [];
      d.email           = features[1].status === 'fulfilled' ? features[1].value.data : null;
      d.directoryStats  = features[2].status === 'fulfilled' ? features[2].value.data : null;
      d.matchingStats   = features[3].status === 'fulfilled' ? features[3].value.data : null;
      d.marketplaceStats = features[4].status === 'fulfilled' ? features[4].value.data : null;
      d.push            = features[5].status === 'fulfilled' ? features[5].value.data : null;
      d.csmTemplates    = features[6].status === 'fulfilled' ? features[6].value.data : null;
      d.msmIntegrations = features[7].status === 'fulfilled' ? features[7].value.data : null;
      d.genesis         = features[8].status === 'fulfilled' ? features[8].value.data : null;
      d.configSchema    = features[9].status === 'fulfilled' ? features[9].value.data : null;
      d.consul          = features[10].status === 'fulfilled' ? features[10].value.data : null;
      d.schedulerJobs   = features[11].status === 'fulfilled' ? features[11].value.data : null;
      d.extensions      = features[12].status === 'fulfilled' ? features[12].value.data : null;
      d.systemPrompts   = features[13].status === 'fulfilled' ? features[13].value?.data : null;

      // Scheduler execution log (non-blocking)
      d.schedulerLog = await api.fetchSchedulerExecutionLog({ limit: 50 }).catch(() => ({ entries: [], total: 0 }));

      // Phase 4: portal + stats + owners
      try {
        const [portalMeta, portalTemplate, portalChangelog] = await Promise.all([
          api.getSiteMeta().catch(() => ({ data: null })),
          api.getSiteTemplate().catch(() => ({ data: null })),
          api.getSiteChangelog().catch(() => ({ data: null })),
        ]);
        d.portal = { meta: portalMeta.data, template: portalTemplate.data, changelog: portalChangelog.data };
      } catch (err) { swallowed('admin', err); d.portal = null; }

      try { const sr = await api.getStats(); if (sr.data) d.stats = sr.data; } catch (err) { swallowed('admin', err); d.stats = null; }

      // Load owners from dedicated admin endpoint (includes roles)
      try {
        const ownersResp = await api.getAdminOwners();
        d.owners = ownersResp.data?.owners || [];
      } catch (err) { swallowed('admin', err); d.owners = []; }

      // Final counts
      newCounts.owners = d.owners.length;
      newCounts.work = d.workItems.length;
      newCounts.peers = d.livePeers.length;
      newCounts.rooms = d.realtime?.stats?.rooms || 0;
      newCounts.ghii = d.ghiiUsers.length;
      newCounts.genesis = d.genesis?.peers?.length || 0;
      newCounts.msm = d.msmIntegrations?.total || 0;

      if (mountRef.current) {
        setData(d);
        setCounts(newCounts);
        setLastUpdate(new Date().toLocaleTimeString());
      }
    } catch (e) {
      if (!mountRef.current) return;
      // 403 = not operator, show access denied
      if (e.message?.includes('403') || e.message?.includes('FORBIDDEN') || e.message?.includes('operator')) {
        setAccessDenied(true);
      } else {
        setError(e.message);
      }
    }
    if (mountRef.current) setLoading(false);
  }, []);

  // Load on mount when session is ready — server decides if user is authorized
  useEffect(() => {
    if (session) loadAll();
  }, [session, loadAll]);

  // SSE live updates — auto-reload on server-side data changes.
  // Debounced + silent: busy nodes emit many events per second; without this the
  // whole dashboard re-fetches (and flickers "Loading…") on every single event.
  useEffect(() => {
    if (!session) return;
    connect(() => getSession()?.jwt);
    const debouncedReload = () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;
        if (mountRef.current) loadAll(true);
      }, 1500);
    };
    onUpdate(debouncedReload);
    return () => {
      offUpdate(debouncedReload);
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      disconnect();
    };
  }, [session, loadAll]);

  // Switch page
  function switchPage(id) {
    setActivePage(id);
    // Update URL without reload
    const url = new URL(window.location.href);
    url.searchParams.set('tab', id);
    history.replaceState(null, '', url);
  }

  // ── Not logged in ──
  if (!session) {
    return html`<div class="adm">
      <div class="adm-login">
        <div class="adm-card" style="text-align:center">
          <h2>\u{1F512} ${t('dashboard.loginTitle')}</h2>
          <p>${t('dashboard.loginDesc')}</p>
          <p style="color:var(--text-dim);font-size:.85rem">${t('dashboard.loginNeedOperator') || 'You need to sign in with an operator account from the header.'}</p>
        </div>
      </div>
    </div>`;
  }

  // ── Access denied (server returned 403) ──
  if (accessDenied) {
    return html`<div class="adm">
      <div class="adm-login">
        <div class="adm-card" style="text-align:center">
          <h2>\u{1F6AB} ${t('dashboard.accessDenied') || 'Access Denied'}</h2>
          <p>${t('dashboard.operatorRequired') || 'You need the operator role to access the admin dashboard.'}</p>
        </div>
      </div>
    </div>`;
  }

  // Find active component
  const allItems = NAV_GROUPS.flatMap(g => g.items);
  const activeItem = allItems.find(i => i.id === activePage) || allItems[0];
  const ActiveComponent = activeItem.component;
  const pageInfo = PAGE_TITLES[activePage] || { key: '' };

  const tabProps = { data, reload: loadAll, session, navigate, locale, switchPage };

  return html`
    <div class="adm">
      <!-- Sidebar -->
      <nav class="adm-sidebar">
        <div class="node-id">${data?.dash?.node_id || ''}</div>

        ${NAV_GROUPS.map(group => html`
          <div class="adm-nav-group">${t(group.key)}</div>
          ${group.items.map(item => html`
            <button
              class="adm-nav-item ${activePage === item.id ? 'active' : ''}"
              onClick=${() => switchPage(item.id)}
            >
              <span class="label">${t(item.key)}</span>
              ${item.count != null && counts[item.count] != null
                ? html`<span class="cnt">${counts[item.count]}</span>`
                : null}
            </button>
          `)}
        `)}
      </nav>

      <!-- Main content -->
      <div class="adm-main">
        <div class="adm-topbar">
          <div class="adm-page-title">
            ${t(pageInfo.key)}
          </div>
          <div class="adm-topbar-right">
            <button class="adm-btn" onClick=${loadAll} disabled=${loading}>
              ${loading ? t('dashboard.loading') : t('dashboard.refresh')}
            </button>
            ${lastUpdate && html`<span style="color:var(--text-dim);font-size:.7rem">${lastUpdate}</span>`}
          </div>
        </div>

        ${error && html`<div class="error-box"><strong>${t('dashboard.failedToLoad')}</strong><br/>${escHtml(error)}</div>`}

        ${!data && !error && html`<div class="empty"><div class="spinner"></div> ${t('dashboard.loading')}</div>`}

        ${data && html`<${ActiveComponent} ...${tabProps} />`}
      </div>
    </div>
  `;
}
