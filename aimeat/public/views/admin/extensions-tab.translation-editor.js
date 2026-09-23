/**
 * @file public/views/admin/extensions-tab.translation-editor.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Instance translation editor + AI-prompt builder + per-extension key patterns for the admin Extensions tab. Extracted from the tab file to satisfy max-file-lines.
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: fields, a tab for the JSON
 *     mode, the shared copy action, and a scrolling surface for a long key list.
 *   v1.0.0 — 2026-07-13 — Extracted from the tab file (max-file-lines)
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Stack, Field, Action, CopyAction, Surface, Text } from '/components/poster-parts.js';

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

  return html`<${Stack}>
    <${Stack} direction="wrap" align="center" density="compact">
      <${Text} kind="label">${t('dashboard.servicesTlTitle')}<//>
      <${Field} type="select" width="narrow" ariaLabel=${t('dashboard.servicesTlTitle')} value=${locale}
        options=${[{ value: 'fi', label: 'Suomi (fi)' }, { value: 'en', label: 'English (en)' }]}
        onChange=${e => setLocale(e.target.value)} />
      <${Action} kind="tab" selected=${jsonMode}
        onClick=${() => { setJsonMode(!jsonMode); if (!jsonMode) setJsonText(JSON.stringify(translations, null, 2)); }}>${jsonMode ? t('dashboard.servicesTlFormMode') : 'JSON'}<//>
      <${CopyAction}
        text=${buildTranslationAiPrompt(extName, inst.id, allKeys.length > 0 ? allKeys : ['(no keys detected — add categories to config first)'], locale, translations)}
        label=${t('dashboard.servicesTlAiPrompt')} copiedLabel=${t('dashboard.servicesTlAiPrompt')}
        onCopied=${() => setMsg({ ok: true, text: t('dashboard.servicesTlPromptCopied') })} />
    <//>

    ${jsonMode ? html`<${Field} type="textarea" rows=${10} ariaLabel="JSON" value=${jsonText}
        spellCheck=${false} onInput=${e => setJsonText(e.target.value)} />`
      : html`<${Stack} density="compact">
        <${Surface} kind="plain" density="flush" height="scroll">
          <${Stack} density="compact">
            ${displayKeys.map(key => html`<${Stack} key=${key} direction="horizontal" align="center" density="compact">
              <${Text} kind="mono" tone="muted">${key}<//>
              <${Field} ariaLabel=${key} value=${translations[key] || ''}
                placeholder=${key.split('.').pop()}
                onInput=${e => setKey(key, e.target.value)} />
              ${!autoKeys.includes(key) && html`<${Action} kind="icon" label=${key} onClick=${() => removeKey(key)}>✗<//>`}
            <//>`)}
          <//>
        <//>
        <${Stack} direction="horizontal" align="center" density="compact">
          <${Field} ariaLabel=${t('dashboard.servicesTlAddKey')} value=${customKey}
            placeholder=${t('dashboard.servicesTlAddKey')} onInput=${e => setCustomKey(e.target.value)}
            onKeyDown=${e => { if (e.key === 'Enter') addCustomKey(); }} />
          <${Action} kind="icon" label=${t('dashboard.servicesTlAddKey')} onClick=${addCustomKey}>+<//>
        <//>
      <//>`}

    <${Stack} direction="wrap" align="center">
      <${Action} onClick=${handleSave} disabled=${saving}>${saving ? '...' : t('dashboard.servicesTlSave')}<//>
      ${msg && html`<${Text} tone=${msg.ok ? 'success' : 'danger'}>${msg.text}<//>`}
    <//>
  <//>`;
}

export { TranslationEditor };
