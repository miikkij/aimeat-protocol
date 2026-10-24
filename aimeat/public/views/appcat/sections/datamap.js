/**
 * @file public/views/appcat/sections/datamap.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "Where this app puts what" (features F338–F340): the app's data map
 *   from GET /v1/datamap/apps/{owner}/{file}, drawn by components/DataMap.js with appcat's own
 *   `dataMap.*` words (appcat.dataMap.*, which carry Spanish too). Shown on every detail view. Like the
 *   old page, the read sends no token (F340, kept as it behaves: the route decides what it shows, and
 *   a visitor's view and the owner's are the same here). The shell draws the chapter line and the
 *   headline from `meta`; this is the body.
 *
 *   ABOVE THE MAP, THE AGENTS WHOSE WORK THE APP SHOWS, when the map's rows name any (a row's
 *   `agent`, the tie the agent's page on the home lists from the other side). The names are the
 *   map's, so everybody reads them; the app's owner also reads whether an agent is stopped or gone,
 *   opens it, and may take the tie away (DELETE …/agents/{agent}).
 * @structure meta · agentsOfMap(map) · DataMapSection({ d })
 * @usage const mod = await import('./sections/datamap.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.2.0 — 2026-10-24 — "Personal data this app keeps": the app's records of processing as the map
 *     read answers them, and whether it has a privacy notice (plan doc-mvlftkh9zmc9, C1.7).
 *   v1.1.0 — 2026-10-11 — The agents whose work the app shows, above the map
 *     (wish-agentista-sovellukseen-sovelluksen-teko-agentin-j-lkeen-ja-a).
 *   v1.0.0 — 2026-09-27 — Initial: the old catalogue's js/data-map.js on components (appcat detail
 *     builder B).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { DataMap } from '/components/DataMap.js';
import { Facts } from '/components/Facts.js';
import { SubHeading } from '/components/SubHeading.js';
import { Note } from '/components/Note.js';
import { Action, Actions } from '/components/Action.js';
import { Space } from '/components/Layout.js';
import { swallowed } from '/js/swallowed.js';
import { readHomeAgents } from '/js/services/agent-draft.js';
import { untieApp } from '/js/services/agent-ties.js';
import { x } from '/views/appcat/i18n.js';
import { tOr } from '/js/i18n.js';

const html = htm.bind(h);

export const meta = { id: 'datamap', title: 'dataMap.title', show: () => true };

/** The agents a map's rows name, each once: { name, madeFor }. A row's `agent` is the tie. */
export function agentsOfMap(map) {
  const seen = new Map();
  for (const row of (map && Array.isArray(map.held) ? map.held : [])) {
    if (!row || typeof row.agent !== 'string' || !row.agent) continue;
    seen.set(row.agent, (seen.get(row.agent) || false) || row.madeFor === true);
  }
  return [...seen].map(([name, madeFor]) => ({ name, madeFor }));
}

/**
 * The agents whose work this app shows, from the map's own rows. Everybody reads the names, as the
 * map is public; the app's owner also reads each agent's state (GET /v1/home/agents), opens the
 * agent's page on their home, and may take the tie away.
 */
function TiedAgents({ d, map, onChanged }) {
  const tied = agentsOfMap(map);
  const own = !!d.isOwn;
  const [workers, setWorkers] = useState({});
  const [said, setSaid] = useState(null);
  const names = tied.map((a) => a.name).join(',');
  useEffect(() => {
    if (!own || !names) return undefined;
    let live = true;
    Promise.all(names.split(',').map((name) => readHomeAgents(1, name)
      .then((data) => [name, (data?.workers ?? [])[0] ?? null])
      .catch((err) => { swallowed('appcat datamap: agent state', err); return [name, undefined]; })))
      .then((rows) => { if (live) setWorkers(Object.fromEntries(rows)); });
    return () => { live = false; };
  }, [own, names]);
  if (!tied.length) return null;

  const untie = async (name) => {
    setSaid(null);
    try {
      await untieApp(d.owner, d.filename, name);
      setSaid({ ok: true, text: x('dataMap.agentUntied') });
      onChanged();
    } catch (err) { setSaid({ ok: false, text: err?.message || String(err) }); }
  };
  const words = (a) => {
    const w = workers[a.name];
    const tie = a.madeFor ? x('dataMap.agentMadeFor') : x('dataMap.agentUses');
    if (!own || w === undefined) return tie;
    if (w === null) return `${tie} ${x('dataMap.agentGone')}`;
    return w.stopped ? `${tie} ${x('dataMap.agentStopped')}` : tie;
  };
  return html`
    <${Space} below="part">
      <${SubHeading} level=${3}>${x('dataMap.agentsTitle')}<//>
      <${Facts} wide rows=${tied.map((a) => ({
        k: (own && workers[a.name]?.display_name) || a.name,
        v: words(a),
        state: own && workers[a.name]?.stopped ? 'attention' : undefined,
        action: own ? html`
          <${Actions}>
            ${workers[a.name] ? html`<${Action} small href=${'/v1/home?agent=' + encodeURIComponent(a.name)}>${x('dataMap.agentOpen')}<//>` : null}
            <${Action} small tone="danger" onClick=${() => untie(a.name)}>${x('dataMap.agentUntie')}<//>
          <//>` : undefined,
      }))} />
      ${said ? html`<${Note} kind="message" error=${!said.ok}>${said.text}<//>` : null}
      <${Note} kind="quiet">${x('dataMap.agentNote')}<//>
    <//>`;
}

