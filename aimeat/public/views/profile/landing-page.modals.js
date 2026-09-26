/**
 * @file public/views/profile/landing-page.modals.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile edit / change-password / presence modals + presence pill. Extracted from landing-page.js to satisfy max-file-lines.
 * @version-history
 *   v1.9.0 — 2026-09-26 — Every part is a kit component (the dialogs' fields TextField, TextArea, Select, Check, Choice and Field in a Stack; the picture's preview MastheadPreview; the password's eye TextField secret with its Show and Hide words, kept as main had it; the requirements the List's small cut with Tick; the presence button PresenceButton; Note, Action, Loud): this file writes no class (page group G8).
 *   v1.8.0 — 2026-09-26 — The overview's head is the home's head, the Masthead (components/Masthead.js); the head's own rules go, the address line and the marks keep theirs. The account dialog's preview of your picture is framed as the head frames it (.poster-frame); its size stays (a unification: Jouni's decision "Person head").
 *   v1.7.0 — 2026-09-26 — The account dialog's e-mail, which is changed in the Email tab, is the Text field, disabled; .pf-edit-readonly goes (a unification: the look most tabs use).
 *   v1.6.0 — 2026-09-26 — Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.5.0 — 2026-09-25 — The account dialogs' fields are the Text field, the Text area and the Select field, their labels the row label and their help lines the Hint; the dialogs' own field looks go, a field keeps its width and its room for Show (a unification: the look most tabs use).
 *   v1.4.0 — 2026-09-25 — The last labels over a field or a group wear .poster-label: the classic AI settings, the presence dialog, the scope groups, the ecosystem's trigger and sample, the scheduler's edit form, P&L's fields, the task runner's name; a place keeps its layout (Jouni's decision "Row label", a unification).
 *   v1.3.0 — 2026-09-25 — The last quiet ways on with a look of their own are the action link (.poster-action; the danger tone for detach, the small link for a link inside a part, the quiet cut in the account dialogs): pn-detach-btn, pn-setup-link, pf-aitr-row-link, pf-edit-link, pf-pw-eye and the door's underlined words; a place keeps only its layout (Jouni's decision "Action link", a unification).
 *   v1.2.0 — 2026-09-25 — The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.1.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   2026-09-24: The footers' actions are the library's (Jouni's decision "Dialog actions"): Cancel and
 *     "Change password…" the action link, Save the dark block.
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
import { LoadingLine } from "./shared.js";
import { PresenceDot, PresenceButton } from "/components/PresenceDot.js";
import { useToast } from "/components/Toast.js";
import { DisplayPrefsFields } from "/components/DisplayPrefsFields.js";
import { setDisplayPrefs } from "/js/display-prefs.js";
import { swallowed } from '/js/swallowed.js';
import { Modal } from '/components/Modal.js';
import { MastheadPreview } from '/components/Masthead.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Choice } from '/components/Choice.js';
import { Field } from '/components/Field.js';
import { List, Row, Tick, Cell } from '/components/List.js';
import { HeadDesc } from '/components/SubHeading.js';
import { Note } from '/components/Note.js';
import { Action, Loud } from '/components/Action.js';
import { Row as Line, Stack, Space } from '/components/Layout.js';

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
    <${Loud} control onClick=${save} disabled=${saving}>
      ${saving ? t('profile.landing.editSaving') : t('profile.landing.editSave')}
    <//>`;
  const footerStart = loading ? null : html`
    <${Action} href="#" onClick=${(e) => { e.preventDefault(); onChangePassword?.(); }}>${t('profile.landing.changePassword')}…<//>`;

  return html`
    <${Modal} open=${true} onClose=${requestClose} title=${t('profile.landing.editModalTitle')}
      footer=${footer} footerStart=${footerStart}>
        ${loading ? html`<${Space} above="section" below="section"><${LoadingLine} /><//>` : html`
          <${Stack} gap="medium">
            <${TextField} label=${t('profile.landing.editDisplayName')} value=${fields.display_name}
              placeholder=${t('profile.landing.editDisplayNamePlaceholder')} maxLength=${100}
              onInput=${(v) => set('display_name', v)} />
            <${TextArea} label=${t('profile.landing.editBio')} value=${fields.bio}
              placeholder=${t('profile.landing.editBioPlaceholder')} maxLength=${500} rows=${3}
              onInput=${(v) => set('bio', v)} />
            <${TextField} label=${t('profile.landing.editAvatar')} value=${fields.avatar}
              placeholder=${t('profile.landing.editAvatarPlaceholder')} maxLength=${50}
              onInput=${(v) => set('avatar', v)}
              actions=${html`<${MastheadPreview}>${fields.avatar || '🙂'}<//>`} />
            <${Select} label=${t('profile.landing.editLocale')} value=${fields.locale} onChange=${(v) => set('locale', v)}
              options=${[['en', 'English'], ['fi', 'Suomi'], ['es', 'Español']]}
              hint=${t('profile.landing.editLocaleHint') || 'Your preferred language — used for the portal UI; agents can read it from your profile to answer in it.'} />
            ${/* Beside the language, because they are the two settings it is NOT. */''}
            <${DisplayPrefsFields} region=${fields.region} timezone=${fields.timezone}
              onChange=${(k, v) => set(k, v)} />
            <${Field} label=${t('profile.landing.editEmail')}>
              <${TextField} value=${currentEmail || t('profile.landing.editEmailNone')} disabled ariaLabel=${t('profile.landing.editEmail')} />
              <${Action} tone="quiet" href="/v1/profile?tab=email">${t('profile.landing.editEmailLink') || 'Change in the Email tab →'}<//>
            <//>
            <${Check} checked=${fields.directory_listed} onChange=${(on) => set('directory_listed', on)}
              hint=${t('profile.landing.editDirectoryHint') || 'Off by default. When on, other signed-in members can find you (name, bio, avatar) in the directory. Anonymous visitors never see it.'}>
              ${t('profile.landing.editDirectoryListed') || 'List me in the member directory'}
            <//>
          <//>
        `}
        <${ToastContainer} />
    <//>
  `;
}

