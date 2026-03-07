import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { EconRow, Empty, ExpandableHelp } from './shared.js';
import { sendTestEmail, getEmailTemplates, sendGroupEmail, saveEmailTemplate, resetEmailTemplate, seedEmailTemplates, resetAllEmailTemplates, saveConfig } from '/js/services/admin.js';

const TEMPLATE_IDS = ['notification', 'verification', 'magic_link', 'match_suggestion'];
const TEMPLATE_LABELS = {
  verification: 'dashboard.emailTplVerification',
  magic_link: 'dashboard.emailTplMagicLink',
  notification: 'dashboard.emailTplNotification',
  match_suggestion: 'dashboard.emailTplMatchSuggestion',
};
const USED_IN_LABELS = {
  ghii: 'dashboard.emailUsedInGhii',
  system: 'dashboard.emailUsedInSystem',
  matching: 'dashboard.emailUsedInMatching',
};

/* ── AI Prompt builder ── */
function buildAiPrompt(tpl, locale) {
  const langName = locale === 'fi' ? 'Finnish (suomi)' : 'English';
  const paramList = (tpl.params || []).map(p =>
    `  ${p} — ${(tpl.paramDescriptions || {})[p] || 'system parameter'}`
  ).join('\n');

  return `I need you to create a beautiful, professional HTML email template for the AIMEAT Protocol.

Template type: ${t(TEMPLATE_LABELS[tpl.id] || tpl.id)}
Purpose: ${t(USED_IN_LABELS[tpl.usedIn] || tpl.usedIn)}
Language: ${langName} — ALL user-facing text in the template must be written in ${langName}.

IMPORTANT — Parameter tags that MUST be preserved exactly as-is in the output:
${paramList}

These tags are replaced by the system with real data when the email is sent. You must include them in the appropriate places in both HTML and plain text versions. Do NOT translate or modify these tags.

Requirements:
- Modern, clean design with good typography
- Mobile-responsive (max-width container, fluid layout)
- Inline CSS only (email clients don't support external stylesheets)
- Professional color scheme (consider using indigo/purple #4f46e5 as accent)
- AIMEAT branding in header
- Clear visual hierarchy
- Footer with "Sent by AIMEAT Protocol" and unsubscribe note (in ${langName})
- Both HTML version and plain text fallback version
- All text content must be in ${langName}

Here is the current default template for reference:
---HTML---
${tpl.defaultHtml || tpl.preview || ''}
---TEXT---
${tpl.defaultText || tpl.text || ''}
---END---

Please provide:
1. The complete HTML email template (in ${langName})
2. The plain text version (in ${langName})

Make it visually stunning while keeping parameter tags intact.`;
}

