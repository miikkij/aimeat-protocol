/**
 * @file public/components/WorldMap.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Counts per country on a world map, with the list that says the same numbers beside it:
 *   countries shaded in five strengths of coral on a square-root scale, land with nothing at a faint
 *   ink; a press on a counted country zooms to it and lists its regions and cities; "+" and "−" zoom
 *   around the middle and "Whole world" goes back; a dot per city where coordinates are known, the
 *   same size at any zoom; a Fewer…More legend under the map. Beside it (under it on a narrow screen)
 *   the list: one row per country with its count, the country a button that does what the map does,
 *   a note on the ones the atlas is too coarse to draw, and "place unknown" for the unknown code.
 *
 *   NOTHING LEAVES THE NODE TO DRAW IT. The shapes are the node's own file (/lib/aimeat-atlas@1.json,
 *   Natural Earth, public domain, projected once into SVG paths), fetched same-origin the first time a
 *   map is shown and kept for the page. ZOOM IS THE SVG VIEW BOX: the paths are never re-projected,
 *   and the sheet keeps a border one pixel wide at any zoom. THE MAP IS THE PICTURE, THE LIST IS THE
 *   ANSWER: the list is what a keyboard or a screen reader reaches.
 *
 *   A page passes data and words and never a class; the look is css/components/world-map.css (the old
 *   app catalogue's .vis-geo, .vis-map*, .vis-land, .vis-shade-*, .vis-dot, .vis-legend).
 *
 *   WorldMap({ countries, places, unknownCode, lang, words, atlasUrl })
 *   - countries: [{ code, count }] (ISO alpha-2); places: [{ country, region, city, lat, lon, count }].
 *   - unknownCode: the code that means "place unknown" (the node's ZZ).
 *   - lang: the page language, for the country names (Intl.DisplayNames, then the atlas name, then the code).
 *   - words: { map, loading, failed, empty, zoomIn, zoomOut, zoomInTitle, zoomOutTitle, whole, few,
 *     many, country, count, notDrawn, unknownPlace, noPlaces, counted(n) } — counted(n) says one
 *     country's or place's count in a tooltip ("visits: 12").
 * @structure WorldMap(props) · loadAtlas(url) · countryName(code, lang, atlas, unknownCode, unknownWords)
 * @usage html`<${WorldMap} countries=${v.countries.map((c) => ({ code: c.country, count: c.people }))}
 *          unknownCode=${v.unknown_country} lang=${lang()} words=${words} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — The lists are the old .vis-table (List tone "counts": the country a bold word
 *     that turns coral, "place unknown" bold, the counts in typewriter), the notes in the old grey
 *     (Note hint 'note'), the zoom doors at the old .vis-map-controls size (world-map.css); appcat
 *     parity (sections-b).
 *   v1.0.0 — 2026-09-27 — Initial: the old app catalogue's visitors map (js/visitors-map.js) as a
 *     component (appcat detail builder B).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Actions } from '/components/Action.js';
import { List, Row, Name, Num } from '/components/List.js';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';
import { numericOf, alpha2Of, shadeStep, projectPoint, zoomBox, placesOfCountry } from '/components/world-map/model.js';

const html = htm.bind(h);
/** The narrowest view the zoom allows, in atlas units (the canvas is 1000 wide). */
const MIN_SPAN = 60;
const ATLAS = '/lib/aimeat-atlas@1.json';

/** The atlas, fetched once per page: { state: 'loading' | 'ready' | 'error', atlas, promise }. */
const atlasCache = {};

/** Fetch the geometry once per page; resolves to the atlas or null. */
export function loadAtlas(url = ATLAS) {
  const hit = atlasCache[url];
  if (hit) return hit.promise;
  const entry = { state: 'loading', atlas: null, promise: null };
  entry.promise = fetch(url)
    .then((r) => { if (!r.ok) throw new Error('atlas ' + r.status); return r.json(); })
    .then((json) => {
      if (!json || !Array.isArray(json.countries)) throw new Error('atlas shape');
      entry.atlas = json; entry.state = 'ready'; return json;
    })
    // eslint-disable-next-line aimeat/no-silent-catch -- the failure is the 'error' state, which the map says in words ("could not be loaded")
    .catch(() => { entry.state = 'error'; return null; });
  atlasCache[url] = entry;
  return entry.promise;
}