/* ───── Change Password Modal ───── */

/* Password input with the show/hide eye, named in words (the Text field's secret cut; the lead's
 * ruling: the account password dialog keeps its eye). `onInput` gets the event, as it always did. */
export function PwInput({ value, onInput, label, autoComplete }) {
  return html`<${TextField} secret label=${label} value=${value} autoComplete=${autoComplete || 'current-password'}
    showLabel=${t('profile.landing.showPassword') || 'Show'} hideLabel=${t('profile.landing.hidePassword') || 'Hide'}
    onInput=${(v, e) => onInput?.(e)} />`;
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
    <${Loud} control onClick=${save} disabled=${saving || hasPassword === null || (!setupMode && !current) || !rulesOk || !confirm || mismatch}>
      ${saving
        ? (setupMode ? (t('profile.landing.passwordSaving') || t('profile.landing.passwordChanging')) : t('profile.landing.passwordChanging'))
        : (setupMode ? (t('profile.landing.setPasswordBtn') || 'Set password') : (t('profile.landing.changePasswordBtn') || 'Change password'))}
    <//>`;

  return html`
    <${Modal} open=${true} onClose=${requestClose} size="sm" footer=${footer}
      title=${setupMode ? (t('profile.landing.setPasswordTitle') || 'Set a password') : t('profile.landing.changePasswordTitle')}>
      <${Stack} gap="medium">
          ${setupMode ? html`
            <${Note}>${t('profile.landing.setPasswordHint')
              || 'Your account has no password yet (you signed in with Google). Choose a password to also sign in with your username.'}<//>
          ` : html`
            <${PwInput} label=${t('profile.landing.currentPassword')} value=${current} onInput=${(e) => setCurrent(e.target.value)} />
          `}
          <${PwInput} label=${t('profile.landing.newPassword')} autoComplete="new-password" value=${newPw} onInput=${(e) => setNewPw(e.target.value)} />
          <${List} cols="mark-name" keepCols small>
            ${rules.map(r => html`<${Row} key=${r.label} fine=${r.ok}><${Tick} bare state=${r.ok ? 'done' : 'off'} glyph=${r.ok ? '✓' : '○'} /><${Cell}>${r.label}<//><//>`)}
          <//>
          <${PwInput} label=${t('profile.landing.confirmPassword')} autoComplete="new-password" value=${confirm} onInput=${(e) => setConfirm(e.target.value)} />
          ${mismatch ? html`<${Note} kind="message" error>${t('profile.landing.passwordMismatch')}<//>` : null}
          ${err && html`<${Note} kind="message" error>${err}<//>`}
      <//>
    <//>
  `;
}

/* "Presence" — the owner's own availability control. Lives as a compact status
 * pill in the ProfileCard header (<PresencePill>); clicking it opens the settings
 * <PresenceDialog>. The dot the pill shows is the same <PresenceDot> rendered next
 * to people everywhere else, kept live by the pill's own fetch + live-update wiring. */
export function PresenceDialog({ cfg, status, saving, onSave, onClose }) {
  // Every choice here saves the moment it is made, so there is no half-written form to guard.
  return html`
    <${Modal} open=${true} onClose=${onClose} title=${t('presence.control.title')} size="sm" guard=${false}
      footer=${html`<${Loud} control onClick=${onClose}>${t('profile.close')}<//>`}>
      <${Stack} gap="medium">
          <${Line} justify="between" align="start" gap="large">
            <${HeadDesc}>${t('presence.control.desc')}<//>
            <${PresenceDot} status=${status} size="md" label=${true} />
          <//>

          <${Choice} label=${t('presence.control.modeLabel')} value=${cfg.mode} disabled=${saving}
            options=${[['auto', t('presence.control.modeAuto')], ['manual', t('presence.control.modeManual')]]}
            onChange=${(mode) => onSave({ mode })} />

          ${cfg.mode === 'auto' ? html`
            <${Note}>${t('presence.control.modeAutoHint')}<//>
          ` : html`
            <${Select} fit id="pf-presence-status" label=${t('presence.control.statusLabel')} value=${cfg.status} disabled=${saving}
              onChange=${(v) => onSave({ status: v })}
              options=${[['available', t('presence.status.available')], ['busy', t('presence.status.busy')], ['away', t('presence.status.away')], ['invisible', t('presence.status.invisible')]]} />
          `}

          <${Select} fit id="pf-presence-vis" label=${t('presence.control.visibilityLabel')} value=${cfg.visibility} disabled=${saving}
            onChange=${(v) => onSave({ visibility: v })}
            options=${[['everyone', t('presence.control.visEveryone')], ['contacts', t('presence.control.visContacts')], ['nobody', t('presence.control.visNobody')]]} />
          <${Note}>
            ${cfg.visibility === 'everyone' ? t('presence.control.visEveryoneHint')
              : cfg.visibility === 'contacts' ? t('presence.control.visContactsHint') : ''}
          <//>
      <//>
    <//>
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
    <${PresenceButton} status=${status} title=${t('presence.control.title')} onClick=${() => setOpen(true)} />
    ${open ? html`<${PresenceDialog} cfg=${cfg} status=${status} saving=${saving}
      onSave=${save} onClose=${() => setOpen(false)} />` : null}
  `;
}
