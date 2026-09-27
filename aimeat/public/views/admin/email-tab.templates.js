/**
 * @file public/views/admin/email-tab.templates.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 05 of the Email page: the three editable templates, one language at a time.
 *   A template has an HTML part and a plain-text part, and both travel in the same message. The
 *   section says out loud what an operator cannot see otherwise: a saved template is stored on the
 *   node and every send still uses the built-in one, because nothing on the send path reads these
 *   records yet (routes/admin-features.ts writes _email_tpl/… and is the only reader). The section
 *   draws library components and passes them data; it writes no class.
 *
 * @structure
 *   - Templates({ locale }) — the language chooser, the seed and reset-all doors, the three rows
 *   - Editor({ tpl, locale }) — placeholders, the three views, save, AI prompt, back to built-in
 *   - buildAiPrompt(tpl, locale) — the paste for the operator's own AI, tags kept intact
 *
 * @version-history
 *   v3.0.0 — 2026-09-27 — The section draws library components and writes no class: the language
 *     chooser and the three views are tabs (the chosen one on the sun, as before), a template is a
 *     row of a List that opens its editor in the raised box under it (its id in typewriter under
 *     the name, built-in or edited at the right, the arrow at the end), the preview is PagePreview's
 *     email tone (600px on white, nothing in it runs), the edits are code areas.
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
import { Section } from '/components/Section.js';
import { SettingBox } from '/components/Box.js';
import { List, Row as ListRow, Name, Cell } from '/components/List.js';
import { Tabs, TabPanel } from '/components/Tabs.js';
import { TextArea } from '/components/TextField.js';
import { PagePreview } from '/components/PagePreview.js';
import { Loud, Action } from '/components/Action.js';
import { FormActions } from '/components/Field.js';
import { Split, Row } from '/components/Layout.js';
import { Note } from '/components/Note.js';
import { Label, Code } from '/components/Mark.js';
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

  return html`
    ${tpl.params?.length > 0 && html`
      <${Label} block>${E('tpl.placeholders')}<//>
      <${Row} wrap align="baseline">
        ${tpl.params.map(p => html`<${Code} key=${p}>${p}<//>`)}
        <${Note} kind="meta" inline>${E('tpl.placeholdersWhy')}<//>
      <//>`}

    <${Tabs} kind="view" value=${view} onSelect=${setView} label=${E('tpl.preview')}
      items=${[
        { value: 'preview', label: E('tpl.preview') },
        { value: 'html', label: E('tpl.html') },
        { value: 'text', label: E('tpl.text') },
      ]}>
      <${Note} kind="meta" inline mono>${E('tpl.width')}<//>
    <//>
    <${TabPanel} value=${view} label=${E('tpl.' + view)}>
      ${view === 'preview' && html`<${PagePreview} email title=${E('tpl.preview')} srcdoc=${editHtml} />`}
      ${view === 'html' && html`<${TextArea} code rows=${18} spellCheck=${false} ariaLabel=${E('tpl.html')} value=${editHtml} onInput=${setEditHtml} />`}
      ${view === 'text' && html`<${TextArea} code rows=${18} spellCheck=${false} ariaLabel=${E('tpl.text')} value=${editText} onInput=${setEditText} />`}
    <//>

    <${Split} heavy>
      <${FormActions}>
        <${Loud} control onClick=${save} disabled=${saving || !changed}>${E('tpl.save')}<//>
        <${Action} small soft copy=${buildAiPrompt(tpl, locale)} copiedLabel=${E('tpl.aiPromptCopied')}>${E('tpl.aiPrompt')}<//>
        ${tpl.isCustom && html`
          <${Action} small soft tone="danger" onClick=${reset}>${E('tpl.backToBuiltIn')}<//>`}
        ${said && html`<${Note} kind="message" error=${!said.ok}>${said.text}<//>`}
        ${!said && !changed && html`<${Note} inline>${E('tpl.noChanges')}<//>`}
      <//>
    <//>
    <${Note}>${E('tpl.aiHint')}<//>
    <${ConfirmUI} />`;
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

  const languages = html`<${Tabs} tone="fold" value=${lang} onSelect=${setLang} label=${E('tpl.title')}
    items=${LOCALES.map((l) => ({ value: l, label: l }))} />`;

  return html`
    <${Section} num="05" title=${E('tpl.title')} doors=${languages}>
      <${SettingBox}><b>${E('tpl.warnLead')}</b> ${E('tpl.warn')}<//>

      <${List} cols="name-tags-doors" keepCols apart>
        ${(list || []).map(tpl => {
    const isOpen = open === tpl.id;
    return html`
          <${ListRow} key=${tpl.id} open=${isOpen} onToggle=${() => setOpen(isOpen ? null : tpl.id)}
            panel=${isOpen ? html`<${Editor} key=${tpl.id + '-' + lang} tpl=${tpl} locale=${lang} onSave=${onSave} onReset=${onReset} />` : null}>
            <${Name} meta=${tpl.id}>${E('kind.' + tpl.id)}<//>
            <${Cell} meta>${tpl.isCustom ? E('tpl.edited', { lang }) : E('tpl.builtIn')}<//>
            <${Cell} sign>${isOpen ? '▴' : '▾'}<//>
          <//>`;
  })}
      <//>

      <${FormActions}>
        ${seeded
    ? html`<${Action} small soft onClick=${seedAll}>${E('tpl.reseed')}<//>
           <${Action} small soft tone="danger" onClick=${resetAll}>${E('tpl.resetAll')}<//>`
    : html`<${Action} small soft onClick=${seedAll}>${E('tpl.seedDefaults')}<//>`}
        <${Note} slab>${seeded ? E('tpl.seededNote') : E('tpl.seedNote')}<//>
        ${said && html`<${Note} kind="message" error=${!said.ok}>${said.text}<//>`}
      <//>
      <${Note}>${E('tpl.bothParts')}<//>
      <${ConfirmUI} />
    <//>`;
}
