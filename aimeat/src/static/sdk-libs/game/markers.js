/**
 * @file game/markers.js
 * @description Two cards that mark a state rather than a value: the badge (a thing earned) and
 *   the coming-soon card (a thing deliberately not built yet).
 *
 *   AN UNEARNED BADGE IS NOT A FAILURE. It is drawn as an open, dashed seal with no cross and no
 *   red — the difference between "not yet" and "you lost" is the whole emotional content of the
 *   component, and getting it wrong makes an app feel punishing.
 *
 *   COMING SOON MUST READ AS INTENTIONAL. Every product grows a few of these, and the difference
 *   between a roadmap and a broken app is entirely in how this behaves: a planned chip, a
 *   full-strength card, a real sentence about what it will be — and NO dead link, no clickable
 *   path into an empty screen, no greyed-out button that looks like a bug. The only control it
 *   ever renders is a genuine "tell me when this opens", and only when the host supplied a
 *   handler for it.
 * @structure badge(spec) · comingSoon(spec)
 * @usage  AIMEAT.game.comingSoon({ title: 'Agent incubator',
 *           description: 'Your agents will run the venture while you sleep.',
 *           eta: 'Q4', notify: { onNotify: () => save() } });
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 01).
 */
import { el, clear, whileBusy } from './dom.js';
import { t, i18n } from './i18n.js';

/**
 * An earned marker.
 * @param {{
 *   title: string, description?: string, earned?: boolean,
 *   earnedAt?: string|number|Date, glyph?: string
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: any) => void, destroy: () => void }}
 */
export function badge(spec) {
  const state = {
    title: spec.title,
    description: spec.description,
    earned: !!spec.earned,
    earnedAt: spec.earnedAt,
  };

  const seal = el('span', { class: 'ag-badge__seal', 'aria-hidden': 'true' });
  const name = el('span', { class: 'ag-badge__name' });
  const desc = el('span', { class: 'ag-badge__desc' });
  const when = el('span', { class: 'ag-badge__when' });
  const text = el('span', {}, [name, desc, when]);
  const root = el('div', { class: 'ag-root ag-badge' }, [seal, text]);

  /** A date the viewer's locale understands, or the string the host already formatted. */
  function whenText() {
    if (!state.earned) return t('notEarned');
    if (state.earnedAt == null) return t('earned');
    const d = state.earnedAt instanceof Date ? state.earnedAt : new Date(state.earnedAt);
    const shown = Number.isNaN(d.getTime()) ? String(state.earnedAt) : d.toLocaleDateString(i18n.lang());
    return t('earnedOn', { when: shown });
  }

  function render() {
    root.className = 'ag-root ag-badge' + (state.earned ? ' ag-badge--earned' : '');
    seal.textContent = state.earned ? (spec.glyph || '✓') : '';
    name.textContent = state.title;
    desc.textContent = state.description || '';
    desc.hidden = !state.description;
    when.textContent = whenText();
  }

  const stopLang = i18n.onChange(render);
  render();

  return {
    el: root,
    /** @param {{ earned?: boolean, earnedAt?: any, title?: string, description?: string }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.earned != null) state.earned = !!patch.earned;
      if (patch.earnedAt !== undefined) state.earnedAt = patch.earnedAt;
      if (patch.title != null) state.title = patch.title;
      if (patch.description !== undefined) state.description = patch.description;
      render();
    },
    destroy() { stopLang(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * A stage that is planned, not broken.
 * @param {{
 *   title: string, description: string, eta?: string, chipLabel?: string,
 *   notify?: { label?: string, doneLabel?: string, onNotify: () => any, already?: boolean }
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: any) => void, destroy: () => void }}
 */
export function comingSoon(spec) {
  const state = {
    title: spec.title,
    description: spec.description,
    eta: spec.eta,
    notified: !!(spec.notify && spec.notify.already),
  };

  const name = el('h3', { class: 'ag-title' });
  const chip = el('span', { class: 'ag-chip ag-chip--info' });
  const top = el('div', { class: 'ag-soon__top' }, [name, chip]);
  const what = el('p', { class: 'ag-soon__what' });
  const foot = el('div', { class: 'ag-soon__foot' });
  const root = el('div', { class: 'ag-root ag-card ag-soon' }, [top, what, foot]);

  function render() {
    name.textContent = state.title;
    chip.textContent = spec.chipLabel || t('comingSoon');
    what.textContent = state.description;

    clear(foot);
    if (state.eta) foot.appendChild(el('span', { class: 'ag-soon__eta', text: t('eta', { when: state.eta }) }));
    if (!spec.notify) return;
    if (state.notified) {
      foot.appendChild(el('span', { class: 'ag-chip ag-chip--ok', text: '✓ ' + (spec.notify.doneLabel || t('notified')) }));
      return;
    }
    foot.appendChild(el('button', {
      type: 'button', class: 'ag-btn',
      on: {
        click: function (ev) {
          const btn = /** @type {HTMLElement} */ (ev.currentTarget);
          whileBusy(btn, spec.notify ? spec.notify.onNotify() : null).then(function () {
            state.notified = true;
            render();
          }).catch(function () { /* the host reports its own failure — the card stays as it was */ });
        },
      },
    }, spec.notify.label || t('notifyMe')));
  }

  const stopLang = i18n.onChange(render);
  render();

  return {
    el: root,
    /** @param {{ title?: string, description?: string, eta?: string, notified?: boolean }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.title != null) state.title = patch.title;
      if (patch.description != null) state.description = patch.description;
      if (patch.eta !== undefined) state.eta = patch.eta;
      if (patch.notified != null) state.notified = !!patch.notified;
      render();
    },
    destroy() { stopLang(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
