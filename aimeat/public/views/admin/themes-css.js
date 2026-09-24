/**
 * @file public/views/admin/themes-css.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A theme's theme CSS (S6): CSS for the whole theme, for what no single component owns.
 *   It may target anything on AIMEAT's own pages (07, Q2); only CSS that does not parse is refused.
 *   The editor has the same frames as S5 (a chosen component, without the theme CSS and with it,
 *   light and dark) and the same warnings.
 * @structure ThemeCssTab (default)
 * @usage html`<${ThemeCssTab} theme=${theme} warnings=${w} readOnly=${false} onSaved=${fn} />`
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles S6).
 */
import { h } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPut } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { Band } from '/components/Band.js';
import { ActionRow } from '/components/ActionRow.js';
import { Hint } from '/components/Hint.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { ConfirmDialog } from '/components/Modal.js';
import { Specimens, Specimen } from '/components/Specimen.js';
import { Choice, StylePicker, CssEditor, WarningList } from './themes-bits.js';
import { useDraftSheets, useFrameChecks, newFindings, componentFrame } from './themes-draft.js';

const html = htm.bind(h);
const SAMPLER = 'theme:sampler';

export default function ThemeCssTab({ theme, readOnly, onSaved }) {
  const saved = theme.css || '';
  const [css, setCss] = useState(saved);
  const [style, setStyle] = useState(theme.defaultStyle);
  const [part, setPart] = useState(SAMPLER);
  const [components, setComponents] = useState(/** @type {any[]} */ ([]));
  const [state, setState] = useState({ busy: false, error: '', saved: false });
  const [removing, setRemoving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { apiGet('/v1/ui/components?status=active').then((r) => setComponents(r.data.components)).catch((e) => { swallowed('themes: components', e); setComponents([]); }); }, []);

  const drafts = useMemo(() => ({ 'css-with': { ...theme, css: css.trim() ? css : null }, 'css-without': { ...theme, css: null } }), [theme, css]);
  const out = useDraftSheets(drafts);
  const checks = useFrameChecks('s6:');
  const findings = [...newFindings(checks['s6:light:with'], checks['s6:light:without']), ...newFindings(checks['s6:dark:with'], checks['s6:dark:without'])];
  const lint = out['css-with']?.warnings?.css || [];
  // What the frames found hidden or out of reach because of this CSS: named before it is saved.
  const hidden = [...new Set(findings.filter((f) => f.code === 'hidden' || f.code === 'covered').map((f) => f.what))];

  const save = async (text) => {
    setState({ busy: true, error: '', saved: false });
    try {
      await apiPut(`/v1/themes/${encodeURIComponent(theme.id)}`, { css: text || null });
      setState({ busy: false, error: '', saved: true });
      onSaved();
    } catch (e) {
      // The node refuses only CSS that does not parse, and says where.
      setState({ busy: false, error: e.message || String(e), saved: false });
    }
  };
  const frame = (mode, withCss) => componentFrame({ id: part, mode, key: withCss ? 'css-with' : 'css-without', style, fk: `s6:${mode}:${withCss ? 'with' : 'without'}` });
  const choices = [{ value: SAMPLER, label: t('themes.sampler') }, ...components.map((c) => ({ value: c.id, label: String(c.name).replace(/([a-z])([A-Z])/g, '$1 $2') }))];

  return html`
    <${Band} title=${t('themes.tab.css')}>
      <${Hint}>${readOnly ? t('themes.builtinHint') : t('themes.themeCssHint')}<//>
      <${StylePicker} theme=${{ ...theme, styles: theme.styles.filter((s) => !s.retired) }} value=${style} onChoose=${setStyle} />
      <${Choice} label=${t('themes.showComponent')} hint=${t('themes.showComponentHint')} value=${part} choices=${choices} onChoose=${setPart} />
      <${Specimens}>
        <${Specimen} key=${part + style + 'wl'} label=${t('themes.withoutLight')} src=${frame('light', false)} eager=${true} />
        <${Specimen} key=${part + style + 'l'} label=${t('themes.withLight')} src=${frame('light', true)} eager=${true} />
        <${Specimen} key=${part + style + 'wd'} label=${t('themes.withoutDark')} src=${frame('dark', false)} eager=${true} />
        <${Specimen} key=${part + style + 'd'} label=${t('themes.withDark')} src=${frame('dark', true)} eager=${true} />
      <//>
      <${CssEditor} id="theme-css" label=${t('themes.themeCssLabel')} value=${css} onInput=${setCss} readOnly=${readOnly} />
      <${WarningList} warnings=${lint} findings=${findings} />
      ${!readOnly && html`
        ${state.error && html`<${ErrorNote} text=${state.error} />`}
        <${ActionRow}>
          <button type="button" class="poster-action" disabled=${css === saved} onClick=${() => setCss(saved)}>${t('themes.undo')}</button>
          ${saved && html`<button type="button" class="poster-action" onClick=${() => setRemoving(true)}>${t('themes.removeCss')}</button>`}
          <button type="button" class="poster-slab poster-slab--control" disabled=${state.busy || css === saved} onClick=${() => (hidden.length ? setConfirming(true) : save(css))}>${t('themes.save')}</button>
          ${state.saved && html`<span class="text-meta">${t('themes.saved')}</span>`}
        <//>`}
    <//>
    ${confirming && html`<${ConfirmDialog} open=${true} onClose=${() => setConfirming(false)} danger=${true}
      title=${t('themes.saveAnyway')} message=${t('themes.hidesConfirm', { list: hidden.join(', ') })}
      confirmLabel=${t('themes.saveAnyway')} cancelLabel=${t('themes.cancel')}
      onConfirm=${() => { setConfirming(false); save(css); }} />`}
    ${removing && html`<${ConfirmDialog} open=${true} onClose=${() => setRemoving(false)} danger=${true}
      title=${t('themes.removeCss')} message=${t('themes.removeThemeCssConfirm', { name: theme.name })}
      confirmLabel=${t('themes.removeCss')} cancelLabel=${t('themes.cancel')}
      onConfirm=${() => { setRemoving(false); setCss(''); save(''); }} />`}`;
}
