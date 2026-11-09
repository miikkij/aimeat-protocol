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
 *   2026-11-09 — A tab's module is imported when the tab first opens (TABS `load`, LazyTab), not with
 *     this file: a Settings page loaded all 53 tabs and 859 module files before (perf round 4).
 *   2026-11-08 — The "Contexts" tab (views/profile/contexts-tab.js, id 'contexts'): the person's
 *     contexts, which their AI keeps and shapes in chat, with who can read each one, archive and
 *     delete (wish-oma-konteksti-muoto-syntyy-k-yt-ss-n-kym-pyynn-st).
 *   2026-11-07 — The "Receivers" tab (views/profile/receivers-tab.js, id 'receivers'): the addresses and
 *     keys through which an outside program writes into one place of the person's data
 *     (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 *   2026-11-02 — The "Data you share" tab (views/profile/shared-data-tab.js, id 'sharedData'): every data
 *     package the person shares, who reads it, and the data products, moved from Offers (WP11).
 *   2026-10-31 — The AI tab hands its three cards (decision model, transparency, compliance) to the
 *     page as `extras`, so a buyer's simple view keeps them inside "Lisäasetukset" (v31 K58).
 *   2026-10-29 — The "Your own storage" tab (views/profile/storage-tab.js, id 'storage'): a person keeps
 *     their files in their own S3 bucket or Azure container (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 *   2026-10-25 — The "Goals" tab (views/profile/goals-tab.js): the agents' goals and their rules.
 *   2026-10-24 — The "Agreements" tab (views/profile/agreements-tab.js): the data processing agreements in
 *     which the person is the counterparty, and the four ways to sign them (plan doc-mvmr4i2wdk0p).
 *   2026-10-18 — The "What others can see" tab (views/profile/exposure-tab.js): what of the person's own
 *     a stranger can read, and how to close it (plan doc-mvcn6c7e4e5q, V6.2).
 *   2026-10-09 — The Visibility tab (views/profile/visibility-tab.js): AI visibility and on-page behaviour.
 *   2026-10-01 — The packages tab is shown from the 'new' tier: the menu names it "Get apps" (decision D8).
 *   2026-09-26 — The root and the toast pill are components (SettingsRoot in components/SettingsFrame.js,
 *     ToastBox in components/Toast.js): this file writes no class (page group G8).
 *   2026-09-13 — The toast pill shows above an open dialog (raiseAboveDialogs in /js/dialog.js)
 *     instead of under its dimmed backdrop.
 *   2026-09-06 — The signed-out wall is the door (profile/door.js): it names where the address leads
 *     (Settings & Controls → the tab the URL asks for), offers sign-in and an account, and the shell
 *     renders the site footer under it. The old wall ("Your AIMEAT Profile" under an aurora theme.css
 *     had turned off) was a title on a blank page.
 *   2026-09-03 — The AI tab (id 'ai', alias 'generator') renders the poster-face AI page
 *     (profile/ai-tab.js) instead of the collapsible OpenRouter panel.
 *   2026-09-03 — A `fleet` tab: "Your agents", the Agents v2 section, which was a page reached by a
 *     sidebar link above the menu rather than through it. The Agents tab below it is untouched.
 *   2026-08-29 — A signed-out ?tab=mcp goes to the connect story (/v1/connect-your-ai) instead of the
 *     sign-in wall, and the wall's heading lost its emoji.
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
import { normalizeToastType, ToastBox } from '/components/Toast.js';
import { SettingsRoot } from '/components/SettingsFrame.js';
import { getSession, onAuthChange } from '/js/services/auth.js';
import { connect, disconnect, onUpdate, offUpdate } from '/lib/live-updates.js';
import { apiGet } from '/js/api.js';
import * as nodesService from '/js/services/nodes.js';
import { swallowed } from '/js/swallowed.js';
import { Note } from '/components/Note.js';
import { LoadingLine } from './profile/shared.js';

// === Landing page (adaptive dashboard) ===
import LandingPage, { computeTier } from './profile/landing-page.js';
// === The door a signed-out visitor sees ===
import SignedOutDoor from './profile/door.js';

// === Tab modules: each is imported when its tab first opens (LazyTab below), not with this file ===
const byDefault = (m) => m.default;

// The AI tab (route id 'ai'; 'generator' is its old name and still resolves, because the chat, the
// home cards and two account-event links point at it): the provider settings in the poster face
// AND, below them, the owner's own transparency view: what they published with a model in it, how
// much of it carries a label, and what this node records about a model call (TARGET-058 Phase 8).
const loadAiTab = () => Promise.all([
  import('./profile/ai-tab.js'),
  import('./profile/decide-card.js'),
  import('./profile/ai-transparency-card.js'),
  import('./profile/compliance-card.js'),
]).then(([{ default: AiSettingsTab }, { DecideCard }, { AiTransparencyCard }, { ComplianceCard }]) =>
  function AiTab(props) {
    // The page draws the three cards: after itself, or inside "Lisäasetukset" for a buyer (v31 K58).
    return html`
      <${AiSettingsTab} ...${props} extras=${html`
        <${DecideCard} />
        <${AiTransparencyCard} />
        <${ComplianceCard} />`} />`;
  });

/** Old tab ids that still arrive in links and in a remembered session. */
const TAB_ALIASES = { generator: 'ai' };
const canonicalTab = (id) => TAB_ALIASES[id] || id;

// Each tab has a minTier: 'new' | 'active' | 'experienced'
// Tabs with minTier <= current tier are visible in the tab bar.
// Deep links (?tab=X) bypass tier filtering.
// `load` resolves to the tab's component; it is called the first time the tab opens.
const TABS = [
  { id: 'messages',      key: 'profile.tabs.inbox',          load: () => import('./profile/inbox-tab.js').then(byDefault),          minTier: 'new' },
  { id: 'contacts',      key: 'contacts.tabLabel',           load: () => import('./profile/contacts-tab.js').then(byDefault),       minTier: 'new' },
  { id: 'discover',      key: 'discover.tabLabel',           load: () => import('./profile/discover-tab.js').then(byDefault),       minTier: 'new' },
  { id: 'portfolio',     key: 'portfolio.tabLabel',          load: () => import('./profile/portfolio-tab.js').then(byDefault),      minTier: 'active' },
  { id: 'fleet',         key: 'profile.tabs.fleet',          load: () => import('./profile/fleet-tab.js').then(byDefault),          minTier: 'active' },
  { id: 'agents',        key: 'profile.tabs.agents',         load: () => import('./profile/agents-tab.js').then(byDefault),         minTier: 'active' },
  { id: 'ecosystem',     key: 'profile.tabs.ecosystem',      load: () => import('./profile/ecosystem-tab.js').then(byDefault),      minTier: 'active' },
  { id: 'offers',        key: 'profile.tabs.offers',         load: () => import('./profile/offers-tab.js').then(byDefault),         minTier: 'active' },
  { id: 'scheduler',     key: 'profile.tabs.scheduler',      load: () => import('./profile/scheduler-tab.js').then(byDefault),      minTier: 'active' },
  { id: 'workflows',     key: 'profile.tabs.workflows',      load: () => import('./profile/workflows-tab.js').then(byDefault),      minTier: 'active' },
  { id: 'receivers',     key: 'profile.tabs.receivers',      load: () => import('./profile/receivers-tab.js').then(byDefault),      minTier: 'active' },
  { id: 'goals',         key: 'profile.tabs.goals',          load: () => import('./profile/goals-tab.js').then(byDefault),          minTier: 'active' },
  { id: 'chatsessions',  key: 'profile.tabs.chatSessions',   load: () => import('./profile/chat-sessions-tab.js').then(byDefault),  minTier: 'active' },
  // 'new', not 'active': this tab hosts Hello MCP, which is the FIRST thing a brand-new user is
  // sent to. Gating it behind 'active' hid the onboarding surface from exactly the people it is for.
  { id: 'mcp',           key: 'profile.tabs.mcp',            load: () => import('./profile/mcp-tab.js').then(byDefault),            minTier: 'new' },
  { id: 'wallet',        key: 'profile.tabs.wallet',         load: () => import('./profile/wallet-tab.js').then(byDefault),         minTier: 'new' },
  { id: 'usage',         key: 'profile.tabs.usage',          load: () => import('./profile/usage-tab.js').then(byDefault),          minTier: 'new' },
  { id: 'visibility',    key: 'profile.tabs.visibility',     load: () => import('./profile/visibility-tab.js').then(byDefault),     minTier: 'new' },
  { id: 'pnl',           key: 'profile.tabs.pnl',            load: () => import('./profile/pnl-tab.js').then((m) => m.PnlTab),      minTier: 'active' },
  { id: 'companies',     key: 'profile.tabs.companies',      load: () => import('./profile/companies-tab.js').then((m) => m.CompaniesTab), minTier: 'active' },
  { id: 'knowledge',     key: 'knowledge.tabLabel',          load: () => import('./profile/knowledge-tab.js').then(byDefault),      minTier: 'active' },
  { id: 'skills',        key: 'skills.tabLabel',             load: () => import('./profile/skills-tab.js').then(byDefault),         minTier: 'active' },
  { id: 'organisms',     key: 'profile.tabs.organisms',      load: () => import('./profile/organisms-tab.js').then(byDefault),      minTier: 'active' },
  { id: 'memory',        key: 'profile.tabs.memory',         load: () => import('./profile/memory-tab.js').then(byDefault),         minTier: 'new' },
  { id: 'contexts',      key: 'profile.tabs.contexts',       load: () => import('./profile/contexts-tab.js').then(byDefault),       minTier: 'new' },
  { id: 'notebook',      key: 'profile.tabs.notebook',       load: () => import('./profile/notebook-tab.js').then(byDefault),       minTier: 'new' },
  { id: 'living',        key: 'profile.tabs.living',         load: () => import('./profile/living-tab.js').then(byDefault),         minTier: 'new' },
  { id: 'work',          key: 'profile.tabs.work',           load: () => import('./profile/work-tab.js').then(byDefault),           minTier: 'active' },
  { id: 'actions',       key: 'profile.tabs.services',       load: () => import('./profile/services-tab.js').then(byDefault),       minTier: 'active' },
  { id: 'boards',        key: 'profile.tabs.boards',         load: () => import('./profile/boards-tab.js').then(byDefault),         minTier: 'active' },
  { id: 'apps',          key: 'profile.tabs.apps',           load: () => import('./profile/apps-tab.js').then(byDefault),           minTier: 'active' },
  { id: 'appdev',        key: 'profile.tabs.appDev',         load: () => import('./profile/appdev-tab.js').then(byDefault),         minTier: 'active' },
  { id: 'extensions',    key: 'profile.tabs.extensions',     load: () => import('./profile/extensions-tab.js').then(byDefault),     minTier: 'active' },
  { id: 'capabilities', key: 'capabilities.tabLabel',       load: () => import('./profile/capabilities-tab.js').then(byDefault),   minTier: 'active' },
  { id: 'federation',    key: 'profile.tabs.federation',     load: () => import('./profile/federation-tab.js').then(byDefault),     minTier: 'experienced' },
  { id: 'nodes',         key: 'profile.tabs.nodes',          load: () => import('./profile/nodes-tab.js').then(byDefault),          minTier: 'experienced' },
  { id: 'access',        key: 'profile.tabs.access',         load: () => import('./profile/access-tab.js').then(byDefault),         minTier: 'new' },
  { id: 'exposure',      key: 'profile.tabs.exposure',       load: () => import('./profile/exposure-tab.js').then(byDefault),       minTier: 'new' },
  { id: 'agreements',    key: 'profile.tabs.agreements',     load: () => import('./profile/agreements-tab.js').then(byDefault),     minTier: 'new' },
  { id: 'sharedData',    key: 'profile.tabs.sharedData',     load: () => import('./profile/shared-data-tab.js').then(byDefault),    minTier: 'new' },
  { id: 'dataWallet',    key: 'profile.tabs.dataWallet',     load: () => import('./profile/data-wallet-tab.js').then(byDefault),    minTier: 'active' },
  { id: 'storage',       key: 'profile.tabs.storage',        load: () => import('./profile/storage-tab.js').then(byDefault),        minTier: 'new' },
  { id: 'nodeStats',     key: 'profile.tabs.nodeStats',      load: () => import('./profile/node-stats-tab.js').then(byDefault),     minTier: 'experienced' },
  // 'new', not 'experienced': this tab is where two-step sign-in is switched on, and that is not an
  // expert setting — it is the first thing a careful person looks for after making an account.
  // Behind 'experienced' the control existed and nobody could find it.
  { id: 'security',      key: 'profile.tabs.security',       load: () => import('./profile/security-tab.js').then(byDefault),       minTier: 'new' },
  { id: 'email',         key: 'profile.tabs.email',          load: () => import('./profile/email-tab.js').then(byDefault),          minTier: 'new' },
  { id: 'notifications', key: 'profile.tabs.notifications',  load: () => import('./profile/notifications-tab.js').then(byDefault),  minTier: 'active' },
  // 'new', not 'active', for the same reason as the mcp tab above: the own-key road is one of the
  // two ways OFF the node's key, offered to a brand-new person by the chat's status line — a door
  // that leads to a tab the menu refuses to show is a dead end.
  { id: 'ai',            key: 'profile.generator.openrouter.title', load: loadAiTab,                                                 minTier: 'new' },
  { id: 'calibrator',   key: 'profile.calibrator.tabLabel', load: () => import('./profile/calibrator-tab.js').then(byDefault),     minTier: 'active' },
  // 'new': the menu shows it as "Get apps" under Apps, the place a newcomer's first apps come from.
  { id: 'packages',      key: 'profile.tabs.packages',       load: () => import('./profile/packages-tab.js').then(byDefault),       minTier: 'new' },
  { id: 'libraries',     key: 'librariesTab.tabLabel',       load: () => import('./profile/libraries-tab.js').then(byDefault),      minTier: 'new' },
];

/** A tab's component once its module has loaded, by tab id, so a tab opened again draws at once. */
const loadedTabs = new Map();

/**
 * One tab: its component when its module has loaded, the loading line until then. The module is
 * imported on the first visit only; the browser keeps the module, and `loadedTabs` the component.
 */
function LazyTab({ tab, tabProps }) {
  const [Component, setComponent] = useState(() => loadedTabs.get(tab.id) || null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (Component) return undefined;
    let current = true;
    tab.load().then(
      (loaded) => {
        loadedTabs.set(tab.id, loaded);
        if (current) setComponent(() => loaded);
      },
      (err) => {
        swallowed(`profile: load tab ${tab.id}`, err);
        if (current) setFailed(true);
      },
    );
    return () => { current = false; };
  }, [tab, Component]);
  if (Component) return html`<${Component} ...${tabProps} />`;
  if (failed) return html`<${Note} error>${t('common.loadFailed')}<//>`;
  return html`<${LoadingLine} />`;
}

export default function Profile({ navigate, locale }) {
  const [session, setSession] = useState(null);
  const savedTab = () => {
    const id = canonicalTab(sessionStorage.getItem('aimeat-profile-tab'));
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

  // A signed-out visitor asking for the connections tab (the front page's "connect the AI you
  // already use" door) gets the story of what that means, not a wall that says sign in. The
  // stored session is read synchronously, so a signed-in person never sees the detour.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'mcp' && !getSession()) navigate('/v1/connect-your-ai');
  }, [navigate]);

  // URL tab param (deep links bypass tier filtering)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = canonicalTab(params.get('tab'));
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
    // Keyed by the tab id: another tab is another LazyTab, as another component was before.
    return html`<${LazyTab} key=${tab.id} tab=${tab} tabProps=${tabProps} />`;
  }, [tabProps]);

  // Get tab label by ID
  const getTabLabel = useCallback((tabId) => {
    const tab = TABS.find(t => t.id === tabId);
    return tab ? t(tab.key) : tabId;
  }, []);

  // Not logged in — guard placed AFTER the hooks above (Rules of Hooks). The door says where the
  // address leads: the tab the URL names, when this registry knows it; otherwise the profile alone.
  if (!session) {
    const asked = canonicalTab(new URLSearchParams(window.location.search).get('tab'));
    const askedTab = TABS.find(x => x.id === asked);
    return html`<${SignedOutDoor} navigate=${navigate} tabLabel=${askedTab ? t(askedTab.key) : null} />`;
  }

  return html`
    <${SettingsRoot}>
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
    <//>

    <!-- Toast -->
    <${ToastBox} toast=${toast} />`;
}
