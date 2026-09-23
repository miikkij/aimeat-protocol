/**
 * @file public/views/admin.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Dashboard SPA view — sidebar layout with data preloading and tab components.
 * @structure Single `loadAll` fetches all dashboard data; tabs render slices of it. SSE
 *            live-updates trigger a debounced, silent background refresh.
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- The frame is the shared set's: a Page whose menu is the navigation rail
 *     (the same quiet list as Settings & Controls, a menu dialog on a phone), the page title and the
 *     refresh in the masthead, and the sign-in, access-denied, error and loading states as shared
 *     parts. admin.css no longer draws the shell.
 *   v1.8.0 -- 2026-09-13 -- Compose the existing page title with poster-page-title.
 *   v1.9.0 — 2026-09-09 — The marketplace stats fetch goes: its route was deleted, and nothing here
 *     ever rendered the value it loaded.
 *   v1.8.0 — 2026-09-05 — The sign-in card's lock emoji goes: no emoji anywhere in the interface.
 *   v1.5.0 — 2026-07-16 — Drop the per-item emoji icons from the sidebar nav and page title
 *     (label-only menu — the icons added visual noise without aiding scanning).
 *   v1.1.0 — 2026-06-18 — Debounce + silence SSE-driven refresh so busy nodes don't flicker "Loading…".
 *   v1.1.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 *   v1.2.0 — 2026-06-24 — Add Applications moderation tab (operator hide/restore apps).
 *   v1.3.0 — 2026-07-05 — Add "AI Apps Usage" tab (operator cross-user AI-spend charts).
 *   v1.4.0 — 2026-07-11 — Replace the "AI Apps Usage" nav entry with a unified "Usage" tab
 *     (agent LLM ledger + AI apps spend, two labeled never-summed sections).
 *   v1.6.0 — 2026-08-17 — Metrics tab: the /v1/metrics Prometheus exposition rendered as a page.
 *   v1.7.0 — 2026-08-31 — The poster frame (design canvas "AIMEAT Hallinnan kehys"): the refresh
 *     becomes the quiet underlined word (.adm-refresh), the clock a mono reading (.adm-time),
 *     and the access-denied heading loses its emoji.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { time as fmtTime } from '/js/format.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { Page, Rail, Stack, ListRow, Text, Action, Surface } from '/components/poster-parts.js';
import { Spinner } from '/components/Spinner.js';
import { getSession, onAuthChange } from '/js/services/auth.js';
import * as api from '/js/services/admin.js';
import { connect, disconnect, onUpdate, offUpdate } from '/lib/live-updates.js';

// ── Tab components (loaded eagerly — admin pages are lightweight) ──
import OverviewTab     from './admin/overview-tab.js';
import EconomyTab      from './admin/economy-tab.js';
import ConfigTab       from './admin/config-tab.js';
import SecurityTab     from './admin/security-tab.js';
import ComplianceTab   from './admin/compliance-tab.js';
import CorsTab         from './admin/cors-tab.js';
import MaintenanceTab  from './admin/maintenance-tab.js';
import HooksTab        from './admin/hooks-tab.js';
import PortalTab       from './admin/portal-tab.js';
import DiscoveryTab    from './admin/discovery-tab.js';
import StatsTab        from './admin/stats-tab.js';
import DatabaseTab     from './admin/database-tab.js';
import MetricsTab      from './admin/metrics-tab.js';
import UsageTab        from './admin/usage-tab.js';
import OwnersTab       from './admin/owners-tab.js';
import AgentsTab       from './admin/agents-tab.js';
import GhiiTab         from './admin/ghii-tab.js';
import OrganismOwnershipTab from './admin/organism-ownership-tab.js';
import SsoTab from './admin/sso-tab.js';
import ActionsTab      from './admin/actions-tab.js';
import BoardsTab       from './admin/boards-tab.js';
import ChatInstancesTab from './admin/chat-instances-tab.js';
import RealtimeTab     from './admin/realtime-tab.js';
import WorkTab         from './admin/work-tab.js';
import MessagesAdminTab from './admin/messages-tab.js';
import EmailTab        from './admin/email-tab.js';
import PushTab         from './admin/push-tab.js';
import DirectoryTab    from './admin/directory-tab.js';
import ExtensionsTab   from './admin/extensions-tab.js';
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
/** Old tab words that still have to work in a saved link, mapped to the page they became. */
const TAB_ALIASES = { services: 'extensions' };

