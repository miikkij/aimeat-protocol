/**
 * @file public/views/admin/extensions-tab.translation-editor.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Instance translation editor + AI-prompt builder + per-extension key patterns for the admin Extensions tab. Extracted from the tab file to satisfy max-file-lines.
 * @version-history
 *   v2.0.0 — 2026-09-27 — The library's parts (admin page group G7): the editor stands in the dashed
 *     field Box, its head is the row label, the language a Select, the JSON switch and the AI prompt's
 *     copy Action links, the keys a scrolling List of key, field and remove mark, the new key a
 *     TextField that adds on Enter, the answer the form message. No class, no style.
 *   v1.0.0 — 2026-07-13 — Extracted from the tab file (max-file-lines)
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Box } from '/components/Box.js';
import { Select } from '/components/Select.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Action, Icon } from '/components/Action.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { List, Row as ListRow, Cell, Doors } from '/components/List.js';
import { Row } from '/components/Layout.js';

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
    <${Box} tone="field">
      <${Row} gap="medium" wrap>
        <${Label}>${t('dashboard.servicesTlTitle')}<//>
        <${Select} fit ariaLabel=${t('dashboard.servicesTlTitle')} value=${locale} onChange=${setLocale}
          options=${[['fi', 'Suomi (fi)'], ['en', 'English (en)']]} />
        <${Action} small soft onClick=${() => { setJsonMode(!jsonMode); if (!jsonMode) setJsonText(JSON.stringify(translations, null, 2)); }}>
          ${jsonMode ? t('dashboard.servicesTlFormMode') : 'JSON'}<//>
        <${Action} small soft
          copy=${buildTranslationAiPrompt(extName, inst.id, allKeys.length > 0 ? allKeys : ['(no keys detected — add categories to config first)'], locale, translations)}
          copiedLabel=${t('dashboard.servicesTlAiPrompt')}
          onCopied=${() => setMsg({ ok: true, text: t('dashboard.servicesTlPromptCopied') })}>${t('dashboard.servicesTlAiPrompt')}<//>
      <//>

      ${jsonMode ? html`
        <${TextArea} code rows=${8} ariaLabel="JSON" value=${jsonText} onInput=${setJsonText} />
      ` : html`
        <${List} cols="label-words-doors" keepCols dense scroll="medium">
          ${displayKeys.map(key => html`
            <${ListRow} key=${key}>
              <${Cell} code>${key}<//>
              <${Cell}><${TextField} ariaLabel=${key} value=${translations[key] || ''}
                placeholder=${key.split('.').pop()} onInput=${v => setKey(key, v)} /><//>
              <${Doors}>${!autoKeys.includes(key) ? html`<${Icon} small label=${t('common.remove')} onClick=${() => removeKey(key)}>✕<//>` : null}<//>
            <//>`)}
        <//>
        <${TextField} ariaLabel=${t('dashboard.servicesTlAddKey')} value=${customKey}
          placeholder=${t('dashboard.servicesTlAddKey')} onInput=${setCustomKey} onEnter=${addCustomKey}
          actions=${html`<${Action} small soft onClick=${addCustomKey}>+<//>`} />
      `}

      <${Row} gap="medium" wrap above="small">
        <${Action} small onClick=${handleSave} disabled=${saving}>${saving ? '...' : t('dashboard.servicesTlSave')}<//>
        ${msg ? html`<${Note} kind="message" error=${!msg.ok}>${msg.text}<//>` : null}
      <//>
    <//>
  `;
}

export { TranslationEditor };
