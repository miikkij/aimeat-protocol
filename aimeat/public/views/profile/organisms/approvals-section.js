/**
 * @file public/views/profile/organisms/approvals-section.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism page's section for the approvals that wait in the organism. The list of
 *   everything that waits for a person (GET /v1/home/waiting) opens the organism's page for an
 *   approval that names no workspace, and until this section that page had no place to decide one.
 *   A person resolves an approval, never an agent, so such an approval could be decided only with
 *   a REST call.
 *
 *   One row per pending approval the reader may see (GET /v1/organisms/:id/approvals answers those):
 *   what is asked, who asks and when. A reader whose role decides it approves or rejects on the row
 *   (POST /v1/organisms/:id/approvals/:aid); any other reader is told who decides. A member's
 *   suggested workspace change is decided as the server decides it: by an owner or an admin of the
 *   organism here, never by the member who made it, with the word `decline`. An approval that names
 *   a workspace also opens that workspace, where a publish is read before it is approved.
 *
 *   The section draws nothing when nothing waits, and tells the page so (`onCount`), which numbers
 *   its sections and lists them in its contents rail. A team's page does not draw it: the team's
 *   own waiting section names the team's approvals (team-sections.js).
 * @structure OrgApprovals({ org, ghii, isCreator, isAdmin, showToast, onOpenWs, id, num, first, onCount }) ·
 *   decides(approval, reader)
 * @usage html`<${OrgApprovals} org=${org} ghii=${ghii} isCreator=${isCreator} isAdmin=${isAdmin}
 *   showToast=${showToast} onOpenWs=${onOpenWs} id="og-approvals" num="01" first onCount=${setN} />`
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import * as orgService from '/js/services/organisms.js';
import { swallowed } from '/js/swallowed.js';
import { fmtDate } from '/views/profile/organisms/helpers.js';
import { Section } from '/components/Section.js';
import { List, Row, Name, Desc, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);
const x = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v ?? '')), t(`organisms.approvals.${key}`));

/** The two actions a member's suggested workspace change is filed under (services/workspace/suggestion-notices.ts). */
const SUGGESTION_ACTIONS = ['workspace.space.add', 'workspace.sections.change'];

/** The account an identity acts for, as a row shows it: `helper#bob@node` and `bob@node` both give bob. */
function accountOf(identity) {
  const s = String(identity || '');
  const at = s.lastIndexOf('@');
  const whole = at > 0 ? s.slice(0, at) : s;
  const hash = whole.indexOf('#');
  return hash >= 0 ? whole.slice(hash + 1) : whole;
}

/**
 * Whether this reader decides the approval, and when not, which sentence says who does. The rule is
 * the server's (routes/organisms/gates.ts, services/workspace/suggestions.ts); this only keeps a
 * reader from pressing a button the server would refuse.
 * @param {{ action: string, actor?: string, approverRole?: string }} approval
 * @param {{ ghii: string, isCreator?: boolean, isAdmin?: boolean }} reader
 * @returns {{ may: boolean, why?: string }}
 */
export function decides(approval, { ghii, isCreator, isAdmin }) {
  if (SUGGESTION_ACTIONS.includes(approval.action)) {
    if (accountOf(approval.actor) === ghii) return { may: false, why: x('own') };
    return isCreator || isAdmin ? { may: true } : { may: false, why: x('needsAdmin') };
  }
  if (approval.approverRole === 'member') return { may: true };
  if (approval.approverRole === 'admin') return isCreator || isAdmin ? { may: true } : { may: false, why: x('needsAdmin') };
  return isCreator ? { may: true } : { may: false, why: x('needsOwner') };
}

/**
 * @param {{ org: { id: string }, ghii: string, isCreator?: boolean, isAdmin?: boolean,
 *   showToast?: (text: string, kind?: string) => void, onOpenWs?: (wsId: string) => void,
 *   id?: string, num?: string, first?: boolean, onCount?: (n: number) => void }} p
 */
export function OrgApprovals({ org, ghii, isCreator, isAdmin, showToast, onOpenWs, id, num, first, onCount }) {
  const [approvals, setApprovals] = useState(/** @type {any[] | null} */ (null));
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => orgService.listApprovals(org.id, 'pending')
    .then((list) => setApprovals(Array.isArray(list) ? list : []))
    .catch((err) => { swallowed('approvals-section: load', err); setApprovals([]); }), [org.id]);
  useEffect(() => { load(); return onLiveUpdate(['organisms'], load); }, [load]);

  const count = approvals ? approvals.length : 0;
  useEffect(() => { onCount?.(count); }, [count, onCount]);

  async function resolve(approval, yes) {
    if (busy) return;
    setBusy(true);
    try {
      const no = SUGGESTION_ACTIONS.includes(approval.action) ? 'decline' : 'reject';
      await orgService.resolveApproval(org.id, approval.id, yes ? 'approve' : no);
      showToast?.(yes ? t('organisms.approved') : t('organisms.rejected'), 'success');
      await load();
    } catch (err) {
      showToast?.(err?.message || x('failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!count) return null;
  const verdicts = new Map(approvals.map((a) => [a.id, decides(a, { ghii, isCreator, isAdmin })]));
  // The line about what a decision does is for a reader who has one to make.
  const decidesAny = [...verdicts.values()].some((v) => v.may);
  return html`
    <${Section} id=${id} num=${num} first=${first} title=${x('title')} count=${count}>
      <${List} cols="name-desc-doors">
        ${approvals.map((a) => {
          const who = verdicts.get(a.id);
          const ws = a.arguments?.ws;
          return html`
            <${Row} key=${a.id}>
              <${Name}>${a.prompt || a.action}<//>
              <${Desc} sub=${who.may ? null : who.why}>${x('by', { who: accountOf(a.actor), when: fmtDate(a.createdAt) })}<//>
              <${Doors}>
                ${ws && onOpenWs ? html`<${Action} small row soft onClick=${() => onOpenWs(ws)}>${x('openWs')}<//>` : null}
                ${who.may ? html`
                  <${Action} small row disabled=${busy} onClick=${() => resolve(a, true)}>${t('organisms.approve')}<//>
                  <${Action} small row tone="danger" disabled=${busy} onClick=${() => resolve(a, false)}>${t('organisms.reject')}<//>` : null}
              <//>
            <//>`;
        })}
      <//>
      ${decidesAny ? html`<${Note} kind="quiet">${x('hint')}<//>` : null}
    <//>`;
}
