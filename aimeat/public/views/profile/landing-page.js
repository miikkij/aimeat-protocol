/**
 * @file landing-page.js
 * @description Profile landing page. Navigation is a PERSISTENT, grouped sidebar
 *   (every tab always visible — no activity-based hiding) plus a content column
 *   showing either the selected tab or the home dashboard (ProfileCard +
 *   tier-based onboarding/app-strip). On mobile the sidebar is an off-canvas
 *   drawer. The logged-in pill + Logout live in the global shell header
 *   (spa.html), not here. Replaced the old new/active/experienced tier-adaptive
 *   menu, which was unpredictable for humans and agentic developers.
 * @structure
 *   - computeTier() — exported heuristic; now gates only the home onboarding content
 *   - tierLevel() — exported numeric tier comparison helper
 *   - SIDEBAR_GROUPS — grouped, always-visible tab list
 *   - ProfileCard (with PresencePill), NextSteps, CortexSection — home/section sub-components
 *   - PresencePill + PresenceDialog — header status pill that opens the availability settings dialog
 *   - LandingPage — main orchestrator (default export)
 * @version-history
 *   v3.12.1 — 2026-07-20 — Fix: the `aimeat-open-tab` handler force-opens (never toggles). Tapping a
 *     message push-notification while the Messages tab was already open toggled it CLOSED (back to
 *     Home) instead of switching to the new conversation; now it leaves the already-open tab in place
 *     and lets that tab's own listener consume the deep-link.
 *   v3.12.0 — 2026-07-16 — Drop the per-item emoji icons from the sidebar (Home, Inbox, and each
 *     grouped/pinned item render label-only) — cleaner, less visually noisy menu.
 *   v3.11.0 — 2026-07-13 — Split into sibling modules for max-file-lines: modals →
 *     landing-page.modals.js, home cards + sidebar → landing-page.cards.js, and time/nav/
 *     format helpers → landing-page.helpers.js. Behavior, exports (computeTier/tierLevel/
 *     default LandingPage), and hook order unchanged.
 *   v3.10.0 — 2026-07-11 — Home AgentLedgerCard: owner's agent LLM ledger (cost / tokens / LLM-calls
 *     tiles + a top-5 by-model breakdown) backed by GET /v1/ledger/usage?group_by=model. A distinct
 *     system from AiSpendCard (AI-apps spend) — the two are labeled and never summed. Hidden until
 *     there is any agent LLM spend.
 *   v3.9.0 — 2026-07-05 — Home AiSpendCard: 24h/7d/30d AI token + cost tiles, a per-app stacked bar
 *     of the last 30 days, and a "where it went" top-apps breakdown, backed by GET
 *     /v1/ai/usage/history. Hidden until there is any AI-apps spend.
 *   v3.8.0 — 2026-06-22 — Home UsageCard: quota usage bars (memory / files / micro-memory) + resource
 *     counts (agents, organisms, apps, connected apps, extensions, cortexes, services), backed by the
 *     cached GET /v1/owner/usage endpoint (60s server-side TTL).
 *   v3.7.0 — 2026-06-22 — WaitingForYou uses one getWaiting() call (server-aggregated) instead of the
 *     per-organism listApprovals + listJoinRequests + listWorkspaces fan-out.
 *   v3.6.0 — 2026-06-21 — Change-password modal handles OAuth accounts with no password yet
 *     (e.g. Google sign-in): fetches has_password from /v1/ghii/me and, when none is set, switches
 *     to a "set a password" flow — drops the current-password field, shows an explanatory hint, and
 *     no longer requires a current password. Lets such users enable username + password sign-in.
 *   v3.5.0 — 2026-06-20 — NextSteps recut to a curated, value-first set (write self-organizing
 *     notes → Notebook; create your portfolio → Portfolio; build an app → app-catalog create flow
 *     with ?lang=&create=1; use agents others shared → Offers) — dropped the package-manager /
 *     connect-agent steps. The portfolio step shows only when no portfolio is published yet, and
 *     the build-an-app step only when the user has no app of their own (both gated on KNOWN-missing
 *     data so an existing user never sees them flash). Browser Back now works INSIDE the profile:
 *     open()/close() push
 *     /v1/profile?tab= history entries and a popstate handler restores the tab, so Back steps
 *     through tabs to Home instead of leaving the profile (?tab= is also a working deep link now).
 *   v3.4.0 — 2026-06-20 — Home cleanup: removed the tier-'new' onboarding blocks (HeroOnboarding,
 *     KnowledgeCallout, GhostTiles) that flashed on every load (tier starts 'new' before stats land)
 *     then vanished for active/experienced users. Replaced with a state-aware <NextSteps> "suggested
 *     next steps" card computed from stats. Presence moved off the home body into a compact status
 *     pill in the ProfileCard header (<PresencePill>) that opens the settings <PresenceDialog>.
 *   v3.3.0 — 2026-06-19 — Add the PresenceControl card to the home dashboard (own availability:
 *     auto/manual status + who-can-see visibility), previewing the shared <PresenceDot>.
 *   v3.2.0 — 2026-06-10 — Sidebar reorg: groups follow the information-refinement pipeline
 *     (Information / Automation / Activity / Build & Share / Account / Infrastructure) —
 *     Daily/Personal/Technical are gone. Pinned section under Home (pin-on-hover 📌, max 5,
 *     defaults organisms/agents/memory/scheduler, persisted in user memory `sidebar.pins`);
 *     groups collapse/expand with localStorage memory; Infrastructure renders AND opens only
 *     for operators (open() refuses infra ids; APIs operator-gated server-side); Node Stats
 *     left the menu (now a sub-tab on the Nodes page); "work" parked at Build & Share bottom
 *     pending placement decision.
 *   v3.1.0 — 2026-06-10 — Sidebar identity shows the generated identicon (same seed as the profile
 *     card) instead of a plain accent ball; home-card list rows lightened (weight 500, dim color) so
 *     card titles read as headers again. Agents-card rows deep-link to the agent (primes
 *     aimeat.agents.open → agents tab expands + scrolls to it); the next-run row opens the Scheduler.
 *   v3.0.0 — 2026-06-10 — Home is a DASHBOARD ("what happened, what waits for me"): new
 *     WaitingForYou box (pending publish approvals per org/workspace + join requests + incoming
 *     invitations, with Review/View buttons that prime the organisms tab), Continue card (cross-type
 *     recents from /js/recents.js with real display names — replaces the AppStrip file listing) and
 *     Agents card (active today / last seen + next scheduled run). Extensions promo shows only while
 *     apps < 3 and is dismissable (localStorage). ProfileCard stats are navigation (click → section);
 *     profile editing moved behind a Profile button / avatar click. Edit-profile modal: avatar live
 *     preview, locale hint, real "Change in the Email tab" link, Change-password link in the footer.
 *     Change-password modal: live requirement checklist, inline mismatch, neutral Show/Hide toggles,
 *     button verb "Change password". Sidebar agents count badge removed (badges = action only).
 *   v2.3.0 — 2026-06-10 — Drop the "← Home" button from the content header (visual noise,
 *     duplicated the sidebar's 🏠 Home item); the header keeps the current-tab label.
 *   v2.2.0 — 2026-06-10 — Listen for the `aimeat-open-tab` CustomEvent so tab components can
 *     navigate to another profile tab (first user: organism home's Board tab → Boards view).
 *   v2.1.0 — 2026-06-09 — Remembered open view (openView) now persists in
 *     sessionStorage instead of localStorage, so it is per browser TAB: with
 *     multiple profile tabs open, an F5 restores that tab's own view rather than
 *     whichever tab last wrote the shared value.
 *   v2.0.0 — 2026-06-03 — Replace tier-adaptive menu with a persistent grouped sidebar
 *     + content column + mobile drawer; computeTier now only gates home onboarding.
 *   v1.2.0 — 2026-03-19 — Expandable AppStrip chips with launch button; remove Generator primary style
 *   v1.1.0 — 2026-03-19 — Persist open tab to localStorage across page reloads
 *   v1.0.0 — 2026-03-18 — Initial adaptive landing page implementation
 */
