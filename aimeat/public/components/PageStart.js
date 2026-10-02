/**
 * @file public/components/PageStart.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The start of a page for a person who has not used it yet: one quiet block under the
 *   page's head in three parts. "What this is for" says in one sentence what the person gets here.
 *   "Do this first" gives one action: a prompt to paste into their own AI (the PromptCard), and,
 *   where this page has a button that does the same, that button. "What happens next" says in one
 *   sentence what follows. A person who has done the first action folds it to one line; the choice
 *   is kept per page in this browser (localStorage), never on the server.
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
 *   - link: { onClick | href, label? }: a way on after the purpose sentence (the AI page's link to
 *     the page where the person's chat AI is connected); its words are `pageStart.<id>.link`.
 *   - done: true when the page knows the first action is done (the block starts folded), null while
 *     it does not know yet (folded until it knows), false or absent: open. The person's own choice
 *     wins over it.
 *
 *   Built from the library's parts (Label, Note, Action, PromptCard); its sheet,
 *   css/components/page-start.css, only lays the parts out. The catalogue entry is `page-start`.
 * @structure PageStart({ id, vars, purpose, prompt, next, action, link, done })
 * @usage html`<${PageStart} id="memory" done=${hasEntries} action=${{ onClick: openForm }} />`
 *        In a Settings page: SettingsPage's `start` slot draws it under the head.
 * @version-history
 *   v1.0.0 — 2026-10-03 — Initial (guidance for normal people, part B): what a page is for, what to do
 *     first and what happens next, on the ten main Settings pages.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Action, Actions } from '/components/Action.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { PromptCard } from '/components/PromptCard.js';

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

/**
 * @param {{ id: string, vars?: Record<string, any>, purpose?: any, prompt?: string, next?: any,
 *   action?: { onClick?: () => void, href?: string, copy?: string, label?: any } | null,
 *   link?: { onClick?: () => void, href?: string, label?: any } | null, done?: boolean | null }} props
 */
export function PageStart({ id, vars, purpose, prompt, next, action, link, done }) {
  const [choice, setChoice] = useState(() => readChoice(id));
  const part = (name) => words(`pageStart.${id}.${name}`, vars);
  const folded = choice === '1' || choice === '0' ? choice === '1' : (done === true || done === null);
  const toggle = () => { setChoice(folded ? '0' : '1'); writeChoice(id, !folded); };

  const forWords = purpose ?? part('purpose');
  const promptText = prompt ?? part('prompt');
  const nextWords = next ?? part('next');
  const actionLabel = action ? (action.label ?? part('action')) : '';
  const linkLabel = link ? (link.label ?? part('link')) : '';

  return html`
    <section class=${cx('page-start', folded && 'page-start--folded')} aria-label=${t('pageStart.label')}>
      <div class="page-start-head">
        <${Label}>${t('pageStart.label')}<//>
        <${Action} small soft expanded=${!folded} onClick=${toggle}>${folded ? t('pageStart.show') : t('pageStart.hide')}<//>
      </div>
      ${folded ? null : html`
        <div class="page-start-parts">
          <div class="page-start-part">
            <${Label} block>${t('pageStart.for')}<//>
            <${Note} kind="lead">${forWords}${link && linkLabel ? html` <${Action} tone="link" href=${link.href} onClick=${link.onClick}>${linkLabel}<//>` : null}<//>
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
        </div>`}
    </section>`;
}

export default PageStart;