const NAV_GROUPS = [
  { key: 'dashboard.navNode', items: [
    { id: 'overview',     key: 'dashboard.overview',   component: OverviewTab },
    { id: 'economy',      key: 'dashboard.economy',    component: EconomyTab },
    { id: 'config',       key: 'dashboard.config',     component: ConfigTab },
    { id: 'security',     key: 'admin.security.title',  component: SecurityTab },
    { id: 'compliance',   key: 'admin.compliance.title', component: ComplianceTab },
    { id: 'cors',         key: 'dashboard.cors',       component: CorsTab },
    { id: 'maintenance',  key: 'dashboard.maintenance',component: MaintenanceTab },
    { id: 'hooks',        key: 'dashboard.hooks',      component: HooksTab },
    { id: 'portal',       key: 'dashboard.portal',     component: PortalTab },
    { id: 'discovery',    key: 'dashboard.seo.tab',    component: DiscoveryTab },
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
    { id: 'sso', key: 'dashboard.ssoTab', component: SsoTab },
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
    { id: 'extensions',  key: 'dashboard.extensionsTab',  component: ExtensionsTab },
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
  const [menuOpen, setMenuOpen] = useState(false);
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

  // URL tab param. A renamed tab keeps its old word here, so a link somebody saved or wrote into a
  // note still lands on the page: ?tab=services is the Extensions page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const asked = params.get('tab');
    const tab = TAB_ALIASES[asked] || asked;
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
      // The hooks are not read here any more: the Hooks tab makes its own one read (it needs the
      // whole page, not the bound lists), and nothing else on the shell used them.
      const extras = await Promise.allSettled([
        api.getMaintenance(), api.getAdminWork(), api.getFederation(),
        api.getChatInstances(), api.getRealtime(),
        api.getFederationPeers(),
      ]);
      if (!mountRef.current) return;

      d.maintenance    = extras[0].status === 'fulfilled' ? extras[0].value.data : null;
      d.workItems      = extras[1].status === 'fulfilled' ? (extras[1].value.data.work || []) : [];
      d.federation     = extras[2].status === 'fulfilled' ? (extras[2].value.data.peers || []) : [];
      d.chatInstances  = extras[3].status === 'fulfilled' ? (extras[3].value.data.chat_instances || []) : [];
      d.realtime       = extras[4].status === 'fulfilled' ? extras[4].value.data : null;
      d.livePeers      = extras[5].status === 'fulfilled' ? (extras[5].value.data?.peers || []) : [];

      // Phase 3: features
      const features = await Promise.allSettled([
        api.getGhiiUsers(), api.getEmailStatus(), api.getDirectoryStats(),
        api.getPushStats(),
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
      d.push            = features[3].status === 'fulfilled' ? features[3].value.data : null;
      d.csmTemplates    = features[4].status === 'fulfilled' ? features[4].value.data : null;
      d.msmIntegrations = features[5].status === 'fulfilled' ? features[5].value.data : null;
      d.genesis         = features[6].status === 'fulfilled' ? features[6].value.data : null;
      d.configSchema    = features[7].status === 'fulfilled' ? features[7].value.data : null;
      d.consul          = features[8].status === 'fulfilled' ? features[8].value.data : null;
      d.schedulerJobs   = features[9].status === 'fulfilled' ? features[9].value.data : null;
      d.extensions      = features[10].status === 'fulfilled' ? features[10].value.data : null;
      d.systemPrompts   = features[11].status === 'fulfilled' ? features[11].value?.data : null;

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
        // The MOMENT, not a formatted string: the clock is formatted where it is drawn, so a
        // language switch re-reads it. Stored formatted, it kept the old language's shape beside a
        // button that had already changed, until the next fetch.
        setLastUpdate(Date.now());
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
    return html`<${Page} width="reading" title=${t('dashboard.loginTitle')}>
      <${Stack}>
        <${Text} kind="lead">${t('dashboard.loginDesc')}<//>
        <${Text} tone="muted">${t('dashboard.loginNeedOperator') || 'You need to sign in with an operator account from the header.'}<//>
      <//>
    <//>`;
  }

  // ── Access denied (server returned 403) ──
  if (accessDenied) {
    return html`<${Page} width="reading" title=${t('dashboard.accessDenied') || 'Access Denied'}>
      <${Text} kind="lead">${t('dashboard.operatorRequired') || 'You need the operator role to access the admin dashboard.'}<//>
    <//>`;
  }

  // Find active component
  const allItems = NAV_GROUPS.flatMap(g => g.items);
  const activeItem = allItems.find(i => i.id === activePage) || allItems[0];
  const ActiveComponent = activeItem.component;
  const pageInfo = PAGE_TITLES[activePage] || { key: '' };

  const tabProps = { data, reload: loadAll, session, navigate, locale, switchPage };

  // The menu: the same quiet navigation list as Settings & Controls. The node's id heads it, each
  // group is a small label, each page a row with its count; the open page sits on the sun.
  const rail = html`<${Rail} kind="navigation" label=${t('nav.admin')}><${Stack} density="compact">
    ${data?.dash?.node_id && html`<${Text} kind="mono" tone="muted">${data.dash.node_id}<//>`}
    ${NAV_GROUPS.map(group => html`<${Stack} key=${group.key} density="compact">
      <${Text} kind="label">${t(group.key)}<//>
      ${group.items.map(item => html`<${ListRow} key=${item.id} density="compact" name=${t(item.key)}
        selected=${activePage === item.id} onOpen=${() => { switchPage(item.id); setMenuOpen(false); }}
        value=${item.count != null && counts[item.count] != null ? counts[item.count] : null} />`)}
    <//>`)}
  <//><//>`;

  return html`<${Page} width="wide" rail=${rail} railSide="leading" railLabel=${t('nav.admin')}
    railOpen=${menuOpen} onRailOpen=${() => setMenuOpen(true)} onRailClose=${() => setMenuOpen(false)}
    title=${t(pageInfo.key)}
    actions=${html`<${Action} onClick=${loadAll} disabled=${loading}>${loading ? t('dashboard.loading') : t('dashboard.refresh')}<//>
      ${lastUpdate && html`<${Text} kind="mono" tone="muted">${fmtTime(lastUpdate)}<//>`}`}>
    ${error && html`<${Surface} kind="aside" tone="danger" role="alert"><${Stack} density="compact">
      <${Text} kind="label">${t('dashboard.failedToLoad')}<//><${Text}>${error}<//>
    <//><//>`}
    ${!data && !error && html`<${Stack} direction="horizontal" align="center"><${Spinner} /><${Text} tone="muted">${t('dashboard.loading')}<//><//>`}
    ${data && html`<${ActiveComponent} ...${tabProps} />`}
  <//>`;
}
