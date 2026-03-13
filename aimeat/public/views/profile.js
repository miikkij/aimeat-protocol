import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { getSession, getNodeUrl, onAuthChange } from '/js/services/auth.js';
import { connect, disconnect, onUpdate, offUpdate } from '/lib/live-updates.js';
import { listAgents } from '/js/services/agents.js';
import { getWallet } from '/js/services/wallet.js';
import * as memoryService from '/js/services/memory.js';
import { listMyServices } from '/js/services/catalogue.js';
import { listInbox } from '/js/services/work.js';
import { listApps } from '/js/services/apps.js';
import * as nodesService from '/js/services/nodes.js';

// === Tab modules (lazy-loaded on first visit, stay mounted) ===
import PortfolioTab from './profile/portfolio-tab.js';
import AgentsTab from './profile/agents-tab.js';
import ChatSessionsTab from './profile/chat-sessions-tab.js';
import McpTab from './profile/mcp-tab.js';
import WalletTab from './profile/wallet-tab.js';
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
import SecurityTab from './profile/security-tab.js';
import KnowledgeTab from './profile/knowledge-tab.js';
import OrganismsTab from './profile/organisms-tab.js';
import NotificationsTab from './profile/notifications-tab.js';
import GeneratorTab from './profile/generator-tab.js';

const TABS = [
  { id: 'portfolio',    key: 'portfolio.tabLabel',         component: PortfolioTab },
  { id: 'agents',       key: 'profile.tabs.agents',        component: AgentsTab },
  { id: 'chatsessions', key: 'profile.tabs.chatSessions',  component: ChatSessionsTab },
  { id: 'mcp',          key: 'profile.tabs.mcp',            component: McpTab },
  { id: 'wallet',       key: 'profile.tabs.wallet',        component: WalletTab },
  { id: 'knowledge',    key: 'knowledge.tabLabel',          component: KnowledgeTab },
  { id: 'organisms',    key: 'profile.tabs.organisms',      component: OrganismsTab },
  { id: 'memory',       key: 'profile.tabs.memory',        component: MemoryTab },
  { id: 'work',         key: 'profile.tabs.work',          component: WorkTab },
  { id: 'actions',      key: 'profile.tabs.services',      component: ServicesTab },
  { id: 'boards',       key: 'profile.tabs.boards',        component: BoardsTab },
  { id: 'apps',         key: 'profile.tabs.apps',          component: AppsTab },
  { id: 'extensions',   key: 'profile.tabs.extensions',    component: ExtensionsTab },
  { id: 'federation',   key: 'profile.tabs.federation',    component: FederationTab },
  { id: 'nodes',        key: 'profile.tabs.nodes',         component: NodesTab },
  { id: 'access',       key: 'profile.tabs.access',        component: AccessTab },
  { id: 'dataWallet',   key: 'profile.tabs.dataWallet',    component: DataWalletTab },
  { id: 'nodeStats',    key: 'profile.tabs.nodeStats',     component: NodeStatsTab },
  { id: 'security',     key: 'profile.tabs.security',      component: SecurityTab },
  { id: 'notifications', key: 'profile.tabs.notifications', component: NotificationsTab },
  { id: 'generator', key: 'profile.generator.tabLabel', component: GeneratorTab },
];

