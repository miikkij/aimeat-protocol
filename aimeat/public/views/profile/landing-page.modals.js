/**
 * @file public/views/profile/landing-page.modals.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile edit / change-password / presence modals + presence pill. Extracted from landing-page.js to satisfy max-file-lines.
 * @version-history
 *   2026-09-13: Presence controls use shared choices, fields and dialog.
 *   2026-09-13: Account dialogs compose the shared poster fields, actions and surfaces.
 *   2026-09-13: The three dialogs open in the site's one dialog (components/Modal.js) instead of an
 *     overlay of their own: the same header, X, scrolling body and footer as every other dialog, the
 *     phone sheet, and Modal's guard in place of the two hand-written Escape listeners.
 *   2026-09-09: Mark both account dialogs for the shared poster form skin in every host view.
 *   2026-09-09: Home journey starts with a connected AI; useful prompts and account settings are within reach.
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
import { DisplayPrefsFields } from "/components/DisplayPrefsFields.js";
import { setDisplayPrefs } from "/js/display-prefs.js";
import { swallowed } from '/js/swallowed.js';
import { Dialog, Stack, Field, Text, Action, KeyValue } from '/components/poster-parts.js';

/* ───── Edit Profile Modal ───── */

export function EditProfileModal({ session, onClose, onSaved, onChangePassword }) {
  const { showToast, ToastContainer } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState({ display_name: '', bio: '', avatar: '', locale: 'en', region: '', timezone: '', directory_listed: false });
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
            // Empty means "follow my browser", which is a real answer rather than a missing one.
            region: d.region || '',
            timezone: d.timezone || '',
            directory_listed: d.directory_listed === true,
          });
          setCurrentEmail(d.notification_email || '');
        }
      } catch (err) { swallowed('landing-page.modals: EditProfileModal', err); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const set = (key, val) => { setFields(prev => ({ ...prev, [key]: val })); };

  const save = async () => {
    setSaving(true);
    try {
      const resp = await updateProfile(fields);
      if (resp && resp.data) {
        // Every date already on the screen repaints in the new format and clock, without a reload.
        setDisplayPrefs({ region: resp.data.region, timezone: resp.data.timezone });
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

  // The dialog keeps a half-written form open against Escape and a stray click (Modal's guard);
  // while a save is on its way nothing closes it.
  const requestClose = () => { if (!saving) onClose(); };


  const footer = loading ? null : html`
    <${Action} onClick=${requestClose} disabled=${saving}>${t('profile.landing.editCancel')}<//>
    <${Action} kind="primary" onClick=${save} disabled=${saving}>
      ${saving ? t('profile.landing.editSaving') : t('profile.landing.editSave')}<//>`;
  const footerStart = loading ? null : html`<${Action} kind="text" onClick=${() => onChangePassword?.()}>
    ${t('profile.landing.changePassword')}…<//>`;
  return html`<${Dialog} open=${true} onClose=${requestClose} title=${t('profile.landing.editModalTitle')}
    actions=${footer} sideAction=${footerStart}>
    ${loading ? html`<${Spinner} />` : html`<${Stack}>
      <${Field} label=${t('profile.landing.editDisplayName')} value=${fields.display_name}
        placeholder=${t('profile.landing.editDisplayNamePlaceholder')} maxLength=${100}
        onInput=${e => set('display_name', e.target.value)} />
      <${Field} type="textarea" label=${t('profile.landing.editBio')} value=${fields.bio}
        placeholder=${t('profile.landing.editBioPlaceholder')} maxLength=${500} rows=${3}
        onInput=${e => set('bio', e.target.value)} />
      <${Field} label=${t('profile.landing.editAvatar')} value=${fields.avatar}
        placeholder=${t('profile.landing.editAvatarPlaceholder')} maxLength=${50}
        onInput=${e => set('avatar', e.target.value)} />
      <${Text}>${fields.avatar || '🙂'}<//>
      <${Field} type="select" label=${t('profile.landing.editLocale')} value=${fields.locale}
        onChange=${e => set('locale', e.target.value)}
        options=${[{value:'en',label:'English'},{value:'fi',label:'Suomi'},{value:'es',label:'Español'}]}
        hint=${t('profile.landing.editLocaleHint') || 'Your preferred language — used for the portal UI; agents can read it from your profile to answer in it.'} />
      <${DisplayPrefsFields} region=${fields.region} timezone=${fields.timezone} onChange=${set} />
      <${KeyValue} label=${t('profile.landing.editEmail')} value=${currentEmail || t('profile.landing.editEmailNone')} />
      <${Action} href="/v1/profile?tab=email" kind="text">${t('profile.landing.editEmailLink') || 'Change in the Email tab →'}<//>
      <${Field} type="checkbox" label=${t('profile.landing.editDirectoryListed') || 'List me in the member directory'}
        value=${fields.directory_listed} onChange=${e => set('directory_listed', e.target.checked)} />
      <${Text} tone="muted">${t('profile.landing.editDirectoryHint') || 'Off by default. When on, other signed-in members can find you (name, bio, avatar) in the directory. Anonymous visitors never see it.'}<//>
    <//>`}
    <${ToastContainer} />
  <//>`;
}

/* ───── Change Password Modal ───── */

/* Password input with a neutral show/hide toggle (text-presentation eye, gray — red would read
 * as an error). */
export function PwInput({ value, onInput, label, autoComplete }) {
  const [show, setShow] = useState(false);
  return html`<${Stack} density="compact">
    <${Field} type=${show ? 'text' : 'password'} label=${label} value=${value} onInput=${onInput} autoComplete=${autoComplete} />
    <${Stack} align="start"><${Action} onClick=${() => setShow(s => !s)}>
      ${show ? (t('profile.landing.hidePassword') || 'Hide') : (t('profile.landing.showPassword') || 'Show')}<//><//>
  <//>`;
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

  const requestClose = () => { if (!saving) onClose(); };

  // OAuth accounts with no password set: "set a password" flow (no current field).
  const setupMode = hasPassword === false;


  const footer = html`
    <${Action} onClick=${requestClose} disabled=${saving}>${t('profile.landing.editCancel')}<//>
    <${Action} kind="primary" onClick=${save} disabled=${saving || hasPassword === null || (!setupMode && !current) || !rulesOk || !confirm || mismatch}>
      ${saving
        ? (setupMode ? (t('profile.landing.passwordSaving') || t('profile.landing.passwordChanging')) : t('profile.landing.passwordChanging'))
        : (setupMode ? (t('profile.landing.setPasswordBtn') || 'Set password') : (t('profile.landing.changePasswordBtn') || 'Change password'))}<//>`;
  return html`<${Dialog} open=${true} onClose=${requestClose} size="small" actions=${footer}
    title=${setupMode ? (t('profile.landing.setPasswordTitle') || 'Set a password') : t('profile.landing.changePasswordTitle')}>
    <${Stack}>
      ${setupMode ? html`<${Text} tone="muted">${t('profile.landing.setPasswordHint')
        || 'Your account has no password yet (you signed in with Google). Choose a password to also sign in with your username.'}<//>`
        : html`<${PwInput} label=${t('profile.landing.currentPassword')} autoComplete="current-password"
            value=${current} onInput=${e => setCurrent(e.target.value)} />`}
      <${PwInput} label=${t('profile.landing.newPassword')} autoComplete="new-password" value=${newPw} onInput=${e => setNewPw(e.target.value)} />
      <${Stack} density="compact">${rules.map(r => html`<${Text} key=${r.label} tone=${r.ok ? 'success' : 'muted'}>
        ${r.ok ? '✓' : '○'} ${r.label}<//>`)}<//>
      <${PwInput} label=${t('profile.landing.confirmPassword')} autoComplete="new-password" value=${confirm} onInput=${e => setConfirm(e.target.value)} />
      ${mismatch && html`<${Text} tone="danger">${t('profile.landing.passwordMismatch')}<//>`}
      ${err && html`<${Text} tone="danger">${err}<//>`}
    <//>
  <//>`;
}

/* "Presence" — the owner's own availability control. Lives as a compact status
 * pill in the ProfileCard header (<PresencePill>); clicking it opens the settings
 * <PresenceDialog>. The dot the pill shows is the same <PresenceDot> rendered next
 * to people everywhere else, kept live by the pill's own fetch + live-update wiring. */
export function PresenceDialog({ cfg, status, saving, onSave, onClose }) {
  // Every choice here saves the moment it is made, so there is no half-written form to guard.
  return html`<${Dialog} open=${true} onClose=${onClose} title=${t('presence.control.title')} size="small" guard=${false}
    actions=${html`<${Action} kind="primary" onClick=${onClose}>${t('profile.close')}<//>`}>
    <${Stack}>
      <${Text} tone="muted">${t('presence.control.desc')}<//>
      <${PresenceDot} status=${status} size="md" label=${true} />
      <${Stack} direction="wrap" role="radiogroup" label=${t('presence.control.modeLabel')}>
        <${Action} kind="tab" semantics="radio" selected=${cfg.mode === 'auto'} disabled=${saving} onClick=${() => onSave({mode:'auto'})}>${t('presence.control.modeAuto')}<//>
        <${Action} kind="tab" semantics="radio" selected=${cfg.mode === 'manual'} disabled=${saving} onClick=${() => onSave({mode:'manual'})}>${t('presence.control.modeManual')}<//>
      <//>
      ${cfg.mode === 'auto' ? html`<${Text} tone="muted">${t('presence.control.modeAutoHint')}<//>`
        : html`<${Field} type="select" label=${t('presence.control.statusLabel')} value=${cfg.status} disabled=${saving}
          onChange=${e => onSave({status:e.target.value})} options=${['available','busy','away','invisible'].map(value => ({value,label:t('presence.status.'+value)}))} />`}
      <${Field} type="select" label=${t('presence.control.visibilityLabel')} value=${cfg.visibility} disabled=${saving}
        onChange=${e => onSave({visibility:e.target.value})} options=${[
          {value:'everyone',label:t('presence.control.visEveryone')},{value:'contacts',label:t('presence.control.visContacts')},{value:'nobody',label:t('presence.control.visNobody')}
        ]} />
      <${Text} tone="muted">${cfg.visibility === 'everyone' ? t('presence.control.visEveryoneHint') : cfg.visibility === 'contacts' ? t('presence.control.visContactsHint') : ''}<//>
    <//>
  <//>`;
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
  return html`<${Action} onClick=${() => setOpen(true)} label=${t('presence.control.title')} expanded=${open}>
    <${PresenceDot} status=${status} size="sm" label=${true} />
  <//>
  ${open && html`<${PresenceDialog} cfg=${cfg} status=${status} saving=${saving} onSave=${save} onClose=${() => setOpen(false)} />`}`;}
