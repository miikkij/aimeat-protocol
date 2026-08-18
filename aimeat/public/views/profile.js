/**
 * @file profile.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile SPA shell — the authenticated user dashboard. Owns the
 *   tab registry (tier-gated), the active-tab/visited-tab state, live-update
 *   wiring, stats aggregation, and a local showToast() passed down to every tab
 *   as a prop (one of the codebase's toast pathways; see note at its definition).
 * @structure TABS registry, default Profile() component (state, showToast,
 *   updateStats, navigate, renderTab) rendering LandingPage + a toast pill.
 * @usage Lazy-loaded route component for /v1/profile.
 * @version-history
 *   2026-07-19 — AppDev tab (KB UI): learned-pitfall + template management surface, start-prompt copy, model badge
 *   v1.3.0 — 2026-07-06 — Toast fix: drop the .pf.toast-container wrapper (its
 *     fixed+transform box was the containing block of the fixed .toast inside,
 *     collapsing it to a one-character-per-line sliver) and adopt Toast.js's
 *     canonical .toast.toast-{type} markup + normalizeToastType so string kinds
 *     ('success'/'info'/'warning') stop rendering as red error toasts.
 *   v1.2.0 — 2026-06-09 — Persist the remembered tab in sessionStorage instead of
 *     localStorage (aimeat-profile-tab) so it is per browser tab; matches the
 *     landing page, which owns the actual restored-on-F5 view.
 *   v1.1.0 — 2026-06-02 — Component unification (#10 toast): tokenized the
 *     shared .toast colors in theme.css (--toast-*) and documented this shell's
 *     showToast as a distinct, intentionally-not-migrated toast pathway. Added
 *     this header (campsite rule — file previously had none).
 *   v1.0.0 — prior — Profile SPA shell.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { normalizeToastType } from '/components/Toast.js';
import { getSession, onAuthChange } from '/js/services/auth.js';
import { connect, disconnect, onUpdate, offUpdate } from '/lib/live-updates.js';
import { apiGet } from '/js/api.js';
import * as nodesService from '/js/services/nodes.js';

// === Landing page (adaptive dashboard) ===
import LandingPage, { computeTier } from './profile/landing-page.js';

// === Tab modules (lazy-loaded on first visit, stay mounted) ===
import PortfolioTab from './profile/portfolio-tab.js';
import AgentsTab from './profile/agents-tab.js';
import EcosystemTab from './profile/ecosystem-tab.js';
import ChatSessionsTab from './profile/chat-sessions-tab.js';
import McpTab from './profile/mcp-tab.js';
import WalletTab from './profile/wallet-tab.js';
import UsageTab from './profile/usage-tab.js';
import { PnlTab } from './profile/pnl-tab.js';
import { CompaniesTab } from './profile/companies-tab.js';
import MemoryTab from './profile/memory-tab.js';
import WorkTab from './profile/work-tab.js';
import ServicesTab from './profile/services-tab.js';
import BoardsTab from './profile/boards-tab.js';
import AppsTab from './profile/apps-tab.js';
import ExtensionsTab from './profile/extensions-tab.js';
import FederationTab from './profile/federation-tab.js';
import NodesTab from './profile/nodes-tab.js';
import AccessTab from './profile/access-tab.js';
import DataWalletTab from './profile/data-wallet-tab.js';
import NodeStatsTab from './profile/node-stats-tab.js';
import AppDevTab from './profile/appdev-tab.js';
import SecurityTab from './profile/security-tab.js';
import EmailTab from './profile/email-tab.js';
import KnowledgeTab from './profile/knowledge-tab.js';
import SkillsTab from './profile/skills-tab.js';
import OrganismsTab from './profile/organisms-tab.js';
import OffersTab from './profile/offers-tab.js';
import NotificationsTab from './profile/notifications-tab.js';
import { OpenRouterSettings } from './profile/openrouter-settings.js';
import { AiTransparencyCard } from './profile/ai-transparency-card.js';
import CalibratorTab from './profile/calibrator-tab.js';
import PackagesTab from './profile/packages-tab.js';
import CapabilitiesTab from './profile/capabilities-tab.js';
import SchedulerTab from './profile/scheduler-tab.js';
import WorkflowsTab from './profile/workflows-tab.js';
import InboxTab from './profile/inbox-tab.js';
import ContactsTab from './profile/contacts-tab.js';
import NotebookTab from './profile/notebook-tab.js';
import LivingTab from './profile/living-tab.js';
import DiscoverTab from './profile/discover-tab.js';
import LibrariesTab from './profile/libraries-tab.js';

// Each tab has a minTier: 'new' | 'active' | 'experienced'
// Tabs with minTier <= current tier are visible in the tab bar.
// Deep links (?tab=X) bypass tier filtering.
// The former "Generator" tab now hosts only the AI-provider (OpenRouter) settings,
// opened by default. The Generator feature itself was removed.
// The AI tab hosts the provider settings AND, below them, the owner's own transparency view: what
// they published with a model in it, how much of it carries a label, and what this node records
// about a model call (TARGET-058 Phase 8 — the deployer's access to the logging policy).
function OpenRouterTab(props) {
  return html`
    <${OpenRouterSettings} ...${props} startOpen=${true} />
    <${AiTransparencyCard} />`;
}

const TABS = [
  { id: 'messages',      key: 'profile.tabs.inbox',          component: InboxTab,          minTier: 'new' },
  { id: 'contacts',      key: 'contacts.tabLabel',           component: ContactsTab,       minTier: 'new' },
  { id: 'discover',      key: 'discover.tabLabel',           component: DiscoverTab,       minTier: 'new' },
  { id: 'portfolio',     key: 'portfolio.tabLabel',          component: PortfolioTab,      minTier: 'active' },
  { id: 'agents',        key: 'profile.tabs.agents',         component: AgentsTab,         minTier: 'active' },
  { id: 'ecosystem',     key: 'profile.tabs.ecosystem',      component: EcosystemTab,      minTier: 'active' },
  { id: 'offers',        key: 'profile.tabs.offers',         component: OffersTab,         minTier: 'active' },
  { id: 'scheduler',     key: 'profile.tabs.scheduler',      component: SchedulerTab,      minTier: 'active' },
  { id: 'workflows',     key: 'profile.tabs.workflows',      component: WorkflowsTab,      minTier: 'active' },
  { id: 'chatsessions',  key: 'profile.tabs.chatSessions',   component: ChatSessionsTab,   minTier: 'active' },
  // 'new', not 'active': this tab hosts Hello MCP, which is the FIRST thing a brand-new user is
  // sent to. Gating it behind 'active' hid the onboarding surface from exactly the people it is for.
  { id: 'mcp',           key: 'profile.tabs.mcp',            component: McpTab,            minTier: 'new' },
  { id: 'wallet',        key: 'profile.tabs.wallet',         component: WalletTab,         minTier: 'new' },
  { id: 'usage',         key: 'profile.tabs.usage',          component: UsageTab,          minTier: 'new' },
  { id: 'pnl',           key: 'profile.tabs.pnl',            component: PnlTab,            minTier: 'active' },
  { id: 'companies',     key: 'profile.tabs.companies',      component: CompaniesTab,      minTier: 'active' },
  { id: 'knowledge',     key: 'knowledge.tabLabel',          component: KnowledgeTab,      minTier: 'active' },
  { id: 'skills',        key: 'skills.tabLabel',             component: SkillsTab,         minTier: 'active' },
  { id: 'organisms',     key: 'profile.tabs.organisms',      component: OrganismsTab,      minTier: 'active' },
  { id: 'memory',        key: 'profile.tabs.memory',         component: MemoryTab,         minTier: 'new' },
  { id: 'notebook',      key: 'profile.tabs.notebook',       component: NotebookTab,       minTier: 'new' },
  { id: 'living',        key: 'profile.tabs.living',         component: LivingTab,         minTier: 'new' },
  { id: 'work',          key: 'profile.tabs.work',           component: WorkTab,           minTier: 'active' },
  { id: 'actions',       key: 'profile.tabs.services',       component: ServicesTab,       minTier: 'active' },
  { id: 'boards',        key: 'profile.tabs.boards',         component: BoardsTab,         minTier: 'active' },
  { id: 'apps',          key: 'profile.tabs.apps',           component: AppsTab,           minTier: 'active' },
  { id: 'appdev',        key: 'profile.tabs.appDev',         component: AppDevTab,         minTier: 'active' },
  { id: 'extensions',    key: 'profile.tabs.extensions',     component: ExtensionsTab,     minTier: 'active' },
  { id: 'capabilities', key: 'capabilities.tabLabel',       component: CapabilitiesTab,   minTier: 'active' },
  { id: 'federation',    key: 'profile.tabs.federation',     component: FederationTab,     minTier: 'experienced' },
  { id: 'nodes',         key: 'profile.tabs.nodes',          component: NodesTab,          minTier: 'experienced' },
  { id: 'access',        key: 'profile.tabs.access',         component: AccessTab,         minTier: 'new' },
  { id: 'dataWallet',    key: 'profile.tabs.dataWallet',     component: DataWalletTab,     minTier: 'active' },
  { id: 'nodeStats',     key: 'profile.tabs.nodeStats',      component: NodeStatsTab,      minTier: 'experienced' },
  { id: 'security',      key: 'profile.tabs.security',       component: SecurityTab,       minTier: 'experienced' },
  { id: 'email',         key: 'profile.tabs.email',          component: EmailTab,          minTier: 'new' },
  { id: 'notifications', key: 'profile.tabs.notifications',  component: NotificationsTab,  minTier: 'active' },
  // 'new', not 'active', for the same reason as the mcp tab above: the own-key road is one of the
  // two ways OFF the node's key, offered to a brand-new person by the chat's status line — a door
  // that leads to a tab the menu refuses to show is a dead end.
  { id: 'generator',     key: 'profile.generator.openrouter.title', component: OpenRouterTab, minTier: 'new' },
  { id: 'calibrator',   key: 'profile.calibrator.tabLabel', component: CalibratorTab,     minTier: 'active' },
  { id: 'packages',      key: 'profile.tabs.packages',       component: PackagesTab,       minTier: 'active' },
  { id: 'libraries',     key: 'librariesTab.tabLabel',       component: LibrariesTab,      minTier: 'new' },
];

export default function Profile({ navigate, locale }) {
  const [session, setSession] = useState(null);
  const savedTab = () => {
    const id = sessionStorage.getItem('aimeat-profile-tab');
    // Default to 'home' (landing page) instead of a specific tab
    if (id === 'home') return 'home';
    return id && TABS.some(t => t.id === id) ? id : 'home';
  };
  const [, setActiveTab] = useState(savedTab);
  const [, setVisitedTabs] = useState(() => {
    const initial = savedTab();
    return initial === 'home' ? new Set() : new Set([initial]);
  });
  const [stats, setStats] = useState({
    agents: '-', ecosystem: '-', chatSessions: '-', balance: '-', memory: '-',
    services: '-', work: '-', apps: '-', files: '-', nodes: '-',
  });
  const [toast, setToast] = useState(null);
  // The home composite (/v1/owner/home) already returns the full usage summary + agent list the Usage and
  // Agents cards render — thread them so those cards skip their own duplicate /v1/owner/usage + /v1/agents
  // mount fetch (they still re-fetch on live-update for freshness).
  const [homeExtras, setHomeExtras] = useState(null);
  const toastTimer = useRef(null);

  // NOTE: this is a toast pathway alongside /components/Toast.js's useToast()
  // and the admin shell's useToast tuple. It keeps its own state (showToast is
  // passed down to every tab as a prop) but now renders Toast.js's canonical
  // bare <.toast.toast-{type}> markup and shares its kind normalization. The
  // old <.pf.toast-container> wrapper was removed: its fixed+transform box
  // became the containing block of the fixed .toast inside, collapsing it to
  // a zero-width column (one character per line).
  const showToast = useCallback((msg, kind) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type: normalizeToastType(kind) });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const updateStats = useCallback((partial) => {
    setStats(prev => ({ ...prev, ...partial }));
  }, []);

  // Compute tier from stats + session (re-computed on every stats change)
  const tier = useMemo(() => {
    if (!session) return 'new';
    return computeTier(stats, session);
  }, [stats, session]);

  // visibleTabs kept for deep-link support — tab bar removed from UI
  // but tier filtering still applies to which tabs can be navigated to via landing page

  // Auth listener
  useEffect(() => {
    const s = getSession();
    if (s) setSession(s);
    return onAuthChange(() => {
      const ns = getSession();
      setSession(ns);
      if (!ns) {
        setActiveTab('home');
        setVisitedTabs(new Set());
        sessionStorage.removeItem('aimeat-profile-tab');
      }
    });
  }, []);

  // URL tab param (deep links bypass tier filtering)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && TABS.some(t => t.id === tab)) {
      setActiveTab(tab);
      setVisitedTabs(prev => { const next = new Set(prev); next.add(tab); return next; });
    }
  }, []);

  useViewCSS('/css/views/profile.css');

  // Load all stats on mount so the stats bar shows counts immediately. ONE composite call
  // (GET /v1/owner/home, HomeDashboardService) replaces the old 8-request fan-out — the server
  // resolves the owner's agent list once and returns every stat count together. Federation node
  // count stays its own call (a different plane, not in the account-domain composite).
  useEffect(() => {
    if (!session) return;
    Promise.allSettled([
      apiGet('/v1/owner/home'),
      nodesService.listNodes(),
    ]).then(([home, nodes]) => {
      const s = {};
      if (home.status === 'fulfilled') {
        const d = home.value?.data || {};
        const st = d.stats || {};
        s.agents = st.agents ?? 0;
        s.chatSessions = st.chatSessions ?? 0;
        s.balance = st.balance ?? '-';
        s.memory = st.memory ?? 0;
        s.files = st.files ?? 0;
        s.services = st.services ?? 0;
        s.work = st.work ?? 0;
        s.apps = st.apps ?? 0;
        setHomeExtras({ usage: d.usage ?? null, agents: Array.isArray(d.agents) ? d.agents : null });
      }
      if (nodes.status === 'fulfilled') {
        const list = nodes.value;
        s.nodes = Array.isArray(list) ? list.length : 0;
      }
      updateStats(s);
    });
  }, [session, updateStats]);

  // SSE live updates — broadcast a custom event carrying WHICH domains changed so tabs can
  // re-fetch selectively (detail.domains is a Set<string>, or null = everything changed).
  useEffect(() => {
    if (!session) return;
    const notifyTabs = (domains) => {
      window.dispatchEvent(new CustomEvent('aimeat-live-update', { detail: { domains } }));
    };
    connect(() => getSession()?.jwt);
    onUpdate(notifyTabs);
    return () => {
      offUpdate(notifyTabs);
      disconnect();
    };
  }, [session]);

  // Common props passed to all tabs. Memoised so renderTab's identity is stable
  // across renders that don't change these inputs (avoids remounting the shown tab).
  const tabProps = useMemo(
    () => ({ session, showToast, onStats: updateStats, navigate, locale }),
    [session, showToast, updateStats, navigate, locale],
  );

  // Render a tab component by ID — called by LandingPage to show content inline
  const renderTab = useCallback((tabId) => {
    const tab = TABS.find(t => t.id === tabId);
    if (!tab) return null;
    return html`<${tab.component} ...${tabProps} />`;
  }, [tabProps]);

  // Get tab label by ID
  const getTabLabel = useCallback((tabId) => {
    const tab = TABS.find(t => t.id === tabId);
    return tab ? t(tab.key) : tabId;
  }, []);

  // Not logged in — guard placed AFTER the hooks above (Rules of Hooks).
  if (!session) {
    return html`
      <div class="bg-aurora" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none">
        <div class="aurora-wave"></div><div class="aurora-wave"></div><div class="aurora-wave"></div>
      </div>
      <div class="pf">
        <div class="login-prompt">
          <h1>\u{1F496} ${t('profile.signInTitle')}</h1>
          <p>${t('profile.signInDesc')}</p>
        </div>
      </div>`;
  }

  return html`
    <div class="pf">
      <${LandingPage}
        tier=${tier}
        stats=${stats}
        homeUsage=${homeExtras?.usage}
        homeAgents=${homeExtras?.agents}
        session=${session}
        navigate=${navigate}
        showToast=${showToast}
        locale=${locale}
        renderTab=${renderTab}
        getTabLabel=${getTabLabel}
      />
    </div>

    <!-- Toast -->
    ${toast && html`<div class="toast toast-${toast.type}">${toast.msg}</div>`}`;
}
