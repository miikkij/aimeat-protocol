/**
 * @file public/views/admin/email-tab.templates.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 05 of the Email page: the three editable templates, one language at a time.
 *   A template has an HTML part and a plain-text part, and both travel in the same message. The
 *   section says out loud what an operator cannot see otherwise: a saved template is stored on the
 *   node and every send still uses the built-in one, because nothing on the send path reads these
 *   records yet (routes/admin-features.ts writes _email_tpl/… and is the only reader).
 *
 * @structure
 *   - Templates({ locale }) — the language picker, the seed and reset-all doors, the three folds
 *   - Editor({ tpl, locale }) — placeholders, the three views, save, AI prompt, back to built-in
 *   - buildAiPrompt(tpl, locale) — the paste for the operator's own AI, tags kept intact
 *
 * @version-history
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared component set: the section with the language
 *     tabs as its actions, the aside, one shared Fold per template, chips for the placeholders, tab
 *     words for the three views, shared fields and actions (CopyAction for the AI prompt), and the
 *     preview in the shared stage, which keeps a light ground in every theme.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.2.0 -- 2026-09-13 -- Compose ink row boundaries from the shared poster class.
 *   v2.1.0 — 2026-09-13 — Compose the shared template heading and external spacing.
 *   v2.0.0 — 2026-09-12 — The poster face, and the plain statement that a saved template does not
 *     reach a recipient yet. The AI prompt names the third shipped language instead of calling
 *     everything that is not Finnish English.
 *   v1.0.0 — 2026-06-02 — In email-tab.js, in the classic shell.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { LOCALES } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import { Section, Fold, Stack, Chip, Field, Surface, Action, CopyAction, Text } from '/components/poster-parts.js';
import {
  getEmailTemplates, saveEmailTemplate, resetEmailTemplate, seedEmailTemplates, resetAllEmailTemplates,
} from '/js/services/admin.js';
import { swallowed } from '/js/swallowed.js';

const E = (key, params) => t('admin.email.' + key, params);

/** What the language tag is called in the prompt, so the AI writes in the right one. */
const LANGUAGE_NAMES = { en: 'English', fi: 'Finnish (suomi)', es: 'Spanish (español, es-419)' };

/**
 * The paste for the operator's own AI.
 *
 * Unchanged in substance from the version that shipped in June: it carries the current template,
 * the placeholders and the language, and it insists the placeholder tags survive. Only the
 * language name is new, because es shipped and everything that was not Finnish was called English.
 */
export function buildAiPrompt(tpl, locale) {
  const langName = LANGUAGE_NAMES[locale] || LANGUAGE_NAMES.en;
  const paramList = (tpl.params || []).map(p =>
    `  ${p} — ${(tpl.paramDescriptions || {})[p] || 'system parameter'}`).join('\n');

  return `I need you to create a beautiful, professional HTML email template for the AIMEAT Protocol.

Template type: ${E('kind.' + tpl.id)}
Language: ${langName} — ALL user-facing text in the template must be written in ${langName}.

IMPORTANT — Parameter tags that MUST be preserved exactly as-is in the output:
${paramList}

These tags are replaced by the system with real data when the email is sent. You must include them in the appropriate places in both HTML and plain text versions. Do NOT translate or modify these tags.

Requirements:
- Modern, clean design with good typography
- Mobile-responsive (max-width container, fluid layout)
- Inline CSS only (email clients don't support external stylesheets)
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
2. The plain text version (in ${langName})`;
}

