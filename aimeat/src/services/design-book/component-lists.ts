/**
 * @file src/services/design-book/component-lists.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A component's list items stay in its own lists. A browser numbers a list item as an
 *   item of the list around it, and a component lands inside somebody else's page: a list item that
 *   no list of the component holds is numbered as an item of the page's own list around the
 *   component, and the page's items after it count on from it. The component bench (component.ts)
 *   refuses the ways a component makes such a list item, each in a sentence that says so:
 *     - an <li> whose parent in the markup is not a <ul>, <ol> or <menu>, the three elements whose
 *       default style starts a list of their own (the allowlist refuses <menu> before this reads it);
 *     - a `display` that holds `list-item`, and a `display` the bench cannot read as words: through
 *       var() or another function, or `inherit`, which takes the display of a parent that can be an
 *       item of the page's list;
 *     - where the markup carries a <summary>, a counter-increment without `list-item 0`. A browser
 *       makes the <summary> of a <details> a list item that counts 0, and a counter-increment that
 *       reaches it replaces that 0.
 *   A component's own list keeps its numbering in itself: where the markup carries a <ul>, <ol> or
 *   <menu>, every counter-reset names list-item, since an author counter-reset replaces the one the
 *   list's default style gives it, and `all` is revert or revert-layer (listResetRefusal). There, and
 *   only there, list-item in a counter-reset is the component's own (resetsListItem).
 * @structure listItemMarkupRefusal(elements) · displayRefusal(declaration) · summaryCounterRefusal(elements, declarations, prefix) ·
 *   listResetRefusal(elements, declarations) · carriesList(elements) · resetsListItem(part) · countsListItemZero(parts, at)
 * @usage const why = listItemMarkupRefusal(elements); if (why) refuse(why);
 * @version-history
 *   v1.1.0 — 2026-09-26 — Where the markup carries a <ul>, <ol> or <menu>, every counter-reset names
 *     list-item (the word, with an integer or not, or reversed(list-item)), revert and revert-layer
 *     pass, and `all` passes only as revert or revert-layer; there list-item in a counter-reset is the
 *     component's own.
 *   v1.0.0 — 2026-09-26 — Initial: an <li> outside a list of the component, a display that holds list-item or
 *     cannot be read as words, and a counter-increment that can reach a <summary> without list-item 0.
 */
import type { DeclarationRead, MarkupElement, ValuePart } from './component-scan.js';

/** The elements whose default style starts a list of their own, so the items in them are numbered there. */
const LIST_PARENTS = new Set(['ul', 'ol', 'menu']);

/** Where a browser numbers a list item that no list of the component holds. */
const AROUND = 'as an item of the page\'s own list around the component';

/** A declaration quoted in a message: its property and its value as written, whitespace folded, cut short. */
const quote = (d: DeclarationRead): string => `${d.property}: ${d.text}`.replace(/\s+/g, ' ').slice(0, 60);

/** Whether the parts at `at` are the word list-item and the number 0: they step the list-item counter by nothing. */
export function countsListItemZero(parts: ReadonlyArray<ValuePart>, at: number): boolean {
  const [word, count] = [parts[at], parts[at + 1]];
  return word?.type === 'word' && word.name === 'list-item' && count?.type === 'number' && Number(count.text) === 0;
}

/** Why an <li> of the markup stands outside a list of the component, or null when every <li> stands in one. */
export function listItemMarkupRefusal(elements: ReadonlyArray<MarkupElement>): string | null {
  const stray = elements.find(e => e.name === 'li' && !LIST_PARENTS.has(e.parent ?? ''));
  if (!stray) return null;
  const where = stray.parent ? `inside <${stray.parent}>` : 'at the top of the markup';
  return `An <li> stands ${where}, outside a list of the component: a browser numbers it ${AROUND}, and the page's items after it count on from it. Put every <li> inside a <ul> or <ol> of the markup.`;
}

/** Why a `display` declaration can make an element a list item that no list of the component holds, or null. */
export function displayRefusal(d: DeclarationRead): string | null {
  if (d.property !== 'display') return null;
  // A value the parser kept raw is one part the bench cannot read.
  const parts: ValuePart[] = d.parts ?? [{ type: 'other', text: d.text }];
  if (parts.some(p => p.type === 'word' && p.name === 'list-item')) {
    return `The declaration "${quote(d)}" makes an element a list item, and outside a list of the component a browser numbers it ${AROUND}, so the page's items after it count on from it. `
      + 'A component\'s list items are the <li> elements of its <ul> or <ol>, which need no display of their own.';
  }
  if (parts.some(p => p.type === 'word' && p.name === 'inherit')) {
    return `The declaration "${quote(d)}" gives an element the display of its parent, and the parent of the component can be an item of the page's own list: the element would then be numbered in that list, `
      + 'and the page\'s items after it count on from it. Write display as the word itself, as in "display: block".';
  }
  const unread = parts.find(p => p.type === 'function' || p.type === 'other');
  if (!unread) return null;
  const through = unread.type === 'function' ? `${unread.name}()` : unread.type === 'other' ? unread.text.slice(0, 40) : '';
  return `The declaration "${quote(d)}" writes display through ${through}, and the bench cannot read whether it makes a list item, which a browser numbers ${AROUND}. `
    + 'Write display as the word itself, as in "display: grid".';
}

