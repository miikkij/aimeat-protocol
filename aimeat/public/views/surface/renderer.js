/**
 * @file public/views/surface/renderer.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One engine, two levels: it takes a surface's stored layout and puts the blocks on the
 *   page in the order the operator arranged them. The node's front page and its members' home both
 *   go through this.
 *
 *   IT NEVER FETCHES A BLOCK'S DATA. Ordering, gating and mounting are all it does; each block owns
 *   its own reads and its own live-update subscription. That is not tidiness, it is the point: the
 *   home used to run eleven requests on every SSE event of any kind, because one listener re-ran the
 *   whole page's load. A block that declares the domains it depends on re-reads when those change
 *   and stays still otherwise.
 *
 *   A BLOCK THAT FAILS TAKES ONLY ITSELF DOWN. Every block is mounted inside a boundary: one that
 *   throws renders nothing and is recorded, and the rest of the page is untouched. On a page people
 *   land on, one broken part must never be the whole screen.
 *
 *   COMPONENTS ARE MEMOISED AT MODULE LEVEL. A component value created during render is a NEW type
 *   every pass, so Preact unmounts and remounts the subtree on every live-update tick — the hazard
 *   already documented in views/home/settings-dialog.js. The resolved component for an id is cached
 *   here and handed back by identity.
 * @structure SurfaceRenderer · useSurfaceLayout · BlockBoundary · Block (the waiting slot)
 * @usage
 *   const { layout, freeform, ready } = useSurfaceLayout('home');
 *   html`<${SurfaceRenderer} surface="home" layout=${layout} freeform=${freeform} ctx=${ctx} placeholders=${true} />`
 * @version-history
 *   2026-11-09: `placeholders` (the home): while a block's code or data is on its way, its place shows
 *     its heading and the loading line at the height it last had in this browser, and drops it when
 *     the block draws, when every shared read has answered with the block still empty, or after 8 s.
 *     Without the prop nothing changes (the front page).
 *   2026-10-31: useSurfaceLayout() returns the answer's `source` (default or stored), so the front
 *     page of a store-sold node can tell an owner's own layout from the built-in one (v27 P3).
 *   2026-10-25: A group's named heading carries a question mark when the locale explains it
 *     (helpTermOf: `x.title` is explained under `explain.x.*`).
 *   2026-10-16: The layout read's `freeform_provenance` reaches each block as `provenance` (state
 *     `freeformProvenance`), so a passage shows the AI label it owes.
 *   2026-09-23: Composed from the shared parts in css/parts.css and css/parts-steps.css (class names by role, values moved from views/home.css unchanged; UI consolidation slice 1).
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { h, Component } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { BLOCKS } from '/views/surface/block-map.js';
import { onSharedIdle, sharedReadsInFlight } from '/views/surface/shared-read.js';
import { Band } from '/components/Band.js';
import { Note } from '/components/Note.js';
import { HelpTip } from '/components/HelpTip.js';
import { explainOf } from '/components/ExplainDialog.js';

/** Resolved components, by block id. Identity has to be stable across renders. */
const resolved = new Map();
/** Ids already being loaded, so a page with the same block twice does not import it twice. */
const loading = new Map();

/**
 * Read a surface's layout. Returns the built-in one the server resolved when nothing is configured,
 * so a caller never has to decide what an unconfigured node looks like.
 */
export function useSurfaceLayout(surface) {
  const [state, setState] = useState({ layout: null, freeform: {}, freeformProvenance: {}, source: null, ready: false, failed: false });

  const load = useCallback(async () => {
    try {
      const r = await apiGet(`/v1/site/layout/${encodeURIComponent(surface)}`);
      setState({
        layout: r?.data?.layout ?? null,
        freeform: r?.data?.freeform ?? {},
        // Each passage's record, keyed like `freeform`: the AI label a passage owes.
        freeformProvenance: r?.data?.freeform_provenance ?? {},
        // 'default' when nobody has saved a layout for this surface, 'stored' when someone has: the
        // front page of a store-sold node shows the owner's start page only in the first case.
        source: r?.data?.source ?? null,
        ready: true,
        failed: false,
      });
    } catch (err) {
      // The caller falls back to its own built-in tree. Recorded rather than swallowed: a layout
      // that silently never loads looks exactly like a node nobody has configured.
      swallowed(`surface: layout ${surface}`, err);
      setState({ layout: null, freeform: {}, freeformProvenance: {}, source: null, ready: true, failed: true });
    }
  }, [surface]);

  useEffect(() => { load(); }, [load]);
  // The layout itself changes only when an operator saves one.
  useEffect(() => onLiveUpdate(['site'], load), [load]);

  return state;
}

