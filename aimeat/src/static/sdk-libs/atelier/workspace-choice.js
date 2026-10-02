/**
 * @file atelier/workspace-choice.js
 * @description The workspace an app chose, shared between workspacePicker and the blocks below it.
 *   workspacePicker reports its choice through onReady, and a mosaic prop cannot carry a callback,
 *   so the picker also announces the choice here: the last choice per app is kept, and one window
 *   event `aimeat-workspace-change` { app, orgId, wsId, name?, orgName?, recalled } is sent when it
 *   changes. workspaceTeam, intakeForm and intakeAdmin given `app` and no org or ws follow it: they
 *   say "choose above" until a choice exists, then mount on that workspace, and mount again when the
 *   person picks another. A page without a picker still opens on the choice the app made before
 *   (AIMEAT.organism.recall, the same `<app>.workspace` record the picker writes). When the person
 *   keeps the app private (workspacePicker allowPrivate), the event carries `private: true` with
 *   orgId and wsId null, and a following block says there is nothing to share instead.
 * @structure WORKSPACE_EVENT · announceWorkspace(app, choice) · announcePrivate(app) ·
 *   chosenWorkspace(app) · pickerOpened(app) · followsWorkspace(spec) · followWorkspace(spec, factory)
 * @usage
 *   if (followsWorkspace(spec)) return followWorkspace(spec, workspaceTeam);   // first line of a block
 *   window.addEventListener('aimeat-workspace-change', (e) => console.log(e.detail.wsId));
 * @version-history
 *   v0.63.0 — 2026-10-02 — announcePrivate(app): the choice of no shared workspace reaches the
 *     following blocks, which show one line (follow.private) instead of the last workspace.
 *   v0.62.0 — 2026-10-01 — Initial (workspacePicker as a mosaic block).
 */
import { el, clear, resolve } from './dom.js';
import { tw } from './workspace-i18n.js';
import { isPlaceholder, watch } from './members-shared.js';

/** The window event a choice sends. */
export const WORKSPACE_EVENT = 'aimeat-workspace-change';

/** @type {Map<string, { orgId: string, wsId: string } | { private: true }>} the last choice per app on this page */
const CHOSEN = new Map();

/** @type {Map<string, number>} how many pickers per app are on the page */
const PICKERS = new Map();

/**
 * A picker for `app` is on the page until the returned function runs. A follower then waits for
 * the picker's answer instead of reading the remembered choice itself.
 * @param {string} app
 */
export function pickerOpened(app) {
  PICKERS.set(app, (PICKERS.get(app) || 0) + 1);
  let open = true;
  return function () {
    if (!open) return;
    open = false;
    const n = (PICKERS.get(app) || 1) - 1;
    if (n > 0) PICKERS.set(app, n); else PICKERS.delete(app);
  };
}

/**
 * Keep an app's choice and tell the page, once per change.
 * @param {string} app
 * @param {{ orgId: string, wsId: string, name?: string, orgName?: string, recalled?: boolean }} choice
 */
export function announceWorkspace(app, choice) {
  if (!app || !choice || !choice.orgId || !choice.wsId) return;
  const before = /** @type {any} */ (CHOSEN.get(app));
  if (before && before.orgId === choice.orgId && before.wsId === choice.wsId) return;
  CHOSEN.set(app, { orgId: choice.orgId, wsId: choice.wsId });
  send({ app: app, orgId: choice.orgId, wsId: choice.wsId, name: choice.name, orgName: choice.orgName, recalled: !!choice.recalled });
}

/**
 * Keep an app's choice of no shared workspace and tell the page, once per change. The event's
 * detail is { app, orgId: null, wsId: null, private: true, recalled }.
 * @param {string} app
 * @param {boolean} [recalled]
 */
export function announcePrivate(app, recalled) {
  if (!app) return;
  const before = /** @type {any} */ (CHOSEN.get(app));
  if (before && before.private) return;
  CHOSEN.set(app, { private: true });
  send({ app: app, orgId: null, wsId: null, private: true, recalled: !!recalled });
}

