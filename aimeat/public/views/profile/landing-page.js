/**
 * @file landing-page.js
 * @description Adaptive profile landing page with three user tier variants
 *   (new / active / experienced). Shows tier-specific dashboard content with
 *   onboarding, app strip, menu sections, and inline preview panels.
 * @structure
 *   - computeTier() — exported heuristic for user tier detection
 *   - tierLevel() — exported numeric tier comparison helper
 *   - ProfileCard, HeroOnboarding, KnowledgeCallout, KnowledgeButton,
 *     GhostTiles, CortexSection, AppStrip — section sub-components
 *   - MenuSection, MenuItem — generic menu layout components
 *   - LandingPage — main orchestrator (default export)
 * @version-history
 *   v1.0.0 — 2026-03-18 — Initial adaptive landing page implementation
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { getNodeUrl } from '/js/services/auth.js';
import { listApps } from '/js/services/apps.js';
import { Spinner } from './shared.js';
import { minidenticon } from '/lib/minidenticons.min.js';

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

/* ───── Sub-components ───── */

function ProfileCard({ tier, stats, session }) {
  const NODE_URL = getNodeUrl();
  const isNew = tier === 'new';
  const isExperienced = tier === 'experienced';
  const avatarSvg = minidenticon(session.owner || 'user');

  return html`
    <div class="pf-lp-card">
      <div class="pf-lp-card-header">
        <div class="pf-lp-avatar" dangerouslySetInnerHTML=${{ __html: avatarSvg }}></div>
        <div class="pf-lp-info">
          <div class="pf-lp-name-row">
            <span class="pf-lp-name">${escHtml(session.displayName || session.owner)}</span>
            ${!isNew && html`
              <a href="#" class="pf-lp-edit" onClick=${(e) => e.preventDefault()}>
                ${t('profile.landing.editProfile')} \u2192
              </a>
            `}
          </div>
          <div class="pf-lp-ghii">${escHtml(session.ghii || '')}</div>
          <div class="pf-lp-node">${t('profile.node')}: ${escHtml(NODE_URL)}</div>
          ${isExperienced && typeof stats.nodes === 'number' && stats.nodes > 0 && html`
            <div class="pf-federation-badge">
              <span class="pf-fed-dot"></span>
              ${t('profile.landing.federationBadge').replace('{count}', String(stats.nodes))}
            </div>
          `}
        </div>
      </div>
      <div class="pf-lp-stats">
        ${isNew ? html`
          ${stats.memory > 0 && html`
            <div class="pf-lp-stat">\u{1F9E0} <span class="pf-lp-stat-val">${stats.memory}</span> ${t('profile.stats.memories')}</div>
          `}
          ${(stats.balance != null && stats.balance !== '-' && stats.balance > 0) && html`
            <div class="pf-lp-stat">
              \u{1F48E} <span class="pf-lp-stat-val pf-lp-stat-green">${stats.balance}</span> ${t('profile.stats.morsels')}
            </div>
          `}
        ` : html`
          ${stats.apps > 0 && html`<div class="pf-lp-stat">\u{1F4F1} <span class="pf-lp-stat-val">${stats.apps}</span> ${t('profile.stats.apps')}</div>`}
          ${stats.memory > 0 && html`<div class="pf-lp-stat">\u{1F9E0} <span class="pf-lp-stat-val">${stats.memory}</span> ${t('profile.stats.memories')}</div>`}
          ${(stats.balance != null && stats.balance !== '-' && stats.balance > 0) && html`
            <div class="pf-lp-stat">\u{1F48E} <span class="pf-lp-stat-val pf-lp-stat-green">${stats.balance}</span> ${t('profile.stats.morsels')}</div>
          `}
          ${stats.services > 0 && html`<div class="pf-lp-stat">\u{1F50C} <span class="pf-lp-stat-val">${stats.services}</span> ${t('profile.stats.services')}</div>`}
          ${isExperienced && stats.agents > 0 && html`
            <div class="pf-lp-stat">\u{1F916} <span class="pf-lp-stat-val">${stats.agents}</span> ${t('profile.stats.agents')}</div>
          `}
        `}
      </div>
    </div>
  `;
}

