/**
 * @file public/views/appcat/sections/agents.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Bundled agents section of the app detail view (F341), shown only when the
 *   published app's manifest declares crew definitions (`manifest.cortex.agents`, the listing row's
 *   manifest, as the old catalogue's app-agents.js appManifestAgents read it): the explanation, one
 *   mark per agent name, and "Inspect & deploy", which opens the Bundled agents dialog (F147: the
 *   inspector, the hosted instances with their prices, deploy your own).
 * @structure meta · agentsOf(app) · AgentsSection({ d })
 * @usage loaded by the detail view: import('./sections/agents.js')
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity with the old page (appcat sections-d): the explanation as the
 *     chapter's grey opening line (Note caption size="lead"), the names as the old chips side by side
 *     with a space between (Mark tone="name"), 8px over the door, the door in the chapter's row.
 *   v1.0.0 — 2026-09-27 — Initial (appcat detail builder C), from the old catalogue's detail.js
 *     agentsHtml.
 */
import { h } from 'preact';
import htm from 'htm';
import { Action, Actions } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Space } from '/components/Layout.js';
import { x } from '/views/appcat/i18n.js';
import { openDialog } from '/views/appcat/dialogs/host.js';

const html = htm.bind(h);

/** The crew definitions a published app declares, from its listing row's manifest. */
export function agentsOf(app) {
  const m = app && app.manifest;
  return (m && m.cortex && Array.isArray(m.cortex.agents)) ? m.cortex.agents : [];
}

export const meta = { id: 'agents', title: 'agents.title', show: (d) => agentsOf(d.app).length > 0 };

export default function AgentsSection({ d }) {
  const defs = agentsOf(d.app);
  if (!defs.length) return null;
  const open = () => (d.openDialog || openDialog)('agents', { owner: d.owner, filename: d.filename, ref: d.ref, agents: defs, app: d.app });
  // The old page joined the chips with a space, in a line 8px over the door.
  return html`
    <${Note} kind="caption" size="lead">${x('agents.declares')}<//>
    <${Space} below="small">${defs.map((def, i) => html`${i ? ' ' : null}<${Mark} key=${(def.agent_name || '') + i} tone="name">${def.agent_name || ''}<//>`)}<//>
    <${Actions} chapter><${Action} small onClick=${open}>${x('agents.manage')}<//><//>`;
}