/** One block's blast radius. It renders nothing when it fails, and says so once in the log. */
class BlockBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err) {
    swallowed(`surface block: ${this.props.blockId}`, err);
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

/** Load a block's component once and hand back the same value every time after. */
function componentFor(id, onReady) {
  if (resolved.has(id)) return resolved.get(id);
  if (!loading.has(id)) {
    const loader = BLOCKS[id];
    if (!loader) {
      // An id the browser has no component for. The server refuses to STORE one, so reaching this
      // means the two sides disagree — which is what pnpm check:surface-blocks exists to prevent.
      swallowed('surface: unknown block', new Error(`no component for block "${id}"`));
      resolved.set(id, null);
      return null;
    }
    loading.set(id, loader()
      .then((mod) => { resolved.set(id, mod ?? null); })
      .catch((err) => { swallowed(`surface: loading ${id}`, err); resolved.set(id, null); }));
  }
  loading.get(id).then(onReady);
  return undefined;   // still loading
}

/**
 * A block's heading. The operator's own words win; otherwise a named heading this node already has
 * in every language it speaks; otherwise nothing. That order is what lets the built-in layout carry
 * a localized band title without freezing it into English.
 */
function titleOf(block, locale) {
  const own = block?.titles;
  if (own && typeof own === 'object') {
    const mine = own[locale] || own[locale?.split('-')[0]] || own.en;
    if (mine) return mine;
  }
  const key = block?.props?.titleKey;
  if (typeof key === 'string' && key) {
    const words = t(key);
    if (words && words !== key) return words;
  }
  return '';
}

/**
 * The explanation behind a group's named heading: `home.playbooks.title` is explained under
 * `explain.home.playbooks.*`. A heading the operator wrote, or a named one with no explanation in
 * this language, gets no question mark, because the dialog would have nothing true to say about it.
 */
function helpTermOf(block) {
  const key = block?.props?.titleKey;
  if (typeof key !== 'string' || !key.endsWith('.title') || block?.titles) return null;
  const term = key.slice(0, -'.title'.length);
  return explainOf(term, 'short') ? term : null;
}

/* ── The waiting slot (`placeholders`, the home) ──────────────────────────────────────────────
 * While a block's code or data is on its way, its place shows the block's heading and the loading
 * line, at the height the block had when it last drew something in this browser, so the page does
 * not jump when the data arrives (Jouni, 2026-11-09: "Heading + loading line"). The wrappers draw no
 * box (css/components/surface-slot.css), so a block that has arrived lays out as it did without them.
 * The heights are a per-browser convenience in localStorage: without them a slot waits at the
 * height of its heading and line. */
const HEIGHTS_KEY = 'aimeat.surface.blockHeights';
/** How long a slot waits at most for a block that never draws, in ms. */
const WAIT_CAP_MS = 8000;
let heights = null;

function heightsMap() {
  if (heights) return heights;
  try {
    heights = JSON.parse(localStorage.getItem(HEIGHTS_KEY) || '{}') || {};
  } catch (err) {
    swallowed('surface: block heights', err);   // storage refused or unreadable: slots wait at their own height
    heights = {};
  }
  return heights;
}

/** What a block's slot remembers: its height, and its heading in the language it was drawn in. */
function rememberedOf(key) {
  const v = heightsMap()[key];
  return v && typeof v === 'object' ? v : { h: 0, t: '', l: '' };
}

function rememberBlock(key, px, title, locale) {
  const map = heightsMap();
  const height = Math.round(px);
  const was = rememberedOf(key);
  if (!height || (Math.abs(was.h - height) < 8 && was.t === title && was.l === locale)) return;
  map[key] = { h: height, t: title, l: locale };
  try { localStorage.setItem(HEIGHTS_KEY, JSON.stringify(map)); } catch (err) { swallowed('surface: remember block height', err); }
}

/** The drawn height of a wrapper that has no box: its first child's top to its last child's bottom. */
function drawnHeight(el) {
  const kids = el.children;
  if (!kids.length) return 0;
  return kids[kids.length - 1].getBoundingClientRect().bottom - kids[0].getBoundingClientRect().top;
}

/** A block's own heading as it drew it: the words of its first section title, without a question mark. */
function drawnTitle(el) {
  const heading = el.querySelector('h2, h3');
  if (!heading) return '';
  return [...heading.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
}

function Block({ block, ctx, freeform, freeformProvenance, locale, placeholders = false }) {
  const [, bump] = useState(0);
  const Cmp = componentFor(block.id, () => bump(n => n + 1));
  const content = useRef(null);
  const [waiting, setWaiting] = useState(() => placeholders && rememberedOf(block.key).h > 0);

  // The block drew something: it waits no more, and its height and heading are kept for the next visit.
  useEffect(() => {
    const el = content.current;
    if (!placeholders || !el) return undefined;
    const check = () => {
      if (el.children.length === 0) return;
      setWaiting(false);
      rememberBlock(block.key, drawnHeight(el), drawnTitle(el), locale);
    };
    check();
    const watch = new MutationObserver(check);
    watch.observe(el, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [placeholders, block.key, locale]);

  // Every shared read has answered and the block still drew nothing: it draws nothing on purpose
  // this time (no conversation waiting, say), so its loading line goes. A cap ends any other wait.
  const loaded = Cmp !== undefined;
  useEffect(() => {
    if (!waiting) return undefined;
    let timer;
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (sharedReadsInFlight() === 0 && content.current && content.current.children.length === 0) setWaiting(false);
      }, 150);
    };
    const off = onSharedIdle(settle);
    if (loaded) settle();
    const cap = setTimeout(() => setWaiting(false), WAIT_CAP_MS);
    return () => { off(); clearTimeout(timer); clearTimeout(cap); };
  }, [waiting, loaded]);

  const drawn = Cmp ? html`
    <${BlockBoundary} blockId=${block.id}>
      <${Cmp}
        ctx=${ctx}
        props=${block.props ?? {}}
        title=${titleOf(block, locale)}
        text=${freeform?.[block.key] ?? ''}
        provenance=${freeformProvenance?.[block.key] ?? null}
        blockKey=${block.key} />
    <//>` : null;   // undefined: still loading, the block appears when it arrives; null: nothing to render it with
  if (!placeholders) return drawn;

  // The layout's own heading for the block when it has one, else the heading the block drew last time
  // in this language.
  const kept = rememberedOf(block.key);
  const title = titleOf(block, locale) || (kept.l === locale ? kept.t : '');
  const keepHeight = (el) => { if (el) el.style.minHeight = `${kept.h}px`; };
  return html`
    <div class="surface-slot">
      ${waiting && html`<div class="surface-slot-wait" ref=${keepHeight}>
        ${title ? html`<${Band} tight=${true} title=${title}><${Note} kind="loading" /><//>` : html`<${Note} kind="loading" />`}
      </div>`}
      <div class="surface-slot-content" ref=${content}>${drawn}</div>
    </div>`;
}

/**
 * Render one surface from its layout.
 *
 * `ctx` is the only surface-specific input — what a block needs that it cannot fetch for itself,
 * such as the router's navigate. A block that needs data goes and gets it.
 */
export function SurfaceRenderer({ layout, ctx = {}, freeform = {}, freeformProvenance = {}, locale = 'en', placeholders = false }) {
  const blocks = Array.isArray(layout?.blocks) ? layout.blocks : [];
  if (blocks.length === 0) return null;

  return html`${blocks.filter(b => !b.hidden).map(block => {
    if (Array.isArray(block.children)) {
      const kids = block.children.filter(c => !c.hidden);
      const heading = titleOf(block, locale);
      const term = helpTermOf(block);
      return html`
        <${Band} tight=${true} title=${heading && term ? html`${heading} <${HelpTip} term=${term} label=${heading} />` : heading} key=${block.key}>
          ${kids.map(child => html`<${Block} key=${child.key} block=${child} ctx=${ctx} freeform=${freeform} freeformProvenance=${freeformProvenance} locale=${locale} placeholders=${placeholders} />`)}
        <//>`;
    }
    return html`<${Block} key=${block.key} block=${block} ctx=${ctx} freeform=${freeform} freeformProvenance=${freeformProvenance} locale=${locale} placeholders=${placeholders} />`;
  })}`;
}

export default SurfaceRenderer;
