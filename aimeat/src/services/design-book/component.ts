/**
 * @file src/services/design-book/component.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ninth kind of Design Book part: a COMPONENT, a piece of page an AI builder made
 *   by hand because the Book had nothing for it, offered to the next builder.
 *
 *   WHY IT EXISTS. Measured 2026-09-20: three builders of one app each made the same tickable
 *   week grid by hand, each writing that "the Book's grids are read-only", and a fourth build made
 *   three flute components. None of it could go into the Book, because every kind the Book had
 *   was an arrangement of the kit's own blocks or a sheet of tokens. The developer's ruling the
 *   same day: no person makes anything here; the Book grows from apps that turned out well.
 *
 *   WHAT A COMPONENT IS: markup and a stylesheet, and NO SCRIPT. It gives the structure and the
 *   look; the app that takes it wires the behaviour, the way an app wires its own `section`. That
 *   is a security decision before it is a design one: a part's preview is served from the node's
 *   own origin, so a part that carried script would be anybody's code running as this node. For
 *   the same reason the markup is read against an ALLOWLIST of elements and attributes, and the
 *   stylesheet may not load anything, reach outside its own prefix, or fix itself over the page.
 *
 *   IT WEARS WHATEVER PAGE IT LANDS IN. Every colour is a `var(--ak-…)` token, never a literal,
 *   so inside a genre it takes the genre's ground, ink and accent through the genre's bridge, and
 *   in a plain Atelier page it takes the look's. A literal colour is refused with the tokens named.
 *
 *   THE BUILDER SAYS WHETHER IT IS WORTH HAVING. `judgement.reach` is "general" (another kind of
 *   app would use this) or "special" (it is this app's own), with the reason in a sentence. The
 *   bench can prove a component renders and cannot prove anybody else wants it: a flute fingering
 *   chart passes every check and belongs to one app. Only a general one is published on its own
 *   (service.ts); a special one stays proposed, listed and usable by whoever made it.
 * @structure COMPONENT_LIMITS · validateComponentBody(raw) · componentPreviewHtml(body) · componentSnippet(body)
 * @usage const body = validateComponentBody(raw);
 * @version-history
 *   v1.1.0 — 2026-09-20 — The markup and the stylesheet are read with an index, one character at a
 *     time (component-scan.ts), and no longer with patterns over the whole text. Three of those
 *     were quadratic on text that opens and never closes (CodeQL js/polynomial-redos, alerts 1646
 *     to 1648, the day this shipped). Found while replacing them, and worse: the tag pattern ended
 *     a tag at the first ">" of any kind, so `<div title="x>" onclick="…">` was read as a harmless
 *     tag and some text while a browser saw the handler. A tag now ends where a browser ends it,
 *     and an attribute the two could read differently is refused.
 *   v1.0.0 — 2026-09-20 — Initial.
 */
import { DesignBookError } from './errors.js';
import { attributesOf, declarationsOf, selectorsOf, tagsOf, withoutComments, withoutVarFallbacks } from './component-scan.js';

export const COMPONENT_LIMITS = { html: 12_000, css: 12_000, use: 600, why: 400, whyMin: 20 } as const;

export interface ComponentBody {
  /** The class prefix every rule and every class in the markup carries, so it cannot collide. */
  prefix: string;
  html: string;
  css: string;
  /** How an app mounts it: which element it fills, which `data-` hooks it reads, what to wire. */
  use: string;
  judgement: { reach: 'general' | 'special'; why: string };
  /** The app it came out of, when its proposer says (the owner's own published filename). */
  from_app?: string;
}

const PREFIX_RE = /^[a-z][a-z0-9]{1,11}$/;

const ELEMENTS = new Set([
  'div', 'span', 'section', 'article', 'header', 'footer', 'nav', 'aside', 'main', 'figure', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'strong', 'em', 'small', 'b', 'i', 'u', 's', 'sub', 'sup',
  'br', 'hr', 'time', 'abbr', 'code', 'kbd', 'pre', 'blockquote', 'q', 'mark', 'label', 'button', 'input', 'select', 'option',
  'textarea', 'output', 'progress', 'meter', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'details', 'summary', 'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs',
  'lineargradient', 'radialgradient', 'stop', 'title', 'desc',
]);

const ATTRIBUTES = new Set([
  'class', 'id', 'role', 'type', 'name', 'value', 'placeholder', 'for', 'title', 'lang', 'dir', 'hidden', 'disabled', 'checked',
  'selected', 'readonly', 'required', 'min', 'max', 'step', 'rows', 'cols', 'colspan', 'rowspan', 'scope', 'tabindex', 'datetime',
  'open', 'width', 'height', 'viewbox', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'fill',
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'transform', 'offset', 'stop-color',
  'stop-opacity', 'opacity', 'text-anchor', 'dominant-baseline', 'preserveaspectratio', 'xmlns', 'focusable', 'autocomplete', 'inputmode',
]);

