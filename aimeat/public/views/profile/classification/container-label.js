/**
 * @file public/views/profile/classification/container-label.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification of a place, on the place's own page (plan doc-mvdipuyqraas, L4.4): an
 *   organism, a workspace, a board or an app. It shows the place's classification on the
 *   ClassificationBadge, says what it means (everything in the place counts as at least that), and
 *   behind Change lets the person who may set it pick another: the organism's creator or an admin
 *   for an organism and its workspaces, the owner for a board or an app. The server decides who may
 *   (services/classification/containers.ts); the page asks it and says its refusal.
 *
 *   ONE ROUTE: GET and PUT /v1/classification/label with the place's kind (organism + organism_id,
 *   workspace + organism_id + ws, board + board_id, app + app), the route the person's AI reaches as
 *   aimeat_classification. A lowering the classification asks a reason for opens the reason field,
 *   and so does the server's JUSTIFICATION_REQUIRED when the page did not foresee it (a change to a
 *   classification that loosens one of its fields, such as a wider audience cap, counts as a lowering).
 *
 *   ONLY WHILE CLASSIFICATION IS ON for the place: the organism's policy for an organism and its
 *   workspaces, the owner's for a board and an app (GET /v1/classification/policy, `active`). Off,
 *   nothing is drawn, because a place's classification then does nothing. Read again on the
 *   `aimeat-live-update` event.
 * @structure ContainerLabel({ kind, organismId, ws, boardId, app, canSet, showToast, chapter })
 * @usage
 *   html`<${ContainerLabel} kind="workspace" organismId=${orgId} ws=${wsId} canSet=${wsCanEdit} showToast=${showToast} />`
 *   html`<${ContainerLabel} kind="app" app=${d.filename} canSet chapter />`
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L4.4).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPut } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { readPolicy, labelName, labelById } from '/js/services/classification.js';
import { ClassificationBadge } from '/components/ClassificationBadge.js';
import { HelpLabel } from '/components/HelpTip.js';
import { Label } from '/components/Mark.js';
import { Select } from '/components/Select.js';
import { TextField } from '/components/TextField.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Row, Stack } from '/components/Layout.js';

const html = htm.bind(h);
const c = (key, vars) => t('classification.container.' + key, vars);

/**
 * The address of the place, as the label route takes it.
 * @param {{ kind: string, organismId?: string, ws?: string, boardId?: string, app?: string }} place
 * @returns {Record<string, string>}
 */
function addressOf({ kind, organismId, ws, boardId, app }) {
  if (kind === 'organism') return { kind, organism_id: organismId };
  if (kind === 'workspace') return { kind, organism_id: organismId, ws };
  if (kind === 'board') return { kind, board_id: boardId };
  return { kind: 'app', app };
}

/**
 * Whether a place's classification is on, its labels, and the place's own label (null: not read yet or off).
 * @param {{ kind: string, organismId?: string, ws?: string, boardId?: string, app?: string }} props
 */
function usePlaceLabel(props) {
  const { kind, organismId, ws, boardId, app } = props;
  const [state, setState] = useState(null);
  const load = useCallback(async () => {
    try {
      const organismLevel = kind === 'organism' || kind === 'workspace';
      const view = await readPolicy(organismLevel ? 'organism' : 'owner', organismLevel ? organismId : undefined);
      if (!view?.active) { setState({ active: false }); return; }
      const q = new URLSearchParams(addressOf({ kind, organismId, ws, boardId, app }));
      const r = await apiGet(`/v1/classification/label?${q}`);
      setState({ active: true, policy: view.effective, label: r?.data ?? null });
    } catch (err) {
      swallowed('container-label: read', err);
      setState({ active: false });
    }
  }, [kind, organismId, ws, boardId, app]);
  useEffect(() => {
    load();
    window.addEventListener('aimeat-live-update', load);
    return () => window.removeEventListener('aimeat-live-update', load);
  }, [load]);
  return [state, load];
}

