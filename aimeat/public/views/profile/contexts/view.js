/**
 * @file public/views/profile/contexts/view.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Contexts page (wish-oma-konteksti-muoto-syntyy-k-yt-ss-n-kym-pyynn-st): the
 *   person's contexts in a list at the start, newest shaped first, each with when it was shaped, who
 *   can read it and its marks (not shaped in months, large), the archived ones in a folded group at
 *   the end; beside it the chosen context: its summary, kind and dates, who can read it (a choice
 *   with its explanation, explain.context.readers), the one loud action that copies the sentence to
 *   go on with it in chat, archive or bring back, delete; then its core, its concepts, its
 *   references, the contexts it includes or keeps out, and the views its AI keeps. One column under
 *   1100px, the list first. The guidance is the standard parts of .claude/rules/page-guidance.md:
 *   the head's paragraph, the title's question mark (explain.concept.context), PageStart
 *   (pageStart.contexts.*) and the list's own empty line; nothing else on the page explains.
 *   Pure render over the ctx bag of contexts-tab.js; every part is a library component, and the
 *   file writes no class.
 * @structure renderContextsView · listPart · tagPick · markWords · contextRow · deletedNote · detailPart · headPart ·
 *   fingerprintPart · corePart · conceptsPart · referencesPart · linksPart · keepWords · viewsPart
 * @usage import { renderContextsView } from './contexts/view.js';
 * @version-history
 *   v1.5.0 — 2026-11-09 — Tags: a drop-down over the list shows the contexts of one tag (only when some
 *     context has a tag), a row names up to three of its tags, and the chosen context's facts name all
 *     of them with the line that the person's AI sets them.
 *   v1.4.0 — 2026-11-09 — The fingerprint as the first numbered part (approved by the developer)
 *     (components/Fingerprint.js, the drawing Pages shows), or the sentence that asks the AI for one.
 *     Compact by default; pressing it opens the whole fingerprint (the developer's call, same day).
 *   v1.3.0 — 2026-11-08 — The guidance follows the page-guidance rule: the page's own introduction is
 *     gone, and the head's paragraph, the title's question mark (concept.context), the standard
 *     PageStart and the list's empty line carry it; the view toggle lost its tooltip-only words.
 *   v1.2.0 — 2026-11-08 — The page introduction (PageStart with the page's own parts): what a context
 *     is, when one starts, what the person gains and what this page is for. It replaces the one-line
 *     empty state and the head's lede.
 *   v1.1.0 — 2026-11-08 — Browser check findings: every numbered section shows its running number
 *     (no counts in that place); a view's frequency in the reader's language when it is a known
 *     value; the rows are ConversationList rows (one button per row, at least 44px, the chosen one on
 *     the sun, which also fixes the grey lines on the chosen row); the head's actions, the links and
 *     the view toggle in the 44px control cut, the readers drop-down inside Touch; the list comes
 *     before the context in the reading order (Beside `start` renders its side part first).
 *   v1.0.0 — 2026-11-08 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { ago, date, num } from '/js/format.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { PageStart } from '/components/PageStart.js';
import { PageSection } from '/components/PageSection.js';
import { ConversationList, ConversationRows, ConversationSection, ConversationRow } from '/components/ConversationList.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Mark, Marks } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Facts, FactLine } from '/components/Facts.js';
import { Select } from '/components/Select.js';
import { HelpLabel } from '/components/HelpTip.js';
import { Box } from '/components/Box.js';
import { Markdown } from '/components/Markdown.js';
import { Peek, nextPeek } from '/components/Peek.js';
import { Beside, Stack, Touch } from '/components/Layout.js';
import { Fingerprint } from '/components/Fingerprint.js';
import { x, xn, marksOf, readersWords, OWN_READERS, chatSentence, crumb, CONTEXT_PREFIX } from './frame.js';

const html = htm.bind(h);
/** A core longer than this shows its top under a fade until the person asks for all of it. */
const CORE_FOLD = 1600;
/** A row names this many of its tags; the chosen context names all of them. */
const ROW_TAGS = 3;

export function renderContextsView(ctx) {
  const all = ctx.items || [];
  const marks = ctx.items ? [{ label: xn('chipCount', all.length) },
    ctx.archived.length ? { label: xn('chipArchived', ctx.archived.length), tone: 'dim' } : null] : [];
  let body;
  if (ctx.failed) body = html`<${Note} kind="quiet">${x('loadFailed')} <${Action} small soft onClick=${() => ctx.reload()}>${x('retry')}<//><//>`;
  else if (!ctx.items) body = html`<${Note} kind="loading" />`;
  else if (!all.length) body = listPart(ctx);
  else body = html`<${Beside} start narrow side=${listPart(ctx)}>${detailPart(ctx, ctx.current)}<//>`;
  // The page's guidance is the standard parts (.claude/rules/page-guidance.md): the head's paragraph,
  // the question mark on the title (explain.concept.context), PageStart (pageStart.contexts.*, folded
  // once the person has a context) and the list's own empty line.
  const start = html`<${PageStart} id="contexts" done=${ctx.items ? all.length > 0 : null} />`;
  return html`
    <${SettingsPage} name="ctx" crumb=${crumb()} title=${t('profile.tabs.contexts')} help="concept.context" marks=${marks}
      desc=${x('lede')} start=${start} after=${html`<${ctx.ConfirmUI} />`}>
      ${body}
    <//>`;
}