import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import htm from "htm";
const html = htm.bind(h);
import { t } from "/js/i18n.js";
import { listApps } from "/js/services/apps.js";
import { onLiveUpdate } from "/lib/live-updates.js";
import { getMemory, createMemory } from "/js/services/memory.js";
import { minidenticon } from "/lib/minidenticons.min.js";
import { syncTabHistory } from "./landing-page.helpers.js";
import { EditProfileModal, ChangePasswordModal } from "./landing-page.modals.js";
import { swallowed } from '/js/swallowed.js';
import {
  ProfileCard, WaitingForYou, NextSteps, UsageCard, AiSpendCard, AgentLedgerCard,
  CommerceCard, ContinueCard, AgentsCard, CortexSection, InboxNavButton,
  SIDEBAR_GROUPS, SIDEBAR_ITEM_BY_ID, INFRA_TAB_IDS, DEFAULT_PINS,
} from "./landing-page.cards.js";

/* ───── Tier heuristic ───── */

const TIER_LEVELS = { 'new': 0, 'active': 1, 'experienced': 2 };

/**
 * Compute user tier from stats and session data.
 * Runs on every profile load and on SSE events — no persistence needed.
 */
export function computeTier(stats, session) {
  const nodes  = typeof stats.nodes  === 'number' ? stats.nodes  : 0;
  const agents = typeof stats.agents === 'number' ? stats.agents : 0;
  const apps   = typeof stats.apps   === 'number' ? stats.apps   : 0;
  const hasOperatorRole = session.roles?.includes('operator');
  // Active requires deliberate action: installed apps or connected agents.
  // Memories alone don't count — they accumulate passively from system/agents.
  const hasActiveContent = apps > 0 || agents > 0;

  // Experienced: operator WITH active content, or has federation peers, or many agents
  if ((hasOperatorRole && hasActiveContent) || nodes > 0 || agents >= 5) return 'experienced';
  // Active: has installed apps or connected agents
  if (hasActiveContent) return 'active';
  // New: no apps, no agents (even with memories or operator role)
  return 'new';
}

