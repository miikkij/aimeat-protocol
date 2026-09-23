/**
 * @file parts-html.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The site's one component set (public/components/poster-parts.js), as HTML strings for
 *   the app catalog, which builds its screens from strings rather than from Preact. Each function
 *   emits exactly the classes and data attributes its namesake in poster-parts.js does, so the rules
 *   in public/css/parts.css and public/css/poster.css (inlined by scripts/build-app-catalog.ts) draw
 *   the catalog the way they draw every other page, and a theme or a part changes in one place.
 *
 *   CONTENT IS TRUSTED HTML. Every text argument is inserted as it is: the caller escapes what a
 *   person or an app wrote (escapeHtml from util.js) before handing it in. Attribute values that come
 *   from data (ids, titles, labels) are escaped here. `onclick` arguments are inline handler strings,
 *   as everywhere else in the catalog; the caller builds them with jsArg().
 *
 *   A PAGE PASSES CONTENT AND NAMED VARIANTS, NEVER CSS. No function takes a class or a style. When
 *   a screen needs something no part carries, the lead adds it to poster-parts.js, parts.css and
 *   here together; a view never writes its own rule.
 * @structure section · sectionSlot · fold · listRow · chip · action · keyValue · numeralBand · stack · columns ·
 *   surface · text · field · toolbar · table · crumbs · masthead · steps · checkItem · meter · statRow
 * @usage import { section, listRow, action } from './parts-html.js';
 * @version-history
 *   v1.0.0 — 2026-09-22 — Initial: the catalog composes from the shared set.
 */
import { escapeHtml } from './util.js';