function HeroOnboarding({ switchTab }) {
  return html`
    <div class="pf-hero-onboard">
      <div class="pf-hero-ob-title">${t('profile.landing.heroTitle')} \u{1F44B}</div>
      <div class="pf-hero-ob-subtitle">${t('profile.landing.heroSubtitle')}</div>
      <div class="pf-onboard-grid">
        <div class="pf-onboard-card highlight" onClick=${() => switchTab('packages')}>
          <span class="pf-onboard-tag">${t('profile.landing.tagEasiest')}</span>
          <span class="pf-onboard-icon">\u{1F4E6}</span>
          <div class="pf-onboard-title">${t('profile.landing.onboardInstall')}</div>
          <div class="pf-onboard-desc">${t('profile.landing.onboardInstallDesc')}</div>
        </div>
        <div class="pf-onboard-card" onClick=${() => switchTab('knowledge')}>
          <span class="pf-onboard-icon">\u{1F4AC}</span>
          <div class="pf-onboard-title">${t('profile.landing.onboardChat')}</div>
          <div class="pf-onboard-desc">${t('profile.landing.onboardChatDesc')}</div>
        </div>
        <div class="pf-onboard-card" onClick=${() => switchTab('agents')}>
          <span class="pf-onboard-icon">\u{1F916}</span>
          <div class="pf-onboard-title">${t('profile.landing.onboardAgent')}</div>
          <div class="pf-onboard-desc">${t('profile.landing.onboardAgentDesc')}</div>
        </div>
        <div class="pf-onboard-card" onClick=${() => switchTab('generator')}>
          <span class="pf-onboard-tag pf-tag-later">${t('profile.landing.tagLater')}</span>
          <span class="pf-onboard-icon">\u{26A1}</span>
          <div class="pf-onboard-title">${t('profile.landing.onboardGenerator')}</div>
          <div class="pf-onboard-desc">${t('profile.landing.onboardGeneratorDesc')}</div>
        </div>
      </div>
    </div>
  `;
}

function KnowledgeCallout({ switchTab }) {
  return html`
    <div class="pf-knowledge-callout" onClick=${() => switchTab('knowledge')}>
      <div class="pf-knowledge-callout-icon">\u{1F9E0}</div>
      <div class="pf-knowledge-callout-body">
        <h3 class="pf-knowledge-callout-title">${t('profile.landing.knowledgeTitle')}</h3>
        <p class="pf-knowledge-callout-desc">${t('profile.landing.knowledgeDesc')}</p>
        <div class="pf-ai-pills">
          <span class="pf-ai-pill">Claude</span>
          <span class="pf-ai-pill">ChatGPT</span>
          <span class="pf-ai-pill">Grok</span>
          <span class="pf-ai-pill">Copilot</span>
        </div>
      </div>
    </div>
  `;
}

function KnowledgeButton({ switchTab }) {
  return html`
    <div class="pf-knowledge-btn" onClick=${() => switchTab('knowledge')}>
      <span class="pf-kb-icon">\u{1F9E0}</span>
      <div class="pf-kb-text">
        <div class="pf-kb-title">${t('profile.landing.knowledgeBtnTitle')}</div>
        <div class="pf-kb-desc">${t('profile.landing.knowledgeBtnDesc')}</div>
      </div>
      <span class="pf-kb-arrow">\u2192</span>
    </div>
  `;
}

function GhostTiles({ switchTab }) {
  /* Hardcoded popular services — matches wireframe. Names are Finnish product
     names recognizable across locales; not i18n'd intentionally. */
  const tiles = [
    { icon: '\u26A1', name: 'Sähkön hinta' },
    { icon: '\u{1F6A8}', name: 'Hälytyskartta' },
    { icon: '\u{1F324}\uFE0F', name: 'Uloslähdinkö' },
    { icon: '\u{1F3E2}', name: 'Yritystutka' },
  ];
  return html`
    <div class="pf-landing-section">
      <div class="pf-menu-title">${t('profile.landing.ghostSectionTitle')}</div>
      <div class="pf-ghost-grid">
        ${tiles.map(tile => html`
          <div class="pf-ghost-tile" onClick=${() => switchTab('packages')}>
            <span class="pf-ghost-icon">${tile.icon}</span>
            <span class="pf-ghost-name">${tile.name}</span>
            <span class="pf-ghost-cta">${t('profile.landing.ghostInstall')} \u2192</span>
          </div>
        `)}
      </div>
    </div>
  `;
}

