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
 *   THE WORKSPACE IT CREATES. `objectTypes`, `schemas` (namespace → JSON Schema, locked by the node)
 *   and `manifest` (a whole workspace manifest; its objectTypes, name and kind fill from the spec
 *   when missing) pass through to findOrCreateWorkspace, so a CRM or a sales space is created with
 *   the app's own locked record schemas. Without objectTypes a new workspace gets one records space.
 *
 *   KEEP IT PRIVATE. `allowPrivate: true` adds the choice of no shared workspace (LATTICE's private
 *   home): onReady(null) runs, the choice is remembered ({ private: true }) and the one-line view
 *   says the records stay private.
 *
 *   SEVERAL WORKSPACES. `multiple: true` keeps a list (LÄHETIN's spaces): the one-line view becomes
 *   the list with the one in use marked, "Use this" on the others, "Remove from list" on each and
 *   "Add a workspace", and the choose screen asks the new workspace's name. onReady(list, current)
 *   runs on every change; current is null when the private choice is in use. The list is kept with
 *   AIMEAT.organism.rememberList under the same `<app>.workspace` key, the current one first, so
 *   the blocks that follow the app's choice open on the one in use.
 *
 *   WHAT FETCHES AND WHY. The kit renders; it does not fetch. Every read and write goes through
 *   AIMEAT.organism (organisms, findOrCreateWorkspace, remember, recall, rememberList, recallList,
 *   and workspaces for the workspace's name on the one-line view), feature-detected on the page.
 *
 *   THE SAMPLE STATE. `sample: true`, or an `app` that is still a fill's <placeholder>, draws marked
 *   sample organisms and changes nothing; onReady is never called.
 *
 *   THE BLOCKS BELOW IT. Every choice, recalled or picked, is also announced (workspace-choice.js):
 *   one window event `aimeat-workspace-change`, and workspaceTeam, intakeForm and intakeAdmin given
 *   the same `app` and no org or ws open on it. That is how the picker works as a mosaic block,
 *   where a prop cannot carry onReady. The private choice is announced with `private: true`.
 * @parts workspacePicker root · title · intro · failure · using · change · orgs · row · who · chip · use · create · createGo · cancel · working · private · privateGo · wsName · wsNameInput · list · entry · entryText · acts · current · switch · remove · hint · add
 * @slots workspacePicker onReady(choice) · onReady(list, current) with multiple
 * @variants workspacePicker dense
 * @tokens workspacePicker --ak-mem-width
 * @fork workspacePicker Copying it out means calling AIMEAT.organism's recall(app, { verify: true }), organisms(), findOrCreateWorkspace() and remember() yourself, in that order, and keeping the one-line view of a remembered choice; with multiple, recallList() and rememberList() instead of recall() and remember().
 * @structure workspacePicker(spec) · findArgs · start · draw (using line, list, choose) · pick · choosePrivate · switchTo · removeEntry · names · the sample
 * @usage
 *   AIMEAT.atelier.workspacePicker({ target: '#home', app: 'cadence', name: 'CRM', kind: 'cadence-crm',
 *     purpose: 'Customers and deals', objectTypes, schemas: CRM_SCHEMAS, onReady: (c) => openWorkspace(c.orgId, c.wsId) });
 *   AIMEAT.atelier.workspacePicker({ target, app: 'lattice', name: 'LATTICE', allowPrivate: true, onReady: (c) => setHome(c) });
 *   AIMEAT.atelier.workspacePicker({ target, app: 'lahetin', name: 'Space', multiple: true, onReady: (list, now) => open(now) });
 * @version-history
 *   v0.63.0 — 2026-10-02 — schemas and manifest pass through to findOrCreateWorkspace; allowPrivate
 *     (onReady(null), remembered); multiple (a kept list with switch, remove and add). Without
 *     them the block draws and calls exactly what it did.
 *   v0.62.0 — 2026-10-01 — The choice is announced to the page (workspace-choice.js), so the picker
 *     is a mosaic block and the blocks below it follow its choice. Without objectTypes a new
 *     workspace gets one records space; the node refused the manifest without one.
 *   v0.61.0 — 2026-10-01 — Initial (IAM plan Phase D block 3).
 */
import { el, clear, resolve, enter } from './dom.js';
import { tw } from './workspace-i18n.js';
import { isPlaceholder, sampleBadge, watch, refusal, person } from './members-shared.js';
import { announceWorkspace, announcePrivate, pickerOpened } from './workspace-choice.js';

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

/** A prop that is on: true, or the string 'true' a mosaic prop carries. */
function on(v) {
  return v === true || v === 'true';
}

/** Whether two choices name the same workspace. */
function same(a, b) {
  return !!a && !!b && a.orgId === b.orgId && a.wsId === b.wsId;
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
 *   objectTypes?: any[], schemas?: Record<string, any>, manifest?: Record<string, any>,
 *   allowPrivate?: boolean|'true', multiple?: boolean|'true', title?: string, sample?: boolean,
 *   variant?: 'dense',
 *   onReady?: (choice: (PickedWorkspace|PickedWorkspace[]|null), current?: (PickedWorkspace|null)) => any }} spec
 * @returns {{ el: HTMLElement, choice: () => (PickedWorkspace|null), list: () => PickedWorkspace[],
 *   isPrivate: () => boolean, change: () => void, refresh: () => Promise<void>, destroy: () => void }}
 */
export function workspacePicker(spec) {
  const sample = !!spec && (spec.sample === true || !spec.app || isPlaceholder(spec.app));
  const variant = spec.variant === 'dense' ? 'dense' : '';
  const allowPrivate = on(spec.allowPrivate);
  const multiple = on(spec.multiple);
  const root = el('section', {
    class: 'ak-root ak-mem ak-ws ak-ws--picker' + (variant ? ' ak-ws--' + variant : ''),
    'data-ak-part': 'root', 'data-ak-variant': variant || null,
  });
  if (spec.target) resolve(spec.target).appendChild(root);
  const wsName = String(spec.name || spec.app || '').trim();
  // While this picker is on the page, the blocks that follow its app wait for its answer.
  const closed = sample ? function () { /* the sample announces nothing */ } : pickerOpened(spec.app);
  const noop = function () { /* the sample changes nothing */ };

  /** @type {'loading'|'noLib'|'signedOut'|'using'|'choose'|'working'} */
  let mode = 'loading';
  /** @type {PickedWorkspace|null} the workspace in use */
  let choice = null;
  // The private choice is in use (allowPrivate): no shared workspace.
  let priv = false;
  /** @type {PickedWorkspace[]} the kept list (multiple) */
  let kept = [];
  /** @type {Array<{ id: string, name: string, role: string }>|null} */
  let orgs = null;
  let failure = '';
  let typedOrg = '';
  let typedWs = '';
  let who = '';
  // Each start() is one generation; an answer that arrives after a newer start is dropped.
  let gen = 0;

  function lib() { return sample ? null : orgLib(); }

  function button(label, tone, part, run, disabled) {
    return el('button', {
      type: 'button', class: 'ak-btn ak-btn--' + tone, 'data-ak-part': part, disabled: disabled ? true : null, on: { click: run },
    }, label);
  }

  function callReady(args) {
    if (typeof spec.onReady !== 'function') return;
    try {
      Promise.resolve(spec.onReady.apply(null, args)).catch(function (e) { console.error('aimeat-atelier: workspacePicker onReady failed', e); });
    } catch (e) {
      console.error('aimeat-atelier: workspacePicker onReady failed', e);
    }
  }

  /** Tell the page and the app what is in use now: `c`, or the private choice when priv is set. */
  function report(c) {
    if (sample) return;
    // The blocks below that follow this app's choice (workspace-choice.js) hear it here.
    if (priv) announcePrivate(spec.app, false);
    else if (c) announceWorkspace(spec.app, c);
    if (multiple) callReady([kept.slice(), priv ? null : c]);
    else callReady([priv ? null : c]);
  }

  /** The findOrCreateWorkspace options for a pick in `target`, under the workspace name `name`. */
  function findArgs(target, name) {
    /** @type {Record<string, any>} */
    const args = {
      org: target.id ? target.id : { name: target.name }, name: name,
      kind: spec.kind, purpose: spec.purpose,
      objectTypes: Array.isArray(spec.objectTypes) && spec.objectTypes.length ? spec.objectTypes : DEFAULT_OBJECT_TYPES,
    };
    if (spec.schemas && typeof spec.schemas === 'object') args.schemas = spec.schemas;
    if (spec.manifest && typeof spec.manifest === 'object') {
      const m = Object.assign({}, spec.manifest);
      if (!m.name) m.name = name;
      if (!Array.isArray(m.objectTypes) || !m.objectTypes.length) m.objectTypes = args.objectTypes;
      args.manifest = m;
      // The manifest's kind is the app's marker too: a same-named workspace of another app is passed over.
      if (!args.kind && typeof m.kind === 'string' && m.kind) args.kind = m.kind;
    }
    return args;
  }

  function head() {
    root.appendChild(el('h3', { class: 'ak-mem__title', 'data-ak-part': 'title' },
      [spec.title || tw('picker.title'), sample ? sampleBadge() : null].filter(Boolean)));
    root.appendChild(el('p', { class: 'ak-mem__intro ak-ws__explain', 'data-ak-part': 'intro' }, tw(multiple ? 'picker.introMany' : 'picker.intro')));
  }

  function failureLine() {
    if (failure) root.appendChild(el('p', { class: 'ak-mem__failure', role: 'alert', 'data-ak-part': 'failure' }, tw('failed', { why: failure })));
  }

  /** multiple: the kept workspaces, the one in use marked, with switch, remove and add. */
  function drawList() {
    root.appendChild(el('h3', { class: 'ak-mem__title', 'data-ak-part': 'title' }, tw('picker.listTitle')));
    failureLine();
    const rows = kept.map(function (c) {
      const now = !priv && same(choice, c);
      return el('li', { class: 'ak-mem__row ak-ws__entry', 'data-ak-part': 'entry', 'data-ak-current': now ? 'true' : null }, [
        el('span', { class: 'ak-ws__entry-text', 'data-ak-part': 'entryText' }, tw('picker.entry', { ws: c.name || wsName, org: c.orgName || c.orgId })),
        el('span', { class: 'ak-mem__acts', 'data-ak-part': 'acts' }, [
          now ? el('span', { class: 'ak-ws__chip', 'data-ak-part': 'current' }, tw('picker.current'))
            : button(tw('picker.switch'), 'ghost', 'switch', function () { switchTo(c); }),
          button(tw('picker.remove'), 'ghost', 'remove', function () { removeEntry(c); }),
        ]),
      ]);
    });
    if (allowPrivate) {
      rows.push(el('li', { class: 'ak-mem__row ak-ws__entry', 'data-ak-part': 'entry', 'data-ak-current': priv ? 'true' : null, 'data-ak-private': 'true' }, [
        el('span', { class: 'ak-ws__entry-text', 'data-ak-part': 'entryText' }, tw('picker.privateEntry')),
        el('span', { class: 'ak-mem__acts', 'data-ak-part': 'acts' }, [
          priv ? el('span', { class: 'ak-ws__chip', 'data-ak-part': 'current' }, tw('picker.current'))
            : button(tw('picker.switch'), 'ghost', 'switch', function () { choosePrivate(); }),
        ]),
      ]));
    }
    root.appendChild(el('ul', { class: 'ak-mem__rows ak-ws__list', 'data-ak-part': 'list' }, rows));
    if (kept.length) root.appendChild(el('p', { class: 'ak-mem__hint', 'data-ak-part': 'hint' }, tw('picker.listHint')));
    root.appendChild(button(tw('picker.add'), 'primary', 'add', function () { change(); }));
  }

  function draw() {
    clear(root);
    if (mode === 'using' && multiple) { drawList(); return; }
    if (mode === 'using' && priv) {
      failureLine();
      root.appendChild(el('p', { class: 'ak-ws__using', 'data-ak-part': 'using' }, [
        el('span', { class: 'ak-ws__using-text' }, tw('picker.usingPrivate')),
        button(tw('picker.change'), 'ghost', 'change', function () { change(); }),
      ]));
      return;
    }
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
    if (multiple) {
      // Several workspaces per organism are told apart by name, so a new one asks its name.
      const wsIn = /** @type {HTMLInputElement} */ (el('input', {
        type: 'text', class: 'ak-input ak-mem__name', placeholder: tw('picker.wsName'), 'aria-label': tw('picker.wsName'),
        disabled: sample ? true : null, autocomplete: 'off', maxlength: '120', 'data-ak-part': 'wsNameInput',
      }));
      wsIn.value = typedWs || wsName;
      wsIn.addEventListener('input', function () { typedWs = wsIn.value; });
      root.appendChild(el('div', { class: 'ak-mem__group', 'data-ak-part': 'wsName' }, [
        el('h4', { class: 'ak-mem__group-title' }, tw('picker.wsName')),
        el('div', { class: 'ak-mem__field' }, [wsIn]),
      ]));
    }
    const list = orgs || [];
    root.appendChild(el('div', { class: 'ak-mem__group', 'data-ak-part': 'orgs' }, [
      el('h4', { class: 'ak-mem__group-title' }, tw('picker.choose')),
      el('p', { class: 'ak-mem__hint' }, tw('picker.wsWill', { name: multiple ? (typedWs.trim() || wsName) : wsName })),
      list.length
        ? el('ul', { class: 'ak-mem__rows' }, list.map(function (o) {
          return el('li', { class: 'ak-mem__row', 'data-ak-part': 'row' }, [
            person(o.name, null),
            el('span', { class: 'ak-mem__meta' }, [el('span', { class: 'ak-ws__chip', 'data-ak-part': 'chip' }, tw('orgRole.' + o.role))]),
            el('span', { class: 'ak-mem__acts' }, [
              button(tw('picker.use'), 'primary', 'use', sample ? noop : function () { pick(o); }, sample),
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
        button(tw('picker.createGo'), 'primary', 'createGo', sample ? noop : function () {
          const n = input.value.trim();
          typedOrg = n;
          if (n) pick({ name: n });
        }, sample),
      ]),
    ]));
    if (allowPrivate) {
      root.appendChild(el('div', { class: 'ak-mem__group', 'data-ak-part': 'private' }, [
        el('h4', { class: 'ak-mem__group-title' }, tw('picker.privateTitle')),
        el('p', { class: 'ak-mem__hint' }, tw('picker.privateHint')),
        button(tw('picker.privateGo'), 'ghost', 'privateGo', sample ? noop : function () { choosePrivate(); }, sample),
      ]));
    }
    if (choice || priv || kept.length) {
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
    if (mine === gen && mode === 'using' && (choice === c || kept.indexOf(c) >= 0)) draw();
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

  /** multiple: keep the list and the one in use (the private choice when priv is set). */
  function keepList(o) {
    const now = priv ? { private: true } : (choice ? { orgId: choice.orgId, wsId: choice.wsId } : null);
    const plain = kept.map(function (c) { return { orgId: c.orgId, wsId: c.wsId }; });
    if (typeof o.rememberList === 'function') return o.rememberList(spec.app, plain, now);
    // An older library keeps one choice: the one in use.
    return now ? o.remember(spec.app, now) : Promise.resolve(null);
  }

  /** Write the memory of the choice; a failure is shown and the choice stands for this visit. */
  async function keep(work) {
    try {
      await work();
    } catch (e) {
      // The workspace is ready; only the memory of the choice failed, so the app asks again next time.
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
    const name = multiple ? (typedWs.trim() || wsName) : wsName;
    /** @type {any} */
    let made;
    try {
      made = await o.findOrCreateWorkspace(findArgs(target, name));
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
    /** @type {PickedWorkspace} */
    const picked = {
      orgId: made.orgId, wsId: made.wsId, name: made.name || name,
      orgName: target.name || undefined, created: !!made.created, orgCreated: !!made.orgCreated, recalled: false,
    };
    if (multiple) {
      kept = kept.filter(function (c) { return !same(c, picked); }).concat([picked]);
      choice = picked;
      priv = false;
      await keep(function () { return keepList(o); });
    } else {
      await keep(function () { return o.remember(spec.app, { orgId: made.orgId, wsId: made.wsId }); });
      priv = false;
    }
    if (mine !== gen) return;
    typedOrg = '';
    typedWs = '';
    if (made.orgCreated) orgs = null;
    choice = picked;
    mode = 'using';
    draw();
    report(choice);
  }

  /** allowPrivate: no shared workspace; remembered, then onReady(null) (or onReady(list, null)). */
  async function choosePrivate() {
    const o = lib();
    if (!o) return;
    const mine = gen;
    failure = '';
    priv = true;
    if (!multiple) choice = null;
    await keep(function () { return multiple ? keepList(o) : o.remember(spec.app, { private: true }); });
    if (mine !== gen) return;
    mode = 'using';
    draw();
    report(null);
  }

  /** multiple: put another kept workspace in use. */
  async function switchTo(c) {
    const o = lib();
    if (!o) return;
    const mine = gen;
    failure = '';
    choice = c;
    priv = false;
    await keep(function () { return keepList(o); });
    if (mine !== gen) return;
    draw();
    report(c);
  }

  /** multiple: drop a workspace from the list (the workspace itself stays); the next one takes over. */
  async function removeEntry(c) {
    const o = lib();
    if (!o) return;
    const mine = gen;
    failure = '';
    const wasCurrent = !priv && same(choice, c);
    kept = kept.filter(function (x) { return !same(x, c); });
    if (wasCurrent) choice = kept[0] || null;
    await keep(function () { return keepList(o); });
    if (mine !== gen) return;
    if (!kept.length && !priv) {
      choice = null;
      await change();
      if (wasCurrent) report(null);
      return;
    }
    draw();
    if (wasCurrent) report(choice);
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

  /** multiple: the kept list and the one in use, from recallList (or recall on an older library). */
  async function recallKept(o) {
    if (typeof o.recallList === 'function') return o.recallList(spec.app, { verify: true });
    const one = await o.recall(spec.app, { verify: true });
    return one && one.orgId ? { list: [one], current: one, private: false } : null;
  }

  async function start() {
    const mine = ++gen;
    failure = '';
    choice = null;
    priv = false;
    kept = [];
    orgs = null;
    if (sample) { orgs = SAMPLE_ORGS.slice(); mode = 'choose'; draw(); return; }
    const o = lib();
    if (!o) { mode = 'noLib'; draw(); return; }
    who = identity();
    if (!who) { mode = 'signedOut'; draw(); return; }
    mode = 'loading';
    draw();
    /** @type {any} */
    let found = null;
    try {
      if (multiple) found = await recallKept(o);
      else found = await o.recall(spec.app, allowPrivate ? { verify: true, private: true } : { verify: true });
    } catch (e) {
      if (mine !== gen) return;
      failure = refusal(e) || String(e);
    }
    if (mine !== gen) return;
    if (multiple && found && (found.list.length || (found.private && allowPrivate))) {
      kept = found.list.map(function (c) { return /** @type {PickedWorkspace} */ ({ orgId: c.orgId, wsId: c.wsId, recalled: true }); });
      priv = !!found.private && allowPrivate && !found.current;
      choice = priv ? null : (kept.filter(function (c) { return same(c, found.current); })[0] || kept[0] || null);
      mode = 'using';
      report(choice);
      draw();
      // One entry after another: the first reads the organisms, the rest reuse them.
      (async function () { for (const c of kept) await names(c, mine); })();
      return;
    }
    if (!multiple && found && found.private && allowPrivate) {
      priv = true;
      mode = 'using';
      report(null);
      draw();
      return;
    }
    if (!multiple && found && found.orgId && found.wsId) {
      choice = { orgId: found.orgId, wsId: found.wsId, recalled: true };
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
    choice: function () { return priv ? null : choice; },
    list: function () { return kept.slice(); },
    isPrivate: function () { return priv; },
    change: function () { change(); },
    refresh: function () { return ready0.then(start); },
    destroy: function () { gen++; stop(); closed(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