/* ── Single Template Editor ── */
function TemplateEditor({ tpl, locale, onSave, onReset }) {
  const [view, setView] = useState('preview'); // preview | html | text
  const [editHtml, setEditHtml] = useState(tpl.preview || '');
  const [editText, setEditText] = useState(tpl.text || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  // Sync when tpl data or locale changes
  useEffect(() => {
    setEditHtml(tpl.preview || '');
    setEditText(tpl.text || '');
    setMsg(null);
  }, [tpl.id, tpl.preview, tpl.text, locale]);

  async function doSave() {
    setSaving(true);
    setMsg(null);
    try {
      await onSave(tpl.id, locale, editHtml, editText);
      setMsg({ ok: true, text: t('dashboard.emailTplSaved') });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
    setSaving(false);
  }

  async function doReset() {
    if (!confirm(t('dashboard.emailTplResetConfirm'))) return;
    setSaving(true);
    setMsg(null);
    try {
      await onReset(tpl.id, locale);
      setEditHtml(tpl.defaultHtml || '');
      setEditText(tpl.defaultText || '');
      setMsg({ ok: true, text: t('dashboard.emailTplResetDone') });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
    setSaving(false);
  }

  async function copyAiPrompt() {
    const prompt = buildAiPrompt(tpl, locale);
    try {
      await navigator.clipboard.writeText(prompt);
      setMsg({ ok: true, text: t('dashboard.emailTplAiPromptCopied') });
    } catch {
      // Fallback: select textarea
      const ta = document.createElement('textarea');
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setMsg({ ok: true, text: t('dashboard.emailTplAiPromptCopied') });
    }
  }

  const hasChanges = editHtml !== (tpl.preview || '') || editText !== (tpl.text || '');

  const tabStyle = (active) => `
    padding:6px 14px;font-size:.78rem;border:none;border-radius:4px 4px 0 0;cursor:pointer;
    background:${active ? 'rgba(79,70,229,0.15)' : 'transparent'};
    color:${active ? '#818cf8' : 'var(--text-dim)'};
    font-weight:${active ? '600' : '400'};
    border-bottom:2px solid ${active ? '#818cf8' : 'transparent'};
  `;

  return html`
    <div style="border-top:1px solid var(--glass-border);padding:12px 0 0">
      <!-- Parameters reference -->
      ${tpl.params && tpl.params.length > 0 && html`
        <div style="margin-bottom:10px;padding:8px 10px;border-radius:6px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.15)">
          <div style="font-size:.72rem;font-weight:600;color:#f59e0b;margin-bottom:4px">${t('dashboard.emailTplParams')}</div>
          <div style="font-size:.72rem;color:var(--text-dim);margin-bottom:6px">${t('dashboard.emailTplParamsExplain')}</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${tpl.params.map(p => html`
              <span style="font-size:.72rem;background:rgba(0,0,0,0.2);color:#f59e0b;padding:2px 8px;border-radius:4px;font-family:monospace"
                title=${(tpl.paramDescriptions || {})[p] || ''}>${p}</span>
            `)}
          </div>
        </div>
      `}

      <!-- Sub-tabs -->
      <div style="display:flex;gap:2px;border-bottom:1px solid var(--glass-border);margin-bottom:0">
        <button style=${tabStyle(view === 'preview')} onClick=${() => setView('preview')}>${t('dashboard.emailTplPreview')}</button>
        <button style=${tabStyle(view === 'html')} onClick=${() => setView('html')}>${t('dashboard.emailTplEditHtml')}</button>
        <button style=${tabStyle(view === 'text')} onClick=${() => setView('text')}>${t('dashboard.emailTplEditText')}</button>
      </div>

      <!-- Content area -->
      ${view === 'preview' && html`
        <iframe
          srcdoc=${editHtml}
          style="width:100%;height:420px;border:1px solid var(--glass-border);border-top:none;border-radius:0 0 6px 6px;background:#f4f4f7"
          sandbox="allow-same-origin allow-scripts"
        />
      `}
      ${view === 'html' && html`
        <textarea
          value=${editHtml}
          onInput=${e => setEditHtml(e.target.value)}
          style="width:100%;height:420px;font-family:monospace;font-size:12px;padding:10px;border:1px solid var(--glass-border);border-top:none;border-radius:0 0 6px 6px;background:rgba(0,0,0,0.2);color:var(--text-bright);resize:vertical;line-height:1.5;tab-size:2"
          spellcheck="false"
        />
      `}
      ${view === 'text' && html`
        <textarea
          value=${editText}
          onInput=${e => setEditText(e.target.value)}
          style="width:100%;height:300px;font-family:monospace;font-size:13px;padding:10px;border:1px solid var(--glass-border);border-top:none;border-radius:0 0 6px 6px;background:rgba(0,0,0,0.2);color:var(--text-bright);resize:vertical;line-height:1.5"
          spellcheck="false"
        />
      `}

      <!-- Action buttons -->
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px">
        <button class="adm-btn-action" onClick=${doSave} disabled=${saving || !hasChanges}
          style="font-size:.8rem">${saving ? '...' : t('dashboard.emailTplSave')}</button>
        <button class="adm-btn-action" onClick=${copyAiPrompt}
          style="font-size:.8rem;background:rgba(79,70,229,0.1);border-color:rgba(79,70,229,0.3);color:#818cf8">${t('dashboard.emailTplAiPrompt')}</button>
        ${tpl.isCustom && html`
          <button class="adm-btn-action" onClick=${doReset} disabled=${saving}
            style="font-size:.8rem;color:#ef4444;border-color:rgba(239,68,68,0.3)">${t('dashboard.emailTplReset')}</button>
        `}
        ${msg && html`<span style="font-size:.8rem;color:${msg.ok ? '#22c55e' : '#ef4444'}">${msg.text}</span>`}
      </div>
    </div>
  `;
}

/* ── Main Tab ── */
export default function EmailTab({ data, reload, locale }) {
  const email = data.email;
  const [to, setTo] = useState('');
  const [testTpl, setTestTpl] = useState('notification');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [tplLocale, setTplLocale] = useState(locale || 'en');
  const [templates, setTemplates] = useState(null);
  const [tplLoading, setTplLoading] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [seeded, setSeeded] = useState(false);
  const [seedMsg, setSeedMsg] = useState(null);
  const [cfgSaving, setCfgSaving] = useState(false);

  // Group send state
  const [grpGroup, setGrpGroup] = useState('operators');
  const [grpSubject, setGrpSubject] = useState('');
  const [grpBody, setGrpBody] = useState('');
  const [grpSending, setGrpSending] = useState(false);
  const [grpResult, setGrpResult] = useState(null);

  useEffect(() => {
    if (email && email.enabled) loadTemplates(tplLocale);
  }, [tplLocale, email?.enabled]);

  async function loadTemplates(loc) {
    setTplLoading(true);
    try {
      const r = await getEmailTemplates(loc);
      setTemplates(r.data.templates || []);
      setSeeded(!!r.data.seeded);
    } catch (_) {
      setTemplates(null);
    }
    setTplLoading(false);
  }

  async function toggleSmtpConfig(dotPath, newValue) {
    setCfgSaving(true);
    try {
      await saveConfig([{ path: dotPath, value: newValue }]);
      reload();
    } catch (_) { /* reload will show current state */ }
    setCfgSaving(false);
  }

  if (!email) return html`<${Empty} text=${t('dashboard.emailNotAvailable')} />`;

  if (!email.enabled) {
    return html`
      <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">${t('dashboard.emailDisabledExplain')}</p>
      <${ExpandableHelp} title=${t('dashboard.emailSmtpHelp')}>
        <p>${t('dashboard.emailSmtpHelpDetail')}</p>
      </${ExpandableHelp}>
    `;
  }

  async function doSend() {
    if (!to) return;
    setSending(true);
    setResult(null);
    try {
      const r = await sendTestEmail(to, testTpl, tplLocale);
      if (r.data?.sent) {
        setResult({ ok: true, msg: t('dashboard.emailSent') });
      } else {
        setResult({ ok: false, msg: t('dashboard.emailSendFailed') });
      }
    } catch (e) {
      setResult({ ok: false, msg: e.message });
    }
    setSending(false);
  }

  async function doGroupSend() {
    if (!grpSubject || !grpBody) return;
    setGrpSending(true);
    setGrpResult(null);
    try {
      const r = await sendGroupEmail(grpGroup, grpSubject, grpBody);
      setGrpResult({ ok: true, msg: t('dashboard.emailGroupSent').replace('{sent}', r.data.sent).replace('{total}', r.data.total) });
    } catch (e) {
      setGrpResult({ ok: false, msg: e.message });
    }
    setGrpSending(false);
  }

  function toggle(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleSaveTemplate(id, loc, htmlContent, textContent) {
    await saveEmailTemplate(id, loc, htmlContent, textContent);
    await loadTemplates(loc);
  }

  async function handleResetTemplate(id, loc) {
    await resetEmailTemplate(id, loc);
    await loadTemplates(loc);
  }

  async function doSeedDefaults() {
    setSeedMsg(null);
    try {
      const r = await seedEmailTemplates();
      setSeedMsg({ ok: true, text: t('dashboard.emailTplSeeded').replace('{count}', r.data.count) });
      await loadTemplates(tplLocale);
    } catch (e) {
      setSeedMsg({ ok: false, text: e.message });
    }
  }

  async function doResetAll() {
    if (!confirm(t('dashboard.emailTplResetAllConfirm'))) return;
    setSeedMsg(null);
    try {
      const r = await resetAllEmailTemplates();
      setSeedMsg({ ok: true, text: t('dashboard.emailTplResetAllDone').replace('{count}', r.data.count) });
      await loadTemplates(tplLocale);
    } catch (e) {
      setSeedMsg({ ok: false, text: e.message });
    }
  }

  return html`
    <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">${t('dashboard.emailExplain')}</p>

    <!-- SMTP Configuration -->
    <div class="adm-card">
      <h4 style="margin:0 0 12px">${t('dashboard.smtpConfig')}</h4>
      <${EconRow} label=${t('dashboard.host')} value=${email.smtp_host || '\u2014'} />
      <${EconRow} label=${t('dashboard.port')} value=${email.smtp_port || '\u2014'} />
      <div class="adm-hrow">
        <span class="adm-hmetric">${t('dashboard.secure')}</span>
        <span><label style="cursor:pointer"><input type="checkbox" checked=${email.smtp_secure} disabled=${cfgSaving}
          onChange=${ev => toggleSmtpConfig('email.smtp_secure', ev.target.checked)} /> ${email.smtp_secure ? '\u2705' : '\u274C'}</label></span>
      </div>
      <div class="adm-hrow">
        <span class="adm-hmetric">${t('dashboard.rejectUnauthorized')}</span>
        <span><label style="cursor:pointer"><input type="checkbox" checked=${email.smtp_reject_unauthorized} disabled=${cfgSaving}
          onChange=${ev => toggleSmtpConfig('email.smtp_reject_unauthorized', ev.target.checked)} /> ${email.smtp_reject_unauthorized ? '\u2705' : '\u274C'}
          <span style="font-size:.72rem;color:var(--text-dim);margin-left:6px">${t('dashboard.rejectUnauthorizedHelp')}</span></label></span>
      </div>
      <${EconRow} label=${t('dashboard.from')} value=${email.smtp_from || '\u2014'} />
      <${EconRow} label=${t('dashboard.emailUserConfigured')} value=${email.smtp_user_configured ? '\u2705' : '\u274C'} />
      <${EconRow} label=${t('dashboard.emailPassConfigured')} value=${email.smtp_pass_configured ? '\u2705' : '\u274C'} />
    </div>

    <!-- Test Email -->
    <div class="adm-card" style="margin-top:12px">
      <h4 style="margin:0 0 12px">${t('dashboard.testEmail')}</h4>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="email" class="adm-input" value=${to}
          onInput=${e => setTo(e.target.value)}
          placeholder=${t('dashboard.emailPlaceholder')}
          style="flex:1;min-width:200px" />
        <select class="adm-input" value=${testTpl} onChange=${e => setTestTpl(e.target.value)}
          style="width:auto;min-width:140px">
          ${TEMPLATE_IDS.map(id => html`
            <option value=${id}>${t(TEMPLATE_LABELS[id])}</option>
          `)}
        </select>
        <button class="adm-btn" onClick=${doSend} disabled=${sending || !to}>
          ${sending ? '...' : t('dashboard.send')}
        </button>
      </div>
      ${result && html`<div style="margin-top:8px;font-size:.85rem;color:${result.ok ? '#22c55e' : '#ef4444'}">${result.msg}</div>`}
    </div>

    <!-- Send to Group -->
    <div class="adm-card" style="margin-top:12px">
      <h4 style="margin:0 0 12px">${t('dashboard.emailGroupTitle')}</h4>
      <p style="color:var(--text-dim);font-size:.85rem;margin:0 0 12px">${t('dashboard.emailGroupExplain')}</p>
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <select class="adm-input" value=${grpGroup} onChange=${e => setGrpGroup(e.target.value)}
          style="width:auto;min-width:140px">
          <option value="operators">${t('dashboard.emailGroupOperators')}</option>
          <option value="all">${t('dashboard.emailGroupAll')}</option>
        </select>
      </div>
      <input type="text" class="adm-input" value=${grpSubject}
        onInput=${e => setGrpSubject(e.target.value)}
        placeholder=${t('dashboard.emailGroupSubject')}
        style="width:100%;margin-bottom:8px" />
      <textarea class="adm-input" value=${grpBody}
        onInput=${e => setGrpBody(e.target.value)}
        placeholder=${t('dashboard.emailGroupBody')}
        rows="4"
        style="width:100%;resize:vertical;font-family:inherit" />
      <div style="margin-top:8px">
        <button class="adm-btn" onClick=${doGroupSend} disabled=${grpSending || !grpSubject || !grpBody}>
          ${grpSending ? '...' : t('dashboard.emailGroupSend')}
        </button>
      </div>
      ${grpResult && html`<div style="margin-top:8px;font-size:.85rem;color:${grpResult.ok ? '#22c55e' : '#ef4444'}">${grpResult.msg}</div>`}
    </div>

    <!-- Email Templates -->
    <div class="adm-card" style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h4 style="margin:0">${t('dashboard.emailTemplatesTitle')}</h4>
        <div style="display:flex;gap:4px">
          ${['en', 'fi'].map(l => html`
            <button class=${tplLocale === l ? 'adm-btn' : 'adm-btn-action'} style="padding:4px 10px;font-size:.75rem"
              onClick=${() => setTplLocale(l)}>${l.toUpperCase()}</button>
          `)}
        </div>
      </div>
      <p style="color:var(--text-dim);font-size:.85rem;margin:0 0 12px">${t('dashboard.emailTemplatesExplain')}</p>

      <!-- Seed / Reset All buttons -->
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px;padding:10px 12px;border-radius:6px;background:rgba(255,255,255,0.02);border:1px solid var(--glass-border)">
        ${!seeded && html`
          <button class="adm-btn-action" onClick=${doSeedDefaults}
            style="font-size:.8rem;background:rgba(34,197,94,0.1);border-color:rgba(34,197,94,0.3);color:#22c55e">${t('dashboard.emailTplSeedDefaults')}</button>
          <span style="font-size:.78rem;color:var(--text-dim)">${t('dashboard.emailTplSeedExplain')}</span>
        `}
        ${seeded && html`
          <button class="adm-btn-action" onClick=${doResetAll}
            style="font-size:.8rem;color:#ef4444;border-color:rgba(239,68,68,0.3)">${t('dashboard.emailTplResetAll')}</button>
          <button class="adm-btn-action" onClick=${doSeedDefaults}
            style="font-size:.8rem">${t('dashboard.emailTplReseed')}</button>
          <span style="font-size:.78rem;color:var(--text-dim)">${t('dashboard.emailTplSeededStatus')}</span>
        `}
        ${seedMsg && html`<span style="font-size:.8rem;color:${seedMsg.ok ? '#22c55e' : '#ef4444'}">${seedMsg.text}</span>`}
      </div>

      ${tplLoading ? html`<p style="color:var(--text-dim);font-size:.85rem">...</p>` : null}

      ${templates && templates.map(tpl => html`
        <div style="border:1px solid ${expanded[tpl.id] ? '#818cf8' : 'var(--glass-border)'};border-radius:8px;margin-bottom:10px;overflow:hidden;transition:border-color .2s ease">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;cursor:pointer;background:${expanded[tpl.id] ? 'rgba(79,70,229,0.04)' : 'rgba(255,255,255,.03)'}"
            onClick=${() => toggle(tpl.id)}>
            <span style="display:flex;align-items:center;gap:8px">
              <strong>${t(TEMPLATE_LABELS[tpl.id] || tpl.id)}</strong>
              <span style="font-size:.72rem;color:var(--text-dim)">${t(USED_IN_LABELS[tpl.usedIn] || tpl.usedIn)}</span>
              ${tpl.isCustom && html`<span style="font-size:.65rem;background:rgba(79,70,229,0.15);color:#818cf8;padding:1px 6px;border-radius:3px;font-weight:600">${t('dashboard.emailTplCustomBadge')}</span>`}
            </span>
            <span style="font-size:.75rem;color:var(--text-dim)">${expanded[tpl.id] ? '\u25B2' : '\u25BC'}</span>
          </div>
          ${expanded[tpl.id] && html`
            <div style="padding:0 14px 14px">
              <${TemplateEditor}
                key=${`${tpl.id}-${tplLocale}`}
                tpl=${tpl}
                locale=${tplLocale}
                onSave=${handleSaveTemplate}
                onReset=${handleResetTemplate}
              />
            </div>
          `}
        </div>
      `)}
    </div>
  `;
}
