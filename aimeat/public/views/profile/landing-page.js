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
 *   - ProfileCard, HeroOnboarding, KnowledgeCallout, GhostTiles, CortexSection,
 *     AppStrip — home/section sub-components
 *   - LandingPage — main orchestrator (default export)
 * @version-history
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
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { getNodeUrl, getProfile, updateProfile, changePassword } from '/js/services/auth.js';
import { listApps } from '/js/services/apps.js';
import { listAgents } from '/js/services/agents.js';
import { listAllSchedules } from '/js/services/schedules.js';
import * as orgService from '/js/services/organisms.js';
import { listRecents } from '/js/recents.js';
import { getMemory, createMemory } from '/js/services/memory.js';
import { Spinner } from './shared.js';
import { minidenticon } from '/lib/minidenticons.min.js';

/* ───── Small time helpers (reuse the organisms rel-time keys) ───── */

function fmtDateLocal(s) {
  return new Date(s).toLocaleDateString(getLocale() === 'fi' ? 'fi-FI' : undefined);
}
function relTime(s) {
  const ts = new Date(s).getTime();
  if (!Number.isFinite(ts)) return '';
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return (t('organisms.relMin') || '{n} min ago').replace('{n}', String(mins));
  const hours = Math.round(mins / 60);
  if (hours < 24) return (t('organisms.relHours') || '{n} h ago').replace('{n}', String(hours));
  const days = Math.round(hours / 24);
  if (days <= 7) return (t('organisms.relDays') || '{n} d ago').replace('{n}', String(days));
  return fmtDateLocal(s);
}
function fmtClock(s) {
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '';
  const loc = getLocale() === 'fi' ? 'fi-FI' : undefined;
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(loc, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ───── Home-card navigation: prime the organisms tab's sessionStorage, then open it ───── */

function openProfileTab(tabId) {
  window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
}
function gotoWorkspace(orgId, wsId, wsTab) {
  try {
    sessionStorage.setItem('aimeat.ws.openId', orgId);
    sessionStorage.setItem('aimeat.ws.openWs', wsId);
    if (wsTab) sessionStorage.setItem(`aimeat.ws.${orgId}.${wsId}.tab`, wsTab);
  } catch { /* noop */ }
  openProfileTab('organisms');
}
function gotoOrganism(orgId, homeTab) {
  try {
    sessionStorage.setItem('aimeat.ws.openId', orgId);
    sessionStorage.removeItem('aimeat.ws.openWs');
    if (homeTab) sessionStorage.setItem('aimeat.org.tab', homeTab);
  } catch { /* noop */ }
  openProfileTab('organisms');
}
function gotoOrganismsList() {
  try { sessionStorage.removeItem('aimeat.ws.openId'); sessionStorage.removeItem('aimeat.ws.openWs'); } catch { /* noop */ }
  openProfileTab('organisms');
}

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

function EditProfileModal({ session, onClose, onSaved, onChangePassword }) {
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
              <div class="pf-avatar-row">
                <input type="text" class="pf-edit-input" value=${fields.avatar}
                  placeholder=${t('profile.landing.editAvatarPlaceholder')}
                  maxlength="50"
                  onInput=${(e) => set('avatar', e.target.value)} />
                <span class="pf-avatar-preview" aria-hidden="true">${fields.avatar || '🙂'}</span>
              </div>
            </label>
            <label class="pf-edit-label">
              ${t('profile.landing.editLocale')}
              <select class="pf-edit-select" value=${fields.locale}
                onChange=${(e) => set('locale', e.target.value)}>
                <option value="en">English</option>
                <option value="fi">Suomi</option>
              </select>
              <div class="pf-edit-hint">${t('profile.landing.editLocaleHint') || 'Your preferred language — used for the portal UI; agents can read it from your profile to answer in it.'}</div>
            </label>
            <div class="pf-edit-label">
              ${t('profile.landing.editEmail')}
              <div class="pf-edit-readonly">${currentEmail || t('profile.landing.editEmailNone')}</div>
              <a href="#" class="pf-edit-link" onClick=${(e) => { e.preventDefault(); onClose(); window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'email' } })); }}>
                ${t('profile.landing.editEmailLink') || 'Change in the Email tab →'}</a>
            </div>
          </div>
          <div class="pf-edit-footer">
            <a href="#" class="pf-edit-link pf-edit-footer-left" onClick=${(e) => { e.preventDefault(); onChangePassword?.(); }}>
              ${t('profile.landing.changePassword')}…</a>
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