/**
 * @param {{ kind: 'organism'|'workspace'|'board'|'app', organismId?: string, ws?: string, boardId?: string,
 *   app?: string, canSet?: boolean, showToast?: (msg: string, kind?: string) => void, chapter?: boolean }} props
 *   `canSet`: the viewer may change it (the page knows the role); the server decides in the end.
 *   `chapter`: drawn inside a chapter of the app catalogue's detail.
 */
export function ContainerLabel(props) {
  const { kind, canSet, showToast, chapter } = props;
  const [state, reload] = usePlaceLabel(props);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // The server asked for a reason the page did not foresee (a change that loosens a field of the
  // classification, not only its rank): the reason field opens.
  const [askReason, setAskReason] = useState(false);

  if (!state?.active || !state.label) return null;
  const { policy, label: view } = state;
  const own = view.labelDetail || labelById(policy, view.label);
  const eff = view.effective;
  // A workspace counts as its organism's classification when that is higher: the badge and the
  // sentence say what counts, and a line says the place's own one and where the higher one comes from.
  const raisedBy = eff && eff.from !== 'own' ? eff : null;
  const counts = raisedBy ? (raisedBy.labelDetail || labelById(policy, raisedBy.label) || own) : own;
  const labels = (policy?.labels ?? []).filter((l) => l.status !== 'retired').sort((a, b) => a.rank - b.rank);
  const next = labelById(policy, pick);
  // A lowering from a classification that asks a reason opens the reason field (labels.ts setLabel).
  const needsReason = askReason || !!(own && next && next.rank < own.rank && own.lowerNeedsJustification);

  const toggle = () => {
    if (!open) { setPick(view.label); setReason(''); setError(''); setAskReason(false); }
    setOpen((v) => !v);
  };

  async function save() {
    if (saving) return;
    if (!pick || pick === view.label) { setOpen(false); return; }
    if (needsReason && !reason.trim()) { setError(c('reasonNeeded', { label: labelName(own) })); return; }
    setSaving(true);
    setError('');
    try {
      await apiPut('/v1/classification/label', {
        ...addressOf(props), label: pick, ...(reason.trim() ? { justification: reason.trim() } : {}),
      });
      setOpen(false);
      showToast?.(c('saved', { label: labelName(next) || pick }), 'success');
      await reload();
    } catch (err) {
      swallowed('container-label: save', err);
      if (err?.code === 'JUSTIFICATION_REQUIRED' && !reason.trim()) {
        setAskReason(true);
        setError(c('reasonNeeded', { label: labelName(own) }));
      } else {
        setError(err?.message || c('failed'));
      }
    } finally {
      setSaving(false);
    }
  }

  const word = c(`kind.${kind}`);
  return html`
    <${Stack} gap="small">
      <${HelpLabel} term="classification.container" label=${c('label')}><${Label}>${c('label')}<//><//>
      <${Row} wrap>
        <${ClassificationBadge} label=${counts} from=${raisedBy ? raisedBy.from : 'own'} />
        ${canSet ? html`<${Action} small soft expanded=${open} onClick=${toggle}>${open ? c('close') : c('change')}<//>` : null}
      <//>
      <${Note} kind="hint" chapter=${chapter}>${c('means', { place: word, label: labelName(counts) })}<//>
      ${raisedBy ? html`<${Note} kind="hint" chapter=${chapter}>${c('raisedBy', {
        own: labelName(own), label: labelName(counts), from: t(`classification.badge.from.${raisedBy.from}`),
      })}<//>` : null}
      ${open ? html`
        <${Stack} gap="medium">
          <${Select} label=${c('choose', { place: word })} value=${pick} disabled=${saving} onChange=${(v) => { setPick(v); setError(''); setAskReason(false); }}
            options=${labels.map((l) => [l.id, labelName(l)])} />
          ${needsReason ? html`<${TextField} label=${c('reason')} hint=${c('reasonHint', { label: labelName(own) })}
            value=${reason} onInput=${setReason} disabled=${saving} />` : null}
          ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
          <${Actions} chapter=${chapter}>
            <${Loud} control disabled=${saving || !pick || pick === view.label} onClick=${save}>${c('save')}<//>
          <//>
        <//>` : null}
    <//>`;
}

export default ContainerLabel;
