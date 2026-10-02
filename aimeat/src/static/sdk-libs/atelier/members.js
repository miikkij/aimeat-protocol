/**
 * @file atelier/members.js
 * @description The app's own members, as kit components (wish-library-blocks-in-the-kit-and-the-
 *   design-book-iam-members-fi, block 1). Apps wrote this by hand: the access check, the member list
 *   with a role select, the approve and decline buttons, the join form. The data and the decisions
 *   are aimeat-iam.js's (AIMEAT.iam, feature-detected on the page); these components draw them in the
 *   kit's tokens, so the panel wears the app's look instead of the library's neutral one.
 *
 *   Three members:
 *     members      the owner's screen (members-admin.js, re-exported here)
 *     joinRequest  the visitor's side: ask for access, or see that you asked, or that you are in
 *     accessState  a members-only area: draws the app's own content for a member and the ask for
 *                  everybody else
 *
 *   WHAT FETCHES AND WHY. The kit's charter is "it renders; it does not fetch". These components
 *   fetch nothing themselves: every read and write goes through AIMEAT.iam, which the page loads and
 *   which holds the session. Without it the component says what is missing.
 *
 *   THE SAMPLE STATE. `sample: true`, or an `app` that is still a fill's <placeholder>, renders
 *   built-in sample content marked as such and changes nothing, so the Design Book shows what the
 *   screen looks like without a real app behind it.
 * @parts joinRequest root · title · intro · note · send · status
 * @parts accessState root · title · intro · join
 * @fork joinRequest Copying it out means reading me().requested and calling AIMEAT.iam.request(note) yourself.
 * @fork accessState Copying it out means asking AIMEAT.iam.can(cap) after init and drawing both sides yourself.
 * @structure members (re-exported) · joinRequest(spec) · accessState(spec)
 * @usage
 *   AIMEAT.atelier.joinRequest({ target: '#join', app: 'me/club.html' });
 *   AIMEAT.atelier.accessState({ target: '#tools', app: 'me/club.html', cap: 'use', render(host) { … } });
 *   REFUSALS IN THE PAGE'S LANGUAGE. A refusal the node answers with a code the members dictionary
 *   knows (REASK_TOO_SOON, SEATS_FULL, FORBIDDEN, ...) is said in the page's language, its date
 *   through the SDK's formatter; an unknown code keeps the node's own sentence (members-shared.js
 *   refusal).
 * @version-history
 *   v0.62.0 — 2026-10-02 — joinRequest says a refusal in the page's language, and a person declined
 *     less than a week ago reads when they may ask again instead of a form the node would refuse
 *     (me().requested.retryAt).
 *   v0.61.0 — 2026-10-01 — Initial. The owner's screen moved to members-admin.js and the shared
 *     helpers to members-shared.js when the screen grew.
 */
import { el, clear, resolve, enter } from './dom.js';
import { tm } from './members-i18n.js';
import { wantsSample, sampleBadge, watch, ready, refusal, refusalWords, day } from './members-shared.js';

export { members } from './members-admin.js';

// ── joinRequest: the visitor's side ──────────────────────────────────────────────────────────

