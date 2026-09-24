/**
 * @file public/views/admin/themes-pages.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A theme on real pages (S7): the theme (its styles, component CSS and theme CSS, as
 *   saved, or with the unsaved CSS of the component the operator came from) on the real home, chat, Settings & Controls, admin and Agents pages, in a frame, in any
 *   style of the theme, light and dark, and at a phone width, for the operator only and before it
 *   is offered to people. The pages are the operator's own, signed in; the draft reaches them on a
 *   same-origin channel (spa.html's look script, `?look-draft=`), so nothing leaves this browser.
 * @structure PagesTab (default) · PAGES
 * @usage html`<${PagesTab} theme=${theme} draft=${unsaved} path="/v1/home" />`
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles S7).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Band } from '/components/Band.js';
import { Hint } from '/components/Hint.js';
import { Specimens, Specimen } from '/components/Specimen.js';
import { Choice, StylePicker } from './themes-bits.js';
import { useDraftSheets, pageFrame } from './themes-draft.js';

const html = htm.bind(h);

/** AIMEAT's own pages a theme reaches, and their names. */
const PAGES = [
  ['/v1/home', 'themes.page.home'],
  ['/v1/chat', 'themes.page.chat'],
  ['/v1/profile', 'themes.page.profile'],
  ['/v1/admin', 'themes.page.admin'],
  ['/v1/fleet', 'themes.page.fleet'],
];

export default function PagesTab({ theme, draft, path }) {
  const [page, setPage] = useState(PAGES.some(([p]) => p === path) ? path : '/v1/home');
  const [style, setStyle] = useState(theme.defaultStyle);
  // The draft another tab sent here (unsaved component CSS included), else the theme as saved.
  useDraftSheets({ pages: draft || theme });
  const src = (mode) => pageFrame(page, { mode, key: 'pages', style });
  return html`
    <${Band}>
      <${Hint}>${t('themes.pagesHint')}<//>
      <${Choice} label=${t('themes.whichPage')} hint=${t('themes.whichPageHint')} value=${page}
        choices=${PAGES.map(([p, key]) => ({ value: p, label: t(key) }))} onChoose=${setPage} />
      <${StylePicker} theme=${{ ...theme, styles: theme.styles.filter((s) => !s.retired) }} value=${style} onChoose=${setStyle} />
      ${/* A real page needs the whole width, or it takes its phone layout: these two stand outside the grid. */''}
      <${Specimen} key=${page + style + 'l'} label=${t('themes.light')} src=${src('light')} eager=${true} />
      <${Specimen} key=${page + style + 'd'} label=${t('themes.dark')} src=${src('dark')} eager=${true} />
      <${Specimens}>
        <${Specimen} key=${page + style + 'p'} label=${t('themes.phone')} phone=${true} src=${src('light')} />
      <//>
    <//>`;
}
