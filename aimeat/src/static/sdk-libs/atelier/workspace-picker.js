/**
 * @file atelier/workspace-picker.js
 * @description workspacePicker(): an app's first-run screen (IAM plan Phase D block 3). It answers
 *   one question, where the app keeps its records: in which organism, and in which workspace of it.
 *   A choice the app made before (recall with verify) is used at once: onReady(choice) runs and the
 *   block shrinks to one line, "Using <workspace> in <organism>", with a Change button. Otherwise
 *   it lists the caller's organisms with the role they hold there, plus a field to create a new
 *   organism; a pick finds the app's workspace in it or creates it, remembers the choice in the
 *   owner's memory, and calls onReady. A refusal shows the node's own sentence and keeps the typed
 *   organism name.
 *
 *   WHAT FETCHES AND WHY. The kit renders; it does not fetch. Every read and write goes through
 *   AIMEAT.organism (organisms, findOrCreateWorkspace, remember, recall, and workspaces for the
 *   workspace's name on the one-line view), feature-detected on the page.
 *
 *   THE SAMPLE STATE. `sample: true`, or an `app` that is still a fill's <placeholder>, draws marked
 *   sample organisms and changes nothing; onReady is never called.
 *
 *   THE BLOCKS BELOW IT. Every choice, recalled or picked, is also announced (workspace-choice.js):
 *   one window event `aimeat-workspace-change`, and workspaceTeam, intakeForm and intakeAdmin given
 *   the same `app` and no org or ws open on it. That is how the picker works as a mosaic block,
 *   where a prop cannot carry onReady.
 * @parts workspacePicker root · title · intro · failure · using · change · orgs · row · who · chip · use · create · createGo · cancel · working
 * @slots workspacePicker onReady(choice)
 * @variants workspacePicker dense
 * @tokens workspacePicker --ak-mem-width
 * @fork workspacePicker Copying it out means calling AIMEAT.organism's recall(app, { verify: true }), organisms(), findOrCreateWorkspace() and remember() yourself, in that order, and keeping the one-line view of a remembered choice.
 * @structure workspacePicker(spec) · start · draw · pick · names · the sample
 * @usage
 *   AIMEAT.atelier.workspacePicker({ target: '#home', app: 'cadence', name: 'CRM', kind: 'cadence-crm',
 *     purpose: 'Customers and deals', objectTypes, onReady: (c) => openWorkspace(c.orgId, c.wsId) });
 * @version-history
 *   v0.62.0 — 2026-10-01 — The choice is announced to the page (workspace-choice.js), so the picker
 *     is a mosaic block and the blocks below it follow its choice. Without objectTypes a new
 *     workspace gets one records space; the node refused the manifest without one.
 *   v0.61.0 — 2026-10-01 — Initial (IAM plan Phase D block 3).
 */
import { el, clear, resolve, enter } from './dom.js';
import { tw } from './workspace-i18n.js';
import { isPlaceholder, sampleBadge, watch, refusal, person } from './members-shared.js';
import { announceWorkspace, pickerOpened } from './workspace-choice.js';

const SAMPLE_ORGS = [
  { id: 'sample-shop', name: 'Shop team', role: 'owner' },
  { id: 'sample-club', name: 'Book club', role: 'member' },
];

/**
 * The space a new workspace gets when the app names none. The node refuses a manifest without at
 * least one space, and a picker placed from a stored layout cannot carry objectTypes, so without
 * this its first pick was refused. One records space; createWorkspace fills a schema that admits
 * every field.
 */
const DEFAULT_OBJECT_TYPES = [{
  name: 'record', schemaRef: 'schema:record@1', namespace: 'records', backing: 'memory',
  writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records',
}];

/** The page's AIMEAT.organism when it carries the first-run methods, or null. */
function orgLib() {
  const ns = /** @type {any} */ (window).AIMEAT;
  const o = ns && ns.organism;
  return o && typeof o.organisms === 'function' && typeof o.findOrCreateWorkspace === 'function'
    && typeof o.remember === 'function' && typeof o.recall === 'function' ? o : null;
}

