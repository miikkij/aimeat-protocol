/**
 * @file public/views/admin/themes-ai.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Themes & Styles' "Ask your AI" section. Jouni, 2026-10-02: "eikö themes & styles
 *   pitänyt olla AI kiihdytetyä niin että AI pystyy tekemään noi teemaukset suoraan ? ... en näe
 *   missään tuolla copy prompt nappia minkä voisin antaa AI:lle".
 *
 *   The chat path comes first: an AI connected to this node over MCP makes the theme itself with
 *   the aimeat_theme_* tools, and this section only hands over the prompt. An AI without that
 *   connection gets the second prompt, answers with one JSON block, and the paste box here applies
 *   it through the same /v1/themes routes the view uses: the theme is made as a copy of its base,
 *   the AI's styles are added, they become the offered styles, and the copied styles are retired
 *   (they keep their data). The new theme is not offered to people; the operator opens it first.
 *   Built only from library parts, with no sheet of its own.
 * @structure AskAiBand({ data, onMade }) · applyThemePlan(plan) → { id }
 * @usage html`<${AskAiBand} data=${data} onMade=${(id) => setOpen(id)} />` (themes-tab.js)
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (wish "Themes & Styles: Pyydä tekoälyltä -lohko").
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiPost, apiPut } from '/js/api.js';
import { getNodeUrl } from '/js/services/auth.js';
import { Band } from '/components/Band.js';
import { Hint } from '/components/Hint.js';
import { FormField } from '/components/FormField.js';
import { TextInput } from '/components/TextInput.js';
import { PromptCard } from '/components/PromptCard.js';
import { PasteBox } from '/components/PasteBox.js';
import { Loud, Actions } from '/components/Action.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { buildThemeMcpPrompt, buildThemeJsonPrompt, readThemeAnswer } from './themes-tab.prompt.js';

const html = htm.bind(h);
const enc = encodeURIComponent;

/**
 * Make the theme a JSON answer describes. Each step is one existing route, so the node checks every
 * value as it does for the view. Throws with `made` set when the theme exists but a later step failed.
 * @param {{ name: string, basedOn: string, styles: any[], shapes?: Record<string,string>, css?: string }} plan
 * @returns {Promise<{ id: string }>}
 */
export async function applyThemePlan(plan) {
  const made = await apiPost('/v1/themes', {
    name: plan.name, basedOn: plan.basedOn,
    ...(plan.shapes ? { shapes: plan.shapes } : {}),
    ...(plan.css ? { css: plan.css } : {}),
  });
  const theme = made.data.theme;
  try {
    const ids = [];
    for (const style of plan.styles) {
      const r = await apiPost(`/v1/themes/${enc(theme.id)}/styles`, style);
      ids.push(r.data.style.id);
    }
    await apiPut(`/v1/themes/${enc(theme.id)}`, { defaultStyle: ids[0], offeredStyles: ids });
    for (const copied of theme.styles) {
      await apiPut(`/v1/themes/${enc(theme.id)}/styles/${enc(copied.id)}`, { retired: true });
    }
    return { id: theme.id };
  } catch (e) {
    const err = /** @type {any} */ (e instanceof Error ? e : new Error(String(e)));
    err.made = theme;
    throw err;
  }
}

/** The section: the look in the person's words, the two prompts, and the paste box for the answer. */
export function AskAiBand({ data, onMade }) {
  const [look, setLook] = useState('');
  const [paste, setPaste] = useState('');
  const [state, setState] = useState({ busy: false, error: '' });
  const url = getNodeUrl();
  const mcp = buildThemeMcpPrompt({ url, look, themes: data.themes });
  const json = buildThemeJsonPrompt({ url, look, themes: data.themes, vocabulary: data.vocabulary });

  const apply = async () => {
    const read = /** @type {any} */ (readThemeAnswer(paste));
    if (!read.ok) { setState({ busy: false, error: t(`themes.ai.bad.${read.error}`, { style: read.at || '' }) }); return; }
    setState({ busy: true, error: '' });
    try {
      // The theme screen it opens on shows each style's contrast warnings.
      const r = await applyThemePlan(read.plan);
      setPaste('');
      setState({ busy: false, error: '' });
      onMade(r.id);
    } catch (e) {
      const err = /** @type {any} */ (e);
      const message = err?.message || String(e);
      setState({ busy: false, error: err?.made ? t('themes.ai.partly', { name: err.made.name, error: message }) : message });
    }
  };

  return html`
    <${Band} title=${t('themes.ai.title')}>
      <${Hint}>${t('themes.ai.lead')}<//>
      <${Hint}>${t('themes.ai.langNote')}<//>
      <${FormField} label=${t('themes.ai.look')} hint=${t('themes.ai.lookHint')}>
        <${TextInput} id="theme-ai-look" maxLength="600" value=${look} onInput=${(e) => setLook(e.target.value)} />
      <//>
      <${PromptCard} loud label=${t('themes.ai.mcpLabel')} prompt=${mcp} showPrompt=${false}
        copyLabel=${t('themes.ai.copy')} copiedLabel=${t('themes.ai.copied')} />
      <${Hint}>${t('themes.ai.mcpHint')}<//>
      <${PromptCard} quiet label=${t('themes.ai.jsonLabel')} prompt=${json} showPrompt=${false}
        copyLabel=${t('themes.ai.copy')} copiedLabel=${t('themes.ai.copied')} />
      <${Hint}>${t('themes.ai.jsonHint')}<//>
      <${PasteBox} id="theme-ai-paste" label=${t('themes.ai.pasteLabel')} placeholder=${t('themes.ai.pastePh')}
        value=${paste} onInput=${(e) => setPaste(e.target.value)} />
      <${Actions}>
        <${Loud} control disabled=${state.busy || !paste.trim()} onClick=${apply}>${state.busy ? t('themes.ai.making') : t('themes.ai.make')}<//>
      <//>
      ${state.error && html`<${ErrorNote} text=${state.error} />`}
    <//>`;
}