/* ── The list ─────────────────────────────────────────────────────────────────────────────────── */

/* The rows are the conversation list's (components/ConversationList.js): each row is one button the
   width of the column and at least 44px tall, the chosen one on the sun with its lines in the words'
   own colour; the archive is a section whose heading folds it. */
function listPart(ctx) {
  return html`
    <${Stack} gap="medium">
      ${tagPick(ctx)}
      ${deletedNote(ctx)}
      <${ConversationList} empty=${ctx.items && !ctx.items.length ? x('empty') : undefined}>
        <${ConversationRows}>${ctx.active.map((c) => contextRow(ctx, c))}<//>
        ${ctx.archived.length ? html`
          <${ConversationSection} kind="archive" label=${x('archivedGroup')} count=${num(ctx.archived.length)}
            open=${ctx.archivedOpen} onToggle=${() => ctx.toggleArchived()}>
            ${ctx.archived.map((c) => contextRow(ctx, c))}
          <//>` : null}
      <//>
    <//>`;
}

/**
 * The list by one tag: a drop-down of every tag the contexts carry, with how many carry it. Shown only
 * when some context has a tag. Touch: the drop-down is a 44px target (layout.css .layout-touch).
 */
function tagPick(ctx) {
  if (!ctx.tags?.length) return null;
  const options = [{ value: '', label: x('tagAll') },
    ...ctx.tags.map(({ tag, count }) => ({ value: tag, label: x('tagOption', { tag, n: num(count) }) }))];
  return html`<${Touch}><${Select} value=${ctx.tag} options=${options} ariaLabel=${x('tagPickLabel')} fit
    onChange=${(v) => ctx.pickTag(v)} /><//>`;
}

/** The marks a person reads on a row and over the chosen context, in words. */
function markWords(m) {
  return [
    m.staleMonths ? xn('stale', m.staleMonths) : '',
    m.large ? x('large') : '',
  ].filter(Boolean).join(' · ');
}

function contextRow(ctx, c) {
  const m = marksOf(c);
  const note = m.archived ? x('archivedOn', { date: date(c.archivedAt) }) : markWords(m);
  const line = `${x('shaped', { when: ago(c.shapedAt) })} · ${readersWords(c.visibility, ctx.orgNames)}`;
  return html`<${ConversationRow} key=${c.key} title=${c.name} chips=${c.tags.slice(0, ROW_TAGS)} preview=${line} why=${note || undefined}
    active=${ctx.current?.key === c.key} onOpen=${() => ctx.select(c.key)} />`;
}

/** Said after a delete, with the way back while the bin keeps it. */
function deletedNote(ctx) {
  const d = ctx.deleted;
  if (!d) return null;
  return html`
    <${Note} kind="aside" size="small">
      ${d.until ? x('deletedNote', { name: d.name, date: d.until }) : x('deletedNoteSoon', { name: d.name })}
      <${Actions}>
        <${Action} small disabled=${ctx.busy} onClick=${() => ctx.restore()}>${x('restore')}<//>
        <${Action} small soft onClick=${() => ctx.dismissDeleted()}>${x('dismiss')}<//>
      <//>
    <//>`;
}

/* ── The chosen context ───────────────────────────────────────────────────────────────────────── */

function detailPart(ctx, c) {
  if (!c) return null;
  const parts = [fingerprintPart, corePart, conceptsPart, referencesPart, linksPart, viewsPart];
  let n = 0;
  const numbered = parts.map((part) => part(ctx, c, () => String(++n).padStart(2, '0')));
  return html`
    <div id="ctx-detail">
      ${headPart(ctx, c)}
      ${numbered}
    </div>`;
}

