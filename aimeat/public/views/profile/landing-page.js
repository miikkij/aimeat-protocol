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
 *   v1.2.0 — 2026-03-19 — Expandable AppStrip chips with launch button; remove Generator primary style
 *   v1.1.0 — 2026-03-19 — Persist open tab to localStorage across page reloads
 *   v1.0.0 — 2026-03-18 — Initial adaptive landing page implementation
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { getNodeUrl, getProfile, updateProfile, changePassword } from '/js/services/auth.js';
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

/* ───── Edit Profile Modal ───── */

function EditProfileModal({ session, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState({ display_name: '', bio: '', avatar: '', locale: 'en' });
  const [currentEmail, setCurrentEmail] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await getProfile();
        if (cancelled) return;
        if (resp && resp.data) {
          const d = resp.data;
          setFields({
            display_name: d.display_name || '',
            bio: d.bio || '',
            avatar: d.avatar || '',
            locale: d.locale || 'en',
          });
          setCurrentEmail(d.notification_email || '');
        }
      } catch { /* use defaults */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const set = (key, val) => setFields(prev => ({ ...prev, [key]: val }));

  const save = async () => {
    setSaving(true);
    try {
      const resp = await updateProfile(fields);
      if (resp && resp.data) {
        if (session && typeof fields.display_name === 'string') {
          session.displayName = fields.display_name;
        }
        onSaved?.();
      } else {
        alert(t('profile.landing.editError'));
      }
    } catch {
      alert(t('profile.landing.editError'));
    }
    setSaving(false);
  };

  const onOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return html`
    <div class="pf-edit-overlay" onClick=${onOverlayClick}>
      <div class="pf-edit-modal">
        <div class="pf-edit-header">
          <h2 class="pf-edit-title">${t('profile.landing.editModalTitle')}</h2>
          <button class="pf-edit-close" onClick=${onClose} aria-label=${t('profile.landing.editCancel')}>✕</button>
        </div>
        ${loading ? html`<div class="pf-edit-loading"><${Spinner} /></div>` : html`
          <div class="pf-edit-body">
            <label class="pf-edit-label">
              ${t('profile.landing.editDisplayName')}
              <input type="text" class="pf-edit-input" value=${fields.display_name}
                placeholder=${t('profile.landing.editDisplayNamePlaceholder')}
                maxlength="100"
                onInput=${(e) => set('display_name', e.target.value)} />
            </label>
            <label class="pf-edit-label">
              ${t('profile.landing.editBio')}
              <textarea class="pf-edit-textarea" value=${fields.bio}
                placeholder=${t('profile.landing.editBioPlaceholder')}
                maxlength="500" rows="3"
                onInput=${(e) => set('bio', e.target.value)}></textarea>
            </label>
            <label class="pf-edit-label">
              ${t('profile.landing.editAvatar')}
              <input type="text" class="pf-edit-input" value=${fields.avatar}
                placeholder=${t('profile.landing.editAvatarPlaceholder')}
                maxlength="50"
                onInput=${(e) => set('avatar', e.target.value)} />
            </label>
            <label class="pf-edit-label">
              ${t('profile.landing.editLocale')}
              <select class="pf-edit-select" value=${fields.locale}
                onChange=${(e) => set('locale', e.target.value)}>
                <option value="en">English</option>
                <option value="fi">Suomi</option>
              </select>
            </label>
            <div class="pf-edit-label">
              ${t('profile.landing.editEmail')}
              <div class="pf-edit-readonly">${currentEmail || t('profile.landing.editEmailNone')}</div>
              <div class="pf-edit-hint">${t('profile.landing.editEmailHint')}</div>
            </div>
          </div>
          <div class="pf-edit-footer">
            <button class="btn-outline" onClick=${onClose} disabled=${saving}>
              ${t('profile.landing.editCancel')}
            </button>
            <button class="btn-primary" onClick=${save} disabled=${saving}>
              ${saving ? t('profile.landing.editSaving') : t('profile.landing.editSave')}
            </button>
          </div>
        `}
      </div>
    </div>
  `;
}

/* ───── Change Password Modal ───── */

function ChangePasswordModal({ onClose, onChanged }) {
  const [current, setCurrent] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setErr('');
    if (newPw !== confirm) {
      setErr(t('profile.landing.passwordMismatch'));
      return;
    }
    setSaving(true);
    try {
      const resp = await changePassword(current, newPw);
      if (resp && resp.data && resp.data.ok) {
        onChanged?.();
      } else {
        setErr(resp?.error?.message || t('profile.landing.passwordChangeFailed'));
      }
    } catch {
      setErr(t('profile.landing.passwordChangeFailed'));
    }
    setSaving(false);
  };

  const onOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return html`
    <div class="pf-edit-overlay" onClick=${onOverlayClick}>
      <div class="pf-edit-modal">
        <div class="pf-edit-header">
          <h2 class="pf-edit-title">${t('profile.landing.changePasswordTitle')}</h2>
          <button class="pf-edit-close" onClick=${onClose} aria-label=${t('profile.landing.editCancel')}>✕</button>
        </div>
        <div class="pf-edit-body">
          <label class="pf-edit-label">
            ${t('profile.landing.currentPassword')}
            <input type="password" class="pf-edit-input" value=${current}
              onInput=${(e) => setCurrent(e.target.value)} />
          </label>
          <label class="pf-edit-label">
            ${t('profile.landing.newPassword')}
            <input type="password" class="pf-edit-input" value=${newPw}
              onInput=${(e) => setNewPw(e.target.value)} />
          </label>
          <label class="pf-edit-label">
            ${t('profile.landing.confirmPassword')}
            <input type="password" class="pf-edit-input" value=${confirm}
              onInput=${(e) => setConfirm(e.target.value)} />
          </label>
          <div class="pf-edit-hint">${t('profile.landing.passwordRequirements')}</div>
          ${err && html`<div class="pf-edit-error">${err}</div>`}
        </div>
        <div class="pf-edit-footer">
          <button class="btn-outline" onClick=${onClose} disabled=${saving}>
            ${t('profile.landing.editCancel')}
          </button>
          <button class="btn-primary" onClick=${save} disabled=${saving || !current || !newPw || !confirm}>
            ${saving ? t('profile.landing.passwordChanging') : t('profile.landing.editSave')}
          </button>
        </div>
      </div>
    </div>
  `;
}