/** Who is signed in on the page ('' when nobody): the session's owner or GHII. */
function identity() {
  const ns = /** @type {any} */ (window).AIMEAT;
  const auth = ns && ns.auth;
  if (!auth || typeof auth.getSession !== 'function') return '';
  try {
    const s = auth.getSession();
    if (!s) return '';
    return String(s.owner || s.ghii || (s.user && s.user.owner) || 'signed-in');
  } catch { return ''; }
}

/**
 * Where an app keeps its records. Names are filled when the block knows them; a remembered choice
 * reaches onReady before its names are read.
 * @typedef {{ orgId: string, wsId: string, name?: string, orgName?: string, created?: boolean,
 *   orgCreated?: boolean, recalled?: boolean }} PickedWorkspace
 */

/**
 * The first-run screen: choose an organism, find or create the app's workspace, remember it.
 * @param {{ target?: string|Element, app: string, name?: string, kind?: string, purpose?: string,
 *   objectTypes?: any[], title?: string, sample?: boolean, variant?: 'dense',
 *   onReady?: (choice: PickedWorkspace) => any }} spec
 * @returns {{ el: HTMLElement, choice: () => (PickedWorkspace|null), change: () => void,
 *   refresh: () => Promise<void>, destroy: () => void }}
 */
export function workspacePicker(spec) {
  const sample = !!spec && (spec.sample === true || !spec.app || isPlaceholder(spec.app));
  const variant = spec.variant === 'dense' ? 'dense' : '';
  const root = el('section', {
    class: 'ak-root ak-mem ak-ws ak-ws--picker' + (variant ? ' ak-ws--' + variant : ''),
    'data-ak-part': 'root', 'data-ak-variant': variant || null,
  });
  if (spec.target) resolve(spec.target).appendChild(root);
  const wsName = String(spec.name || spec.app || '').trim();
  // While this picker is on the page, the blocks that follow its app wait for its answer.
  const closed = sample ? function () { /* the sample announces nothing */ } : pickerOpened(spec.app);

  /** @type {'loading'|'noLib'|'signedOut'|'using'|'choose'|'working'} */
  let mode = 'loading';
  /** @type {PickedWorkspace|null} */
  let choice = null;
  /** @type {Array<{ id: string, name: string, role: string }>|null} */
  let orgs = null;
  let failure = '';
  let typedOrg = '';
  let who = '';
  // Each start() is one generation; an answer that arrives after a newer start is dropped.
  let gen = 0;

  function lib() { return sample ? null : orgLib(); }

  function button(label, tone, part, run, disabled) {
    return el('button', {
      type: 'button', class: 'ak-btn ak-btn--' + tone, 'data-ak-part': part, disabled: disabled ? true : null, on: { click: run },
    }, label);
  }

  function report(c) {
    if (sample) return;
    // The blocks below that follow this app's choice (workspace-choice.js) hear it here.
    announceWorkspace(spec.app, c);
    if (typeof spec.onReady !== 'function') return;
    try {
      Promise.resolve(spec.onReady(c)).catch(function (e) { console.error('aimeat-atelier: workspacePicker onReady failed', e); });
    } catch (e) {
      console.error('aimeat-atelier: workspacePicker onReady failed', e);
    }
  }

  function head() {
    root.appendChild(el('h3', { class: 'ak-mem__title', 'data-ak-part': 'title' },
      [spec.title || tw('picker.title'), sample ? sampleBadge() : null].filter(Boolean)));
    root.appendChild(el('p', { class: 'ak-mem__intro ak-ws__explain', 'data-ak-part': 'intro' }, tw('picker.intro')));
  }

  function failureLine() {
    if (failure) root.appendChild(el('p', { class: 'ak-mem__failure', role: 'alert', 'data-ak-part': 'failure' }, tw('failed', { why: failure })));
  }

  function draw() {
    clear(root);
    if (mode === 'using' && choice) {
      failureLine();
      root.appendChild(el('p', { class: 'ak-ws__using', 'data-ak-part': 'using' }, [
        el('span', { class: 'ak-ws__using-text' }, tw('picker.using', {
          ws: choice.name || wsName, org: choice.orgName || choice.orgId,
        })),
        button(tw('picker.change'), 'ghost', 'change', function () { change(); }),
      ]));
      return;
    }
    head();
    if (mode === 'noLib') { root.appendChild(el('p', { class: 'ak-mem__none' }, tw('noLib'))); return; }
    if (mode === 'signedOut') { root.appendChild(el('p', { class: 'ak-mem__none' }, tw('picker.signIn'))); return; }
    if (mode === 'loading' || mode === 'working') {
      root.appendChild(el('p', { class: 'ak-mem__none', role: 'status', 'data-ak-part': 'working' },
        mode === 'working' ? tw('picker.working') : tw('loading')));
      return;
    }
    failureLine();
    if (sample) root.appendChild(el('p', { class: 'ak-mem__hint' }, tw('sample.note')));
    const list = orgs || [];
    root.appendChild(el('div', { class: 'ak-mem__group', 'data-ak-part': 'orgs' }, [
      el('h4', { class: 'ak-mem__group-title' }, tw('picker.choose')),
      el('p', { class: 'ak-mem__hint' }, tw('picker.wsWill', { name: wsName })),
      list.length
        ? el('ul', { class: 'ak-mem__rows' }, list.map(function (o) {
          return el('li', { class: 'ak-mem__row', 'data-ak-part': 'row' }, [
            person(o.name, null),
            el('span', { class: 'ak-mem__meta' }, [el('span', { class: 'ak-ws__chip', 'data-ak-part': 'chip' }, tw('orgRole.' + o.role))]),
            el('span', { class: 'ak-mem__acts' }, [
              button(tw('picker.use'), 'primary', 'use', sample ? function () { /* the sample changes nothing */ } : function () { pick(o); }, sample),
            ]),
          ]);
        }))
        : el('p', { class: 'ak-mem__none' }, tw('picker.none')),
    ]));
    const input = /** @type {HTMLInputElement} */ (el('input', {
      type: 'text', class: 'ak-input ak-mem__name', placeholder: tw('picker.orgName'), 'aria-label': tw('picker.orgName'),
      disabled: sample ? true : null, autocomplete: 'off', maxlength: '120',
    }));
    if (typedOrg) input.value = typedOrg;
    root.appendChild(el('div', { class: 'ak-mem__group', 'data-ak-part': 'create' }, [
      el('h4', { class: 'ak-mem__group-title' }, tw('picker.create')),
      el('div', { class: 'ak-mem__add' }, [
        el('div', { class: 'ak-mem__field' }, [input]),
        button(tw('picker.createGo'), 'primary', 'createGo', sample ? function () { /* the sample changes nothing */ } : function () {
          const n = input.value.trim();
          typedOrg = n;
          if (n) pick({ name: n });
        }, sample),
      ]),
    ]));
    if (choice) {
      root.appendChild(button(tw('picker.cancel'), 'ghost', 'cancel', function () { failure = ''; mode = 'using'; draw(); }));
    }
  }

  /** Read the organism's and the workspace's names for the one-line view; ids stay when unreadable. */
  async function names(c, mine) {
    const o = lib();
    if (!o) return;
    try {
      if (!c.orgName) {
        const list = orgs || await o.organisms();
        if (mine !== gen) return;
        orgs = orgs || list;
        const hit = (list || []).filter(function (x) { return x && x.id === c.orgId; })[0];
        if (hit) c.orgName = hit.name;
      }
      if (!c.name && typeof o.workspaces === 'function') {
        const rows = await o.workspaces(c.orgId);
        if (mine !== gen) return;
        const w = (rows || []).filter(function (x) { return x && x.id === c.wsId; })[0];
        if (w && w.name) c.name = w.name;
      }
    } catch (e) {
      console.debug('aimeat-atelier: workspace names not read', e);
    }
    if (mine === gen && mode === 'using' && choice === c) draw();
  }

  async function loadOrgs(mine) {
    const o = lib();
    try {
      const list = await o.organisms();
      if (mine !== gen) return;
      orgs = Array.isArray(list) ? list : [];
    } catch (e) {
      if (mine !== gen) return;
      orgs = [];
      failure = refusal(e) || String(e);
    }
  }

  async function pick(target) {
    const o = lib();
    if (!o) return;
    const mine = gen;
    failure = '';
    mode = 'working';
    draw();
    /** @type {any} */
    let made;
    try {
      made = await o.findOrCreateWorkspace({
        org: target.id ? target.id : { name: target.name }, name: wsName,
        kind: spec.kind, purpose: spec.purpose,
        objectTypes: Array.isArray(spec.objectTypes) && spec.objectTypes.length ? spec.objectTypes : DEFAULT_OBJECT_TYPES,
      });
      if (mine !== gen) return;
    } catch (e) {
      if (mine !== gen) return;
      failure = refusal(e) || String(e);
      mode = 'choose';
      draw();
      return;
    }
    // findOrCreateWorkspace answers null only with create: false, which this block never sends.
    if (!made || !made.orgId || !made.wsId) { mode = 'choose'; draw(); return; }
    try {
      await o.remember(spec.app, { orgId: made.orgId, wsId: made.wsId });
    } catch (e) {
      // The workspace is ready; only the memory of the choice failed, so the app asks again next time.
      failure = refusal(e) || String(e);
    }
    if (mine !== gen) return;
    typedOrg = '';
    if (made.orgCreated) orgs = null;
    choice = {
      orgId: made.orgId, wsId: made.wsId, name: made.name || wsName,
      orgName: target.name || undefined, created: !!made.created, orgCreated: !!made.orgCreated, recalled: false,
    };
    mode = 'using';
    draw();
    report(choice);
  }

  async function change() {
    const mine = gen;
    failure = '';
    if (!orgs) {
      mode = 'loading';
      draw();
      await loadOrgs(mine);
      if (mine !== gen) return;
    }
    mode = 'choose';
    draw();
  }

  async function start() {
    const mine = ++gen;
    failure = '';
    choice = null;
    orgs = null;
    if (sample) { orgs = SAMPLE_ORGS.slice(); mode = 'choose'; draw(); return; }
    const o = lib();
    if (!o) { mode = 'noLib'; draw(); return; }
    who = identity();
    if (!who) { mode = 'signedOut'; draw(); return; }
    mode = 'loading';
    draw();
    /** @type {any} */
    let kept = null;
    try {
      kept = await o.recall(spec.app, { verify: true });
    } catch (e) {
      if (mine !== gen) return;
      failure = refusal(e) || String(e);
    }
    if (mine !== gen) return;
    if (kept && kept.orgId && kept.wsId) {
      choice = { orgId: kept.orgId, wsId: kept.wsId, recalled: true };
      mode = 'using';
      report(choice);
      draw();
      names(choice, mine);
      return;
    }
    await loadOrgs(mine);
    if (mine !== gen) return;
    mode = 'choose';
    draw();
  }

  const ready0 = start().then(function () { enter(root); }, function (e) {
    failure = refusal(e) || String(e);
    mode = 'choose';
    draw();
  });
  // A sign-in or sign-out starts over for the new person; a language change only draws again.
  const stop = watch(function () {
    if (!sample && identity() !== who) start();
    else draw();
  }, root);
  return {
    el: root,
    choice: function () { return choice; },
    change: function () { change(); },
    refresh: function () { return ready0.then(start); },
    destroy: function () { gen++; stop(); closed(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
