/**
 * @file public/views/admin/themes-components.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A theme's components (S4) and the styling of one of them (S5), in Themes & Styles.
 *   Jouni: "nähtävissä nämä komponentit + lisättävissä omat css:t per teema ja tyylitellä asioita
 *   mitenkä halutaan jotain komponentteja tuoda sinne ilman että niiden toiminnallisuus muuttuu".
 *
 *   S4: every component of the catalogue drawn live in this theme, in the style and the mode chosen
 *   at the top, filtered by what it is used for, by page and by words. Each says whether it has
 *   component CSS in this theme and whether that CSS is served; CSS for a component that left the
 *   catalogue is listed with a delete action (07 "Lifecycle").
 *
 *   S5: one component in frames, without this theme's CSS for it and with it, light and dark, every
 *   variant, and at a phone width, following the editor as the operator types. Beside it the editor,
 *   the component's own classes (a click puts the selector in) and the usual things to change, and
 *   the warnings: the node's, with the line, and what the frames measured that the CSS caused.
 * @structure ComponentsTab (default) · ComponentGrid · ComponentEditor · pagePath
 * @usage html`<${ComponentsTab} theme=${theme} readOnly=${false} onSaved=${fn} onOpenPage=${fn} />`
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles S4 and S5).
 */
import { h } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPut } from '/js/api.js';
import { Band } from '/components/Band.js';
import { ActionRow } from '/components/ActionRow.js';
import { NamedRow } from '/components/NamedRow.js';
import { Hint } from '/components/Hint.js';
import { QuietNote } from '/components/QuietNote.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { PageIntro } from '/components/PageIntro.js';
import { BackLink } from '/components/BackLink.js';
import { SearchBar } from '/components/SearchBar.js';
import { ConfirmDialog } from '/components/Modal.js';
import { Specimens, Specimen } from '/components/Specimen.js';
import { Choice, StylePicker, ModePicker, CssEditor, WarningList, tokenKey } from './themes-bits.js';
import { useDraftSheets, useFrameChecks, newFindings, componentFrame } from './themes-draft.js';

const html = htm.bind(h);