function CortexSection({ switchTab }) {
  return html`
    <div class="pf-landing-section">
      <div class="pf-menu-title">${t('profile.landing.cortexSectionTitle')}</div>
      <div class="pf-cortex-grid">
        <div class="pf-cortex-card" onClick=${() => switchTab('extensions')}>
          <div class="pf-cortex-header">
            <span>\u{1F4CA}</span><span>${t('profile.landing.cortexCharts')}</span>
          </div>
          <p class="pf-cortex-desc">${t('profile.landing.cortexChartsDesc')}</p>
        </div>
        <div class="pf-cortex-card" onClick=${() => switchTab('extensions')}>
          <div class="pf-cortex-header">
            <span>\u{1F3A8}</span><span>${t('profile.landing.cortexCanvas')}</span>
          </div>
          <p class="pf-cortex-desc">${t('profile.landing.cortexCanvasDesc')}</p>
        </div>
      </div>
    </div>
  `;
}

function AppStrip({ apps, switchTab }) {
  return html`
    <div class="pf-app-strip">
      <div class="pf-app-strip-header">
        <div class="pf-menu-title">${t('profile.landing.myApps')}</div>
        <a href="#" class="pf-app-strip-link" onClick=${(e) => { e.preventDefault(); switchTab('apps'); }}>
          ${t('profile.landing.allApps')} \u2192
        </a>
      </div>
      <div class="pf-app-row">
        ${apps.length > 0 ? apps.map(app => html`
          <div class="pf-app-chip" key=${app.filename || app.name}>
            <span class="pf-chip-icon">\u{1F4F1}</span>
            ${escHtml(app.name || app.filename || 'App')}
          </div>
        `) : html`
          <div class="pf-app-chip pf-app-chip-ghost" onClick=${() => switchTab('packages')}>
            <span class="pf-chip-icon">+</span>
            ${t('profile.landing.installFirst')} \u2192
          </div>
        `}
      </div>
    </div>
  `;
}

/* ───── Generic layout components ───── */

function MenuSection({ title, annotation, children }) {
  return html`
    <div class="pf-landing-section">
      <div class="pf-menu-title">
        ${title}
        ${annotation && html`<span class="pf-menu-annotation">${annotation}</span>`}
      </div>
      ${children}
    </div>
  `;
}

function MenuItem({ icon, label, badge, badgeMuted, primary, indigo, active, onClick }) {
  let cls = 'pf-menu-item';
  if (primary) cls += ' pf-primary';
  if (indigo) cls += ' pf-indigo';
  if (active) cls += ' pf-menu-active';
  return html`
    <a class=${cls} onClick=${(e) => { e.preventDefault(); onClick?.(); }}>
      ${icon} ${label}
      ${badge != null && badge > 0 && html`
        <span class="pf-menu-badge${badgeMuted ? ' pf-badge-muted' : ''}">${badge}</span>
      `}
    </a>
  `;
}

/* ───── Inline view wrapper — renders tab content below its trigger ───── */

function InlineView({ tabId, label, onClose, renderTab }) {
  const ref = useRef(null);
  useEffect(() => {
    setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }, [tabId]);

  return html`
    <div class="pf-inline-view" ref=${ref}>
      <div class="pf-inline-view-header">
        <button class="pf-back-btn" onClick=${onClose}>\u2715 ${t('profile.close')}</button>
        <span class="pf-back-current">${label}</span>
      </div>
      <div class="pf-inline-view-body">${renderTab(tabId)}</div>
    </div>
  `;
}

/* ───── Main landing page ───── */

