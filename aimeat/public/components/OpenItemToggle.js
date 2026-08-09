/**
 * @file public/components/OpenItemToggle.js
 * @description The one control that puts something on your open list, and takes it off again.
 *
 *   ONE control, TWO positions, in the SAME place. You switch it on where the thing is, and it is on
 *   your list. You come back to that same spot, switch it off, and it is not. That is the whole
 *   model, and every part of it is deliberate:
 *
 *   - **It is not "save for later".** That phrase promised a queue things go into and never come out
 *     of, and it told the person nothing about what would happen. The word for something switched on
 *     is "waiting"; the list is called "open items".
 *   - **Off is not a third state.** There is no done, no archive, no age. Switched off is simply not
 *     on the list, which is why the same control does both directions.
 *   - **The AI flips these too.** When it does, the row says so. A person has to be able to see that
 *     something happened here on their AI's behalf rather than their own, or the list stops being
 *     theirs.
 *
 *   The component is deliberately ignorant of what it is attached to. It takes a subject and a
 *   callback; an app, a room card and a piece of knowledge all use the identical control, because a
 *   marking that looks different in each place is one a person has to learn four times.
 * @structure OpenItemToggle({ title, kind, promptRef, promptArgs, origin, object, itemId,
 *   onChanged, label })
 * @usage
 *   html`<${OpenItemToggle} title=${app.name} kind="app" origin="app-catalog"
 *     object=${{ type: 'app', id: app.id }} onChanged=${reload} />`
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial. Replaces the "save for later" row that used to live behind
 *     PromptCard's chevron on two room cards.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { addOpenItem, switchOff } from '/js/services/open-items.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

export function OpenItemToggle({
  title,
  kind = null,
  promptRef = null,
  promptArgs = null,
  origin = null,
  object = null,
  /** Set when this thing is already on the list; the control then switches it off. */
  itemId = null,
  /** (nextItemId | null) => void — the caller keeps the id so the control can toggle back. */
  onChanged = null,
  /**
   * Show the words next to the light. OFF by default, and that is the point: this is a state
   * indicator you can flip, roughly a traffic light, not a button with a sentence on it. The first
   * version shipped a wide labelled button reading "Add to open items" and it dominated every card
   * it sat on for a control whose whole job is to be small and legible at a glance.
   */
  label = false,
}) {
  const [busy, setBusy] = useState(false);
  const [id, setId] = useState(itemId);
  const on = !!id;

  // The control can sit inside a card that is an <a> under the SPA's delegated link handler.
  // Without this, switching also navigates away — already learned once in views/home/feed.js.
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

  async function flip(e) {
    stop(e);
    if (busy) return;
    setBusy(true);
    try {
      if (on) {
        await switchOff(id);
        setId(null);
        onChanged?.(null);
      } else {
        const item = await addOpenItem({
          title, kind, prompt_ref: promptRef, prompt_args: promptArgs, origin, object,
        });
        if (item) { setId(item.id); onChanged?.(item.id); }
      }
    } catch (err) {
      swallowed('OpenItemToggle: flip', err);
    } finally {
      setBusy(false);
    }
  }

  const hint = on ? tr('openItems.toggleOff', 'Take it off your open items')
                  : tr('openItems.toggleOn', 'Put it on your open items');
  return html`
    <button type="button"
      class="open-toggle ${on ? 'open-toggle--on' : ''} ${label ? 'open-toggle--labelled' : ''}"
      aria-pressed=${on}
      aria-label=${hint}
      disabled=${busy}
      title=${hint}
      onClick=${flip}>
      <span class="open-toggle-light" aria-hidden="true"></span>
      ${label && html`<span class="open-toggle-text">
        ${on ? tr('openItems.on', 'Waiting') : tr('openItems.add', 'Add to open items')}
      </span>`}
    </button>`;
}

export default OpenItemToggle;
