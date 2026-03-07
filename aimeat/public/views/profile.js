import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { getSession, getNodeUrl, onAuthChange } from '/js/services/auth.js';

// === Tab modules (lazy-loaded on first visit, stay mounted) ===
import PortfolioTab from './profile/portfolio-tab.js';
import AgentsTab from './profile/agents-tab.js';
import ChatSessionsTab from './profile/chat-sessions-tab.js';
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
import NotificationsTab from './profile/notifications-tab.js';

const TABS = [
  { id: 'portfolio',    key: 'portfolio.tabLabel',         component: PortfolioTab },
  { id: 'agents',       key: 'profile.tabs.agents',        component: AgentsTab },
  { id: 'chatsessions', key: 'profile.tabs.chatSessions',  component: ChatSessionsTab },
  { id: 'wallet',       key: 'profile.tabs.wallet',        component: WalletTab },
  { id: 'knowledge',    key: 'knowledge.tabLabel',          component: KnowledgeTab },
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
];

export default function Profile({ navigate, locale }) {
  const NODE_URL = getNodeUrl();
  const [session, setSession] = useState(null);
  const [activeTab, setActiveTab] = useState('agents');
  const [visitedTabs, setVisitedTabs] = useState(new Set(['agents']));
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

  // Tab switching
  function switchTab(tabId) {
    setActiveTab(tabId);
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
    <div class="pf">
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