const namesCache = { lang: '', names: null };

/**
 * A country's name in the reader's language. The browser holds the list; the atlas name and the bare
 * code are the fallbacks for a browser that does not.
 */
export function countryName(code, lang, atlas, unknownCode, unknownWords) {
  if (code === unknownCode) return unknownWords || code;
  if (namesCache.lang !== lang) {
    namesCache.lang = lang;
    // eslint-disable-next-line aimeat/no-silent-catch -- a browser without the names list falls back to the atlas name
    try { namesCache.names = new Intl.DisplayNames([lang || 'en'], { type: 'region' }); } catch { namesCache.names = null; }
  }
  try {
    const n = namesCache.names ? namesCache.names.of(code) : '';
    if (n && n !== code) return n;
  // eslint-disable-next-line aimeat/no-silent-catch -- a code the browser's list does not know: the atlas name follows
  } catch { /* fall through */ }
  const shape = shapeOf(atlas, code);
  return shape ? shape.name : code;
}

function shapeOf(atlas, code) {
  const id = numericOf(code);
  if (!id || !atlas) return null;
  return atlas.countries.find((c) => c.id === id) || null;
}

/** Zoom in (factor < 1) or out (factor > 1) around the middle of what is shown; null is the world. */
function zoomed(atlas, view, factor) {
  const cur = view || { x: 0, y: 0, w: atlas.w, h: atlas.h };
  const w = Math.max(MIN_SPAN, Math.min(atlas.w, cur.w * factor));
  const hh = w / 2;
  if (w >= atlas.w) return null;
  const cx = cur.x + cur.w / 2;
  const cy = cur.y + cur.h / 2;
  return { x: Math.max(0, Math.min(atlas.w - w, cx - w / 2)), y: Math.max(0, Math.min(atlas.h - hh, cy - hh / 2)), w, h: hh };
}

function useAtlas(url) {
  const hit = atlasCache[url];
  const [state, setState] = useState(hit ? hit.state : 'loading');
  useEffect(() => {
    let live = true;
    loadAtlas(url).then(() => { if (live) setState(atlasCache[url].state); });
    return () => { live = false; };
  }, [url]);
  return { state, atlas: atlasCache[url] ? atlasCache[url].atlas : null };
}

/** The map itself: the land, the shades, the dots. */
function Picture({ atlas, view, focus, byCode, max, places, name, words, onFocus }) {
  const vb = view || { x: 0, y: 0, w: atlas.w, h: atlas.h };
  const r = (vb.w / 1000) * 5;
  return html`<svg class="world-map-svg" viewBox=${[vb.x, vb.y, vb.w, vb.h].map((v) => v.toFixed(1)).join(' ')} role="img" aria-label=${words.map}>
    ${atlas.countries.map((shape) => {
      const a2 = alpha2Of(shape.id);
      const n = a2 ? (byCode[a2] || 0) : 0;
      const cls = `world-map-land world-map-shade-${shadeStep(n, max)}${n ? ' world-map-land--hit' : ''}${a2 && a2 === focus ? ' is-focus' : ''}`;
      const label = (a2 ? name(a2) : shape.name) + (n ? ' · ' + words.counted(n) : '');
      return html`<path key=${shape.id} class=${cls} d=${shape.d} onClick=${n ? () => onFocus(a2) : undefined}><title>${label}</title></path>`;
    })}
    ${(places || []).filter((p) => p.lat !== null && p.lat !== undefined && p.lon !== null && p.lon !== undefined).map((p, i) => {
      const pt = projectPoint(p.lat, p.lon, atlas.w, atlas.h);
      const label = [p.city, p.region, name(p.country)].filter(Boolean).join(', ') + ' · ' + words.counted(p.count);
      return html`<circle key=${'p' + i} class="world-map-dot" cx=${pt.x.toFixed(1)} cy=${pt.y.toFixed(1)} r=${r.toFixed(2)}><title>${label}</title></circle>`;
    })}
  </svg>`;
}