var pick = function (value, choices, fallback) { return choices.indexOf(value) >= 0 ? value : fallback; };
var density = function (v) { return pick(v, ['compact', 'normal', 'roomy'], 'normal'); };
/** One attribute, escaped; nothing when the value is empty. */
var attr = function (name, value) {
  return value === undefined || value === null || value === false || value === '' ? '' : ' ' + name + '="' + escapeHtml(String(value)) + '"';
};
/** An inline handler: already built by the caller with jsArg(), so it is not escaped a second time. */
var handler = function (code) { return code ? ' onclick="' + String(code).replace(/"/g, '&quot;') + '"' : ''; };
var has = function (v) { return v !== undefined && v !== null && v !== '' && v !== false; };

/**
 * A section: the B1 slab (title, a `count` after it), the section's `actions` on the same row, a
 * `description` under it, and the `body`. `selected` puts the body on the sun edge.
 */
export function section(o) {
  var head = (o.title || o.actions) ? '<div class="poster-section-head">' +
      (o.title ? '<h2 class="poster-section-title">' + o.title + (has(o.count) ? '<small>' + o.count + '</small>' : '') + '</h2>' : '') +
      (o.actions ? '<div class="poster-actions">' + o.actions + '</div>' : '') +
    '</div>' : '';
  return '<section class="poster-section poster-section-part" data-density="' + density(o.density) + '" data-size="' +
      pick(o.size, ['small', 'normal', 'large'], 'normal') + '"' + attr('id', o.id) + '>' + head +
    (o.description ? '<p class="poster-section-description">' + o.description + '</p>' : '') +
    '<div class="' + (o.selected ? 'poster-panel poster-section-body' : 'poster-section-body') + '">' + (o.body || '') + '</div>' +
  '</section>';
}

/**
 * A wrapper that holds one section: a mount point a script fills later, or a slot with an id. The
 * section inside keeps the gap to the section before it. `attrs` is extra attribute text the caller
 * built (a data- hook), never a class or a style.
 */
export function sectionSlot(o, content) {
  return '<div data-section-slot' + attr('id', o.id) + (o.attrs || '') + '>' + (content || '') + '</div>';
}

/** A folded row that opens in place: `number`, `title`, a quiet `sub`, the arrow; `onToggle` is its handler. */
export function fold(o) {
  return '<section class="poster-fold" data-open="' + (o.open ? 'yes' : 'no') + '"' + attr('id', o.id) + '>' +
    '<div class="poster-fold-row">' +
      '<button type="button" class="poster-fold-toggle" aria-expanded="' + (o.open ? 'true' : 'false') + '"' + handler(o.onToggle) + attr('title', o.toggleTitle) + '>' +
        (has(o.number) ? '<span class="poster-list-number">' + o.number + '</span>' : '') +
        '<span class="poster-fold-title">' + o.title + '</span>' +
        (o.sub ? '<span class="poster-fold-sub">' + o.sub + '</span>' : '') +
        '<span class="poster-fold-arrow" aria-hidden="true">' + (o.open ? '↓' : '→') + '</span>' +
      '</button>' +
      (o.actions ? '<div class="poster-actions">' + o.actions + '</div>' : '') +
    '</div>' +
    (o.open ? '<div class="poster-fold-body">' + (o.body || '') + '</div>' : '') +
  '</section>';
}

/**
 * The roster row. `mark` (an icon), `name`, `detail` (mono; `detailKind:'text'` for a sentence),
 * `value` at the right, `actions`, `body` under it. `onOpen` or `href` makes the name the door.
 * An index row passes `number` and `arrow`; a timeline row `time` and a `marker` tone.
 * `selected` is the sun fill, `open` the arrow down without it, `muted` a row that is done.
 */
export function listRow(o) {
  var lead = has(o.time) || o.marker || has(o.number);
  var face = o.preview ? 'text' : pick(o.detailKind, ['mono', 'text'], 'mono');
  var name = (o.href || o.onOpen)
    ? action({ kind: 'text', href: o.href, onclick: o.onOpen, expanded: o.open === undefined ? undefined : !!o.open, target: o.external ? '_blank' : undefined, label: o.label }, o.name)
    : '<strong>' + o.name + '</strong>';
  var markHtml = lead ? '<div class="poster-list-mark poster-list-lead">' +
      (has(o.number) ? '<span class="poster-list-number">' + o.number + '</span>' : '') +
      (has(o.time) ? '<span class="poster-list-time"' + attr('title', o.timeTitle) + '>' + o.time + '</span>' : '') +
      (o.marker ? '<span class="poster-list-marker" data-tone="' + pick(o.marker, ['coral', 'sun', 'success', 'danger', 'info', 'muted'], 'muted') + '"' + (o.live ? ' data-live="yes"' : '') + ' aria-hidden="true"></span>' : '') +
    '</div>' : (o.mark ? '<div class="poster-list-mark">' + o.mark + '</div>' : '');
  return '<article class="poster-list-row" data-kind="' + pick(o.kind, ['normal', 'chronology'], 'normal') + '" data-density="' + density(o.density) +
      '" data-selected="' + (o.selected ? 'yes' : 'no') + '"' + (o.preview ? ' data-preview="yes"' : '') + ' data-detail="' + face + '"' +
      (o.muted ? ' data-muted="yes"' : '') + (o.nameKind === 'mono' ? ' data-name="mono"' : '') + attr('id', o.id) + (o.rowAttrs || '') + '>' +
    markHtml +
    '<div class="poster-list-name"' + attr('title', o.nameTitle) + '>' + name + (o.detail ? '<small>' + o.detail + '</small>' : '') + '</div>' +
    (has(o.value) ? '<div class="poster-list-value">' + o.value + '</div>' : '') +
    (o.actions ? '<div class="poster-list-actions">' + o.actions + '</div>' : '') +
    (o.arrow ? '<span class="poster-list-arrow" aria-hidden="true">' + ((o.open === undefined ? o.selected : o.open) ? '↓' : '→') + '</span>' : '') +
    (o.body ? '<div class="poster-list-body">' + o.body + '</div>' : '') +
  '</article>';
}

/** A square mono chip: tone plain, sun, coral, success, danger or muted. */
export function chip(content, tone, title) {
  return '<span class="poster-chip" data-tone="' + pick(tone, ['plain', 'sun', 'coral', 'success', 'danger', 'muted'], 'plain') + '"' + attr('title', title) + '>' + content + '</span>';
}

/**
 * An action. o.kind: primary (the one loud slab), secondary (an underlined word), tab, text (a word
 * inside a row), icon (a square with an SVG), choice (a boxed answer; o.title in bold). o.tone:
 * danger | success on a word, danger on a primary. o.size 'large' on a primary. `onclick` is the
 * inline handler; `href` makes it a link. o.attrs is extra attribute text the caller built and
 * escaped (an id, data-i18n), never a class or a style.
 */
export function action(o, content) {
  var role = pick(o.kind, ['primary', 'secondary', 'tab', 'text', 'icon', 'choice'], 'secondary');
  var cls = role === 'primary' ? 'poster-slab' + (o.size === 'large' ? ' poster-slab--large' : '')
    : role === 'choice' ? 'poster-choice' + (o.selected ? ' on' : '')
    : role === 'tab' ? 'poster-tab' + (o.selected ? ' is-on' : '')
    : role === 'text' ? 'poster-text-action' : role === 'icon' ? 'poster-icon-action' : 'poster-action';
  var tones = role === 'primary' ? ['plain', 'danger'] : (role === 'secondary' || role === 'text') ? ['plain', 'danger', 'success'] : role === 'tab' ? ['plain', 'coral'] : ['plain'];
  var common = ' class="' + cls + '" data-tone="' + pick(o.tone, tones, 'plain') + '"' + handler(o.onclick) + attr('aria-label', o.label) + attr('title', o.title && role !== 'choice' ? o.title : o.hint) +
    (o.expanded === undefined ? '' : ' aria-expanded="' + (o.expanded ? 'true' : 'false') + '"') + attr('aria-controls', o.controls) + (o.attrs || '');
  if (o.href && !o.disabled) {
    return '<a' + common + ' href="' + escapeHtml(o.href) + '"' + attr('download', o.download) + attr('target', o.target) +
      (o.target === '_blank' ? ' rel="noopener noreferrer"' : '') + '>' + content + '</a>';
  }
  var sem = pick(o.semantics, ['radio', 'tab', 'switch'], '');
  return '<button' + common + ' type="' + pick(o.type, ['button', 'submit', 'reset'], 'button') + '"' + (o.disabled ? ' disabled' : '') +
    (sem ? ' role="' + sem + '"' : '') +
    (sem === 'radio' || sem === 'switch' ? ' aria-checked="' + (o.selected ? 'true' : 'false') + '"' : '') +
    (sem === 'tab' ? ' aria-selected="' + (o.selected ? 'true' : 'false') + '"' : '') +
    ((role === 'tab' || role === 'icon' || role === 'choice') && !sem ? ' aria-pressed="' + (o.selected ? 'true' : 'false') + '"' : '') + '>' +
    (role === 'choice' && o.title ? '<b>' + o.title + '</b>' : '') + content + '</button>';
}

/** A coral label on the left, the value on the right, a hairline under. */
export function keyValue(label, value, mono) {
  return '<div class="poster-key-value"><div class="kv-row"><span class="kv-label">' + label + '</span><span class="kv-value' + (mono ? ' mono' : '') + '">' + value + '</span></div></div>';
}

/**
 * Big numbers with small labels in one band. items: [{ label, value, note?, onclick?, tone? }].
 * o.tone coral | sun | ink | plain; o.cut 'diagonal' (the coral band with the sun edge); o.size
 * 'small' for counts inside a card; o.lead and o.actions around the numbers.
 */
export function numeralBand(o) {
  var small = o.size === 'small';
  var items = (o.items || []).map(function (it) {
    var v = it.onclick ? action({ kind: 'text', onclick: it.onclick, label: it.labelText }, it.value) : it.value;
    return '<div><dt>' + it.label + (has(it.note) ? '<small>' + it.note + '</small>' : '') + '</dt>' +
      '<dd class="poster-stat-number' + (small ? ' poster-stat-number--small' : '') + '"' + (it.tone === 'coral' || it.tone === 'muted' ? ' data-tone="' + it.tone + '"' : '') + '>' + v + '</dd></div>';
  }).join('');
  return '<section class="poster-numeral-band" data-tone="' + (o.cut === 'diagonal' ? 'coral' : pick(o.tone, ['coral', 'sun', 'ink', 'plain'], 'coral')) +
      '" data-cut="' + pick(o.cut, ['straight', 'diagonal'], 'straight') + '"' + (o.contained ? ' data-contained="yes"' : '') + (small ? ' data-size="small"' : '') + attr('id', o.id) + '>' +
    (o.lead ? '<div class="poster-band-lead">' + o.lead + '</div>' : '') +
    (items ? '<dl>' + items + '</dl>' : '') + (o.body || '') +
    (o.actions ? '<div class="poster-actions">' + o.actions + '</div>' : '') +
  '</section>';
}

/** Vertical content, horizontal controls or a wrapping group; the spacing belongs here. */
export function stack(o, content) {
  return '<div class="poster-stack" data-direction="' + pick(o.direction, ['vertical', 'horizontal', 'wrap'], 'vertical') +
    '" data-align="' + pick(o.align, ['start', 'center', 'end', 'stretch', 'between'], 'stretch') + '" data-density="' + density(o.density) + '"' +
    attr('role', o.role) + attr('id', o.id) + attr('aria-label', o.label) + '>' + content + '</div>';
}

/** Named column ratios (equal, thirds, quarters, leading, trailing) and one of the four breakpoints. */
export function columns(o, content) {
  return '<div class="poster-columns-frame"><div class="poster-columns" data-layout="' + pick(o.layout, ['equal', 'thirds', 'quarters', 'leading', 'trailing'], 'equal') +
    '" data-density="' + density(o.density) + '" data-collapse="' + pick(Number(o.collapse), [560, 600, 640, 900], 640) + '">' + content + '</div></div>';
}

/**
 * A content surface: box, record, aside, code, editor, plain, panel or preview. o.tone (danger makes
 * the solid-framed aside), o.height scroll | tall, o.summary makes it fold (a <details>).
 */
export function surface(o, content) {
  var shapes = { box: 'poster-box', record: 'poster-record', aside: 'poster-aside', code: 'poster-box poster-code', editor: 'poster-box poster-editor', plain: '', panel: 'poster-panel', preview: 'poster-box poster-preview' };
  var kind = pick(o.kind, Object.keys(shapes), 'box');
  var tag = o.summary ? 'details' : 'div';
  return '<' + tag + ' class="' + (kind === 'panel' ? 'poster-panel' : 'poster-surface ' + shapes[kind]) + '" data-density="' + (o.density === 'flush' ? 'flush' : density(o.density)) +
    '" data-tone="' + pick(o.tone, ['plain', 'muted', 'coral', 'sun', 'ink', 'success', 'danger'], 'plain') + '" data-height="' + pick(o.height, ['auto', 'scroll', 'tall'], 'auto') + '"' +
    attr('id', o.id) + attr('role', o.role) + (o.summary && o.open ? ' open' : '') + '>' +
    (o.summary ? '<summary>' + o.summary + '</summary>' : '') + content + '</' + tag + '>';
}

/**
 * Literal copy: kind body, lead, label, mono, caption, heading, number; o.tone plain, muted, coral,
 * sun, info, success, danger; o.size small | large for a number, small for a heading; o.lines keeps
 * typed line breaks.
 */
export function text(o, content) {
  var roles = { body: 'p', lead: 'p', label: 'span', mono: 'span', caption: 'small', heading: 'h3', number: 'span' };
  var kind = pick(o.kind, Object.keys(roles), 'body');
  var shape = { heading: 'poster-record-title', number: 'poster-stat-number', label: 'poster-label' }[kind];
  var size = pick(o.size, ['small', 'normal', 'large'], 'normal');
  var mod = kind === 'number' && size !== 'normal' ? ' poster-stat-number--' + size : (kind === 'heading' && size === 'small' ? ' poster-record-title--small' : '');
  var tag = roles[kind];
  return '<' + tag + ' class="poster-copy ' + (shape || 'poster-text') + mod + '" data-kind="' + kind + '"' + (o.lines ? ' data-lines="yes"' : '') + (o.face === 'mono' ? ' data-face="mono"' : '') +
    ' data-tone="' + pick(o.tone, ['plain', 'muted', 'coral', 'sun', 'info', 'success', 'danger'], 'plain') + '"' + attr('title', o.title) + attr('id', o.id) + '>' + content + '</' + tag + '>';
}

/**
 * A field: label, control, hint. o.type text, email, url, password, search, number, date, checkbox,
 * textarea, select (o.options [{ value, label }]); o.mono writes the value in the mono face (code). o.id is required (the catalog reads fields by id);
 * o.inputAttrs is extra attribute text the caller built (oninput, data-i18n-placeholder), never a
 * class or a style.
 */
export function field(o) {
  var kind = pick(o.type, ['text', 'email', 'url', 'password', 'search', 'number', 'date', 'datetime-local', 'time', 'checkbox', 'textarea', 'select'], 'text');
  var filled = has(o.value);
  var common = ' id="' + escapeHtml(o.id) + '"' + attr('name', o.name) + (o.disabled ? ' disabled' : '') + (o.readOnly ? ' readonly' : '') + (o.required ? ' required' : '') +
    attr('maxlength', o.maxLength) + attr('aria-describedby', o.hint ? o.id + '-hint' : '') + (o.inputAttrs || '');
  var control = kind === 'textarea' ? '<textarea' + common + attr('rows', o.rows || 5) + attr('placeholder', o.placeholder) + '>' + escapeHtml(o.value || '') + '</textarea>'
    : kind === 'select' ? '<select' + common + '>' + (o.options || []).map(function (op) {
        return '<option value="' + escapeHtml(op.value) + '"' + (String(op.value) === String(o.value) ? ' selected' : '') + '>' + op.label + '</option>';
      }).join('') + '</select>'
    : kind === 'checkbox' ? '<input' + common + ' type="checkbox"' + (o.value ? ' checked' : '') + ' />'
    : '<input' + common + ' type="' + kind + '"' + attr('value', o.value) + attr('placeholder', o.placeholder) + attr('autocomplete', o.autoComplete) + attr('min', o.min) + attr('max', o.max) + attr('step', o.step) + ' />';
  return '<div class="poster-field" data-filled="' + (filled ? 'yes' : 'no') + '" data-kind="' + kind + '"' + (o.width === 'narrow' ? ' data-width="narrow"' : '') + (o.mono ? ' data-mono="yes"' : '') + '>' +
    (o.label ? '<label for="' + escapeHtml(o.id) + '" class="poster-label">' + o.label + '</label>' : '') + control +
    (o.hint ? '<small id="' + escapeHtml(o.id) + '-hint" class="poster-field-hint">' + o.hint + '</small>' : '') +
  '</div>';
}

/** Search, filters and a right-aligned count: `search` is a field(...) string, `filters` action strings. */
export function toolbar(o) {
  return '<div class="poster-toolbar" role="group"' + attr('aria-label', o.label) + '>' + (o.search || '') +
    (o.filters ? '<div class="poster-filters">' + o.filters + '</div>' : '') + (o.body || '') +
    (has(o.count) ? '<span class="poster-toolbar-count">' + o.count + '</span>' : '') +
    (o.actions ? '<div class="poster-actions">' + o.actions + '</div>' : '') +
  '</div>';
}

/**
 * A table: headers (plain text) and rows of trusted cell html; a cell may be { html, mono, end }.
 * o.collapse 560 | 600 | 640 stacks rows as label-value pairs on a narrow screen.
 */
export function table(o) {
  var headers = o.headers || [];
  var head = headers.length ? '<thead><tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead>' : '';
  var body = (o.rows || []).map(function (row) {
    return '<tr>' + row.map(function (cell, i) {
      var c = cell && typeof cell === 'object' ? cell : { html: cell };
      return '<td' + (c.mono ? ' class="mono"' : '') + attr('data-label', headers[i]) + (c.end ? ' data-align="end"' : '') + '>' + (c.html == null ? '' : c.html) + '</td>';
    }).join('') + '</tr>';
  }).join('');
  var collapse = o.collapse ? ' data-collapse="' + pick(Number(o.collapse), [560, 600, 640, 900], 640) + '"' : '';
  return '<div class="poster-table-frame"><div class="poster-table-wrap" data-density="' + density(o.density) + '"' + collapse + ' role="region"' + attr('aria-label', o.label) + ' tabindex="0">' +
    '<table class="data-table poster-table">' + head + '<tbody>' + body + '</tbody></table></div></div>';
}

/** The trail to a page: [{ label, onclick? | href? }], the last is where the person is. */
export function crumbs(items) {
  var shown = (items || []).filter(Boolean);
  return '<nav class="poster-crumbs" aria-label="Breadcrumb"><ol>' + shown.map(function (it, i) {
    var last = i === shown.length - 1;
    return '<li' + (last ? ' aria-current="page"' : '') + '>' + (!last && (it.href || it.onclick) ? action({ kind: 'text', href: it.href, onclick: it.onclick }, it.label) : it.label) + '</li>';
  }).join('') + '</ol></nav>';
}

/** The page's opening: o.crumbs (a crumbs() string), o.mark, o.title (o.subtitle), o.identity, o.actions. */
export function masthead(o) {
  return '<header class="poster-masthead" data-size="' + pick(o.size, ['normal', 'large'], 'normal') + '">' +
    (o.mark ? '<span class="poster-masthead-mark">' + o.mark + '</span>' : '') +
    '<div class="poster-masthead-words">' + (o.crumbs || '') +
      (o.title ? '<h1 class="poster-page-title"' + (o.titleKind === 'mono' ? ' data-kind="mono"' : '') + attr('id', o.titleId) + '>' + o.title + (o.subtitle ? '<small>' + o.subtitle + '</small>' : '') + '</h1>' : '') +
      (o.identity ? '<div class="poster-identity">' + o.identity + '</div>' : '') +
    '</div>' +
    (o.actions ? '<div class="poster-masthead-actions">' + o.actions + '</div>' : '') +
  '</header>';
}

/** Numbered steps to follow in order. */
export function steps(items) {
  var shown = (items || []).filter(Boolean);
  return shown.length ? '<ol class="poster-steps">' + shown.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol>' : '';
}

/** One checklist item: state done | failed | warn | pending; `onclick` makes it a button. */
export function checkItem(o, content) {
  var st = pick(o.state, ['done', 'failed', 'warn', 'pending'], o.done ? 'done' : 'pending');
  var inner = '<span class="poster-check-box" data-state="' + st + '" aria-hidden="true">' + (st === 'done' ? '✓' : st === 'failed' ? '✗' : '') + '</span><span>' + content + '</span>';
  var d = ' data-done="' + (st === 'done' ? 'yes' : 'no') + '"';
  return o.onclick ? '<button type="button" class="poster-check"' + d + handler(o.onclick) + '>' + inner + '</button>' : '<span class="poster-check"' + d + '>' + inner + '</span>';
}

/** A numeral row: one sentence with its number big; `light` a status square; `onclick` makes it a button. */
export function statRow(o, content) {
  var inner = (o.light ? '<span class="poster-stat-light" data-tone="' + pick(o.light, ['success', 'danger', 'sun', 'muted'], 'muted') + '" aria-hidden="true"></span>' : '') + '<span class="poster-stat-text">' + content + '</span>';
  var tone = ' data-tone="' + pick(o.tone, ['plain', 'coral'], 'plain') + '"';
  return o.onclick ? '<button type="button" class="poster-stat"' + tone + handler(o.onclick) + '>' + inner + '</button>' : '<div class="poster-stat"' + tone + '>' + inner + '</div>';
}

/** A filled bar for a ratio; a quota turns to danger from 90 %, `kind:'progress'` never does. */
export function meter(o) {
  var limit = isFinite(o.max) && o.max > 0 ? o.max : 100;
  var amount = isFinite(o.value) ? Math.max(0, Math.min(limit, o.value)) : 0;
  var pct = (amount / limit) * 100;
  var quota = o.kind !== 'progress';
  var tone = quota ? '' : pick(o.tone, ['sun', 'coral', 'ink', 'muted'], '');
  return '<div class="poster-box poster-box--meter poster-meter' + (quota ? ' poster-box--quota' : '') + (quota && pct >= 90 ? ' is-full' : '') + '"' + (tone ? ' data-tone="' + tone + '"' : '') + ' role="meter"' +
    attr('aria-label', o.label) + ' aria-valuenow="' + amount + '" aria-valuemin="0" aria-valuemax="' + limit + '">' +
    '<svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true"><rect width="' + pct + '" height="100" /></svg></div>';
}
