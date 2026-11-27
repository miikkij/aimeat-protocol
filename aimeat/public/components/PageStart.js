/**
 * @file public/components/PageStart.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The start of a page for a person who has not used it yet: one quiet block under the
 *   page's head in three parts. "What this is for" says in one sentence what the person gets here.
 *   "Do this first" gives one action: a prompt to paste into their own AI (the PromptCard), and,
 *   where this page has a button that does the same, that button. "What happens next" says in one
 *   sentence what follows. It is one closed row until the person opens it, so the page's own content
 *   starts on the first screen; the choice is kept per page in this browser (localStorage), never
 *   on the server.
 *
 *   The words are locale data under `pageStart.<id>.*` (`purpose`, `prompt`, `next`, `action`,
 *   `link`), so a page passes its id and what only it knows: the values the prompt names (`vars`),
 *   what its button does and whether the first action is done. A prop of the same name wins over
 *   the locale's words.
 *
 *   - id: the page ('memory', 'organisms', ...): the locale's words and the remembered fold.
 *   - vars: the values the prompt's {placeholders} take (an address).
 *   - action: { onClick | href | copy, label? }: the page's own button for the same first action;
 *     its words are `pageStart.<id>.action` unless `label` is given.
 *   - link: { onClick | href, label? }: a way on after the purpose sentence (the AI models page's link to
 *     the page where the person's chat AI is connected); its words are `pageStart.<id>.link`.
 *   - done: accepted from the pages that pass it and no longer read: since 2026-11-26 the block is
 *     closed on every page until the person opens it, and their choice is kept.
 *
 *   "Explain this page to me" stands under the purpose: a prompt for the person's own AI that carries
 *   the page's own explanation (the purpose, what follows, the page's concept and its examples) and
 *   who the person is (js/ask-ai-prompt.js buildPagePrompt, their memory record profile.explain), so
 *   any AI chat explains the page at their role and level, connected to AIMEAT or not. The page's
 *   title, description and concept come from PageInfo, which SettingsPage and the admin frame fill;
 *   props of the same names win.
 *
 *   Built from the library's parts (Label, Note, Action, PromptCard); its sheet,
 *   css/components/page-start.css, only lays the parts out. The catalogue entry is `page-start`.
 *   - inline: the start in the head's row of a page whose work area takes the screen (SettingsPage
 *     `desk`, the messenger): closed it is only the word that opens it, open it is the same block
 *     across the head's full width.
 * @structure PageStart({ id, vars, purpose, prompt, next, action, link, done, title, concept, inline }) ·
 *   PageInfo (context: { title, desc, help })
 * @usage html`<${PageStart} id="memory" done=${hasEntries} action=${{ onClick: openForm }} />`
 *        In a Settings page: SettingsPage's `start` slot draws it under the head.
 * @version-history
 *   v1.4.0 — 2026-11-27 — Closed, the start is one light row on every page (a chevron and its words,
 *     .page-start-open, about 32 px); it was a framed block of 76 px with a label and a button. Props
 *     unchanged.
 *   v1.3.0 — 2026-11-27 — `inline`: closed, the start is one word in the head's row of a page whose
 *     work area takes the screen; the messenger's closed start took a row of 76 px.
 *   v1.2.0 — 2026-11-26 — The block is closed on every page until the person opens it (it was open
 *     on a page whose first action was not done). One row stands above the page's own content
 *     instead of about 400 px (Jouni, 2026-11-26).
 *   v1.1.0 — 2026-11-09 — "Explain this page to me": a prompt with the page's explanation and the
 *     person's role from profile.explain; PageInfo carries the page's title, description and concept
 *     (guidance audit 2026-11-09).
 *   v1.0.0 — 2026-10-03 — Initial (guidance for normal people, part B): what a page is for, what to do
 *     first and what happens next, on the ten main Settings pages.
 */
import { h, createContext } from 'preact';
import { useState, useEffect, useContext } from 'preact/hooks';
import htm from 'htm';
import { t, getLocale } from '/js/i18n.js';
import { Action, Actions, Chevron } from '/components/Action.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { PromptCard } from '/components/PromptCard.js';
import { explainOf } from '/components/ExplainDialog.js';
import { buildPagePrompt, EXPLAIN_PROFILE_KEY } from '/js/ask-ai-prompt.js';
import { getMemory } from '/js/services/memory.js';
import { hasSession } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const STORE = 'aimeat.pageStart.';

/** A locale string, or '' when the locale has none (t() gives the key back on a miss). */
const words = (key, vars) => {
  const v = t(key, vars);
  return v && v !== key ? v : '';
};

/** The person's own choice for this page: '1' folded, '0' open, null when they never chose. */
function readChoice(id) {
  try { return localStorage.getItem(STORE + id); } catch { return null; }   // eslint-disable-line aimeat/no-silent-catch -- no storage (a private window): the page's own default stands
}