const refuse = (message: string): never => { throw new DesignBookError('BODY_INVALID', message, 422); };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function checkMarkup(html: string, prefix: string): void {
  if (html.includes('<!--')) refuse('A component\'s markup carries no comments: say what it is in `use`.');
  // Read with an index and never with a pattern over the whole text (component-scan.ts says why).
  const { tags, unclosed } = tagsOf(html);
  if (unclosed) refuse('A component\'s markup has a "<" that never meets its ">". Every tag is closed, and a "<" in text is written &lt;.');
  for (const tag of tags) {
    const name = tag.name;
    if (!ELEMENTS.has(name)) {
      refuse(`A component's markup may not carry <${name}>. It is structure and nothing else: no script, style, link, iframe, object, embed, form, img, video, audio or anchor. `
        + 'A picture or a link is the app\'s to add, where it knows the address.');
    }
    if (tag.closing) continue;
    for (const { key, value, odd } of attributesOf(tag.attrs)) {
      if (odd) {
        refuse(`On <${name}>, the attribute "${key.slice(0, 40)}" carries a quote or an angle bracket where a browser and this bench could read the tag differently. `
          + 'Write every value in double quotes, with no quote, "<" or ">" inside it.');
      }
      if (!(ATTRIBUTES.has(key) || key.startsWith('data-') || key.startsWith('aria-'))) {
        refuse(`A component's markup may not carry the attribute "${key}" on <${name}>. Allowed: class, id, role, data-*, aria-*, the form and table attributes, and the SVG drawing attributes. `
          + 'An event handler is the app\'s to wire, in its own script.');
      }
      // A browser drops whitespace and control characters inside a scheme, so they go first.
      // eslint-disable-next-line no-control-regex -- control characters are exactly what is being removed
      const address = value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
      if (address.startsWith('javascript:') || address.startsWith('data:') || address.startsWith('vbscript:') || address.includes('url(')) {
        refuse(`The attribute "${key}" on <${name}> may not carry an address.`);
      }
      if (key === 'class') {
        for (const cls of value.split(/\s+/).filter(Boolean)) {
          if (cls !== prefix && !cls.startsWith(prefix + '-')) {
            refuse(`Every class in a component's markup starts with its prefix, "${prefix}" or "${prefix}-…", so it cannot collide with the page it lands in: "${cls}" does not. `
              + 'The kit\'s own classes (ak-) are the kit\'s: a component that needs a kit block asks the app to mount one beside it.');
          }
        }
      }
    }
  }
}