export default function Profile({ navigate, locale }) {
  const NODE_URL = getNodeUrl();
  const [session, setSession] = useState(null);
  const savedTab = () => {
    const id = localStorage.getItem('aimeat-profile-tab');
    return id && TABS.some(t => t.id === id) ? id : 'agents';
  };
  const [activeTab, setActiveTab] = useState(savedTab);
  const [visitedTabs, setVisitedTabs] = useState(() => new Set([savedTab()]));
  const [stats, setStats] = useState({
    agents: '-', chatSessions: '-', balance: '-', memory: '-',
    services: '-', work: '-', apps: '-', files: '-', nodes: '-',
  });
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((msg, isError) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, isError });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const updateStats = useCallback((partial) => {
    setStats(prev => ({ ...prev, ...partial }));
  }, []);

  // Auth listener
  useEffect(() => {
    const s = getSession();
    if (s) setSession(s);
    return onAuthChange(() => {
      const ns = getSession();
      setSession(ns);
      if (!ns) {
        setActiveTab('agents');
        setVisitedTabs(new Set(['agents']));
        localStorage.removeItem('aimeat-profile-tab');
      }
    });
  }, []);

  // URL tab param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && TABS.some(t => t.id === tab)) {
      setActiveTab(tab);
      setVisitedTabs(prev => { const next = new Set(prev); next.add(tab); return next; });
    }
  }, []);

  useViewCSS('/css/views/profile.css');

  // Load all stats on mount so the stats bar shows counts immediately
  useEffect(() => {
    if (!session) return;
    const owner = session.owner;
    Promise.allSettled([
      listAgents(owner),
      getWallet(),
      memoryService.listMemories(),
      memoryService.listFiles(),
      listMyServices(owner),
      listInbox(),
      listApps(),
      nodesService.listNodes(),
    ]).then(([agents, wallet, memories, files, services, work, apps, nodes]) => {
      const s = {};
      if (agents.status === 'fulfilled') {
        const list = agents.value;
        s.agents = Array.isArray(list) ? list.length : 0;
        s.chatSessions = Array.isArray(list) ? list.filter(a => a.owner === owner && a.name?.startsWith('session-')).length : 0;
      }
      if (wallet.status === 'fulfilled') {
        const w = wallet.value?.data || wallet.value || {};
        s.balance = w.balance ?? '-';
      }
      if (memories.status === 'fulfilled') {
        const list = memories.value;
        s.memory = Array.isArray(list) ? list.length : 0;
      }
      if (files.status === 'fulfilled') {
        const list = files.value;
        s.files = Array.isArray(list) ? list.length : 0;
      }
      if (services.status === 'fulfilled') {
        const list = services.value;
        s.services = Array.isArray(list) ? list.length : 0;
      }
      if (work.status === 'fulfilled') {
        const list = work.value;
        s.work = Array.isArray(list) ? list.length : 0;
      }
      if (apps.status === 'fulfilled') {
        const list = apps.value;
        s.apps = Array.isArray(list) ? list.filter(a => a.owner === owner).length : 0;
      }
      if (nodes.status === 'fulfilled') {
        const list = nodes.value;
        s.nodes = Array.isArray(list) ? list.length : 0;
      }
      updateStats(s);
    });
  }, [session]);

  // SSE live updates — broadcast custom event so tabs can re-fetch
  useEffect(() => {
    if (!session) return;
    const notifyTabs = () => {
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
    };
    connect(() => getSession()?.jwt);
    onUpdate(notifyTabs);
    return () => {
      offUpdate(notifyTabs);
      disconnect();
    };
  }, [session]);

  // Tab switching
  function switchTab(tabId) {
    setActiveTab(tabId);
    localStorage.setItem('aimeat-profile-tab', tabId);
    setVisitedTabs(prev => {
      const next = new Set(prev);
      next.add(tabId);
      return next;
    });
  }

  // Not logged in
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

  // Common props passed to all tabs
  const tabProps = { session, showToast, onStats: updateStats, navigate, locale };

  return html`
    <div class="bg-aurora" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none">
      <div class="aurora-wave"></div><div class="aurora-wave"></div><div class="aurora-wave"></div>
    </div>
    <div class="pf-hero">
      <div class="pf-hero-inner">
        <!-- Profile header -->
        <div class="profile-header">
          <div class="avatar">\u{1F9D1}</div>
          <div class="profile-info">
            <h1>${escHtml(session.displayName || session.owner)}</h1>
            <div class="ghii">${escHtml(session.ghii || '')}</div>
            <div class="meta">${t('profile.node')}: ${escHtml(NODE_URL)}</div>
          </div>
        </div>

        <!-- Stats bar -->
        <div class="stats-bar">
          <div class="stat-card"><div class="num">${stats.agents}</div><div class="label">${t('profile.stats.agents')}</div></div>
          <div class="stat-card"><div class="num">${stats.chatSessions}</div><div class="label">${t('profile.stats.chatSessions')}</div></div>
          <div class="stat-card"><div class="num">${stats.balance}</div><div class="label">${t('profile.stats.morsels')}</div></div>
          <div class="stat-card"><div class="num">${stats.memory}</div><div class="label">${t('profile.stats.memories')}</div></div>
          <div class="stat-card"><div class="num">${stats.services}</div><div class="label">${t('profile.stats.services')}</div></div>
          <div class="stat-card"><div class="num">${stats.work}</div><div class="label">${t('profile.stats.tasks')}</div></div>
          <div class="stat-card"><div class="num">${stats.apps}</div><div class="label">${t('profile.stats.apps')}</div></div>
          <div class="stat-card"><div class="num">${stats.files}</div><div class="label">${t('profile.stats.files')}</div></div>
          <div class="stat-card"><div class="num">${stats.nodes}</div><div class="label">${t('profile.stats.nodes')}</div></div>
        </div>

        <!-- Tabs -->
        <div class="tabs">
          ${TABS.map(tab => html`
            <button class="tab ${activeTab === tab.id ? 'active' : ''}" onClick=${() => switchTab(tab.id)}>${t(tab.key)}</button>
          `)}
        </div>
      </div>
    </div>
    <div class="pf">

      <!-- Tab panels: mount once on first visit, show/hide with display -->
      ${TABS.filter(tab => visitedTabs.has(tab.id)).map(tab => html`
        <div key=${tab.id} style=${activeTab === tab.id ? '' : 'display:none'}>
          <${tab.component} ...${tabProps} />
        </div>
      `)}

      <!-- Toast -->
      ${toast && html`<div class="toast ${toast.isError ? 'error' : ''}">${toast.msg}</div>`}
    </div>`;
}