function headPart(ctx, c) {
  const m = marksOf(c);
  const words = markWords(m);
  const own = OWN_READERS.includes(c.visibility);
  const options = [
    ...(own ? [] : [{ value: c.visibility, label: readersWords(c.visibility, ctx.orgNames), disabled: true }]),
    ...OWN_READERS.map((v) => ({ value: v, label: x('readers.' + v) })),
  ];
  // Touch: the drop-down is a 44px target (layout.css .layout-touch).
  const readers = html`<${Touch}><${Select} value=${c.visibility} options=${options} ariaLabel=${x('readersLabel')} fit
    disabled=${ctx.busy} onChange=${(v) => ctx.setReaders(c, v)} /><//>`;
  const sentence = chatSentence(c);
  return html`
    <${PageSection} id="ctx-head" title=${c.name} first>
      ${c.summary ? html`<${Note} kind="lead">${c.summary}<//>` : null}
      ${m.archived || words ? html`<${Marks}>
        ${m.archived ? html`<${Mark} kind="status" tone="off">${x('archivedMark')}<//>` : null}
        ${m.staleMonths ? html`<${Mark} kind="status" tone="attention">${xn('stale', m.staleMonths)}<//>` : null}
        ${m.large ? html`<${Mark} kind="status" tone="attention">${x('large')}<//>` : null}
      <//>` : null}
      <${Facts} wide rows=${[
        c.kind ? { key: 'kind', k: x('kindK'), v: x('kind.' + c.kind), sub: x('kindSub.' + c.kind) } : null,
        { key: 'shaped', k: x('shapedK'), v: ago(c.shapedAt) || x('never'), sub: c.createdAt ? x('createdOn', { date: date(c.createdAt) }) : undefined },
        c.readAt ? { key: 'read', k: x('readK'), v: ago(c.readAt) } : null,
        { key: 'readers', k: html`<${HelpLabel} term="context.readers" label=${x('readersLabel')}>${x('readersLabel')}<//>`,
          v: readers, controls: true, sub: own ? undefined : x('readersWider') },
        { key: 'tags', k: x('tagsK'),
          v: c.tags.length ? html`<${Marks}>${c.tags.map((tag) => html`<${Mark} key=${tag}>${tag}<//>`)}<//>` : x('noTags'),
          sub: x('tagsSub') },
        { key: 'key', k: x('keyK'), v: c.key, mono: true, sub: x('keySub') },
      ]} />
      <${Actions}>
        <${Loud} control copy=${sentence} copiedLabel=${x('copied')} onCopied=${() => ctx.copied()}>${x('continue')}<//>
        ${m.archived
          ? html`<${Action} small control disabled=${ctx.busy} onClick=${() => ctx.bringBack(c)}>${x('bringBack')}<//>`
          : html`<${Action} small control disabled=${ctx.busy} onClick=${() => ctx.archive(c)}>${x('archive')}<//>`}
        <${Action} small control tone="danger" disabled=${ctx.busy} onClick=${() => ctx.remove(c)}>${x('delete')}<//>
      <//>
      <${Note} kind="hint">${x('continueHint', { sentence })}<//>
    <//>`;
}

/**
 * What the context is made of, at a glance: the fingerprint the person's AI made of it (the same
 * drawing as in Pages). Without one, the sentence that asks the AI for it, to copy into chat. The
 * fingerprint describes the version it was made of; a context shaped since says so.
 */
function fingerprintPart(ctx, c, nextNum) {
  const fp = ctx.fingerprint;
  if (!fp || fp.key !== c.key || fp.loading) {
    return html`<${PageSection} id="ctx-fingerprint" num=${nextNum()} title=${x('fingerprint')}>
      <${Note} kind="loading" /><//>`;
  }
  const ask = x('fingerprintAsk', { name: c.name, key: c.key });
  if (!fp.profile) {
    return html`
      <${PageSection} id="ctx-fingerprint" num=${nextNum()} title=${x('fingerprint')}>
        <${Note} kind="quiet">${x('noFingerprint')}<//>
        <${Actions}>
          <${Action} small control copy=${ask} copiedLabel=${x('copied')} onCopied=${() => ctx.copied()}>${x('fingerprintCopy')}<//>
        <//>
        <${Note} kind="hint">${x('fingerprintHint', { sentence: ask })}<//>
      <//>`;
  }
  const older = fp.madeAt && c.shapedAt && String(c.shapedAt) > String(fp.madeAt);
  return html`
    <${PageSection} id="ctx-fingerprint" num=${nextNum()} title=${x('fingerprint')}>
      <${Fingerprint} profile=${fp.profile} sections=${fp.sections} title=${c.name} expandable />
      <${Note} kind="hint">${older
        ? x('fingerprintOlder', { date: date(fp.madeAt) })
        : x('fingerprintMade', { date: date(fp.madeAt) })}<//>
      ${older ? html`<${Actions}>
        <${Action} small control copy=${ask} copiedLabel=${x('copied')} onCopied=${() => ctx.copied()}>${x('fingerprintCopy')}<//>
      <//>` : null}
    <//>`;
}

function corePart(ctx, c, nextNum) {
  const id = 'core:' + c.key;
  const long = c.core.length > CORE_FOLD;
  const open = ctx.viewsOpen[id] === 'full';
  return html`
    <${PageSection} id="ctx-core" num=${nextNum()} title=${x('core')}>
      ${c.core
        ? html`<${Box} folded=${long && !open} unfoldLabel=${x('showAll')} onUnfold=${() => ctx.setViewOpen(id, 'full')}>
            <${Markdown} text=${c.core} />
          <//>`
        : html`<${Note} kind="quiet">${x('noCore')}<//>`}
    <//>`;
}