function checkStyles(raw: string, prefix: string): void {
  // Comments go first, by index, so nothing below can be hidden inside one or split by one.
  const css = withoutComments(raw);
  if (/@import|@font-face|@namespace/i.test(css)) refuse('A component\'s stylesheet loads nothing: no @import, @font-face or @namespace. The type comes from the page it lands in (var(--ak-font)).');
  // Whitespace is taken out once, so "url (" and "position : fixed" are found by plain inclusion.
  const dense = css.replace(/\s/g, '').toLowerCase();
  if (dense.includes('url(')) refuse('A component\'s stylesheet carries no url(): it loads nothing, and a picture is the app\'s to add.');
  if (dense.includes('expression(') || dense.includes('behavior:') || dense.includes('-moz-binding')) refuse('A component\'s stylesheet carries no expression(), behavior or binding.');
  if (dense.includes('!important')) refuse('A component\'s stylesheet carries no !important: it lands inside somebody else\'s page and must lose to it where they disagree.');
  if (dense.includes('position:fixed') || dense.includes('position:sticky')) refuse('A component stays where the app puts it: no position: fixed or sticky.');
  // One declaration at a time: a pattern spanning "animation … infinite" over the whole sheet restarts at every "animation".
  if (declarationsOf(css).some(d => { const l = d.toLowerCase(); return l.trimStart().startsWith('animation') && /\binfinite\b/.test(l); })) {
    refuse('A component does not move at idle: no infinite animation. An entrance that ends is fine, and the ambient is the one layer allowed to keep moving.');
  }
  // A literal colour cannot follow the page it lands in. Inside var(--ak-x, #fallback) it is a fallback, which is fine.
  const bare = withoutVarFallbacks(css);
  const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\s*\(/.exec(bare);
  if (literal) {
    refuse(`A component's colours are the page's tokens, never a literal ("${literal[0]}"): it has to wear whatever page it lands in, a Swiss poster or a night board. `
      + 'Use var(--ak-bg), --ak-surface, --ak-surface-2, --ak-ink, --ak-ink-dim, --ak-line, --ak-accent, --ak-accent-ink, --ak-ok, --ak-warn, --ak-err, and color-mix() of those. '
      + 'A genre hands the kit its own values through its bridge, so these are already the genre\'s.');
  }
  if (!/var\(\s*--ak-/.test(css)) refuse('A component\'s stylesheet reads the page\'s tokens (var(--ak-…)) at least once: one that reads none cannot follow a look, a theme or a genre.');
  // Every rule is about the component's own classes. Selectors are read between rule boundaries.
  for (const selector of selectorsOf(css).flatMap(s => s.split(',')).map(s => s.trim()).filter(Boolean)) {
    const first = /^[.]([a-zA-Z][\w-]*)/.exec(selector)?.[1];
    if (!first || (first !== prefix && !first.startsWith(prefix + '-'))) {
      refuse(`Every rule in a component's stylesheet starts at one of its own classes (".${prefix}" or ".${prefix}-…"): "${selector.slice(0, 60)}" does not, so it would restyle the page it lands in.`);
    }
  }
}

export function validateComponentBody(raw: unknown): ComponentBody {
  const o = (raw ?? {}) as Record<string, unknown>;
  const prefix = str(o.prefix).trim();
  if (!PREFIX_RE.test(prefix)) refuse('A component names its class prefix: 2-12 lowercase letters and digits, starting with a letter, like "wkgrid". Every class it uses starts with it.');
  if (prefix === 'ak' || prefix === 'aimeat') refuse(`"${prefix}" is the kit's prefix. Choose one of the component's own.`);

  const html = str(o.html).trim();
  const css = str(o.css).trim();
  if (!html || html.length > COMPONENT_LIMITS.html) refuse(`A component carries its markup in \`html\`, up to ${COMPONENT_LIMITS.html} characters.`);
  if (!css || css.length > COMPONENT_LIMITS.css) refuse(`A component carries its stylesheet in \`css\`, up to ${COMPONENT_LIMITS.css} characters.`);
  checkMarkup(html, prefix);
  checkStyles(css, prefix);

  const use = str(o.use).replace(/\s+/g, ' ').trim();
  if (use.length < 20 || use.length > COMPONENT_LIMITS.use) {
    refuse(`A component says how an app uses it, in \`use\` (20-${COMPONENT_LIMITS.use} characters): what it fills, which data- hooks carry the values, and what the app wires itself, since a component carries no script.`);
  }

  const j = (o.judgement ?? {}) as Record<string, unknown>;
  const reach = str(j.reach);
  const why = str(j.why).replace(/\s+/g, ' ').trim();
  if (reach !== 'general' && reach !== 'special') {
    refuse('A component carries YOUR judgement of it: judgement.reach is "general" (another kind of app would use this) or "special" (it belongs to this one app). '
      + 'Be honest: a special one is still kept and listed, and a general one that nobody else wants clutters the shelf every builder reads.');
  }
  if (why.length < COMPONENT_LIMITS.whyMin || why.length > COMPONENT_LIMITS.why) {
    refuse(`judgement.why says in a sentence (${COMPONENT_LIMITS.whyMin}-${COMPONENT_LIMITS.why} characters) which other apps would use this, or why none would.`);
  }

  const fromApp = str(o.from_app).trim();
  if (fromApp && !/^[\w.-]{1,120}$/.test(fromApp)) refuse('from_app is the filename of one of your own published apps, like "habits.html".');
  return { prefix, html, css, use, judgement: { reach: reach as 'general' | 'special', why }, ...(fromApp ? { from_app: fromApp } : {}) };
}

/** What an app gets when it takes the component: the two texts to paste, and how to wire it. */
export function componentSnippet(body: ComponentBody): { html: string; css: string; use: string; prefix: string } {
  return { html: body.html, css: body.css, use: body.use, prefix: body.prefix };
}

/**
 * The component as a page: the kit's stylesheet for the tokens, the component's own, its markup
 * on the page ground and again on a surface, so it is seen where an app would put it. No script.
 */
export function componentPreviewHtml(body: ComponentBody): string {
  return [
    '<!DOCTYPE html><html lang="en" data-theme="light"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<link rel="stylesheet" href="/lib/aimeat-atelier.css">',
    '<style>body { margin: 0; background: var(--ak-bg); color: var(--ak-ink); font-family: var(--ak-font); }',
    '.dbc-stage { max-width: 960px; margin: 0 auto; padding: 24px 16px; display: grid; gap: 24px; }',
    '.dbc-surface { background: var(--ak-surface); border: var(--ak-line-w, 1px) solid var(--ak-line); border-radius: var(--ak-radius); padding: 16px; }',
    '</style>',
    `<style>${body.css.replace(/<\//g, '<\\/')}</style>`,
    '</head><body class="ak-root"><div class="dbc-stage">',
    `<div>${body.html}</div>`,
    `<div class="dbc-surface">${body.html}</div>`,
    '</div></body></html>',
  ].join('\n');
}
