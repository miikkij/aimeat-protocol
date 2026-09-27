/**
 * @file public/components/SearchPreview.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a site shows up elsewhere, drawn from what it serves: SearchResult is a search
 *   engine's result (the address in the typewriter face, the name as the coral link line, the
 *   sentence in grey), ShareCard the card a shared link unfolds into (the picture, or a dark place
 *   that says there is none; the name, the sentence, the host). Each has its label over it. A page
 *   passes the words; it never writes a class. The look is css/components/search-preview.css (main's
 *   Discovery previews, .adm-disc-frame, .adm-disc-serp-*, .adm-disc-card-*).
 *   SearchCard is the app catalogue's own preview of a search result: the coral name, the sentence
 *   and the picture in one thin rounded frame (the old .dtl-seo-preview).
 * @structure SearchResult({ label, url, title, desc }) · ShareCard({ label, image, noImage, title, desc, host }) ·
 *   SearchCard({ image, noImage, title, desc })
 * @usage html`<${SearchResult} label=${x('serp')} url=${id.organization_url} title=${id.site_name} desc=${id.site_description} />`
 *        html`<${ShareCard} label=${x('card')} image=${id.og_image} noImage=${x('noImage')} title=${id.site_name}
 *          desc=${id.site_description} host=${host} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — SearchCard: the app catalogue's search preview (.dtl-seo-preview), appcat
 *     parity (sections-c); additive, search-preview.css .search-card.
 *   v1.0.0 — 2026-09-27 — Initial: the Discovery page's two previews as components (admin group G2).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

const labelOf = (label) => (label ? html`<span class="poster-label poster-label--block search-preview-label">${label}</span>` : null);

/** @param {{ label?: any, url?: any, title?: any, desc?: any }} props */
export function SearchResult({ label, url, title, desc }) {
  return html`${labelOf(label)}
    <div class="search-preview">
      <div class="search-preview-url">${url}</div>
      <div class="search-preview-title">${title}</div>
      <div class="search-preview-desc">${desc}</div>
    </div>`;
}

/** @param {{ label?: any, image?: string, noImage?: any, title?: any, desc?: any, host?: any }} props */
export function ShareCard({ label, image, noImage, title, desc, host }) {
  return html`${labelOf(label)}
    <div class="search-preview search-preview--card">
      ${image
        ? html`<img class="search-preview-img" src=${image} alt="" loading="lazy" />`
        : html`<div class="search-preview-img search-preview-img--none">${noImage}</div>`}
      <div class="search-preview-body">
        <div class="search-preview-card-title">${title}</div>
        <div class="search-preview-desc">${desc}</div>
        <div class="search-preview-host">${host}</div>
      </div>
    </div>`;
}

/**
 * SearchCard (added by appcat sections-c, parity): what a search engine will show of a thing, in one
 * thin rounded frame: the name as the coral line, the sentence under it, then the picture or the words
 * that say there is none yet (the old app catalogue's .dtl-seo-preview).
 * @param {{ image?: string, noImage?: any, title?: any, desc?: any }} props
 */
export function SearchCard({ image, noImage, title, desc }) {
  return html`<div class="search-card">
    <div class="search-card-title">${title}</div>
    <div class="search-card-desc">${desc}</div>
    ${image
      ? html`<img class="search-card-img" src=${image} alt="" loading="lazy" />`
      : html`<div class="search-card-none">${noImage}</div>`}
  </div>`;
}

export default SearchResult;
