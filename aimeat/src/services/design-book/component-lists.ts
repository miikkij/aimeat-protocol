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
 * @structure listItemMarkupRefusal(elements) · displayRefusal(declaration) · summaryCounterRefusal(elements, declarations, prefix) ·
 *   countsListItemZero(parts, at)
 * @usage const why = listItemMarkupRefusal(elements); if (why) refuse(why);
 * @version-history
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
