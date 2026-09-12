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
import { CopyButton } from '/components/CopyButton.js';
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
    <div class="adm-em-open">
      ${tpl.params?.length > 0 && html`
        <div class="adm-em-lbl">${E('tpl.placeholders')}</div>
        <div class="adm-em-params">
          ${tpl.params.map(p => html`<code>${p}</code>`)}
          <span>${E('tpl.placeholdersWhy')}</span>
        </div>`}

      <div class="adm-em-views">
        <button type="button" class=${view === 'preview' ? 'on' : ''} onClick=${() => setView('preview')}>${E('tpl.preview')}</button>
        <button type="button" class=${view === 'html' ? 'on' : ''} onClick=${() => setView('html')}>${E('tpl.html')}</button>
        <button type="button" class=${view === 'text' ? 'on' : ''} onClick=${() => setView('text')}>${E('tpl.text')}</button>
        <span class="adm-em-views-r">${E('tpl.width')}</span>
      </div>
      <div class="adm-em-stage">
        ${view === 'preview' && html`<iframe srcdoc=${editHtml} sandbox="" title=${E('tpl.preview')}></iframe>`}
        ${view === 'html' && html`<textarea spellcheck="false" value=${editHtml} onInput=${e => setEditHtml(e.target.value)}></textarea>`}
        ${view === 'text' && html`<textarea spellcheck="false" value=${editText} onInput=${e => setEditText(e.target.value)}></textarea>`}
      </div>

      <div class="adm-em-tacts">
        <button class="adm-btn" onClick=${save} disabled=${saving || !changed}>${E('tpl.save')}</button>
        <${CopyButton} text=${buildAiPrompt(tpl, locale)} className="og-door og-door--quiet"
          label=${E('tpl.aiPrompt')} copiedLabel=${E('tpl.aiPromptCopied')} />
        ${tpl.isCustom && html`
          <button type="button" class="og-door og-door--quiet og-door--danger" onClick=${reset}>${E('tpl.backToBuiltIn')}</button>`}
        ${said && html`<span class="adm-em-said ${said.ok ? 'is-ok' : 'is-bad'}">${said.text}</span>`}
        ${!said && !changed && html`<span class="adm-em-hint" style="margin:0">${E('tpl.noChanges')}</span>`}
      </div>
      <p class="adm-em-hint">${E('tpl.aiHint')}</p>
      <${ConfirmUI} />
    </div>`;
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
    <section class="og-sec">
      <div class="og-sec-h">
        <h2>${E('tpl.title')}<small>05</small></h2>
        <div class="og-doors">
          ${LOCALES.map(l => html`
            <button type="button" class="og-door og-door--quiet ${l === lang ? 'og-door--on' : ''}"
              onClick=${() => setLang(l)}>${l}</button>`)}
        </div>
      </div>

      <div class="og-box">
        <b>${E('tpl.warnLead')}</b> ${E('tpl.warn')}
      </div>

      <div style="margin-top: 18px">
        ${(list || []).map(tpl => html`
          <button type="button" class="adm-em-fold ${open === tpl.id ? 'is-open' : ''}" onClick=${() => setOpen(open === tpl.id ? null : tpl.id)}>
            <i>${tpl.id}</i><b>${E('kind.' + tpl.id)}</b>
            <em>${tpl.isCustom ? E('tpl.edited', { lang }) : E('tpl.builtIn')}</em>
            <span class="adm-em-fold-arrow">${open === tpl.id ? '▴' : '▾'}</span>
          </button>
          ${open === tpl.id && html`<${Editor} key=${tpl.id + '-' + lang} tpl=${tpl} locale=${lang} onSave=${onSave} onReset=${onReset} />`}`)}
      </div>

      <div class="adm-em-act">
        ${seeded
    ? html`<button type="button" class="og-door og-door--quiet" onClick=${seedAll}>${E('tpl.reseed')}</button>
           <button type="button" class="og-door og-door--quiet og-door--danger" onClick=${resetAll}>${E('tpl.resetAll')}</button>`
    : html`<button type="button" class="og-door og-door--quiet" onClick=${seedAll}>${E('tpl.seedDefaults')}</button>`}
        <p>${seeded ? E('tpl.seededNote') : E('tpl.seedNote')}</p>
        ${said && html`<span class="adm-em-said ${said.ok ? 'is-ok' : 'is-bad'}">${said.text}</span>`}
      </div>
      <p class="adm-em-note">${E('tpl.bothParts')}</p>
      <${ConfirmUI} />
    </section>`;
}
