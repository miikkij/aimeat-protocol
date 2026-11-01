/**
 * @file iam/panel-parties.js
 * @description MemberAdmin's section for the people registered to the app without an account
 *   (aimeat-parties, plan doc-mvwxcas3dom3, D4), so the owner manages every member in one panel (WP9d).
 *   It shows the signup setting in plain words, the node's setting first (off, the operator approves,
 *   or the owner decides), with Open or Close and the role a newcomer gets; then each person with their
 *   name, address, the day they joined and were last seen, their state, a role select, Stop or Let in
 *   again, and Remove, which ends the sign-in and deletes what they kept in the app. A role that
 *   manages the roster is refused by the node, and the panel shows the refusal.
 *   Rendered only on the node roster (init with { app }); an extension-only app has no such list.
 * @structure partiesSection(iam, h) → Promise<HTMLElement|null> · isAppPartyRow(id)
 * @usage const sec = await partiesSection(iam, { S, cls, act, roles }); if (sec) wrap.appendChild(sec);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9d).
 */
import { el, fmtDate } from './dom.js';

/**
 * Is this roster row a person registered to the app (`party:<owner>/ap-…`)? MemberAdmin lists them
 * in this section, not among the account holders.
 * @param {string} id
 * @returns {boolean}
 */
export function isAppPartyRow(id) {
  return /^party:[^/]+\/ap-/.test(String(id || ''));
}

/**
 * The section, or null when the app has no node roster or the list is refused.
 * @param {any} iam  The AIMEAT.iam surface.
 * @param {{ S: (k: string, v?: Record<string, string|number>) => string, cls: (hook: string) => string,
 *   act: (fn: () => Promise<any>) => Promise<void>, roles: string[] }} h
 * @returns {Promise<HTMLElement|null>}
 */
export async function partiesSection(iam, h) {
  const { S, cls, act } = h;
  const st = await iam.parties().catch((e) => {
    // A list that could not be read is left out rather than drawn as "nobody registered".
    console.debug('aimeat-iam: the registered people were not read', e);
    return null;
  });
  if (!st || st.ok === false) return null;
  const reg = st.registration || {};
  // The roles a registered person may hold: the app's own, never "owner".
  const roles = h.roles.filter((r) => r && r !== 'owner');
  const body = [el('h3', { cls: cls('aim-iam-h'), text: S('partiesTitle', { n: st.parties.length }) }),
    el('p', { cls: cls('aim-iam-lead'), text: S('partiesLead') })];

  // ── the signup: the node's setting first, then the app's own ──
  if (reg.node_setting === 'off' || reg.effective === 'off') {
    body.push(el('p', { cls: cls('aim-iam-muted'), text: S('partiesRegOff') }));
  } else {
    const line = reg.open ? S('partiesRegOpen', { role: reg.role || 'member' })
      : reg.state === 'requested' ? S('partiesRegRequested')
      : reg.state === 'refused' ? S('partiesRegRefused')
      : S('partiesRegClosed');
    const roleSel = roles.length ? el('select', { attrs: { 'aria-label': S('partiesRoleNew') } },
      roles.map((r) => el('option', { text: r, attrs: Object.assign({ value: r }, r === reg.role ? { selected: 'selected' } : {}) }))) : null;
    const isOpen = reg.open || reg.state === 'requested';
    body.push(el('div', { cls: cls('aim-iam-form') }, [
      el('span', { cls: cls('aim-iam-muted'), text: line }),
      isOpen ? null : roleSel,
      el('button', { cls: cls('aim-iam-btn'), text: isOpen ? S('partiesClose') : S('partiesOpen'), attrs: { type: 'button' },
        on: { click: () => act(() => iam.setRegistration(isOpen ? { open: false }
          : { open: true, role: roleSel ? /** @type {HTMLSelectElement} */ (roleSel).value : undefined })) } }),
    ]));
    if (reg.effective === 'apps-ask' && !reg.open) body.push(el('p', { cls: cls('aim-iam-lead'), text: S('partiesRegAsk') }));
  }

  // ── the people ──
  if (!st.parties.length) body.push(el('p', { cls: cls('aim-iam-empty'), text: S('partiesNone') }));
  for (const p of st.parties) {
    const sel = roles.length ? el('select', { attrs: { 'aria-label': S('colRole') } },
      roles.map((r) => el('option', { text: r, attrs: Object.assign({ value: r }, r === p.role ? { selected: 'selected' } : {}) }))) : null;
    if (sel) sel.addEventListener('change', () => act(() => iam.party('role', { name: p.name, party_ref: p.party_ref, role: /** @type {HTMLSelectElement} */ (sel).value })));
    const stopped = p.status === 'stopped';
    const name = p.display_name || p.name;
    body.push(el('div', { cls: cls('aim-iam-row') }, [
      el('span', { cls: cls('aim-iam-id'), text: name }),
      p.email ? el('span', { cls: cls('aim-iam-muted'), text: p.email }) : null,
      el('span', { cls: cls('aim-iam-muted'), text: S('partiesJoined', { d: fmtDate(p.verified_at || p.created_at) }) }),
      p.last_seen_at ? el('span', { cls: cls('aim-iam-muted'), text: S('partiesSeen', { d: fmtDate(p.last_seen_at) }) }) : null,
      p.status === 'pending' ? el('span', { cls: cls('aim-iam-badge'), text: S('partiesPending') }) : null,
      stopped ? el('span', { cls: cls('aim-iam-badge') + ' ' + cls('aim-iam-warn'), text: S('partiesStopped') }) : null,
      (!sel && p.role) ? el('span', { cls: cls('aim-iam-badge'), text: p.role }) : null,
      sel,
      el('button', { cls: cls('aim-iam-btn'), text: stopped ? S('partiesResume') : S('partiesStop'), attrs: { type: 'button' },
        on: { click: () => act(() => iam.party(stopped ? 'resume' : 'stop', p)) } }),
      el('button', { cls: cls('aim-iam-btn'), text: S('remove'), attrs: { type: 'button' },
        on: { click: () => {
          // Removing deletes what the person kept in the app, so it is asked once.
          const sure = typeof window.confirm === 'function' ? window.confirm(S('partiesRemoveConfirm', { name: name })) : true;
          if (sure) return act(() => iam.party('remove', p));
          return undefined;
        } } }),
    ]));
  }
  return el('section', { cls: cls('aim-iam-sec') }, body);
}