/**
 * @param {{ countries: Array<{ code: string, count: number }>, places?: Array<any>, unknownCode?: string,
 *   lang?: string, words: Record<string, any>, atlasUrl?: string }} props
 */
export function WorldMap({ countries = [], places = [], unknownCode, lang, words, atlasUrl = ATLAS }) {
  const { state, atlas } = useAtlas(atlasUrl);
  const [view, setView] = useState(null);
  const [focus, setFocus] = useState(null);
  if (!countries.length) return html`<${Note} kind="hint" size="note">${words.empty}<//>`;

  const name = (code) => countryName(code, lang, atlas, unknownCode, words.unknownPlace);
  const byCode = {};
  let max = 0;
  for (const c of countries) {
    byCode[c.code] = c.count;
    if (c.code !== unknownCode && c.count > max) max = c.count;
  }
  /** Show one country (zoom to it when the atlas draws it); the same one again goes back to the world. */
  const onFocus = (code) => {
    if (!code || focus === code) { setView(null); setFocus(null); return; }
    setFocus(code);
    const shape = shapeOf(atlas, code);
    setView(shape && atlas ? zoomBox(shape.bbox, atlas.w, atlas.h, MIN_SPAN * 2) : null);
  };

  let picture;
  if (state === 'error') picture = html`<${Note} kind="hint" size="note">${words.failed}<//>`;
  else if (state !== 'ready' || !atlas) picture = html`<div class="world-map-wait">${words.loading}</div>`;
  else picture = html`<${Picture} atlas=${atlas} view=${view} focus=${focus} byCode=${byCode} max=${max} places=${places} name=${name} words=${words} onFocus=${onFocus} />`;

  const focusPlaces = focus ? placesOfCountry(places, focus) : [];
  return html`
    <div class="world-map">
      <div class="world-map-main">
        <${Actions}>
          <${Action} small title=${words.zoomInTitle} onClick=${() => atlas && setView(zoomed(atlas, view, 0.6))}>${words.zoomIn}<//>
          <${Action} small title=${words.zoomOutTitle} disabled=${!view} onClick=${() => atlas && setView(zoomed(atlas, view, 1.6))}>${words.zoomOut}<//>
          <${Action} small disabled=${!view && !focus} onClick=${() => onFocus('')}>${words.whole}<//>
        <//>
        <div class="world-map-frame">${picture}</div>
        <div class="world-map-legend"><span>${words.few}</span>${[1, 2, 3, 4, 5].map((s) => html`<i key=${s} class=${`world-map-step world-map-shade-${s}`}></i>`)}<span>${words.many}</span></div>
      </div>
      <div class="world-map-side">
        <${List} tone="counts" head=${[words.country, { label: words.count, num: true }]}>
          ${countries.map((c) => {
            const unknown = c.code === unknownCode;
            const drawn = !unknown && !!shapeOf(atlas, c.code);
            const note = !drawn && !unknown && state === 'ready' ? html` <${Note} kind="meta" inline>${words.notDrawn}<//>` : null;
            return html`<${Row} key=${c.code} selected=${c.code === focus}>
              <${Name} onOpen=${unknown ? undefined : () => onFocus(c.code)} after=${note}>${unknown ? html`<b>${name(c.code)}</b>` : name(c.code)}<//>
              <${Num}>${c.count}<//>
            <//>`;
          })}
        <//>
        ${focus ? html`
          <${SubHeading} rule>${name(focus)}<//>
          ${focusPlaces.length
            ? html`<${List} tone="counts">${focusPlaces.map((p, i) => html`<${Row} key=${i}>
                <${Name}>${[p.city, p.region].filter(Boolean).join(', ')}<//><${Num}>${p.count}<//>
              <//>`)}<//>`
            : html`<${Note} kind="hint" size="note">${words.noPlaces}<//>`}` : null}
      </div>
    </div>`;
}

export default WorldMap;
