import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/**
 * @file SearchBar.js
 * @description Canonical search-bar shell — a flex row wrapping a single
 *   `type="search"` input that reuses the canonical `.input-field` (theme.css)
 *   for its styling. Provides one place to define the search-toolbar layout so
 *   per-view hand-rolled search inputs (.pkv-search, .cap-search-input,
 *   .pf-agd-search-input, the profile .search-bar + .input-field combo) can
 *   converge. The shell layout lives in `.search-bar` / `.search-bar-input`
 *   (theme.css); all input visuals (border, focus ring, placeholder, dark-mode
 *   flip) come from `.input-field`, so colors are fully token-driven.
 * @structure SearchBar({ value, onInput, placeholder?, onSubmit?, ariaLabel? }) —
 *   renders `<div class="search-bar"><input class="input-field search-bar-input"
 *   type="search" .../></div>`. When `onSubmit` is supplied, pressing Enter calls
 *   `onSubmit(currentValue)`.
 * @usage
 *   import { SearchBar } from '/components/index.js';
 *   html`<${SearchBar} value=${q} onInput=${e => setQ(e.target.value)}
 *        placeholder=${t('common.search')} />`
 * @version-history
 *   v1.0.0 — 2026-06-02 — Component unification (#24): created canonical
 *     search-bar shell backed by .search-bar / .search-bar-input in theme.css.
 */
export function SearchBar({ value, onInput, placeholder, onSubmit, ariaLabel }) {
  const onKeyDown = onSubmit
    ? (e) => { if (e.key === 'Enter') onSubmit(e.target.value); }
    : undefined;
  return html`
    <div class="search-bar">
      <input
        class="input-field search-bar-input"
        type="search"
        placeholder=${placeholder}
        aria-label=${ariaLabel || placeholder}
        value=${value}
        onInput=${onInput}
        onKeyDown=${onKeyDown}
      />
    </div>
  `;
}