/** The inner page a page file belongs to, or null for a page themes do not reach. */
export function pagePath(file) {
  const f = String(file).replace(/^public\//, '');
  if (f.startsWith('views/home/') || f === 'views/home.js') return '/v1/home';
  if (f.startsWith('views/chat')) return '/v1/chat';
  if (f.startsWith('views/profile') || f.startsWith('views/organism') || f.startsWith('views/contacts')
    || f === 'views/agent-solo.js' || f === 'views/doc-solo.js') return '/v1/profile';
  if (f.startsWith('views/admin')) return '/v1/admin';
  if (f.startsWith('views/fleet')) return '/v1/fleet';
  return null;
}

/** The inner pages by address, as the look picker's own pages are named. */
const INNER = [['/v1/home', 'themes.page.home'], ['/v1/chat', 'themes.page.chat'], ['/v1/profile', 'themes.page.profile'], ['/v1/admin', 'themes.page.admin'], ['/v1/fleet', 'themes.page.fleet']];
const innerName = (p) => t((INNER.find(([x]) => x === p) || [p, p])[1]);

/** "StepCard" read as "Step card", as the design lab names a part. */
const spaced = (name) => String(name).replace(/([a-z])([A-Z])/g, '$1 $2');

/** The inner pages that draw a component. */
const innerPagesOf = (c) => [...new Set((c.pages || []).map(pagePath).filter(Boolean))];

/** The state of a component's CSS in this theme, in words. */
function cssStateText(st) {
  if (!st || st.status === 'empty') return t('themes.cssState.none');
  return t('themes.cssState.' + st.status);
}

/** S4: every component, live in this theme. */
function ComponentGrid({ theme, components, onOpen, onRemove, readOnly }) {
  const live = theme.styles.filter((s) => !s.retired);
  const [style, setStyle] = useState(theme.defaultStyle);
  const [mode, setMode] = useState('light');
  const [use, setUse] = useState('');
  const [page, setPage] = useState('');
  const [which, setWhich] = useState('all');
  const [q, setQ] = useState('');
  useDraftSheets({ grid: theme });

  const uses = [...new Set(components.flatMap((c) => c.use || []))].sort();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hasCss = (c) => !!theme.componentCss?.[c.id];
  // What has CSS in this theme first, then an exact name for the words searched, then the catalogue's order.
  const rank = (c) => (hasCss(c) ? 0 : 2) + (words.length && (c.id === q.trim().toLowerCase() || c.name.toLowerCase() === q.trim().toLowerCase()) ? 0 : 1);
  const shown = components.filter((c) => (!use || (c.use || []).includes(use)) && (!page || innerPagesOf(c).includes(page))
    && (which === 'all' || hasCss(c))
    && words.every((w) => `${c.id} ${c.name} ${c.summary}`.toLowerCase().includes(w)))
    .map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
  const known = new Set(components.map((c) => c.id));
  const gone = Object.keys(theme.componentCss || {}).filter((id) => !known.has(id));

  return html`
    <${Band} title=${t('themes.tab.components')}>
      <${Hint}>${t('themes.componentsHint')}<//>
      <${StylePicker} theme=${{ ...theme, styles: live }} value=${style} onChoose=${setStyle} />
      <${ModePicker} value=${mode} onChoose=${setMode} />
      <${Choice} label=${t('themes.filterUse')} hint=${t('themes.filterUseHint')} value=${use}
        choices=${[{ value: '', label: t('themes.all') }, ...uses.map((u) => ({ value: u, label: t('themes.use.' + u) }))]} onChoose=${setUse} />
      <${Choice} label=${t('themes.filterPage')} hint=${t('themes.filterPageHint')} value=${page}
        choices=${[{ value: '', label: t('themes.all') }, ...INNER.map(([p, key]) => ({ value: p, label: t(key) }))]} onChoose=${setPage} />
      <${Choice} label=${t('themes.filterCss')} value=${which}
        choices=${[{ value: 'all', label: t('themes.all') }, { value: 'css', label: t('themes.withCssHere') }]} onChoose=${setWhich} />
      <${SearchBar} value=${q} onInput=${(e) => setQ(e.target.value)} placeholder=${t('themes.findComponent')} ariaLabel=${t('themes.findComponent')} />
      <p class="text-meta">${t('themes.shownCount', { n: shown.length, total: components.length })}</p>
    <//>
    ${gone.length > 0 && html`<${Band} title=${t('themes.cssState.removed')} tight=${true}>
      ${gone.map((id) => html`<${NamedRow} key=${id} label=${id}>
        ${t('themes.removedWhy')}
        ${!readOnly && html` <button type="button" class="poster-action" onClick=${() => onRemove(id)}>${t('themes.deleteCss')}</button>`}
      <//>`)}
    <//>`}
    ${shown.length === 0 && html`<${QuietNote}>${t('themes.noComponent')}<//>`}
    <${Specimens}>
      ${shown.map((c) => {
        const st = theme.componentCssState?.[c.id];
        return html`<${Specimen} key=${c.id + style + mode} label=${spaced(c.name)} src=${componentFrame({ id: c.id, mode, key: 'grid', style })}
          note=${html`${cssStateText(st)}${st && st.status === 'stale' ? ` · ${t('themes.staleWhy')}` : ''}
            <br /><button type="button" class="poster-action" onClick=${() => onOpen(c.id, style)}>${readOnly ? t('themes.open') : hasCss(c) ? t('themes.changeCss') : t('themes.styleIt')}</button>`} />`;
      })}
    <//>`;
}

/** S5: one component, its CSS in this theme, with frames that follow the editor. */
function ComponentEditor({ theme, componentId, initialStyle, readOnly, onBack, onSaved, onOpenPage }) {
  const [entry, setEntry] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  const saved = theme.componentCss?.[componentId] || '';
  const [css, setCss] = useState(saved);
  const [style, setStyle] = useState(initialStyle || theme.defaultStyle);
  const [state, setState] = useState({ busy: false, error: '', saved: false });
  const [removing, setRemoving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    apiGet(`/v1/ui/components/${encodeURIComponent(componentId)}`).then((r) => setEntry(r.data)).catch((e) => setError(e.message || String(e)));
  }, [componentId]);

  const drafts = useMemo(() => {
    const without = { ...(theme.componentCss || {}) };
    delete without[componentId];
    return { with: { ...theme, componentCss: { ...without, ...(css.trim() ? { [componentId]: css } : {}) } }, without: { ...theme, componentCss: without } };
  }, [theme, componentId, css]);
  const out = useDraftSheets(drafts);
  const checks = useFrameChecks('s5:');
  const cssState = out.with?.warnings?.components?.[componentId];
  const broken = cssState?.status === 'broken' ? t('themes.brokenAt', { line: (/Line (\d+)/.exec(cssState.reason) || [])[1] || '?' }) : '';

  const variants = entry?.variants?.length ? entry.variants : [{ name: '' }];
  const findings = [];
  const seen = new Set();
  for (let v = 0; v < variants.length; v++) {
    for (const mode of ['light', 'dark']) {
      for (const f of newFindings(checks[`s5:${v}:${mode}:with`], checks[`s5:${v}:${mode}:without`])) {
        const k = `${f.code}|${f.what}`;
        if (!seen.has(k)) { seen.add(k); findings.push(f); }
      }
    }
  }

  const save = async (text) => {
    setState({ busy: true, error: '', saved: false });
    try {
      await apiPut(`/v1/themes/${encodeURIComponent(theme.id)}/components/${encodeURIComponent(componentId)}`, { css: text });
      setState({ busy: false, error: '', saved: true });
      onSaved();
    } catch (e) {
      setState({ busy: false, error: e.message || String(e), saved: false });
    }
  };

  const frame = (v, mode, withCss) => componentFrame({ id: componentId, v, mode, key: withCss ? 'with' : 'without', style, fk: `s5:${v}:${mode}:${withCss ? 'with' : 'without'}` });
  // The usual things to change: the part's own hooks when it declares them, else the colours of a
  // style it reads (a value it reads that no style sets is not the theme's to change).
  const styleTokens = Object.keys(theme.styles[0]?.light || {});
  const hooks = entry?.themeHooks?.hooks?.map((hk) => ({ label: hk.what, code: hk.name }))
    ?? (entry?.tokens || []).map((tk) => '--' + tk.replace(/^--/, '')).filter((tk) => styleTokens.includes(tk))
      .map((tk) => ({ label: t(tokenKey(tk)), code: `var(${tk})` }));
  // What the frames found hidden or out of reach because of this CSS: named before it is saved (Q2: warn, never refuse).
  const hidden = [...new Set(findings.filter((f) => f.code === 'hidden' || f.code === 'covered').map((f) => f.what))];
  const pages = innerPagesOf(entry || {});
  const elsewhere = (entry?.pages || []).filter((f) => !pagePath(f)).length;
  const back = html`<${BackLink} href="#" onClick=${(e) => { e.preventDefault(); onBack(); }}>↩ ${t('themes.allComponents')}<//>`;
  if (error) return html`${back}<${ErrorNote} text=${error} />`;
  if (!entry) return html`${back}<${QuietNote}>${t('themes.loading')}<//>`;

  return html`
    ${back}
    <${PageIntro} title=${spaced(entry.name)} sub=${entry.summary} />
    <${StylePicker} theme=${{ ...theme, styles: theme.styles.filter((s) => !s.retired) }} value=${style} onChoose=${setStyle} />
    ${variants.map((variant, v) => html`
      <${Band} key=${'v' + v} title=${variant.name ? t('themes.variant', { name: variant.name }) : t('themes.preview')} tight=${true}>
        <${Specimens}>
          <${Specimen} label=${t('themes.withoutLight')} src=${frame(v, 'light', false)} eager=${v === 0} />
          <${Specimen} label=${t('themes.withLight')} src=${frame(v, 'light', true)} eager=${v === 0} />
          <${Specimen} label=${t('themes.withoutDark')} src=${frame(v, 'dark', false)} eager=${v === 0} />
          <${Specimen} label=${t('themes.withDark')} src=${frame(v, 'dark', true)} eager=${v === 0} />
          ${v === 0 && html`<${Specimen} label=${t('themes.withPhone')} phone=${true} src=${componentFrame({ id: componentId, v, mode: 'light', key: 'with', style })} />`}
        <//>
      <//>`)}

    <${Band} title=${t('themes.componentCss')}>
      <${Hint}>${readOnly ? t('themes.builtinHint') : t('themes.componentCssHint')}<//>
      <${CssEditor} id="component-css" label=${t('themes.componentCssFor', { name: spaced(entry.name) })} value=${css} onInput=${setCss}
        classes=${entry.classes || []} usual=${hooks} readOnly=${readOnly} />
      <${WarningList} warnings=${cssState?.warnings || []} findings=${findings} error=${broken} />
      ${!readOnly && html`
        ${state.error && html`<${ErrorNote} text=${state.error} />`}
        <${ActionRow}>
          <button type="button" class="poster-action" disabled=${css === saved} onClick=${() => setCss(saved)}>${t('themes.undo')}</button>
          ${saved && html`<button type="button" class="poster-action" onClick=${() => setRemoving(true)}>${t('themes.removeCss')}</button>`}
          <button type="button" class="poster-slab poster-slab--control" disabled=${state.busy || css === saved || !!broken} onClick=${() => (hidden.length ? setConfirming(true) : save(css))}>${t('themes.save')}</button>
          ${state.saved && html`<span class="text-meta">${t('themes.saved')}</span>`}
        <//>`}
    <//>

    <${Band} title=${t('themes.whereItShows')} tight=${true}>
      ${pages.length === 0 && html`<${QuietNote}>${t('themes.noPage')}<//>`}
      ${pages.map((p) => html`<${NamedRow} key=${p} label=${innerName(p)}>
        <button type="button" class="poster-action" onClick=${() => onOpenPage(p, drafts.with)}>${t('themes.seeOnPage', { page: innerName(p) })}</button>
      <//>`)}
      ${elsewhere > 0 && html`<${Hint}>${t('themes.alsoPublic', { n: elsewhere })}<//>`}
    <//>
    ${confirming && html`<${ConfirmDialog} open=${true} onClose=${() => setConfirming(false)} danger=${true}
      title=${t('themes.saveAnyway')} message=${t('themes.hidesConfirm', { list: hidden.join(', ') })}
      confirmLabel=${t('themes.saveAnyway')} cancelLabel=${t('themes.cancel')}
      onConfirm=${() => { setConfirming(false); save(css); }} />`}
    ${removing && html`<${ConfirmDialog} open=${true} onClose=${() => setRemoving(false)} danger=${true}
      title=${t('themes.removeCss')} message=${t('themes.removeCssConfirm', { name: entry.name })}
      confirmLabel=${t('themes.removeCss')} cancelLabel=${t('themes.cancel')}
      onConfirm=${() => { setRemoving(false); setCss(''); save(''); }} />`}`;
}

export default function ComponentsTab({ theme, readOnly, onSaved, onOpenPage }) {
  const [components, setComponents] = useState(/** @type {any[]|null} */ (null));
  const [open, setOpen] = useState(/** @type {null | { id: string, style: string }} */ (null));
  const [error, setError] = useState('');
  useEffect(() => {
    apiGet('/v1/ui/components').then((r) => setComponents(r.data.components)).catch((e) => setError(e.message || String(e)));
  }, []);
  const remove = async (id) => {
    try { await apiPut(`/v1/themes/${encodeURIComponent(theme.id)}/components/${encodeURIComponent(id)}`, { css: '' }); onSaved(); } catch (e) { setError(e.message || String(e)); }
  };
  if (error) return html`<${ErrorNote} text=${error} />`;
  if (!components) return html`<${QuietNote}>${t('themes.loading')}<//>`;
  if (open) {
    return html`<${ComponentEditor} theme=${theme} componentId=${open.id} initialStyle=${open.style} readOnly=${readOnly}
      onBack=${() => setOpen(null)} onSaved=${onSaved} onOpenPage=${onOpenPage} />`;
  }
  return html`<${ComponentGrid} theme=${theme} components=${components} readOnly=${readOnly}
    onOpen=${(id, style) => setOpen({ id, style })} onRemove=${remove} />`;
}