/**
 * Why a counter-increment can make the <summary> of the markup step the page's list, or null. The
 * bench cannot tell which elements a rule reaches, so where the markup carries a <summary>, every
 * counter-increment writes `list-item 0`, which steps the list-item counter by nothing.
 */
export function summaryCounterRefusal(elements: ReadonlyArray<MarkupElement>, declarations: ReadonlyArray<DeclarationRead>, prefix: string): string | null {
  if (!elements.some(e => e.name === 'summary')) return null;
  const reaches = declarations.find(d => d.property === 'counter-increment' && !(d.parts ?? []).some((_, at, parts) => countsListItemZero(parts, at)));
  if (!reaches) return null;
  return `The markup carries a <summary>, which a browser makes a list item that counts 0, and the declaration "${quote(reaches)}" can reach it: a counter-increment replaces that 0, `
    + `so the <summary> is numbered ${AROUND}, and the page's items after it count on from it. `
    + `Where the markup carries a <summary>, every counter-increment also writes "list-item 0": "counter-increment: ${prefix}-step list-item 0".`;
}

/** Whether the markup carries a <ul>, <ol> or <menu>, a list whose items a browser numbers in it. */
export const carriesList = (elements: ReadonlyArray<MarkupElement>): boolean => elements.some(e => LIST_PARENTS.has(e.name));

/** Whether a part of a counter-reset resets list-item: the word itself, or reversed(list-item). */
export const resetsListItem = (part: ValuePart): boolean => (part.type === 'word' && part.name === 'list-item')
  || (part.type === 'function' && part.name === 'reversed' && part.words?.length === 1 && part.words[0] === 'list-item');

/** The keywords that keep the counter-reset: list-item that a list's default style gives it. */
const KEEPS_RESET = new Set(['revert', 'revert-layer']);
/** The keywords of a counter-reset that name no counter, which the fix replaces with list-item. */
const NAMES_NONE = new Set(['none', 'initial', 'unset']);

/** Where a browser that numbers lists by the list-item counter numbers the items of a list whose reset is gone. */
const AROUND_ITEMS = 'as items of the page\'s own list around the component';

/**
 * Why a declaration can drop the reset that keeps a list of the markup numbered in itself, or null. A
 * browser starts the numbering of a list with the counter-reset: list-item its default style gives
 * every <ul>, <ol> and <menu> (HTML rendering, 15.3.7), and an author counter-reset replaces it. The
 * bench cannot tell which elements a rule reaches, so where the markup carries a list, every
 * counter-reset names list-item, and `all`, which sets counter-reset with every other property, is
 * revert or revert-layer.
 */
export function listResetRefusal(elements: ReadonlyArray<MarkupElement>, declarations: ReadonlyArray<DeclarationRead>): string | null {
  const list = elements.find(e => LIST_PARENTS.has(e.name));
  if (!list) return null;
  const carries = `The markup carries ${list.name === 'ol' ? 'an' : 'a'} <${list.name}>`;
  const where = 'Where the markup carries a <ul>, <ol> or <menu>';
  for (const d of declarations) {
    if (d.keyword !== null && KEEPS_RESET.has(d.keyword)) continue;
    if (d.property === 'counter-reset' && !(d.parts ?? []).some(resetsListItem)) {
      const fix = `counter-reset: ${NAMES_NONE.has(d.keyword ?? '') ? '' : `${d.text.replace(/\s+/g, ' ').slice(0, 40)} `}list-item`;
      return `${carries}, whose items a browser numbers from the counter-reset: list-item that its default style gives every <ul>, <ol> and <menu>. `
        + `The declaration "${quote(d)}" can reach that list and replace its reset, and a browser that numbers lists by the list-item counter then numbers the list's items ${AROUND_ITEMS}, `
        + `whose items after them count on from them. ${where}, every counter-reset also names list-item: "${fix}".`;
    }
    if (d.property === 'all') {
      return `${carries}, and the declaration "${quote(d)}" sets counter-reset to none wherever it reaches, which drops the counter-reset: list-item that a list's default style gives it: `
        + `a browser that numbers lists by the list-item counter then numbers the list's items ${AROUND_ITEMS}. ${where}, "all" takes only revert or revert-layer, which keep that reset.`;
    }
  }
  return null;
}
