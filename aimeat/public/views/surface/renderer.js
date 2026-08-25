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
 * @structure SurfaceRenderer · useSurfaceLayout · BlockBoundary
 * @usage
 *   const { layout, freeform, ready } = useSurfaceLayout('home');
 *   html`<${SurfaceRenderer} surface="home" layout=${layout} freeform=${freeform} ctx=${ctx} />`
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { h, Component } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { BLOCKS } from '/views/surface/block-map.js';

/** Resolved components, by block id. Identity has to be stable across renders. */
const resolved = new Map();
/** Ids already being loaded, so a page with the same block twice does not import it twice. */
const loading = new Map();

/**
 * Read a surface's layout. Returns the built-in one the server resolved when nothing is configured,
 * so a caller never has to decide what an unconfigured node looks like.
 */
export function useSurfaceLayout(surface) {
  const [state, setState] = useState({ layout: null, freeform: {}, ready: false, failed: false });

  const load = useCallback(async () => {
    try {
      const r = await apiGet(`/v1/site/layout/${encodeURIComponent(surface)}`);
      setState({
        layout: r?.data?.layout ?? null,
        freeform: r?.data?.freeform ?? {},
        ready: true,
        failed: false,
      });
    } catch (err) {
      // The caller falls back to its own built-in tree. Recorded rather than swallowed: a layout
      // that silently never loads looks exactly like a node nobody has configured.
      swallowed(`surface: layout ${surface}`, err);
      setState({ layout: null, freeform: {}, ready: true, failed: true });
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

function Block({ block, ctx, freeform, locale }) {
  const [, bump] = useState(0);
  const Cmp = componentFor(block.id, () => bump(n => n + 1));
  if (Cmp === undefined) return null;    // still loading; the block appears when it arrives
  if (Cmp === null) return null;         // nothing to render it with
  return html`
    <${BlockBoundary} blockId=${block.id}>
      <${Cmp}
        ctx=${ctx}
        props=${block.props ?? {}}
        title=${titleOf(block, locale)}
        text=${freeform?.[block.key] ?? ''}
        blockKey=${block.key} />
    <//>`;
}

/**
 * Render one surface from its layout.
 *
 * `ctx` is the only surface-specific input — what a block needs that it cannot fetch for itself,
 * such as the router's navigate. A block that needs data goes and gets it.
 */
export function SurfaceRenderer({ layout, ctx = {}, freeform = {}, locale = 'en' }) {
  const blocks = Array.isArray(layout?.blocks) ? layout.blocks : [];
  if (blocks.length === 0) return null;

  return html`${blocks.filter(b => !b.hidden).map(block => {
    if (Array.isArray(block.children)) {
      const kids = block.children.filter(c => !c.hidden);
      const heading = titleOf(block, locale);
      return html`
        <section class="sf-band" key=${block.key}>
          ${heading ? html`<h2 class="sf-band-title">${heading}</h2>` : ''}
          ${kids.map(child => html`<${Block} key=${child.key} block=${child} ctx=${ctx} freeform=${freeform} locale=${locale} />`)}
        </section>`;
    }
    return html`<${Block} key=${block.key} block=${block} ctx=${ctx} freeform=${freeform} locale=${locale} />`;
  })}`;
}

export default SurfaceRenderer;