/** One `aimeat-workspace-change` event on the window. @param {Record<string, any>} detail */
function send(detail) {
  try {
    window.dispatchEvent(new CustomEvent(WORKSPACE_EVENT, { detail: detail }));
  } catch (e) {
    console.debug('aimeat-atelier: workspace choice not announced', e);
  }
}

/** The app's choice on this page ({ orgId, wsId }, or { private: true }), or null. @param {string} app */
export function chosenWorkspace(app) {
  return CHOSEN.get(app) || null;
}

/** An empty prop or a fill's placeholder. */
function unset(v) {
  return !v || isPlaceholder(v);
}

/**
 * Whether a block follows the app's chosen workspace: it names a real app and leaves org and ws
 * empty, and it does not ask for the sample.
 * @param {any} spec
 */
export function followsWorkspace(spec) {
  return !!spec && spec.sample !== true && !!spec.app && !isPlaceholder(spec.app) && unset(spec.org) && unset(spec.ws);
}

/**
 * Mount `factory` on the app's chosen workspace, and again on every new choice.
 * @template {{ el: HTMLElement, refresh?: () => Promise<void>, destroy: () => void }} H
 * @param {any} spec
 * @param {(spec: any) => H} factory
 * @returns {{ el: HTMLElement, refresh: () => Promise<void>, destroy: () => void }}
 */
export function followWorkspace(spec, factory) {
  const root = el('div', { class: 'ak-ws-follow', 'data-ak-part': 'follow' });
  if (spec.target) resolve(spec.target).appendChild(root);
  /** @type {H|null} */
  let inner = null;
  let at = '';
  let stopped = false;

  /** One line in place of the block: `key` is follow.wait before a choice, follow.private after the private one. */
  function line(key) {
    clear(root);
    root.appendChild(el('section', { class: 'ak-root ak-mem ak-ws', 'data-ak-part': 'root' }, [
      el('p', { class: 'ak-mem__none', role: 'status', 'data-ak-part': key === 'follow.wait' ? 'wait' : 'private' }, tw(key)),
    ]));
  }
  function waiting() { line('follow.wait'); }

  /** @param {any} c  { orgId, wsId }, or { private: true } for no shared workspace */
  function mount(c) {
    if (stopped || !c) return;
    if (c.private) {
      // The app keeps its records out of every workspace: the block has nothing to open on.
      if (at === 'private') return;
      at = 'private';
      if (inner) inner.destroy();
      inner = null;
      line('follow.private');
      return;
    }
    if (!c.orgId || !c.wsId) return;
    const key = c.orgId + '/' + c.wsId;
    if (key === at) return;
    at = key;
    if (inner) inner.destroy();
    clear(root);
    // org and ws set, so the block draws itself and does not follow again.
    inner = factory(Object.assign({}, spec, { target: root, org: c.orgId, ws: c.wsId }));
  }

  /** @param {Event} ev */
  function onChoice(ev) {
    const d = /** @type {any} */ (ev).detail;
    if (d && d.app === spec.app) mount(d);
  }

  // A page without the picker: the choice the app made before, checked as the picker checks it.
  async function recall() {
    if (PICKERS.has(spec.app)) return;
    const ns = /** @type {any} */ (window).AIMEAT;
    const o = ns && ns.organism;
    if (!o || typeof o.recall !== 'function') return;
    try {
      const c = await o.recall(spec.app, { verify: true });
      if (!at && c && c.orgId && c.wsId) mount(c);
    } catch (e) {
      console.debug('aimeat-atelier: remembered workspace not read', e);
    }
  }

  window.addEventListener(WORKSPACE_EVENT, onChoice);
  const known = chosenWorkspace(spec.app);
  if (known) mount(known);
  else { waiting(); recall(); }
  // Before a choice, a sign-in may bring one and a language change redraws the sentence.
  const stopWatch = watch(function () {
    if (at === 'private') { line('follow.private'); return; }
    if (at) return;
    waiting();
    recall();
  }, root);

  return {
    el: root,
    refresh: function () { return inner && inner.refresh ? inner.refresh() : Promise.resolve(); },
    destroy: function () {
      stopped = true;
      window.removeEventListener(WORKSPACE_EVENT, onChoice);
      stopWatch();
      if (inner) inner.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