export default function LandingPage({ tier, stats, session, navigate, showToast, locale, renderTab, getTabLabel }) {
  const [apps, setApps] = useState([]);
  const [openView, setOpenView] = useState(null); // { tabId, slot }
  const [expanded, setExpanded] = useState(false);

  const owner = session.owner;

  /* Fetch app list for app strip */
  const loadApps = useCallback(async () => {
    try {
      const list = await listApps();
      setApps(Array.isArray(list) ? list.filter(a => a.owner === owner) : []);
    } catch { setApps([]); }
  }, [owner]);

  useEffect(() => { loadApps(); }, [loadApps]);

  /* SSE live updates */
  const loadRef = useRef(loadApps);
  loadRef.current = loadApps;
  useEffect(() => {
    const handler = () => loadRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  /* Open a tab inline below a specific slot. Toggle if same tab clicked again. */
  const open = useCallback((tabId, slot) => {
    setOpenView(prev => (prev?.tabId === tabId) ? null : { tabId, slot });
  }, []);

  const close = useCallback(() => setOpenView(null), []);

  /* Render inline view if it matches the given slot */
  const viewAt = (slot) => {
    if (!openView || openView.slot !== slot) return null;
    return html`<${InlineView}
      tabId=${openView.tabId}
      label=${getTabLabel(openView.tabId)}
      onClose=${close}
      renderTab=${renderTab}
    />`;
  };

  const isOpen = (tabId) => openView?.tabId === tabId;

  const isNew = tier === 'new';
  const isActive = tier === 'active';
  const isExperienced = tier === 'experienced';

  return html`
    <div class="pf-landing">

      <${ProfileCard} tier=${tier} stats=${stats} session=${session} />

      ${isNew && html`
        <${HeroOnboarding} switchTab=${(id) => open(id, 'hero')} />
        ${viewAt('hero')}

        <${KnowledgeCallout} switchTab=${() => open('knowledge', 'knowledge-new')} />
        ${viewAt('knowledge-new')}

        <${GhostTiles} switchTab=${() => open('packages', 'ghost')} />
        ${viewAt('ghost')}

        <${CortexSection} switchTab=${() => open('extensions', 'cortex')} />
        ${viewAt('cortex')}

        <${MenuSection} title=${t('profile.landing.menuManagement')}>
          <div class="pf-menu-grid">
            <${MenuItem} icon="\u{1F9E0}" label=${t('profile.tabs.memory')} active=${isOpen('memory')} onClick=${() => open('memory', 'manage-new')} />
            <${MenuItem} icon="\u{1F48E}" label=${t('profile.tabs.wallet')} active=${isOpen('wallet')} onClick=${() => open('wallet', 'manage-new')} />
            <${MenuItem} icon="\u{1F510}" label=${t('profile.tabs.access')} active=${isOpen('access')} onClick=${() => open('access', 'manage-new')} />
            <${MenuItem} icon="\u{1F4E7}" label=${t('profile.tabs.email')} active=${isOpen('email')} onClick=${() => open('email', 'manage-new')} />
          </div>
          <div class="pf-expand-trigger" onClick=${() => setExpanded(!expanded)}>
            ${expanded ? '\u25BE' : '\u25B8'} ${t('profile.landing.expandAll')}
          </div>
          ${expanded && html`
            <div class="pf-menu-grid pf-menu-grid-expanded">
              <${MenuItem} icon="\u{1F916}" label=${t('profile.tabs.agents')} active=${isOpen('agents')} onClick=${() => open('agents', 'manage-new')} />
              <${MenuItem} icon="\u{1F4AC}" label=${t('profile.tabs.chatSessions')} active=${isOpen('chatsessions')} onClick=${() => open('chatsessions', 'manage-new')} />
              <${MenuItem} icon="\u{1F50C}" label=${t('profile.tabs.extensions')} active=${isOpen('extensions')} onClick=${() => open('extensions', 'manage-new')} />
              <${MenuItem} icon="\u{1F534}" label=${t('profile.generator.tabLabel')} active=${isOpen('generator')} onClick=${() => open('generator', 'manage-new')} />
              <${MenuItem} icon="\u{1F4E6}" label=${t('profile.tabs.packages')} active=${isOpen('packages')} onClick=${() => open('packages', 'manage-new')} />
              <${MenuItem} icon="\u{1F4DA}" label=${t('knowledge.tabLabel')} active=${isOpen('knowledge')} onClick=${() => open('knowledge', 'manage-new')} />
              <${MenuItem} icon="\u{1F4CB}" label=${t('profile.tabs.boards')} active=${isOpen('boards')} onClick=${() => open('boards', 'manage-new')} />
              <${MenuItem} icon="\u{1F3A8}" label=${t('portfolio.tabLabel')} active=${isOpen('portfolio')} onClick=${() => open('portfolio', 'manage-new')} />
              <${MenuItem} icon="\u{1F6E0}\uFE0F" label=${t('profile.tabs.services')} active=${isOpen('actions')} onClick=${() => open('actions', 'manage-new')} />
              <${MenuItem} icon="\u{1F4CB}" label=${t('profile.tabs.work')} active=${isOpen('work')} onClick=${() => open('work', 'manage-new')} />
              <${MenuItem} icon="\u{1F3E2}" label=${t('profile.tabs.organisms')} active=${isOpen('organisms')} onClick=${() => open('organisms', 'manage-new')} />
              <${MenuItem} icon="\u{1F512}" label=${t('profile.tabs.dataWallet')} active=${isOpen('dataWallet')} onClick=${() => open('dataWallet', 'manage-new')} />
              <${MenuItem} icon="\u{1F514}" label=${t('profile.tabs.notifications')} active=${isOpen('notifications')} onClick=${() => open('notifications', 'manage-new')} />
              <${MenuItem} icon="\u{1F512}" label=${t('profile.tabs.security')} active=${isOpen('security')} onClick=${() => open('security', 'manage-new')} />
            </div>
          `}
        <//>
        ${viewAt('manage-new')}
      `}

      ${(isActive || isExperienced) && html`
        <${AppStrip} apps=${apps} switchTab=${(id) => open(id, 'apps')} />
        ${viewAt('apps')}

        <${MenuSection} title=${t('profile.landing.menuDaily')}>
          <div class="pf-menu-grid">
            <${MenuItem} icon="\u{1F4E6}" label=${t('profile.landing.packagesExt')} active=${isOpen('packages')} onClick=${() => open('packages', 'daily')} />
            <${MenuItem} icon="\u{1F514}" label=${t('profile.landing.notificationsBadge')} active=${isOpen('notifications')} onClick=${() => open('notifications', 'daily')} />
            <${MenuItem} icon="\u{1F916}" label=${t('profile.tabs.agents')}
              badge=${typeof stats.agents === 'number' ? stats.agents : 0} badgeMuted
              active=${isOpen('agents')} onClick=${() => open('agents', 'daily')} />
            <${MenuItem} icon="\u{1F9E0}" label=${t('profile.tabs.memory')} active=${isOpen('memory')} onClick=${() => open('memory', 'daily')} />
            <${MenuItem} icon="\u{1F4CB}" label=${t('profile.tabs.boards')} active=${isOpen('boards')} onClick=${() => open('boards', 'daily')} />
            <${MenuItem} icon="\u{1F4DA}" label=${t('knowledge.tabLabel')} active=${isOpen('knowledge')} onClick=${() => open('knowledge', 'daily')} />
          </div>
        <//>
        ${viewAt('daily')}

        ${isActive && html`
          <${KnowledgeButton} switchTab=${() => open('knowledge', 'knowledge-btn')} />
          ${viewAt('knowledge-btn')}
        `}

        <${MenuSection} title=${t('profile.landing.menuBuildShare')}>
          <div class="pf-menu-grid">
            <${MenuItem} icon="\u{1F534}" label=${t('profile.generator.tabLabel')} primary active=${isOpen('generator')} onClick=${() => open('generator', 'build')} />
            <${MenuItem} icon="\u{1F50C}" label=${t('profile.tabs.extensions')} active=${isOpen('extensions')} onClick=${() => open('extensions', 'build')} />
            <${MenuItem} icon="\u{1F3A8}" label=${t('portfolio.tabLabel')} active=${isOpen('portfolio')} onClick=${() => open('portfolio', 'build')} />
            ${isExperienced && html`
              <${MenuItem} icon="\u{1F4E4}" label=${t('profile.landing.ownPackages')} active=${isOpen('packages')} onClick=${() => open('packages', 'build')} />
            `}
          </div>
        <//>
        ${viewAt('build')}

        ${isExperienced ? html`
          <${MenuSection} title=${t('profile.landing.menuManagement')}>
            <div class="pf-menu-subgroup">
              <div class="pf-menu-subgroup-title">${t('profile.landing.menuTechnical')}</div>
              <div class="pf-menu-grid">
                <${MenuItem} icon="\u2699\uFE0F" label=${t('profile.tabs.apps')} active=${isOpen('apps')} onClick=${() => open('apps', 'manage')} />
                <${MenuItem} icon="\u{1F517}" label=${t('profile.tabs.mcp')} active=${isOpen('mcp')} onClick=${() => open('mcp', 'manage')} />
                <${MenuItem} icon="\u{1F6E0}\uFE0F" label=${t('profile.tabs.services')} active=${isOpen('actions')} onClick=${() => open('actions', 'manage')} />
                <${MenuItem} icon="\u{1F4CB}" label=${t('profile.tabs.work')} active=${isOpen('work')} onClick=${() => open('work', 'manage')} />
                <${MenuItem} icon="\u{1F4AC}" label=${t('profile.tabs.chatSessions')} active=${isOpen('chatsessions')} onClick=${() => open('chatsessions', 'manage')} />
              </div>
            </div>
            <div class="pf-menu-subgroup">
              <div class="pf-menu-subgroup-title">${t('profile.landing.menuPersonal')}</div>
              <div class="pf-menu-grid">
                <${MenuItem} icon="\u{1F48E}" label=${t('profile.tabs.wallet')} active=${isOpen('wallet')} onClick=${() => open('wallet', 'manage')} />
                <${MenuItem} icon="\u{1F4E7}" label=${t('profile.tabs.email')} active=${isOpen('email')} onClick=${() => open('email', 'manage')} />
                <${MenuItem} icon="\u{1F510}" label=${t('profile.tabs.access')} active=${isOpen('access')} onClick=${() => open('access', 'manage')} />
                <${MenuItem} icon="\u{1F3E2}" label=${t('profile.tabs.organisms')} active=${isOpen('organisms')} onClick=${() => open('organisms', 'manage')} />
              </div>
            </div>
          <//>
          ${viewAt('manage')}

          <${MenuSection} title=${t('profile.landing.menuInfra')} annotation=${t('profile.landing.menuInfraAnnotation')}>
            <div class="pf-menu-grid">
              <${MenuItem} icon="\u{1F310}" label=${t('profile.tabs.federation')} indigo active=${isOpen('federation')} onClick=${() => open('federation', 'infra')} />
              <${MenuItem} icon="\u{1F5A5}\uFE0F" label=${t('profile.tabs.nodes')} active=${isOpen('nodes')} onClick=${() => open('nodes', 'infra')} />
              <${MenuItem} icon="\u{1F4CA}" label=${t('profile.tabs.nodeStats')} active=${isOpen('nodeStats')} onClick=${() => open('nodeStats', 'infra')} />
              <${MenuItem} icon="\u{1F512}" label=${t('profile.tabs.security')} active=${isOpen('security')} onClick=${() => open('security', 'infra')} />
            </div>
          <//>
          ${viewAt('infra')}
        ` : html`
          <${MenuSection} title=${t('profile.landing.menuManagement')}>
            <div class="pf-menu-grid">
              <${MenuItem} icon="\u2699\uFE0F" label=${t('profile.tabs.apps')} active=${isOpen('apps')} onClick=${() => open('apps', 'manage')} />
              <${MenuItem} icon="\u{1F517}" label=${t('profile.tabs.mcp')} active=${isOpen('mcp')} onClick=${() => open('mcp', 'manage')} />
              <${MenuItem} icon="\u{1F48E}" label=${t('profile.tabs.wallet')} active=${isOpen('wallet')} onClick=${() => open('wallet', 'manage')} />
              <${MenuItem} icon="\u{1F4E7}" label=${t('profile.tabs.email')} active=${isOpen('email')} onClick=${() => open('email', 'manage')} />
              <${MenuItem} icon="\u{1F510}" label=${t('profile.tabs.access')} active=${isOpen('access')} onClick=${() => open('access', 'manage')} />
            </div>
            <div class="pf-expand-trigger" onClick=${() => setExpanded(!expanded)}>
              ${expanded ? '\u25BE' : '\u25B8'} ${t('profile.landing.expandMore')}
            </div>
            ${expanded && html`
              <div class="pf-menu-grid pf-menu-grid-expanded">
                <${MenuItem} icon="\u{1F6E0}\uFE0F" label=${t('profile.tabs.services')} active=${isOpen('actions')} onClick=${() => open('actions', 'manage')} />
                <${MenuItem} icon="\u{1F4CB}" label=${t('profile.tabs.work')} active=${isOpen('work')} onClick=${() => open('work', 'manage')} />
                <${MenuItem} icon="\u{1F4AC}" label=${t('profile.tabs.chatSessions')} active=${isOpen('chatsessions')} onClick=${() => open('chatsessions', 'manage')} />
                <${MenuItem} icon="\u{1F512}" label=${t('profile.tabs.dataWallet')} active=${isOpen('dataWallet')} onClick=${() => open('dataWallet', 'manage')} />
                <${MenuItem} icon="\u{1F3E2}" label=${t('profile.tabs.organisms')} active=${isOpen('organisms')} onClick=${() => open('organisms', 'manage')} />
              </div>
            `}
          <//>
          ${viewAt('manage')}
        `}
      `}
    </div>
  `;
}