/* Password input with a neutral show/hide toggle (text-presentation eye, gray — red would read
 * as an error). */
function PwInput({ value, onInput }) {
  const [show, setShow] = useState(false);
  return html`
    <div class="pf-pw-wrap">
      <input type=${show ? 'text' : 'password'} class="pf-edit-input" value=${value} onInput=${onInput} />
      <button type="button" class="pf-pw-eye"
        onClick=${() => setShow(s => !s)}>${show ? (t('profile.landing.hidePassword') || 'Hide') : (t('profile.landing.showPassword') || 'Show')}</button>
    </div>`;
}

function ChangePasswordModal({ onClose, onChanged }) {
  const [current, setCurrent] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Live checklist — the requirements line becomes useful when it ticks green while typing.
  const rules = [
    { ok: newPw.length >= 8, label: t('profile.landing.pwMin') || 'At least 8 characters' },
    { ok: /[A-Z]/.test(newPw), label: t('profile.landing.pwUpper') || 'An uppercase letter' },
    { ok: /[a-z]/.test(newPw), label: t('profile.landing.pwLower') || 'A lowercase letter' },
    { ok: /\d/.test(newPw), label: t('profile.landing.pwDigit') || 'A number' },
  ];
  const rulesOk = rules.every(r => r.ok);
  const mismatch = confirm.length > 0 && newPw !== confirm;

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
            <${PwInput} value=${current} onInput=${(e) => setCurrent(e.target.value)} />
          </label>
          <label class="pf-edit-label">
            ${t('profile.landing.newPassword')}
            <${PwInput} value=${newPw} onInput=${(e) => setNewPw(e.target.value)} />
          </label>
          <ul class="pf-pw-rules">
            ${rules.map(r => html`<li class=${r.ok ? 'ok' : ''} key=${r.label}>${r.ok ? '✓' : '○'} ${r.label}</li>`)}
          </ul>
          <label class="pf-edit-label">
            ${t('profile.landing.confirmPassword')}
            <${PwInput} value=${confirm} onInput=${(e) => setConfirm(e.target.value)} />
          </label>
          ${mismatch ? html`<div class="pf-edit-error">${t('profile.landing.passwordMismatch')}</div>` : null}
          ${err && html`<div class="pf-edit-error">${err}</div>`}
        </div>
        <div class="pf-edit-footer">
          <button class="btn-outline" onClick=${onClose} disabled=${saving}>
            ${t('profile.landing.editCancel')}
          </button>
          <button class="btn-primary" onClick=${save} disabled=${saving || !current || !rulesOk || !confirm || mismatch}>
            ${saving ? t('profile.landing.passwordChanging') : (t('profile.landing.changePasswordBtn') || 'Change password')}
          </button>
        </div>
      </div>
    </div>
  `;
}

/* ───── Home dashboard cards ───── */

/* "Waiting for you" — everything that needs the user's decision, aggregated across organisms:
 * pending publish approvals (per workspace), pending join requests (orgs they manage), and
 * incoming organism invitations. Renders nothing when there is nothing to do. */
function WaitingForYou({ owner }) {
  const [items, setItems] = useState(null);
  const load = useCallback(async () => {
    try {
      const out = [];
      const orgsResp = await orgService.listOrganisms({ member: owner }).catch(() => null);
      const orgs = orgsResp?.data?.organisms || [];
      await Promise.all(orgs.map(async (org) => {
        const canManage = org.creatorGhii === owner || (org.admins || []).includes(owner);
        const [aps, reqs] = await Promise.all([
          orgService.listApprovals(org.id, 'pending').catch(() => []),
          canManage ? orgService.listJoinRequests(org.id).catch(() => null) : Promise.resolve(null),
        ]);
        if ((aps || []).length > 0) {
          const byWs = {};
          for (const a of aps) { const w = a.arguments?.ws || ''; byWs[w] = (byWs[w] || 0) + 1; }
          let names = {};
          try { names = Object.fromEntries((await orgService.listWorkspaces(org.id)).map(w => [w.id, w.name])); } catch { /* ids will do */ }
          for (const [wsId, n] of Object.entries(byWs)) {
            out.push({ kind: 'review', n, orgId: org.id, orgName: org.name, wsId, wsName: names[wsId] || wsId });
          }
        }
        const pend = ((reqs?.data?.join_requests) || []).filter(r => r.status === 'pending').length;
        if (pend > 0) out.push({ kind: 'join', n: pend, orgId: org.id, orgName: org.name });
      }));
      const inv = await orgService.listMyInvitations().catch(() => null);
      for (const e of (inv?.data?.invitations || [])) out.push({ kind: 'invite', orgName: e?.organism?.name || '' });
      setItems(out);
    } catch { setItems([]); }
  }, [owner]);
  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => {
    const h = () => liveRef.current();
    window.addEventListener('aimeat-live-update', h);
    return () => window.removeEventListener('aimeat-live-update', h);
  }, []);

  if (!items || items.length === 0) return null;
  return html`
    <div class="pf-waiting">
      <div class="pf-waiting-title">${'📨 '}${t('profile.landing.waitingTitle') || 'Waiting for you'}</div>
      ${items.map((it, i) => html`
        <div class="pf-waiting-row" key=${i}>
          <span class="pf-waiting-text">
            ${it.kind === 'review' ? html`
              <b>${(t('profile.landing.draftsToReview') || '{n} drafts to review').replace('{n}', String(it.n))}</b>
              <span class="pf-waiting-where"> · ${escHtml(it.orgName)} / ${escHtml(it.wsName)}</span>` : null}
            ${it.kind === 'join' ? html`
              <b>${it.n === 1 ? (t('profile.landing.joinReqOne') || '1 join request') : (t('profile.landing.joinReqMany') || '{n} join requests').replace('{n}', String(it.n))}</b>
              <span class="pf-waiting-where"> · ${escHtml(it.orgName)}</span>` : null}
            ${it.kind === 'invite' ? html`
              <b>${t('profile.landing.inviteWaiting') || 'You’re invited'}</b>
              <span class="pf-waiting-where"> · ${escHtml(it.orgName)}</span>` : null}
          </span>
          ${it.kind === 'review' ? html`
            <button class="btn-outline btn-sm" onClick=${() => (it.wsId ? gotoWorkspace(it.orgId, it.wsId, 'review') : gotoOrganism(it.orgId))}>${t('profile.landing.reviewBtn') || 'Review'}</button>` : null}
          ${it.kind === 'join' ? html`
            <button class="btn-outline btn-sm" onClick=${() => gotoOrganism(it.orgId, 'members')}>${t('profile.landing.viewBtn') || 'View'}</button>` : null}
          ${it.kind === 'invite' ? html`
            <button class="btn-outline btn-sm" onClick=${() => gotoOrganismsList()}>${t('profile.landing.viewBtn') || 'View'}</button>` : null}
        </div>
      `)}
    </div>
  `;
}

/* "Continue" — the last opened things across types (workspace / app / organism), with real
 * display names. Backed by /js/recents.js (device-local). Renders nothing when empty. */
const RECENT_ICONS = { workspace: '🗂', app: '▦', organism: '🏢', board: '📋' };
function ContinueCard() {
  const [items] = useState(() => listRecents(5));
  if (!items.length) return null;
  const openItem = (it) => {
    if (it.type === 'workspace' && it.data?.orgId) gotoWorkspace(it.data.orgId, it.data.wsId);
    else if (it.type === 'organism' && it.data?.orgId) gotoOrganism(it.data.orgId);
    else if (it.type === 'app' && it.data?.filename) window.open(`/v1/apps/${encodeURIComponent(it.data.owner)}/${encodeURIComponent(it.data.filename)}?mode=inline`, '_blank');
  };
  return html`
    <div class="pf-home-card">
      <div class="pf-home-card-title">${t('profile.landing.continueTitle') || 'Continue'}</div>
      ${items.map(it => html`
        <button class="pf-home-row" key=${it.type + it.id} onClick=${() => openItem(it)}>
          <span class="pf-home-row-ico">${RECENT_ICONS[it.type] || '•'}</span>
          <span class="pf-home-row-label">${escHtml(it.label)}</span>
          <span class="pf-home-row-meta">${relTime(it.at)}</span>
        </button>
      `)}
    </div>
  `;
}

/* "Agents" — who has been active today, who is idle, and the next scheduled run. */
function AgentsCard({ owner }) {
  const [agents, setAgents] = useState(null);
  const [nextJob, setNextJob] = useState(null);
  const load = useCallback(async () => {
    try {
      const list = (await listAgents(owner)).filter(a => !String(a.name || '').startsWith('session-'));
      list.sort((a, b) => String(b.last_seen || '').localeCompare(String(a.last_seen || '')));
      setAgents(list);
    } catch { setAgents([]); }
    try {
      const r = await listAllSchedules();
      const all = [...(r?.data?.managed || []), ...(r?.data?.extensions || []), ...(r?.data?.agentInternal || [])]
        .filter(s => s.enabled !== false && s.nextRunAt && new Date(s.nextRunAt).getTime() > Date.now())
        .sort((a, b) => String(a.nextRunAt).localeCompare(String(b.nextRunAt)));
      setNextJob(all[0] || null);
    } catch { /* scheduler row is optional */ }
  }, [owner]);
  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => {
    const h = () => liveRef.current();
    window.addEventListener('aimeat-live-update', h);
    return () => window.removeEventListener('aimeat-live-update', h);
  }, []);

  if (!agents || (agents.length === 0 && !nextJob)) return null;
  const todayStr = new Date().toDateString();
  const isToday = (s) => s && new Date(s).toDateString() === todayStr;
  const activeToday = agents.filter(a => isToday(a.last_seen)).length;
  return html`
    <div class="pf-home-card">
      <button class="pf-home-card-title pf-home-card-link" onClick=${() => openProfileTab('agents')}>
        ${t('profile.landing.agentsTitle') || 'Agents'}
        ${activeToday > 0 ? html`<span class="pf-home-card-note"> · ${(t('profile.landing.activeTodayCount') || '{n} active today').replace('{n}', String(activeToday))}</span>` : null}
      </button>
      ${agents.slice(0, 3).map(a => html`
        <button class="pf-home-row" key=${a.gaii || a.name}
          onClick=${() => { try { sessionStorage.setItem('aimeat.agents.open', a.name); } catch { /* noop */ } openProfileTab('agents'); }}>
          <span class="pf-home-row-ico">${'🤖'}</span>
          <span class="pf-home-row-label">${escHtml(a.display_name || a.name)}</span>
          <span class="pf-home-row-meta ${isToday(a.last_seen) ? 'pf-ok' : ''}">
            ${a.last_seen ? (isToday(a.last_seen) ? (t('profile.landing.agentActiveToday') || 'active today') : relTime(a.last_seen)) : '—'}
          </span>
        </button>
      `)}
      ${nextJob ? html`
        <button class="pf-home-row" key="nextjob" onClick=${() => openProfileTab('scheduler')}>
          <span class="pf-home-row-ico">⏰</span>
          <span class="pf-home-row-label">${escHtml(nextJob.name || nextJob.id || '')}</span>
          <span class="pf-home-row-meta">${(t('profile.landing.nextRunAt') || 'next run {time}').replace('{time}', fmtClock(nextJob.nextRunAt))}</span>
        </button>` : null}
    </div>
  `;
}

/* ───── Sub-components ───── */

function ProfileCard({ tier, stats, session, onEditProfile, switchTab }) {
  const NODE_URL = getNodeUrl();
  const isNew = tier === 'new';
  const isExperienced = tier === 'experienced';
  const avatarSvg = minidenticon(session.owner || 'user');

  // Stats are NAVIGATION, not decoration \u2014 each one opens its own section.
  const stat = (icon, val, labelKey, tabId, green) => html`
    <button class="pf-lp-stat pf-lp-stat-link" onClick=${() => switchTab?.(tabId)}>
      ${icon} <span class="pf-lp-stat-val${green ? ' pf-lp-stat-green' : ''}">${val}</span> ${t(labelKey)}
    </button>`;

  return html`
    <div class="pf-lp-card">
      <div class="pf-lp-card-header">
        <div class="pf-lp-avatar" role="button" tabindex="0" title=${t('profile.landing.editProfile')}
          onClick=${() => onEditProfile?.()} dangerouslySetInnerHTML=${{ __html: avatarSvg }}></div>
        <div class="pf-lp-info">
          <div class="pf-lp-name-row">
            <span class="pf-lp-name">${escHtml(session.displayName || session.owner)}</span>
          </div>
          <div class="pf-lp-ghii">${escHtml(session.ghii || '')}</div>
          <div class="pf-lp-node">${t('profile.node')}: ${escHtml(NODE_URL)}</div>
          ${typeof stats.nodes === 'number' && stats.nodes > 0
            ? html`<div class="pf-federation-badge">
                <span class="pf-fed-dot"></span>
                ${t('profile.federation.statusConnected').replace('{count}', String(stats.nodes))}
              </div>`
            : html`<div class="pf-federation-badge pf-federation-standalone">
                ${t('profile.federation.statusStandalone')}
              </div>`
          }
        </div>
        <button class="btn-outline btn-sm pf-lp-profile-btn" onClick=${() => onEditProfile?.()}>
          ${t('profile.landing.profileBtn') || 'Profile'}</button>
      </div>
      <div class="pf-lp-stats">
        ${isNew ? html`
          ${stats.memory > 0 && stat('\u{1F9E0}', stats.memory, 'profile.stats.memories', 'memory')}
          ${(stats.balance != null && stats.balance !== '-' && stats.balance > 0)
            && stat('\u{1F48E}', stats.balance, 'profile.stats.morsels', 'wallet', true)}
        ` : html`
          ${stats.apps > 0 && stat('\u{1F4F1}', stats.apps, 'profile.stats.apps', 'apps')}
          ${stats.memory > 0 && stat('\u{1F9E0}', stats.memory, 'profile.stats.memories', 'memory')}
          ${(stats.balance != null && stats.balance !== '-' && stats.balance > 0)
            && stat('\u{1F48E}', stats.balance, 'profile.stats.morsels', 'wallet', true)}
          ${stats.services > 0 && stat('\u{1F50C}', stats.services, 'profile.stats.services', 'actions')}
          ${isExperienced && stats.agents > 0 && stat('\u{1F916}', stats.agents, 'profile.stats.agents', 'agents')}
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

/* Onboarding promo — shown only while the user has fewer than 3 apps, and dismissable for good.
 * After that the same content lives on the Extensions page; for a seasoned user it was dead space. */
function CortexSection({ switchTab, onDismiss }) {
  return html`
    <div class="pf-landing-section pf-promo">
      <div class="pf-menu-title">${t('profile.landing.cortexSectionTitle')}
        <button class="pf-promo-dismiss" title=${t('profile.landing.promoDismiss') || 'Hide'}
          onClick=${(e) => { e.stopPropagation(); onDismiss?.(); }}>✕</button>
      </div>
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

/* (AppStrip removed \u2014 the cross-type "Continue" card replaced it: raw filenames in a horizontal
 * scroller duplicated the Apps tab and read as a file listing.) */

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

/* ───── Persistent sidebar groups (replaces the tier-adaptive menu) ─────
 * Every tab is always present and grouped into stable sections — no activity-based
 * hiding, so humans and agentic developers can predict where each tab lives.
 * Group titles reuse existing i18n keys; tab labels reuse profile.tabs.* / *.tabLabel. */
/* Grouping follows the information-refinement pipeline and usage frequency, not an
 * abstract taxonomy (the old Daily/Personal/Technical groups are gone). Badges remain
 * reserved for action-required counts only — never static totals. */
const SIDEBAR_GROUPS = [
  { titleKey: 'profile.landing.menuInformation', items: [   // raw → curated → governed
    { id: 'organisms', icon: '\u{1F3E2}', labelKey: 'profile.tabs.organisms' },
    { id: 'memory', icon: '\u{1F9E0}', labelKey: 'profile.tabs.memory' },
    { id: 'knowledge', icon: '\u{1F4DA}', labelKey: 'knowledge.tabLabel' },
    { id: 'boards', icon: '\u{1F4CB}', labelKey: 'profile.tabs.boards' },
  ] },
  { titleKey: 'profile.landing.menuAutomation', items: [    // agents + their infrastructure
    { id: 'agents', icon: '\u{1F916}', labelKey: 'profile.tabs.agents' },
    { id: 'ecosystem', icon: '\u{1F50C}', labelKey: 'profile.tabs.ecosystem' },
    { id: 'offers', icon: '\u{1F9F0}', labelKey: 'profile.tabs.offers' },
    { id: 'scheduler', icon: '⏰', labelKey: 'profile.tabs.scheduler' },
    { id: 'workflows', icon: '\u{1F500}', labelKey: 'profile.tabs.workflows' },
    { id: 'actions', icon: '\u{1F6E0}️', labelKey: 'profile.tabs.services' },
    { id: 'mcp', icon: '\u{1F517}', labelKey: 'profile.tabs.mcp' },
  ] },
  { titleKey: 'profile.landing.menuActivity', items: [      // communication + events
    { id: 'notifications', icon: '\u{1F514}', labelKey: 'profile.tabs.notifications' },
    { id: 'email', icon: '\u{1F4E7}', labelKey: 'profile.tabs.email' },
    { id: 'chatsessions', icon: '\u{1F4AC}', labelKey: 'profile.tabs.chatSessions' },
  ] },
  { titleKey: 'profile.landing.menuBuildShare', items: [
    { id: 'apps', icon: '⚙️', labelKey: 'profile.tabs.apps' },
    { id: 'generator', icon: '\u{1F534}', labelKey: 'profile.generator.tabLabel' },
    /* foundry removed from the menu 2026-06-10 (owner: not in use). The tab module and
     * its route id still exist — restore by re-adding this item. */
    { id: 'extensions', icon: '\u{1F50C}', labelKey: 'profile.tabs.extensions' },
    { id: 'capabilities', icon: '⚡', labelKey: 'capabilities.tabLabel' },
    { id: 'packages', icon: '\u{1F4E6}', labelKey: 'profile.tabs.packages' },
    { id: 'portfolio', icon: '\u{1F3A8}', labelKey: 'portfolio.tabLabel' },
    { id: 'calibrator', icon: '\u{1F3AF}', labelKey: 'profile.calibrator.tabLabel' },
    /* TODO(owner 2026-06-10): "work" placement is undecided — parked at the bottom of
     * Build & Share until re-evaluated. */
    { id: 'work', icon: '\u{1F4CB}', labelKey: 'profile.tabs.work' },
  ] },
  { titleKey: 'profile.landing.menuAccount', items: [
    { id: 'wallet', icon: '\u{1F48E}', labelKey: 'profile.tabs.wallet' },
    { id: 'dataWallet', icon: '\u{1F512}', labelKey: 'profile.tabs.dataWallet' },
    { id: 'access', icon: '\u{1F510}', labelKey: 'profile.tabs.access' },
  ] },
  /* Operator-only: the group AND its routes are gated on the operator role (open()
   * refuses these ids for non-operators; the underlying APIs enforce server-side).
   * nodeStats left the menu — it lives as a tab on the Nodes page now. */
  { titleKey: 'profile.landing.menuInfra', adminOnly: true, items: [
    { id: 'federation', icon: '\u{1F310}', labelKey: 'profile.tabs.federation' },
    { id: 'nodes', icon: '\u{1F5A5}️', labelKey: 'profile.tabs.nodes' },
    { id: 'security', icon: '\u{1F6E1}️', labelKey: 'profile.tabs.security' },
  ] },
];

// Flat item lookup (pinned section renders items by id).
const SIDEBAR_ITEM_BY_ID = Object.fromEntries(SIDEBAR_GROUPS.flatMap(g => g.items.map(it => [it.id, it])));
const INFRA_TAB_IDS = new Set(['federation', 'nodes', 'nodeStats', 'security']);
const DEFAULT_PINS = ['organisms', 'agents', 'memory', 'scheduler'];

/* ───── Main landing page ───── */

export default function LandingPage({ tier, stats, session, navigate, showToast, locale, renderTab, getTabLabel }) {
  const [apps, setApps] = useState([]);
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
    } catch { /* ignore */ }
    return null;
  });
  const [expanded, setExpanded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Extensions promo: onboarding-only (apps < 3) and dismissable for good.
  const [showPromo, setShowPromo] = useState(() => { try { return localStorage.getItem('aimeat.cortexPromoDismissed') !== '1'; } catch { return true; } });
  const dismissPromo = () => { setShowPromo(false); try { localStorage.setItem('aimeat.cortexPromoDismissed', '1'); } catch { /* noop */ } };

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
  const isOperator = (session?.roles || []).includes('operator');

  const open = useCallback((tabId, slot) => {
    // Infrastructure tabs are operator-only — refuse them here too so deep links
    // (sessionStorage restore, aimeat-open-tab events) can't open the views.
    // The underlying APIs enforce the role server-side regardless.
    if (INFRA_TAB_IDS.has(tabId) && !isOperator) return;
    setOpenView(prev => {
      const next = (prev?.tabId === tabId) ? null : { tabId, slot };
      if (next) {
        sessionStorage.setItem('aimeat-profile-tab', JSON.stringify(next));
      } else {
        sessionStorage.removeItem('aimeat-profile-tab');
      }
      return next;
    });
  }, [isOperator]);

  /* ── Pinned items: 3–5 favourites under Home, persisted per user (memory key
     `sidebar.pins`, same pattern as organisms.ui). Defaults for new users. ── */
  const [pins, setPins] = useState(DEFAULT_PINS);
  useEffect(() => {
    getMemory('sidebar.pins')
      .then(r => { const v = r?.data?.value; if (Array.isArray(v) && v.length) setPins(v.filter(id => SIDEBAR_ITEM_BY_ID[id])); })
      .catch(() => { /* defaults stand */ });
  }, []);
  const togglePin = (id) => {
    setPins(prev => {
      let next;
      if (prev.includes(id)) next = prev.filter(x => x !== id);
      else if (prev.length >= 5) { showToast?.(t('profile.landing.pinLimit') || 'Max 5 pinned items'); return prev; }
      else next = [...prev, id];
      createMemory('sidebar.pins', next, 'private').catch(() => {});
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
      try { localStorage.setItem('aimeat.sidebar.collapsed', JSON.stringify([...next])); } catch { /* noop */ }
      return next;
    });
  };

  const close = useCallback(() => {
    sessionStorage.removeItem('aimeat-profile-tab');
    setOpenView(null);
  }, []);

  /* Cross-tab navigation: any tab component can dispatch
   * `new CustomEvent('aimeat-open-tab', { detail: { tabId } })` to open another
   * profile tab inline (e.g. an organism's Board tab → the Boards view). */
  useEffect(() => {
    const handler = (e) => {
      const tabId = e.detail?.tabId;
      if (tabId) open(tabId, e.detail?.slot || 'main');
    };
    window.addEventListener('aimeat-open-tab', handler);
    return () => window.removeEventListener('aimeat-open-tab', handler);
  }, [open]);

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
          <div class="pf-side-avatar" dangerouslySetInnerHTML=${{ __html: minidenticon(owner || 'user') }}></div>
          <div class="pf-side-id-name">${session.displayName || owner}</div>
        </div>

        <button class="pf-side-item${!openView ? ' pf-side-item--active' : ''}"
          onClick=${() => { close(); setDrawerOpen(false); }}>
          <span class="pf-side-ico">\u{1F3E0}</span><span class="pf-side-label">${t('profile.landing.home')}</span>
        </button>

        ${(() => {
          const renderItem = (it, pinned) => html`
            <button class="pf-side-item${isOpen(it.id) ? ' pf-side-item--active' : ''}" key=${(pinned ? 'pin-' : '') + it.id}
              onClick=${() => { open(it.id, 'main'); setDrawerOpen(false); }}>
              <span class="pf-side-ico">${it.icon}</span>
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
          ${isNew ? html`<${HeroOnboarding} switchTab=${(id) => open(id, 'main')} />` : null}
          ${(isNew || isActive) ? html`<${KnowledgeCallout} switchTab=${() => open('knowledge', 'main')} />` : null}
          ${isNew ? html`<${GhostTiles} switchTab=${() => open('packages', 'main')} />` : null}
          <${WaitingForYou} owner=${owner} />
          <div class="pf-home-grid">
            <${ContinueCard} />
            <${AgentsCard} owner=${owner} />
          </div>
          ${(showPromo && apps.length < 3) ? html`
            <${CortexSection} switchTab=${() => open('extensions', 'main')} onDismiss=${dismissPromo} />` : null}
        `}
      </main>
    </div>
  `;
}