function writeChoice(id, folded) {
  try { localStorage.setItem(STORE + id, folded ? '1' : '0'); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- no storage: the fold holds for this visit only
}

/** What the page tells its start about itself: { title, desc, help } (SettingsPage, the admin frame). */
export const PageInfo = createContext(null);

/** The person's own profile.explain record ({ role, level }), read once per page load; null without one. */
let aboutRead = null;
function readAbout() {
  if (!hasSession()) return Promise.resolve(null);
  if (!aboutRead) {
    aboutRead = getMemory(EXPLAIN_PROFILE_KEY, { soft: true })
      .then((r) => { const v = r?.data?.value; return v && typeof v === 'object' ? v : null; })
      .catch((err) => { swallowed('page-start: profile.explain', err); aboutRead = null; return null; });
  }
  return aboutRead;
}

/** A page's own words as plain text for the prompt; a node (a link, a mark) gives nothing. */
const plain = (v) => (typeof v === 'string' ? v : '');

/**
 * "Explain this page to me": the page's own explanation and who the person is, as one prompt.
 * @param {{ id: string, title: string, desc: string, concept: string, forWords: string, nextWords: string }} p
 */
function ExplainPrompt({ id, title, desc, concept, forWords, nextWords }) {
  const [about, setAbout] = useState(null);
  useEffect(() => { let live = true; readAbout().then((a) => { if (live) setAbout(a); }); return () => { live = false; }; }, []);
  const term = concept && concept.startsWith('concept.') ? concept : '';
  const part = (p) => (term ? explainOf(term, p) : '');
  const prompt = buildPagePrompt({
    title: title || id,
    explanation: [
      forWords && `What the page is for: ${forWords}`,
      desc && desc !== forWords && `What the page says about itself: ${desc}`,
      part('what') && `What it is: ${part('what')}`,
      ...[1, 2, 3].map((n) => part('ex' + n)).filter(Boolean).map((e) => `Example: ${e}`),
      part('tip') && `${part('tipLabel') || 'When to use something else'}: ${part('tip')}`,
      nextWords && `What follows the first step: ${nextWords}`,
    ],
    about, concept: term || undefined, locale: getLocale(), base: location.origin,
  });
  return html`
    <div class="page-start-explain">
      <${PromptCard} quiet showPrompt=${false} label=${t('pageStart.explainLabel')} prompt=${prompt}
        copyLabel=${t('pageStart.copy')} copiedLabel=${t('common.copied')} />
      <${Note} kind="hint">${about ? t('pageStart.explainWhyRole') : t('pageStart.explainWhy')}<//>
    </div>`;
}

/**
 * @param {{ id: string, vars?: Record<string, any>, purpose?: any, prompt?: string, next?: any,
 *   action?: { onClick?: () => void, href?: string, copy?: string, label?: any } | null,
 *   link?: { onClick?: () => void, href?: string, label?: any } | null, done?: boolean | null,
 *   title?: string, concept?: string, inline?: boolean }} props
 */
export function PageStart({ id, vars, purpose, prompt, next, action, link, title, concept, inline }) {
  const info = useContext(PageInfo) || {};
  const [choice, setChoice] = useState(() => readChoice(id));
  const part = (name) => words(`pageStart.${id}.${name}`, vars);
  // Closed until the person opens it, on every page. Open, it took about 400 px above the first
  // section of a page that was not in use yet, so the page's own content began below the first
  // screen. `done` no longer decides the fold; the person's own choice is kept as before.
  const folded = choice !== '0';
  const toggle = () => { setChoice(folded ? '0' : '1'); writeChoice(id, !folded); };

  const forWords = purpose ?? part('purpose');
  const promptText = prompt ?? part('prompt');
  const nextWords = next ?? part('next');
  const actionLabel = action ? (action.label ?? part('action')) : '';
  const linkLabel = link ? (link.label ?? part('link')) : '';

  // Closed, on every page, the start is one light row: a drawn chevron and the words that open it.
  // It was a framed block of about 76 px with its label and a button. `inline` (the messenger) keeps
  // the same row in its head's row; open, the block takes the head's full width.
  if (folded) {
    return html`
      <section class=${cx('page-start', 'page-start--folded', inline && 'page-start--inline')} aria-label=${t('pageStart.label')}>
        <button type="button" class="page-start-open" aria-expanded="false" onClick=${toggle}>
          <${Chevron} small /><span>${t('pageStart.show')}</span>
        </button>
      </section>`;
  }
  return html`
    <section class=${cx('page-start', inline && 'page-start--inline')} aria-label=${t('pageStart.label')}>
      <div class="page-start-head">
        <${Label}>${t('pageStart.label')}<//>
        <${Action} small soft expanded=${true} onClick=${toggle}>${t('pageStart.hide')}<//>
      </div>
        <div class="page-start-parts">
          <div class="page-start-part">
            <${Label} block>${t('pageStart.for')}<//>
            <${Note} kind="lead">${forWords}${link && linkLabel ? html` <${Action} tone="link" href=${link.href} onClick=${link.onClick}>${linkLabel}<//>` : null}<//>
            <${ExplainPrompt} id=${id} title=${plain(title) || plain(info.title)} desc=${plain(info.desc)}
              concept=${concept || plain(info.help)} forWords=${plain(forWords)} nextWords=${plain(nextWords)} />
          </div>
          <div class="page-start-part">
            <${Label} block>${t('pageStart.first')}<//>
            ${promptText ? html`<${PromptCard} quiet label=${t('pageStart.promptLabel')} prompt=${promptText}
              copyLabel=${t('pageStart.copy')} copiedLabel=${t('common.copied')} />` : null}
            ${action && actionLabel ? html`
              <${Actions}>
                <${Action} small href=${action.href} copy=${action.copy} copiedLabel=${action.copy ? t('common.copied') : undefined}
                  onClick=${action.onClick}>${actionLabel}<//>
              <//>` : null}
          </div>
          <div class="page-start-part">
            <${Label} block>${t('pageStart.next')}<//>
            <${Note} kind="hint">${nextWords}<//>
          </div>
        </div>
    </section>`;
}

export default PageStart;
