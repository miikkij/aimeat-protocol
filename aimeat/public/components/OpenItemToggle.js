/**
 * @file public/components/OpenItemToggle.js
 * @description The light that says whether something is on your open list, and the control that
 *   puts it there or takes it off.
 *
 *   THREE STATES, because the thing it reports has three (P5, and the mock in 03-pinnat-ja-ui.md):
 *
 *   | Light | Means |
 *   |---|---|
 *   | outline | not on your list |
 *   | amber | on your list, waiting |
 *   | green, pulsing | somebody is working on it right now |
 *
 *   The third one is why this is a light rather than a checkbox. An agent takes an item and sets it
 *   working; the person sees that happen where the thing is, without going to a list to look. A
 *   two-state control cannot say it, and the first version shipped with exactly two.
 *
 *   CLICKING IS STILL TWO-WAY. On and off, in the same place, both directions. `working` is not
 *   something you click into: it is what an agent does to an item and it appears by itself. You can
 *   always switch a working item off, because it is still your list.
 *
 *   IT LOOKS ITSELF UP. Callers do not have to know whether their subject is already on the list;
 *   they pass what the thing is and the control finds itself, on mount and on every
 *   `aimeat-live-update`. The first version took an `itemId` nobody passed, so a reload showed an
 *   unlit light over an item that was on the list. State a surface cannot restore is not state.
 * @structure OpenItemToggle({ title, kind, promptRef, promptArgs, origin, object, onChanged, label })
 * @usage
 *   html`<${OpenItemToggle} title=${app.name} kind="app" origin="app-catalog"
 *     object=${{ type: 'app', id: app.id }} />`
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial. Replaces the "save for later" row that used to live behind
 *     PromptCard's chevron on two room cards.
 *   v1.1.0 — 2026-08-09 — A light rather than a labelled button, and it reads its own state: three
 *     positions including `working`, restored on load and on live updates.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { addOpenItem, switchOff, listOpenItems } from '/js/services/open-items.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/**
 * Is this list row the same thing as this control?
 *
 * By `object` when there is one, because an app stays the same app whatever it is called today.
 * Otherwise by origin AND title together: origin alone would light every room card as soon as any
 * one of them was on the list, and title alone would collide across surfaces.
 */
function matches(item, { object, origin, title }) {
  if (object && item.object) return item.object.type === object.type && item.object.id === object.id;
  return item.origin === origin && item.title === title;
}

export function OpenItemToggle({
  title,
  kind = null,
  promptRef = null,
  promptArgs = null,
  origin = null,
  object = null,
  /** (item | null) => void after a flip. Optional; the control keeps its own state. */
  onChanged = null,
  /** Show the words next to the light. Off by default: this is an indicator, not a sentence. */
  label = false,
}) {
  const [item, setItem] = useState(null);
  const [busy, setBusy] = useState(false);
  const on = !!item;
  const working = item?.status === 'working';

  const find = useCallback(async () => {
    try {
      const list = await listOpenItems();
      setItem(list.find(i => matches(i, { object, origin, title })) ?? null);
    } catch (e) { swallowed('OpenItemToggle: find', e); }
  }, [object, origin, title]);

  useEffect(() => { find(); }, [find]);

  // The AI switches these on and off and takes them into `working` while a person is looking at the
  // page. Without this the light is only ever right until somebody else acts.
  useEffect(() => {
    const handler = () => find();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [find]);

  // The control can sit inside a card that is an <a> under the SPA's delegated link handler.
  // Without this, switching also navigates away — already learned once in views/home/feed.js.
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

  async function flip(e) {
    stop(e);
    if (busy) return;
    setBusy(true);
    try {
      if (on) {
        await switchOff(item.id);
        setItem(null);
        onChanged?.(null);
      } else {
        const made = await addOpenItem({
          title, kind, prompt_ref: promptRef, prompt_args: promptArgs, origin, object,
        });
        if (made) { setItem(made); onChanged?.(made); }
      }
    } catch (err) {
      swallowed('OpenItemToggle: flip', err);
    } finally {
      setBusy(false);
    }
  }

  const state = working ? 'working' : on ? 'open' : 'off';
  const who = working && item.agent ? String(item.agent).split('#')[0] + ' ' : '';
  const hint = working
    ? `${who}${tr('openItems.isDoing', 'is doing this')}`
    : on
      ? tr('openItems.toggleOff', 'Take it off your open items')
      : tr('openItems.toggleOn', 'Put it on your open items');
  const word = working
    ? tr('openItems.working', 'Being worked on')
    : on ? tr('openItems.on', 'Waiting') : tr('openItems.add', 'Add to open items');

  return html`
    <button type="button"
      class="open-toggle open-toggle--${state} ${label ? 'open-toggle--labelled' : ''}"
      aria-pressed=${on}
      aria-label=${hint}
      disabled=${busy}
      title=${hint}
      onClick=${flip}>
      <span class="open-toggle-light" aria-hidden="true"></span>
      ${label && html`<span class="open-toggle-text">${word}</span>`}
    </button>`;
}

export default OpenItemToggle;