function conceptsPart(ctx, c, nextNum) {
  if (!c.concepts.length) return null;
  return html`
    <${PageSection} id="ctx-concepts" num=${nextNum()} title=${x('concepts')}>
      <${Facts} wide rows=${c.concepts.map((k, i) => ({
        key: 'c' + i, k: k.term, v: k.means || x('noMeaning'), missing: !k.means,
        sub: [k.broader ? x('broader', { term: k.broader }) : '', k.replacedBy ? x('replacedBy', { term: k.replacedBy }) : '']
          .filter(Boolean).join(' · ') || undefined,
        subTone: k.replacedBy ? 'notice' : undefined,
      }))} />
    <//>`;
}

function referencesPart(ctx, c, nextNum) {
  if (!c.references.length) return null;
  return html`
    <${PageSection} id="ctx-refs" num=${nextNum()} title=${x('references')}>
      <${Facts} wide rows=${c.references.map((r, i) => ({
        key: 'r' + i, k: r.what || r.ref,
        v: r.openWhen ? x('openWhen', { when: r.openWhen }) : x('openAny'),
        sub: r.ref || undefined,
      }))} />
    <//>`;
}

/** One included or kept-out context: a way to it when the person has it, its name as text when not. */
function linkTo(ctx, ref) {
  const slug = String(ref).startsWith('context:') ? String(ref).slice('context:'.length) : String(ref);
  const target = (ctx.items || []).find((it) => it.key === CONTEXT_PREFIX + slug);
  return html`<${FactLine} key=${ref} sub=${target ? undefined : x('linkMissing')}>
    ${target ? html`<${Action} small soft control onClick=${() => ctx.select(target.key)}>${target.name}<//>` : slug}
  <//>`;
}

function linksPart(ctx, c, nextNum) {
  if (!c.includes.length && !c.excludes.length) return null;
  return html`
    <${PageSection} id="ctx-links" num=${nextNum()} title=${x('links')}>
      <${Facts} wide rows=${[
        c.includes.length ? { key: 'in', k: x('includes'), v: c.includes.map((r) => linkTo(ctx, r)), sub: x('includesSub') } : null,
        c.excludes.length ? { key: 'out', k: x('excludes'), v: c.excludes.map((r) => linkTo(ctx, r)), sub: x('excludesSub') } : null,
      ]} />
    <//>`;
}

/** The first line of a view's last text, for its folded look. */
const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';

/** How often a view is kept, in words: the known values in the reader's language, any other as written. */
const KEEP_WORDS = { daily: 'daily', weekly: 'weekly', monthly: 'monthly', onchange: 'onChange', whenitchanges: 'onChange' };
function keepWords(keep) {
  const known = KEEP_WORDS[String(keep).toLowerCase().replace(/[^a-z]/g, '')];
  return known ? x('keep.' + known) : String(keep);
}

function viewsPart(ctx, c, nextNum) {
  if (!c.views.length) return null;
  return html`
    <${PageSection} id="ctx-views" num=${nextNum()} title=${x('views')}>
      <${Stack} gap="medium">
        ${c.views.map((v, i) => {
          const id = `${c.key}:${i}`;
          const view = ctx.viewsOpen[id] || 'line';
          const last = v.last && typeof v.last === 'object' && typeof v.last.text === 'string' && v.last.text ? v.last : null;
          // The toggle is a word in the control cut (44px), not the 28px icon: line → peek → all → line.
          const toggle = last ? html`<${Action} small soft control
            onClick=${() => ctx.setViewOpen(id, nextPeek(view))}>${view === 'full' ? x('showLess') : x('showMore')}<//>` : null;
          return html`
            <${Box} key=${id} name=${v.ask} marks=${v.keep ? html`<${Mark}>${keepWords(v.keep)}<//>` : null} end=${toggle}>
              ${last ? html`
                <${Note} kind="meta">${last.at ? x('viewWritten', { when: ago(last.at) }) : x('viewWrittenNoDate')}<//>
                <${Peek} view=${view} line=${firstLine(last.text)}><${Markdown} text=${last.text} /><//>`
                : html`<${Note} kind="quiet">${x('viewNotYet')}<//>`}
            <//>`;
        })}
      <//>
    <//>`;
}
