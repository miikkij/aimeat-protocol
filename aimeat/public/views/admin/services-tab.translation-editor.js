/**
 * @file public/views/admin/services-tab.translation-editor.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Instance translation editor + AI-prompt builder + per-extension key patterns for the admin Services tab. Extracted from services-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from services-tab.js (max-file-lines)
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { inputStyle } from './services-tab.config-form.js';

// ── Translation key patterns by extension ──
const EXT_TRANSLATION_KEYS = {
  'marketplace-behaviors': (cfg) => {
    const keys = [];
    const cats = cfg.categories || [];
    for (const cat of cats) keys.push('mkt.cat.' + cat);
    // Status labels, visibility labels are global — only custom ones need instance translations
    return keys;
  },
};

// ── AI prompt for generating instance translations ──
function buildTranslationAiPrompt(extName, instanceId, keys, targetLocale, existingTranslations) {
  const langName = targetLocale === 'fi' ? 'Finnish (suomi)' : targetLocale === 'en' ? 'English' : targetLocale;
  const keyList = keys.map(k => {
    const existing = existingTranslations[k];
    return `  ${k}${existing ? ` (current: "${existing}")` : ''}`;
  }).join('\n');

  return `I need translations for a "${extName}" extension instance called "${instanceId}".

Target language: ${langName}

These are i18n keys that need translated values. Each key follows a dot-notation pattern where the last segment hints at the meaning.

Keys to translate:
${keyList}

Please provide the translations in this exact JSON format (copy-pasteable):
{
${keys.map(k => `  "${k}": ""`).join(',\n')}
}

Rules:
- Translate naturally, not literally
- Keep translations concise (UI labels)
- Output ONLY the JSON object, nothing else`;
}

// ── Instance Translation Editor ──
function TranslationEditor({ extName, inst, onSave }) {
  const [locale, setLocale] = useState('fi');
  const [translations, setTranslations] = useState({});
  const [customKey, setCustomKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');

  // Derive required keys from config
  const keyFn = EXT_TRANSLATION_KEYS[extName];
  const autoKeys = keyFn ? keyFn(inst.config || {}) : [];

  // Merge: auto keys + any existing keys from stored translations
  const stored = inst.translations || {};
  const storedForLocale = stored[locale] || {};
  const allStoredKeys = Object.keys(storedForLocale);
  const allKeys = [...new Set([...autoKeys, ...allStoredKeys])].sort();

  // Sync local state when locale changes
  useEffect(() => {
    const s = (inst.translations || {})[locale] || {};
    setTranslations({ ...s });
    setJsonText(JSON.stringify(s, null, 2));
    setMsg(null);
  }, [locale, inst.translations]);

  function setKey(key, value) {
    setTranslations(prev => ({ ...prev, [key]: value }));
  }

  function removeKey(key) {
    setTranslations(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function addCustomKey() {
    if (!customKey.trim()) return;
    setTranslations(prev => ({ ...prev, [customKey.trim()]: '' }));
    setCustomKey('');
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      let toSave = translations;
      if (jsonMode) {
        try { toSave = JSON.parse(jsonText); } catch { setMsg({ ok: false, text: 'Invalid JSON' }); setSaving(false); return; }
      }
      // Merge with existing translations for other locales
      const merged = { ...(inst.translations || {}), [locale]: toSave };
      await onSave(extName, inst.id, merged);
      setMsg({ ok: true, text: t('dashboard.servicesTlSaved') });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
    setSaving(false);
  }

  const displayKeys = [...new Set([...allKeys, ...Object.keys(translations)])].sort();

  return html`
    <div style="margin-top:8px;padding:10px;border:1px solid var(--glass-border);border-radius:6px;background:rgba(0,0,0,0.1)">
      <div class="adm-flex-center adm-mb-sm" style="flex-wrap:wrap">
        <strong style="font-size:.85rem">${t('dashboard.servicesTlTitle')}</strong>
        <select class="${inputStyle}" style="padding:4px 8px;font-size:.8rem" value=${locale}
          onChange=${e => setLocale(e.target.value)}>
          <option value="fi">Suomi (fi)</option>
          <option value="en">English (en)</option>
        </select>
        <button class="adm-btn-sm" onClick=${() => { setJsonMode(!jsonMode); if (!jsonMode) setJsonText(JSON.stringify(translations, null, 2)); }}
          style="font-size:.75rem">${jsonMode ? t('dashboard.servicesTlFormMode') : 'JSON'}</button>
        <${CopyButton} className="adm-btn-sm"
          text=${buildTranslationAiPrompt(extName, inst.id, allKeys.length > 0 ? allKeys : ['(no keys detected — add categories to config first)'], locale, translations)}
          label=${t('dashboard.servicesTlAiPrompt')} copiedLabel=${t('dashboard.servicesTlAiPrompt')}
          onCopied=${() => setMsg({ ok: true, text: t('dashboard.servicesTlPromptCopied') })} />
      </div>

      ${jsonMode ? html`
        <textarea class="adm-textarea adm-input-full" value=${jsonText} onInput=${e => setJsonText(e.target.value)}
          style="height:200px;font-size:12px"
          spellcheck="false" />
      ` : html`
        <div class="adm-flex-col" style="gap:4px;max-height:300px;overflow-y:auto">
          ${displayKeys.map(key => html`
            <div style="display:flex;align-items:center;gap:6px">
              <code style="font-size:.75rem;color:var(--text-dim);min-width:140px;flex-shrink:0">${key}</code>
              <input type="text" class="${inputStyle}" style="flex:1;padding:4px 8px;font-size:.85rem" value=${translations[key] || ''}
                placeholder=${key.split('.').pop()}
                onInput=${e => setKey(key, e.target.value)} />
              ${!autoKeys.includes(key) && html`
                <button class="adm-btn-sm" style="font-size:.7rem;padding:2px 6px" onClick=${() => removeKey(key)}>\u2715</button>
              `}
            </div>
          `)}
        </div>
        <div style="display:flex;gap:6px;margin-top:6px;align-items:center">
          <input type="text" class="${inputStyle}" style="padding:4px 8px;font-size:.8rem;flex:1" value=${customKey}
            placeholder=${t('dashboard.servicesTlAddKey')} onInput=${e => setCustomKey(e.target.value)}
            onKeyDown=${e => { if (e.key === 'Enter') addCustomKey(); }} />
          <button class="adm-btn-sm" style="font-size:.75rem" onClick=${addCustomKey}>+</button>
        </div>
      `}

      <div class="adm-flex-center adm-mt-sm">
        <button class="adm-btn-action adm-text-sm" onClick=${handleSave} disabled=${saving}>
          ${saving ? '...' : t('dashboard.servicesTlSave')}</button>
        ${msg && html`<span class="adm-text-sm" style="color:${msg.ok ? '#22c55e' : '#ef4444'}">${msg.text}</span>`}
      </div>
    </div>
  `;
}

export { TranslationEditor };