/**
 * Ask for access, or see that you already asked, were declined, or are in. Renders nothing for the
 * app's owner, and asks a signed-out visitor to sign in.
 * @param {{ target?: string|Element, app: string, roles?: any, title?: string, sample?: boolean }} spec
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function joinRequest(spec) {
  const sample = wantsSample(spec);
  const root = el('section', { class: 'ak-root ak-mem ak-mem-join', 'data-ak-part': 'root' });
  if (spec.target) resolve(spec.target).appendChild(root);

  async function build() {
    clear(root);
    root.hidden = false;
    const status = el('p', { class: 'ak-mem__status', role: 'status', 'data-ak-part': 'status' });
    root.appendChild(el('h3', { class: 'ak-mem__title', 'data-ak-part': 'title' },
      [spec.title || tm('join.title'), sample ? sampleBadge() : null].filter(Boolean)));
    root.appendChild(el('p', { class: 'ak-mem__intro', 'data-ak-part': 'intro' }, sample ? tm('sample.note') : tm('join.intro')));

    function form(iam) {
      const note = /** @type {HTMLTextAreaElement} */ (el('textarea', {
        class: 'ak-input ak-input--area ak-mem__note', rows: '3', maxlength: '400',
        'aria-label': tm('join.note'), placeholder: tm('join.note'), 'data-ak-part': 'note', disabled: sample ? true : null,
      }));
      const ask = el('div', { class: 'ak-mem__ask' });
      const send = el('button', { type: 'button', class: 'ak-btn ak-btn--primary', 'data-ak-part': 'send', disabled: sample ? true : null, on: {
        click: function () {
          if (sample || !iam) return;
          iam.request(note.value.trim()).then(function (r) {
            status.textContent = r && r.alreadyMember ? tm('join.already') : tm('join.sent');
            // Sent is sent: the form goes, so the same ask is not sent twice.
            if (ask.parentNode) ask.parentNode.removeChild(ask);
          }, function (e) {
            status.textContent = tm('members.failed', { why: refusal(e) || String(e) });
          });
        },
      } }, tm('join.send'));
      ask.appendChild(note);
      ask.appendChild(send);
      root.appendChild(ask);
    }

    if (sample) { form(null); root.appendChild(status); return; }
    const iam = await ready(spec);
    if (!iam) { root.appendChild(el('p', { class: 'ak-mem__none' }, tm('members.noLib'))); return; }
    const me = iam.me();
    if (!me) { status.textContent = tm('join.signIn'); root.appendChild(status); return; }
    if (me.isOwner) { root.hidden = true; return; }
    if (me.member) {
      status.textContent = tm('join.member', { role: me.role || '' });
      root.appendChild(status);
      return;
    }
    const asked = me.requested;
    // A declined person may ask again a week later; until then the node refuses the ask, so the
    // block says when instead of offering a form that can only be refused.
    const waits = asked && asked.state === 'declined' && typeof asked.retryAt === 'string'
      && Date.parse(asked.retryAt) > Date.now();
    if (asked && asked.state === 'pending') status.textContent = tm('join.pending', { d: day(asked.at) });
    else if (waits) status.textContent = refusalWords('REASK_TOO_SOON', { retryAt: asked.retryAt });
    else {
      if (asked && asked.state === 'declined') status.textContent = tm('join.declined');
      form(iam);
    }
    root.appendChild(status);
  }

  function run() {
    return build().catch(function (e) {
      root.appendChild(el('p', { class: 'ak-mem__none' }, tm('members.failed', { why: refusal(e) || String(e) })));
    });
  }
  run().then(function () { enter(root); });
  const stop = watch(run, root);
  return { el: root, destroy: function () { stop(); if (root.parentNode) root.parentNode.removeChild(root); } };
}

// ── accessState: a members-only area ─────────────────────────────────────────────────────────

/**
 * A members-only area. For a caller whose role holds `cap` (and for the owner) it calls
 * `render(host, me)` to draw the app's own content; for everybody else it draws the ask. The node
 * enforces nothing on the page, so the data the content reads must be refused on the server too.
 * @param {{ target?: string|Element, app: string, roles?: any, cap: string, title?: string,
 *   render?: (host: HTMLElement, me: any) => void, sample?: boolean }} spec
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function accessState(spec) {
  const sample = wantsSample(spec);
  const root = el('section', { class: 'ak-root ak-mem ak-mem-access', 'data-ak-part': 'root' });
  if (spec.target) resolve(spec.target).appendChild(root);
  /** @type {{ destroy: () => void }|null} */
  let ask = null;

  function locked() {
    root.appendChild(el('h3', { class: 'ak-mem__title', 'data-ak-part': 'title' },
      [spec.title || tm('access.title'), sample ? sampleBadge() : null].filter(Boolean)));
    root.appendChild(el('p', { class: 'ak-mem__intro', 'data-ak-part': 'intro' }, tm('access.intro')));
    const join = el('div', { 'data-ak-part': 'join' });
    root.appendChild(join);
    ask = joinRequest({ target: join, app: spec.app, roles: spec.roles, sample: sample, title: tm('join.title') });
  }

  async function build() {
    // The ask inside listens on its own; the old one goes before a new one is drawn.
    if (ask) { ask.destroy(); ask = null; }
    clear(root);
    root.classList.remove('is-open');
    if (sample) { locked(); return; }
    const iam = await ready(spec);
    if (!iam) { root.appendChild(el('p', { class: 'ak-mem__none' }, tm('members.noLib'))); return; }
    const me = iam.me();
    if (me && (me.isOwner || iam.can(spec.cap))) {
      root.classList.add('is-open');
      if (typeof spec.render === 'function') spec.render(root, me);
      return;
    }
    locked();
  }

  function run() {
    return build().catch(function (e) {
      root.appendChild(el('p', { class: 'ak-mem__none' }, tm('members.failed', { why: refusal(e) || String(e) })));
    });
  }
  run();
  const stop = watch(run, root);
  return { el: root, destroy: function () { stop(); if (ask) ask.destroy(); if (root.parentNode) root.parentNode.removeChild(root); } };
}