/** One template, open: the placeholders, the three views, and what can be done with it. */
function Editor({ tpl, locale, onSave, onReset }) {
  const [view, setView] = useState('preview');
  const [editHtml, setEditHtml] = useState(tpl.preview || '');
  const [editText, setEditText] = useState(tpl.text || '');
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState(null);
  const { confirm, ConfirmUI } = useConfirm();

  useEffect(() => {
    setEditHtml(tpl.preview || '');
    setEditText(tpl.text || '');
    setSaid(null);
  }, [tpl.id, tpl.preview, tpl.text, locale]);

  const changed = editHtml !== (tpl.preview || '') || editText !== (tpl.text || '');

  async function save() {
    setSaving(true);
    setSaid(null);
    try {
      await onSave(tpl.id, locale, editHtml, editText);
      setSaid({ ok: true, text: E('tpl.saved') });
    } catch (e) { setSaid({ ok: false, text: e.message }); }
    setSaving(false);
  }

  function reset() {
    confirm(E('tpl.resetAsk'), async () => {
      setSaving(true);
      setSaid(null);
      try {
        await onReset(tpl.id, locale);
        setEditHtml(tpl.defaultHtml || '');
        setEditText(tpl.defaultText || '');
        setSaid({ ok: true, text: E('tpl.resetDone') });
      } catch (e) { setSaid({ ok: false, text: e.message }); }
      setSaving(false);
    }, { danger: true });
  }

  const views = [['preview', E('tpl.preview')], ['html', E('tpl.html')], ['text', E('tpl.text')]];

  return html`
    <${Stack}>
      ${tpl.params?.length > 0 && html`
        <${Stack} density="compact">
          <${Text} kind="label">${E('tpl.placeholders')}<//>
          <${Stack} direction="wrap" align="center" density="compact">
            ${tpl.params.map(p => html`<${Chip} key=${p}>${p}<//>`)}
            <${Text} kind="caption" tone="muted">${E('tpl.placeholdersWhy')}<//>
          <//>
        <//>`}

      <${Stack} direction="wrap" align="between">
        <${Stack} direction="horizontal" role="tablist" label=${E('tpl.preview')}>
          ${views.map(([id, label]) => html`<${Action} key=${id} kind="tab" semantics="tab" selected=${view === id} onClick=${() => setView(id)}>${label}<//>`)}
        <//>
        <${Text} kind="mono" tone="muted">${E('tpl.width')}<//>
      <//>
      ${view === 'preview' && html`<${Surface} kind="stage"><iframe srcdoc=${editHtml} sandbox="" title=${E('tpl.preview')}></iframe><//>`}
      ${view === 'html' && html`<${Field} type="textarea" rows=${16} ariaLabel=${E('tpl.html')} spellCheck=${false} value=${editHtml} onInput=${e => setEditHtml(e.target.value)} />`}
      ${view === 'text' && html`<${Field} type="textarea" rows=${16} ariaLabel=${E('tpl.text')} spellCheck=${false} value=${editText} onInput=${e => setEditText(e.target.value)} />`}

      <${Stack} direction="wrap" align="center">
        <${Action} onClick=${save} disabled=${saving || !changed}>${E('tpl.save')}<//>
        <${CopyAction} text=${buildAiPrompt(tpl, locale)} label=${E('tpl.aiPrompt')} copiedLabel=${E('tpl.aiPromptCopied')} />
        ${tpl.isCustom && html`<${Action} tone="danger" onClick=${reset}>${E('tpl.backToBuiltIn')}<//>`}
        ${said && html`<${Text} kind="caption" tone=${said.ok ? 'success' : 'danger'}>${said.text}<//>`}
        ${!said && !changed && html`<${Text} kind="caption" tone="muted">${E('tpl.noChanges')}<//>`}
      <//>
      <${Text} kind="caption" tone="muted">${E('tpl.aiHint')}<//>
      <${ConfirmUI} />
    <//>`;
}

export default function Templates({ locale }) {
  const [lang, setLang] = useState(locale || 'en');
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [seeded, setSeeded] = useState(false);
  const [said, setSaid] = useState(null);
  const { confirm, ConfirmUI } = useConfirm();

  // The language is the only signal that should refetch; load() is stable for this tab's lifetime.
  useEffect(() => { load(lang); }, [lang]);

  async function load(l) {
    try {
      const r = await getEmailTemplates(l);
      setList(r.data.templates || []);
      setSeeded(!!r.data.seeded);
    } catch (err) {
      swallowed('email-tab: templates', err);
      setList([]);
    }
  }

  async function onSave(id, l, htmlPart, textPart) {
    await saveEmailTemplate(id, l, htmlPart, textPart);
    await load(l);
  }
  async function onReset(id, l) {
    await resetEmailTemplate(id, l);
    await load(l);
  }
  async function seedAll() {
    setSaid(null);
    try {
      const r = await seedEmailTemplates();
      setSaid({ ok: true, text: E('tpl.seeded', { n: r.data.count }) });
      await load(lang);
    } catch (e) { setSaid({ ok: false, text: e.message }); }
  }
  function resetAll() {
    confirm(E('tpl.resetAllAsk'), async () => {
      setSaid(null);
      try {
        const r = await resetAllEmailTemplates();
        setSaid({ ok: true, text: E('tpl.resetAllDone', { n: r.data.count }) });
        await load(lang);
      } catch (e) { setSaid({ ok: false, text: e.message }); }
    }, { danger: true });
  }

  return html`
    <${Section} title=${E('tpl.title')} count="05"
      actions=${LOCALES.map(l => html`<${Action} key=${l} kind="tab" selected=${l === lang} onClick=${() => setLang(l)}>${l}<//>`)}>
      <${Stack}>
        <${Surface} kind="aside"><${Text}><strong>${E('tpl.warnLead')}</strong> ${E('tpl.warn')}<//><//>

        <div>
          ${(list || []).map(tpl => html`
            <${Fold} key=${tpl.id} number=${tpl.id} title=${E('kind.' + tpl.id)}
              sub=${tpl.isCustom ? E('tpl.edited', { lang }) : E('tpl.builtIn')}
              open=${open === tpl.id} onToggle=${() => setOpen(open === tpl.id ? null : tpl.id)}>
              <${Editor} key=${tpl.id + '-' + lang} tpl=${tpl} locale=${lang} onSave=${onSave} onReset=${onReset} />
            <//>`)}
        </div>

        <${Stack} direction="wrap" align="center">
          ${seeded
    ? html`<${Action} onClick=${seedAll}>${E('tpl.reseed')}<//>
           <${Action} tone="danger" onClick=${resetAll}>${E('tpl.resetAll')}<//>`
    : html`<${Action} onClick=${seedAll}>${E('tpl.seedDefaults')}<//>`}
          <${Text} kind="caption" tone="muted">${seeded ? E('tpl.seededNote') : E('tpl.seedNote')}<//>
          ${said && html`<${Text} kind="caption" tone=${said.ok ? 'success' : 'danger'}>${said.text}<//>`}
        <//>
        <${Text} kind="caption" tone="muted">${E('tpl.bothParts')}<//>
      <//>
      <${ConfirmUI} />
    <//>`;
}
