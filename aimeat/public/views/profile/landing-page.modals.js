/**
 * @file public/views/profile/landing-page.modals.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile edit / change-password / presence modals + presence pill. Extracted from landing-page.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from views/profile/landing-page.js (max-file-lines)
 */
import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import htm from "htm";
const html = htm.bind(h);
import { t } from "/js/i18n.js";
import { getProfile, updateProfile, changePassword, updateSessionMeta } from "/js/services/auth.js";
import { getMyPresence, setMyPresence } from "/js/services/presence.js";
import { onLiveUpdate } from "/lib/live-updates.js";
import { Spinner } from "./shared.js";
import { PresenceDot } from "/components/PresenceDot.js";
import { useToast } from "/components/Toast.js";
import { swallowed } from '/js/swallowed.js';

/* ───── Edit Profile Modal ───── */

export function EditProfileModal({ session, onClose, onSaved, onChangePassword }) {
  const { showToast, ToastContainer } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState({ display_name: '', bio: '', avatar: '', locale: 'en', directory_listed: false });
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
            directory_listed: d.directory_listed === true,
          });
          setCurrentEmail(d.notification_email || '');
        }
      } catch (err) { swallowed('landing-page.modals: EditProfileModal', err); }
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
          // Persist + re-render the golden login pill live (so it shows the new name now).
          updateSessionMeta({ displayName: fields.display_name });
        }
        onSaved?.();
      } else {
        showToast(t('profile.landing.editError'), true);
      }
    } catch (err) {
      swallowed('landing-page.modals: save', err);
      showToast(t('profile.landing.editError'), true);
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
            <label class="pf-edit-check">
              <input type="checkbox" checked=${fields.directory_listed}
                onChange=${(e) => set('directory_listed', e.target.checked)} />
              <span>
                <span class="pf-edit-check-title">${t('profile.landing.editDirectoryListed') || 'List me in the member directory'}</span>
                <span class="pf-edit-hint">${t('profile.landing.editDirectoryHint') || 'Off by default. When on, other signed-in members can find you (name, bio, avatar) in the directory. Anonymous visitors never see it.'}</span>
              </span>
            </label>
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
      <${ToastContainer} />
    </div>
  `;
}

/* ───── Change Password Modal ───── */

/* Password input with a neutral show/hide toggle (text-presentation eye, gray — red would read
 * as an error). */
export function PwInput({ value, onInput }) {
  const [show, setShow] = useState(false);
  return html`
    <div class="pf-pw-wrap">
      <input type=${show ? 'text' : 'password'} class="pf-edit-input" value=${value} onInput=${onInput} />
      <button type="button" class="pf-pw-eye"
        onClick=${() => setShow(s => !s)}>${show ? (t('profile.landing.hidePassword') || 'Hide') : (t('profile.landing.showPassword') || 'Show')}</button>
    </div>`;
}

export function ChangePasswordModal({ onClose, onChanged }) {
  const [current, setCurrent] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  // null while loading; true once we know a password exists, false for OAuth-created
  // accounts that have never set one (Google sign-in). When false we offer "set a
  // password" with no current-password field, since there's nothing to verify against.
  const [hasPassword, setHasPassword] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await getProfile();
        if (!cancelled) setHasPassword(resp?.data?.has_password !== false);
      } catch (err) {
        swallowed('landing-page.modals: ChangePasswordModal', err);
        if (!cancelled) setHasPassword(true); // fail safe: require current password
      }
    })();
    return () => { cancelled = true; };
  }, []);

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

  // OAuth accounts with no password set: "set a password" flow (no current field).
  const setupMode = hasPassword === false;

  return html`
    <div class="pf-edit-overlay" onClick=${onOverlayClick}>
      <div class="pf-edit-modal">
        <div class="pf-edit-header">
          <h2 class="pf-edit-title">${setupMode
            ? (t('profile.landing.setPasswordTitle') || 'Set a password')
            : t('profile.landing.changePasswordTitle')}</h2>
          <button class="pf-edit-close" onClick=${onClose} aria-label=${t('profile.landing.editCancel')}>✕</button>
        </div>
        <div class="pf-edit-body">
          ${setupMode ? html`
            <div class="pf-edit-hint">${t('profile.landing.setPasswordHint')
              || 'Your account has no password yet (you signed in with Google). Choose a password to also sign in with your username.'}</div>
          ` : html`
            <label class="pf-edit-label">
              ${t('profile.landing.currentPassword')}
              <${PwInput} value=${current} onInput=${(e) => setCurrent(e.target.value)} />
            </label>
          `}
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
          <button class="btn-primary" onClick=${save} disabled=${saving || hasPassword === null || (!setupMode && !current) || !rulesOk || !confirm || mismatch}>
            ${saving
              ? (setupMode ? (t('profile.landing.passwordSaving') || t('profile.landing.passwordChanging')) : t('profile.landing.passwordChanging'))
              : (setupMode ? (t('profile.landing.setPasswordBtn') || 'Set password') : (t('profile.landing.changePasswordBtn') || 'Change password'))}
          </button>
        </div>
      </div>
    </div>
  `;
}

/* "Presence" — the owner's own availability control. Lives as a compact status
 * pill in the ProfileCard header (<PresencePill>); clicking it opens the settings
 * <PresenceDialog>. The dot the pill shows is the same <PresenceDot> rendered next
 * to people everywhere else, kept live by the pill's own fetch + live-update wiring. */
export function PresenceDialog({ cfg, status, saving, onSave, onClose }) {
  const onOverlayClick = (e) => { if (e.target === e.currentTarget) onClose(); };
  return html`
    <div class="pf-edit-overlay" onClick=${onOverlayClick}>
      <div class="pf-edit-modal pf-presence-modal">
        <div class="pf-edit-header">
          <h2 class="pf-edit-title">${t('presence.control.title')}</h2>
          <button class="pf-edit-close" onClick=${onClose} aria-label=${t('profile.landing.editCancel')}>✕</button>
        </div>
        <div class="pf-edit-body">
          <div class="pf-presence-head">
            <div class="section-desc">${t('presence.control.desc')}</div>
            <${PresenceDot} status=${status} size="md" label=${true} />
          </div>

          <div class="pf-presence-row">
            <label class="pf-presence-label">${t('presence.control.modeLabel')}</label>
            <div class="pf-presence-modes">
              <button class=${'pf-presence-pill' + (cfg.mode === 'auto' ? ' pf-presence-pill--on' : '')}
                disabled=${saving} onClick=${() => onSave({ mode: 'auto' })}>${t('presence.control.modeAuto')}</button>
              <button class=${'pf-presence-pill' + (cfg.mode === 'manual' ? ' pf-presence-pill--on' : '')}
                disabled=${saving} onClick=${() => onSave({ mode: 'manual' })}>${t('presence.control.modeManual')}</button>
            </div>
          </div>

          ${cfg.mode === 'auto' ? html`
            <div class="pf-presence-hint">${t('presence.control.modeAutoHint')}</div>
          ` : html`
            <div class="pf-presence-row">
              <label class="pf-presence-label" for="pf-presence-status">${t('presence.control.statusLabel')}</label>
              <select id="pf-presence-status" class="pf-edit-select" value=${cfg.status} disabled=${saving}
                onChange=${(e) => onSave({ status: e.target.value })}>
                <option value="available">${t('presence.status.available')}</option>
                <option value="busy">${t('presence.status.busy')}</option>
                <option value="away">${t('presence.status.away')}</option>
                <option value="invisible">${t('presence.status.invisible')}</option>
              </select>
            </div>
          `}

          <div class="pf-presence-row">
            <label class="pf-presence-label" for="pf-presence-vis">${t('presence.control.visibilityLabel')}</label>
            <select id="pf-presence-vis" class="pf-edit-select" value=${cfg.visibility} disabled=${saving}
              onChange=${(e) => onSave({ visibility: e.target.value })}>
              <option value="everyone">${t('presence.control.visEveryone')}</option>
              <option value="contacts">${t('presence.control.visContacts')}</option>
              <option value="nobody">${t('presence.control.visNobody')}</option>
            </select>
          </div>
          <div class="pf-presence-hint">
            ${cfg.visibility === 'everyone' ? t('presence.control.visEveryoneHint')
              : cfg.visibility === 'contacts' ? t('presence.control.visContactsHint') : ''}
          </div>
        </div>
        <div class="pf-edit-footer">
          <button class="btn-primary" onClick=${onClose}>${t('profile.close')}</button>
        </div>
      </div>
    </div>
  `;
}

export function PresencePill() {
  const [cfg, setCfg] = useState(null);
  const [status, setStatus] = useState('unknown');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await getMyPresence();
      if (r?.data) { setCfg(r.data.config); setStatus(r.data.status || 'unknown'); }
    } catch (err) { swallowed('landing-page.modals: PresencePill', err); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => onLiveUpdate(['presence'], () => liveRef.current()), []);

  const save = async (partial) => {
    if (!cfg) return;
    const optimistic = { ...cfg, ...partial };
    setCfg(optimistic);
    setSaving(true);
    try {
      const r = await setMyPresence(partial);
      if (r?.data) { setCfg(r.data.config); setStatus(r.data.status || 'unknown'); }
    } catch (err) { swallowed('landing-page.modals', err); setCfg(cfg); /* revert */ }
    setSaving(false);
  };

  if (!cfg) return null;
  return html`
    <button class="pf-presence-pill-btn" onClick=${() => setOpen(true)} title=${t('presence.control.title')}>
      <${PresenceDot} status=${status} size="sm" label=${true} />
      <span class="pf-presence-pill-caret" aria-hidden="true">⌄</span>
    </button>
    ${open ? html`<${PresenceDialog} cfg=${cfg} status=${status} saving=${saving}
      onSave=${save} onClose=${() => setOpen(false)} />` : null}
  `;
}