/** Numeric tier level for comparison: new(0) < active(1) < experienced(2). */
export function tierLevel(tier) {
  return TIER_LEVELS[tier] || 0;
}

/* ───── Main landing page ───── */

export default function LandingPage({ tier, stats, homeUsage, homeAgents, session, showToast, renderTab, getTabLabel }) {
  const [apps, setApps] = useState([]);
  const [appsLoaded, setAppsLoaded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  // Which inline view is open (and under which slot), restored on F5. Stored in
  // sessionStorage, NOT localStorage, so the remembered position is per browser
  // TAB: with several profile tabs open, refreshing one restores ITS own view
  // instead of whichever tab last wrote a shared localStorage value.
  const [openView, setOpenView] = useState(() => {
    try {
      const saved = sessionStorage.getItem('aimeat-profile-tab');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.tabId && parsed.slot) return parsed;
      }
      // Fall back to a ?tab= deep link (also how Back/Forward restores a tab).
      const tabId = new URLSearchParams(window.location.search).get('tab');
      if (tabId) return { tabId, slot: 'main' };
    // eslint-disable-next-line aimeat/no-silent-catch -- ignore
    } catch { /* ignore */ }
    return null;
  });
  // openViewRef mirrors openView for the toggle logic in open(); fromPopRef suppresses
  // history pushes while we are REACTING to a popstate (Back/Forward) event.
  const openViewRef = useRef(null);
  const fromPopRef = useRef(false);
  openViewRef.current = openView;
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Extensions promo: onboarding-only (apps < 3) and dismissable for good.
  const [showPromo, setShowPromo] = useState(() => { try { return localStorage.getItem('aimeat.cortexPromoDismissed') !== '1'; } catch { return true; } });
  const dismissPromo = () => { setShowPromo(false); try { localStorage.setItem('aimeat.cortexPromoDismissed', '1'); } catch { /* noop */ } };   // eslint-disable-line aimeat/no-silent-catch -- noop

  const owner = session.owner;

  /* Fetch app list for app strip */
  const loadApps = useCallback(async () => {
    try {
      const list = await listApps();
      setApps(Array.isArray(list) ? list.filter(a => a.owner === owner) : []);
    } catch (err) { swallowed('landing-page', err); setApps([]); }
    finally { setAppsLoaded(true); }
  }, [owner]);

  useEffect(() => { loadApps(); }, [loadApps]);

  /* SSE live updates */
  const loadRef = useRef(loadApps);
  loadRef.current = loadApps;
  useEffect(() => onLiveUpdate(['apps'], () => loadRef.current()), []);

  /* Open a tab inline below a specific slot. Toggle if same tab clicked again. */
  const isOperator = (session?.roles || []).includes('operator');

  const open = useCallback((tabId, slot) => {
    // Infrastructure tabs are operator-only — refuse them here too so deep links
    // (sessionStorage restore, aimeat-open-tab events) can't open the views.
    // The underlying APIs enforce the role server-side regardless.
    if (INFRA_TAB_IDS.has(tabId) && !isOperator) return;
    const prev = openViewRef.current;
    const next = (prev?.tabId === tabId) ? null : { tabId, slot };
    try {
      if (next) sessionStorage.setItem('aimeat-profile-tab', JSON.stringify(next));
      else sessionStorage.removeItem('aimeat-profile-tab');
    // eslint-disable-next-line aimeat/no-silent-catch -- noop
    } catch { /* noop */ }
    // Push a history entry so Back returns here (skipped when reacting to popstate).
    if (!fromPopRef.current) syncTabHistory(next?.tabId || null, false);
    setOpenView(next);
  }, [isOperator]);

  /* ── Pinned items: 3–5 favourites under Home, persisted per user (memory key
     `sidebar.pins`, same pattern as organisms.ui). Defaults for new users. ── */
  const [pins, setPins] = useState(DEFAULT_PINS);
  useEffect(() => {
    getMemory('sidebar.pins', { soft: true })
      .then(r => { const v = r?.data?.value; if (Array.isArray(v) && v.length) setPins(v.filter(id => SIDEBAR_ITEM_BY_ID[id])); })
      // eslint-disable-next-line aimeat/no-silent-catch -- defaults stand
      .catch(() => { /* defaults stand */ });
  }, []);
  const togglePin = (id) => {
    setPins(prev => {
      let next;
      if (prev.includes(id)) next = prev.filter(x => x !== id);
      else if (prev.length >= 5) { showToast?.(t('profile.landing.pinLimit') || 'Max 5 pinned items'); return prev; }
      else next = [...prev, id];
      createMemory('sidebar.pins', next, 'private').catch(err => { swallowed('landing-page', err); return {}; });
      return next;
    });
  };

  /* ── Group collapse/expand, remembered per browser. ── */
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('aimeat.sidebar.collapsed') || '[]')); } catch { return new Set(); }
  });
  const toggleGroup = (key) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem('aimeat.sidebar.collapsed', JSON.stringify([...next])); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
      return next;
    });
  };

  const close = useCallback(() => {
    try { sessionStorage.removeItem('aimeat-profile-tab'); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
    if (!fromPopRef.current) syncTabHistory(null, false);
    setOpenView(null);
  }, []);

  /* Browser Back/Forward: read the tab from the URL and apply it WITHOUT pushing a new
   * history entry (fromPopRef guards open()/close()). This makes Back step through the
   * tabs you opened and finally land on Home, instead of leaving the profile. */
  useEffect(() => {
    const onPop = () => {
      const tabId = new URLSearchParams(window.location.search).get('tab');
      fromPopRef.current = true;
      try {
        if (tabId && !(INFRA_TAB_IDS.has(tabId) && !isOperator)) {
          const v = { tabId, slot: 'main' };
          try { sessionStorage.setItem('aimeat-profile-tab', JSON.stringify(v)); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
          setOpenView(v);
        } else {
          try { sessionStorage.removeItem('aimeat-profile-tab'); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
          setOpenView(null);
        }
      } finally {
        fromPopRef.current = false;
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [isOperator]);

  /* On first mount, reflect a sessionStorage/?tab=-restored tab in the URL via
   * replaceState so there is a consistent /v1/profile?tab= entry for Back to return to. */
  useEffect(() => {
    if (openViewRef.current?.tabId) syncTabHistory(openViewRef.current.tabId, true);
  }, []);

  /* Cross-tab navigation: any tab component can dispatch
   * `new CustomEvent('aimeat-open-tab', { detail: { tabId } })` to open another
   * profile tab inline (e.g. an organism's Board tab → the Boards view). */
  useEffect(() => {
    const handler = (e) => {
      const tabId = e.detail?.tabId;
      if (!tabId) return;
      // Force-OPEN semantics (never toggle): a deep-link/cross-nav must land ON the tab. open()
      // toggles, so calling it when that tab is already active would CLOSE it back to Home — the
      // exact bug when a message notification is tapped while the Messages tab is already open. If
      // it's already open, leave it; the tab's own aimeat-open-tab listener consumes the deep-link
      // (e.g. inbox-tab opens the freshly-arrived conversation).
      if (openViewRef.current?.tabId === tabId) return;
      open(tabId, e.detail?.slot || 'main');
    };
    window.addEventListener('aimeat-open-tab', handler);
    return () => window.removeEventListener('aimeat-open-tab', handler);
  }, [open]);

  const isOpen = (tabId) => openView?.tabId === tabId;

  return html`
    <div class="pf-shell${drawerOpen ? ' pf-shell--open' : ''}">

      ${editOpen && html`<${EditProfileModal}
        session=${session}
        onClose=${() => setEditOpen(false)}
        onSaved=${() => { setEditOpen(false); showToast?.(t('profile.landing.editSaved')); }}
        onChangePassword=${() => { setEditOpen(false); setPwOpen(true); }}
      />`}

      ${pwOpen && html`<${ChangePasswordModal}
        onClose=${() => setPwOpen(false)}
        onChanged=${() => { setPwOpen(false); showToast?.(t('profile.landing.passwordChanged')); }}
      />`}

      <button class="pf-mnav-toggle" onClick=${() => setDrawerOpen(o => !o)}>☰ ${t('profile.landing.menu')}</button>
      <div class="pf-scrim" onClick=${() => setDrawerOpen(false)}></div>

      <aside class="pf-sidebar">
        <div class="pf-side-identity">
          <div class="pf-side-avatar" dangerouslySetInnerHTML=${{ __html: minidenticon(typeof owner === 'string' && owner ? owner : 'user') }}></div>
          <div class="pf-side-id-name">${session.displayName || owner}</div>
        </div>

        <button class="pf-side-item${!openView ? ' pf-side-item--active' : ''}"
          onClick=${() => { close(); setDrawerOpen(false); }}>
          <span class="pf-side-label">${t('profile.landing.home')}</span>
        </button>

        <${InboxNavButton}
          active=${isOpen('messages')}
          onClick=${() => { open('messages', 'main'); setDrawerOpen(false); }}
        />

        ${(() => {
          const renderItem = (it, pinned) => html`
            <button class="pf-side-item${isOpen(it.id) ? ' pf-side-item--active' : ''}" key=${(pinned ? 'pin-' : '') + it.id}
              onClick=${() => { open(it.id, 'main'); setDrawerOpen(false); }}>
              <span class="pf-side-label">${t(it.labelKey)}</span>
              ${it.badgeStat && typeof stats?.[it.badgeStat] === 'number' && stats[it.badgeStat] > 0
                ? html`<span class="pf-side-badge">${stats[it.badgeStat]}</span>` : null}
              <span class="pf-side-pin${pins.includes(it.id) ? ' pf-side-pin--on' : ''}"
                role="button" tabindex="-1"
                title=${pins.includes(it.id) ? (t('profile.landing.pinRemove') || 'Unpin') : (t('profile.landing.pinAdd') || 'Pin')}
                onClick=${(e) => { e.stopPropagation(); togglePin(it.id); }}>📌</span>
            </button>`;
          const pinnedItems = pins.map(id => SIDEBAR_ITEM_BY_ID[id]).filter(Boolean)
            .filter(it => !(INFRA_TAB_IDS.has(it.id) && !isOperator));
          return html`
            ${pinnedItems.length > 0 && html`
              <div class="pf-side-group">
                <div class="pf-side-group-title">${t('profile.landing.menuPinned') || 'Pinned'}</div>
                ${pinnedItems.map(it => renderItem(it, true))}
              </div>
            `}
            ${SIDEBAR_GROUPS.filter(g => !g.adminOnly || isOperator).map(g => {
              const collapsed = collapsedGroups.has(g.titleKey);
              return html`
                <div class="pf-side-group" key=${g.titleKey}>
                  <button class="pf-side-group-title pf-side-group-toggle" onClick=${() => toggleGroup(g.titleKey)}>
                    <span class="pf-chevron ${collapsed ? '' : 'pf-chevron-open'}">▼</span> ${t(g.titleKey)}
                  </button>
                  ${!collapsed && g.items.map(it => renderItem(it, false))}
                </div>
              `;
            })}
          `;
        })()}
      </aside>

      <main class="pf-content">
        ${openView ? html`
          <div class="pf-content-head">
            <span class="pf-back-current">${getTabLabel(openView.tabId)}</span>
          </div>
          <div class="pf-content-body">${renderTab(openView.tabId)}</div>
        ` : html`
          <${ProfileCard} tier=${tier} stats=${stats} session=${session}
            onEditProfile=${() => setEditOpen(true)}
            switchTab=${(id) => open(id, 'main')} />
          <${WaitingForYou} owner=${owner} />
          <${NextSteps} switchTab=${(id) => open(id, 'main')}
            hasApps=${appsLoaded ? apps.length > 0 : undefined} />
          <div class="pf-home-grid">
            <${UsageCard} switchTab=${(id) => open(id, 'main')} initialUsage=${homeUsage} />
            <${AiSpendCard} />
            <${AgentLedgerCard} />
            <${CommerceCard} />
            <${ContinueCard} />
            <${AgentsCard} owner=${owner} initialAgents=${homeAgents} />
          </div>
          ${(showPromo && apps.length < 3) ? html`
            <${CortexSection} switchTab=${() => open('extensions', 'main')} onDismiss=${dismissPromo} />` : null}
        `}
      </main>
    </div>
  `;
}

