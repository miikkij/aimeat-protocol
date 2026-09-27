/**
 * @file public/views/appcat/dialogs/consents.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The permissions a person granted an app (features F146, F188, F189): "Permissions you
 *   granted this app", the target line "{name} · {owner}/{filename}", "Loading…", then "You haven't
 *   granted this app access." or "You granted this app permission to:" with the scopes, and the hint
 *   that revoking cuts the app off and it asks again next time. "Revoke access" (the danger action) shows
 *   only when a grant is found; it revokes the whole grant and closes. Unguarded (F176).
 * @structure default ConsentsDialog({ owner, filename, name })
 * @usage openDialog('consents', { owner, filename, name })  — props: owner, filename (the app), name
 *   (optional: its display name for the target line); onDone (optional: called after a revoke).
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity: the target and the "none" line in the old grey sizes (Note caption).
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2), from the old server-io.js openConsents.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Loud } from '/components/Action.js';
import { Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Stack } from '/components/Layout.js';
import { apiGet, apiDelete } from '/js/api.js';
import { x } from '/views/appcat/i18n.js';
import { Dialog } from '/views/appcat/dialogs/host.js';
import { bareOwner } from '/views/appcat/dialogs/app-io.js';

const html = htm.bind(h);

export default function ConsentsDialog({ owner, filename, name, onDone, close }) {
  const target = bareOwner(owner) + '/' + filename;
  const [grant, setGrant] = useState(undefined);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let live = true;
    apiGet('/v1/app-grants').then((json) => {
      if (!live) return;
      const grants = (json.data && json.data.grants) || [];
      setGrant(grants.find((g) => g.app === target) || null);
    }).catch((e) => { if (live) setErr(e.message || String(e)); });
    return () => { live = false; };
  }, [target]);

  const revoke = async () => {
    try {
      await apiDelete('/v1/app-grants/' + encodeURIComponent(grant.grant_id));
      onDone?.();
      close?.();
    } catch (e) { setErr(e.message || String(e)); }
  };

  let body;
  // The old page's body: .9rem in the grey ("Loading…", "none"), red for a failure.
  if (err) body = html`<${Note} kind="report" tone="err">${err}<//>`;
  else if (grant === undefined) body = html`<${Note} kind="caption" size="large">${x('common.loading')}<//>`;
  else if (!grant) body = html`<${Note} kind="caption" size="large">${x('consents.none')}<//>`;
  else {
    body = html`<${Stack} gap="small">
      <span>${x('consents.granted')}</span>
      <${Stack} list gap="tight">${(grant.scopes || []).map((s) => html`<${Code} key=${s}>${s}<//>`)}<//>
      <${Note} kind="hint">${x('consents.hint')}<//>
    <//>`;
  }

  const footer = html`
    <${Action} onClick=${close}>${x('common.close')}<//>
    ${grant ? html`<${Loud} control danger onClick=${revoke}>${x('consents.revoke')}<//>` : null}`;
  return html`<${Dialog} title=${x('consents.title')} size="md" footer=${footer}>
    <${Stack} gap="medium">
      <${Note} kind="caption">${name || filename} · ${target}<//>
      ${body}
    <//>
  <//>`;
}