/* ───── Sub-components ───── */

function ProfileCard({ tier, stats, session, onEditProfile, onChangePassword }) {
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
            <a href="#" class="pf-lp-edit" onClick=${(e) => { e.preventDefault(); onEditProfile?.(); }}>
              ${t('profile.landing.editProfile')} \u2192
            </a>
            <a href="#" class="pf-lp-edit" onClick=${(e) => { e.preventDefault(); onChangePassword?.(); }}>
              ${t('profile.landing.changePassword')} \u2192
            </a>
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
  const [expandedApp, setExpandedApp] = useState(null);

  const toggleApp = (filename) => {
    setExpandedApp(prev => prev === filename ? null : filename);
  };

  const launchApp = (e, app) => {
    e.stopPropagation();
    window.open(`/v1/apps/${app.owner}/${app.filename}?mode=inline`, '_blank');
  };

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
          <div class="pf-app-chip ${expandedApp === app.filename ? 'pf-app-chip-expanded' : ''}"
               key=${app.filename || app.name}
               onClick=${() => toggleApp(app.filename)}>
            <span class="pf-chip-icon">\u{1F4F1}</span>
            ${escHtml(app.name || app.filename || 'App')}
            ${expandedApp === app.filename && html`
              <button class="pf-chip-launch" onClick=${(e) => launchApp(e, app)}
                title=${t('profile.landing.openApp')} aria-label=${t('profile.landing.openApp')}>\u{1F517}</button>
            `}
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
  const [editOpen, setEditOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [openView, setOpenView] = useState(() => {
    try {
      const saved = localStorage.getItem('aimeat-profile-tab');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.tabId && parsed.slot) return parsed;
      }
    } catch { /* ignore */ }
    return null;
  });
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
    setOpenView(prev => {
      const next = (prev?.tabId === tabId) ? null : { tabId, slot };
      if (next) {
        localStorage.setItem('aimeat-profile-tab', JSON.stringify(next));
      } else {
        localStorage.removeItem('aimeat-profile-tab');
      }
      return next;
    });
  }, []);

  const close = useCallback(() => {
    localStorage.removeItem('aimeat-profile-tab');
    setOpenView(null);
  }, []);

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

      <${ProfileCard} tier=${tier} stats=${stats} session=${session}
        onEditProfile=${() => setEditOpen(true)}
        onChangePassword=${() => setPwOpen(true)} />

      ${editOpen && html`<${EditProfileModal}
        session=${session}
        onClose=${() => setEditOpen(false)}
        onSaved=${() => { setEditOpen(false); showToast?.(t('profile.landing.editSaved')); }}
      />`}

      ${pwOpen && html`<${ChangePasswordModal}
        onClose=${() => setPwOpen(false)}
        onChanged=${() => { setPwOpen(false); showToast?.(t('profile.landing.passwordChanged')); }}
      />`}

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
              <${MenuItem} icon="\u{1F3ED}" label=${t('profile.foundry.tabLabel')} active=${isOpen('foundry')} onClick=${() => open('foundry', 'manage-new')} />
              <${MenuItem} icon="\u{1F3AF}" label=${t('profile.calibrator.tabLabel')} active=${isOpen('calibrator')} onClick=${() => open('calibrator', 'manage-new')} />
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
              <${MenuItem} icon="⚡" label=${t('capabilities.tabLabel')} active=${isOpen('capabilities')} onClick=${() => open('capabilities', 'manage-new')} />
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
            <${MenuItem} icon="\u{1F534}" label=${t('profile.generator.tabLabel')} active=${isOpen('generator')} onClick=${() => open('generator', 'build')} />
            <${MenuItem} icon="\u{1F3ED}" label=${t('profile.foundry.tabLabel')} active=${isOpen('foundry')} onClick=${() => open('foundry', 'build')} />
            <${MenuItem} icon="\u{1F3AF}" label=${t('profile.calibrator.tabLabel')} active=${isOpen('calibrator')} onClick=${() => open('calibrator', 'build')} />
            <${MenuItem} icon="\u{1F50C}" label=${t('profile.tabs.extensions')} active=${isOpen('extensions')} onClick=${() => open('extensions', 'build')} />
            <${MenuItem} icon="⚡" label=${t('capabilities.tabLabel')} active=${isOpen('capabilities')} onClick=${() => open('capabilities', 'build')} />
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