/**
 * What personal data the app keeps, as its owner wrote it in the app's records of processing (plan
 * doc-mvlftkh9zmc9, C1.7): one row per register with its data, basis and how long it is kept, and
 * whether the app has a privacy notice. Shown only when the app keeps a register or its map says it
 * holds personal data, so an app with nothing personal says nothing here.
 */
function PersonalData({ records, privacyNotice, map }) {
  const personal = (records || []).filter((r) => r.type === 'personal' || r.type === 'pseudonymised');
  const mapSaysPersonal = !!map && Array.isArray(map.held) && map.held.some((row) => row && row.personalData === 'yes');
  if (!personal.length && !mapSaysPersonal) return null;
  const basisWord = (b) => tOr(`admin.compliance.records.basis.${b}`, b);
  // The number and its unit stay on one line.
  const kept = (r) => r.retentionText || (typeof r.retentionMonths === 'number' ? x('dataMap.recordsMonths', { n: String(r.retentionMonths) }).replace(/^(\S+) /, '$1 ') : '');
  return html`
    <${Space} below="part">
      <${SubHeading} level=${3}>${x('dataMap.recordsTitle')}<//>
      ${personal.length ? html`<${Facts} wide rows=${personal.map((r) => ({
        k: r.title,
        v: [(r.dataCategories || []).join(', '),
          (r.legalBasis || []).length ? x('dataMap.recordsBasis', { basis: r.legalBasis.map(basisWord).join(', ') }) : '',
          kept(r) ? x('dataMap.recordsKept', { how: kept(r) }) : ''].filter(Boolean).join(' · '),
      }))} />` : html`<${Note} kind="quiet">${x('dataMap.recordsNone')}<//>`}
      <${Note} kind=${privacyNotice ? 'quiet' : 'hint'}>${privacyNotice ? x('dataMap.recordsPrivacy') : x('dataMap.recordsNoPrivacy')}<//>
    <//>`;
}

export default function DataMapSection({ d }) {
  const [state, setState] = useState({ loading: true, map: null, findings: [], records: [], privacyNotice: false });
  const [round, setRound] = useState(0);
  const owner = d.owner;
  const filename = d.filename;
  useEffect(() => {
    if (!owner || !filename) return undefined;
    let live = true;
    if (round === 0) setState({ loading: true, map: null, findings: [] });
    fetch('/v1/datamap/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename))
      .then((r) => r.json())
      .then((json) => {
        if (!live) return;
        const data = (json && json.data) || {};
        setState({
          loading: false, map: data.data_map || null, findings: data.findings || [],
          records: data.records_of_processing || [], privacyNotice: !!data.privacy_notice,
        });
      })
      // eslint-disable-next-line aimeat/no-silent-catch -- as on the old page, a map that cannot be read is said as "no map yet"
      .catch(() => { if (live) setState({ loading: false, map: null, findings: [], records: [], privacyNotice: false }); });
    return () => { live = false; };
  }, [owner, filename, round]);
  return html`
    ${state.map ? html`<${TiedAgents} d=${d} map=${state.map} onChanged=${() => setRound((n) => n + 1)} />` : null}
    ${state.loading ? null : html`<${PersonalData} records=${state.records} privacyNotice=${state.privacyNotice} map=${state.map} />`}
    <${DataMap} loading=${state.loading} map=${state.map} findings=${state.findings} say=${(k) => x(k)} />`;
}
