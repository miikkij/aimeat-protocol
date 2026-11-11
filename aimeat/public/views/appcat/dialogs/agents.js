/**
 * @file public/views/appcat/dialogs/agents.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agents an app brings with it (features F147, F341, F218–F222): "Bundled agents
 *   {owner}/{filename}", the intro, and per definition its name and description, the inspector (the
 *   crew with its model profile and process, one line per member "role — goal" with its tools and its
 *   skills in coral, the tasks cut at 140 characters with "→ expected output" at 80), the permissions
 *   the agent holds or would ask for, each as a sentence, the signed-in person's own copy with its
 *   state, and who else runs it (online dot, owner, "you" and "author", "trust {score}", each public
 *   offer with its price or "ask for price" and "· instant" when it can be called at once).
 *
 *   The person's own copy has four states, read from GET .../agents/:name/status and read again on
 *   every `aimeat-live-update` (the catalogue's shell opens the stream, views/appcat.js): none ("Add
 *   this agent", which makes a proposal the owner approves), waiting (the link to the proposal),
 *   running (Stop, the link to the agent's page, and Update when the app declares a newer definition
 *   than the agent runs) and stopped (Start). No runner is chosen here: the node acts on the agent
 *   the person already has, gives the work to their crew-forge when they have one, and otherwise
 *   proposes the agent. Until 2026-11-11 the dialog always sent one of the person's agents as the
 *   runner, so the deploy became a task for an agent that could not do it, and the proposal was
 *   reached only by a person with no agent at all.
 *
 *   Signed out: "Sign in to add this agent." Who else runs it is read signed out too. Unguarded (F176).
 * @structure default AgentsDialog({ owner, filename, agents }) · Definition · Mine · Instance · price(offer) · said(answer)
 * @usage openDialog('agents', { owner, filename })  — props: owner, filename; agents (optional: the
 *   manifest's crew definitions, manifest.cortex.agents; without it the store's listing row is read).
 * @version-history
 *   v2.0.0 — 2026-11-11 — The person's own copy by its state (none, waiting, running, stopped) from
 *     the status route, on the live stream; "Add this agent" sends no runner; the permissions as
 *     sentences before adding; Update for a newer definition; Stop and Start in place of Undeploy.
 *     The Runner picker and the robot sign are gone; the Organism picker shows only for a person
 *     whose crew-forge sets the agent up.
 *   v1.3.0 — 2026-10-19 — The runner picker shows each agent's shown name, in alphabetical order inside each mode.
 *   v1.2.0 — 2026-10-11 — An offer's line is its money price (or Free) and its pacing amount, read
 *     from tollMorsels with price.morsels as the 3.x fallback; no morsel amount is shown as a price.
 *   v1.1.0 — 2026-09-27 — Parity: "owner/filename" after the title in the typewriter face (titleRef).
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2), from the old app-agents.js.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Actions, Loud } from '/components/Action.js';
import { Mark, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';
import { Stack, Row as Line, Split } from '/components/Layout.js';
import { List, Row, Name } from '/components/List.js';
import { Select } from '/components/Select.js';
import { apiGet, apiPost } from '/js/api.js';
import { t } from '/js/i18n.js';
import { priceAndPacing, moneyPriceOf } from '/js/format.js';
import { scopeSentence } from '/js/consent-vocab.js';
import { authHeaders, getSession } from '/js/services/auth.js';
import { useCatalog, notice } from '/views/appcat/store.js';
import { x } from '/views/appcat/i18n.js';
import { Dialog } from '/views/appcat/dialogs/host.js';
import { appUrl, findRow } from '/views/appcat/dialogs/app-io.js';

const html = htm.bind(h);

/** The name the node gives a person's own crew runtime that sets agents up (services/app-agent-deploy.ts). */
const FLEET_RUNNER = 'crew-forge';

/** The live-update domains after which the person's own copy and the list of who runs it are read again. */
const LIVE_DOMAINS = ['agents', 'open-items', 'apps'];

/**
 * "2,50 € · pacing 12 morsels" or "Free · pacing 12 morsels": the money price (or Free) and the
 * pacing amount. "ask for price" only when the offer declares neither (a morsel is never a price).
 */
function price(o) {
  const declared = o.tollMorsels != null || o.toll_morsels != null || o.price != null || moneyPriceOf(o);
  return declared ? priceAndPacing(o, t) : x('agents.askPrice');
}

/** What the notice says for the node's answer to an add, a stop, a start or an update. */
function said(d) {
  switch (d.kind) {
    case 'proposed': return x('agents.saidProposed');
    case 'present': return x('agents.saidPresent');
    case 'started': return x('agents.saidStarted', { name: d.agent });
    case 'stopped': return x('agents.saidStopped', { name: d.agent });
    case 'updated': return x('agents.saidUpdated', { name: d.agent });
    case 'undeploy-app-agent': return x('agents.saidStopTask', { name: d.runner_agent });
    default: return x(d.auto_activated ? 'agents.saidTaskStarted' : 'agents.saidTaskQueued', { name: d.runner_agent });
  }
}

/**
 * What the agent is for, in the app author's words: the definition's `description`, else the first
 * line of its readme that is not a heading (the line the node uses as the proposal's purpose).
 */
function summaryOf(def) {
  if (typeof def.description === 'string' && def.description.trim()) return def.description.trim();
  const lines = typeof def.readme_md === 'string' ? def.readme_md.split('\n').map((l) => l.trim()) : [];
  return lines.find((l) => l && !l.startsWith('#')) || '';
}

function Instance({ inst }) {
  const offers = inst.offers || [];
  const tags = [
    inst.is_yours ? html`<${Mark} key="y">${x('agents.you')}<//>` : null,
    inst.source === 'author' ? html`<${Mark} key="a">${x('agents.author')}<//>` : null,
  ].filter(Boolean);
  const lines = offers.length
    ? offers.map((o) => `${o.title || o.id} ${price(o)}${o.callable ? ' · ' + x('agents.instant') : ''}`)
    : [x('agents.noOffers')];
  return html`<${Row}>
    <${Name} dot=${inst.online ? 'online' : 'offline'} tag=${tags}
      meta=${x('agents.trust') + ' ' + (inst.trust_score != null ? inst.trust_score : '—')} desc=${lines}>${inst.owner}<//>
  <//>`;
}

/** The signed-in person's own copy of one bundled agent: its state, and the one thing to do next. */
function Mine({ status, busy, forge, organisms, organism, setOrganism, onAct }) {
  if (!status) return html`<${Note} kind="quiet">${x('agents.loading')}<//>`;
  const shown = status.agent_display_name || status.agent || '';
  if (status.state === 'waiting') {
    return html`
      <${Note} kind="quiet">${x('agents.stateWaiting')}<//>
      <${Actions} apart><${Loud} control href=${status.approval_url}>${x('agents.openProposal')}<//><//>`;
  }
  if (status.state === 'running' || status.state === 'stopped') {
    const running = status.state === 'running';
    return html`
      <${Note} kind="quiet">${x(running ? 'agents.stateRunning' : 'agents.stateStopped', { name: shown })}<//>
      ${running && !status.online ? html`<${Note} kind="hint">${x('agents.notConnected')}<//>` : null}
      ${status.definition_current === false ? html`<${Note} kind="hint">${x('agents.newer')}<//>` : null}
      <${Actions} apart>
        ${status.definition_current === false
          ? html`<${Loud} control disabled=${busy} onClick=${() => onAct('deploy', {})}>${x('agents.update')}<//>` : null}
        ${running
          ? html`<${Action} small disabled=${busy} onClick=${() => onAct('undeploy', {})}>${x('agents.stop')}<//>`
          : html`<${Loud} control disabled=${busy} onClick=${() => onAct('deploy', {})}>${x('agents.start')}<//>`}
        <${Action} small href=${'/v1/home?agent=' + encodeURIComponent(status.agent)}>${x('agents.openAgent')}<//>
      <//>`;
  }
  // No copy yet. A person whose own crew-forge sets agents up may name the organism it works in.
  return html`
    <${Note} kind="quiet">${x('agents.stateNone')}<//>
    <${Line} gap="medium" wrap align="end">
      ${forge ? html`<${Select} label=${x('agents.organism')} fit value=${organism}
        options=${[['', '—'], ...(organisms || []).map((o) => [o.id, o.name || o.id])]} onChange=${setOrganism} />` : null}
      <${Loud} control disabled=${busy} onClick=${() => onAct('deploy', organism ? { organism_id: organism } : {})}>${x('agents.add')}<//>
    <//>
    <${Note} kind="hint">${x(forge ? 'agents.addDescForge' : 'agents.addDesc')}<//>`;
}

function Definition({ def, owner, filename, forge, organisms }) {
  const [instances, setInstances] = useState(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [organism, setOrganism] = useState('');
  // Counts the reasons to read again: the person's own act here, and a change on the live stream.
  const [round, setRound] = useState(0);
  const signedIn = !!getSession();
  // The address of this agent under its app; 'instances', 'status', 'deploy' and 'undeploy' follow it.
  const base = appUrl(owner, filename, 'agents/' + encodeURIComponent(def.agent_name)) + '/';

  useEffect(() => {
    // Only the changes this dialog shows: an agent made, stopped or started (agents), a proposal
    // made or settled (open-items), and the app publishing a new definition (apps).
    const onLive = (e) => {
      const ds = e.detail?.domains;
      if (ds && !LIVE_DOMAINS.some((d) => ds.has(d))) return;
      setRound((n) => n + 1);
    };
    window.addEventListener('aimeat-live-update', onLive);
    return () => window.removeEventListener('aimeat-live-update', onLive);
  }, []);

  useEffect(() => {
    let live = true;
    fetch(base + 'instances', { headers: authHeaders() })
      .then((r) => r.json())
      .then((json) => { if (live) { setInstances((json.data && json.data.instances) || []); setFailed(false); } })
      .catch((e) => { console.warn('[appcat] the agent\'s running copies were not read', e); if (live) setFailed(true); });
    if (signedIn) {
      apiGet(base + 'status')
        .then((json) => { if (live) setStatus(json.data || null); })
        .catch((e) => console.warn('[appcat] the status of the person\'s own agent was not read', e));
    }
    return () => { live = false; };
  }, [base, round, signedIn]);

  const onAct = async (action, body) => {
    setBusy(true);
    try {
      const json = await apiPost(base + action, body);
      notice(said(json.data || {}), 'success');
    } catch (e) {
      notice(e.status ? (e.message || x('agents.failed')) : x('agents.failed') + ': ' + e.message, 'error');
    }
    setBusy(false);
    setRound((n) => n + 1);
  };

  const crew = (def.agents || []).map((a, i) => html`<${Row} key=${i}>
    <${Name} desc=${a.goal || null} marks=${[
      ...(a.tools || []).map((tool) => html`<${Mark} key=${'t' + tool}>${tool}<//>`),
      ...(a.skills || []).map((s) => html`<${Mark} key=${'s' + s} tone="coral">${s}<//>`),
    ]}>${a.role || ''}<//>
  <//>`);
  const tasks = (def.tasks || []).map((tk) => {
    let d = String(tk.description || '');
    if (d.length > 140) d = d.slice(0, 140) + '…';
    return d + (tk.expected_output ? ' → ' + String(tk.expected_output).slice(0, 80) : '');
  });
  // The agent's own permissions when it exists, else what a proposal would ask for; signed out, what the app declares.
  const scopes = status ? status.scopes || [] : (Array.isArray(def.scopes) ? def.scopes : []);
  const leftOut = status ? status.scopes_left_out || [] : [];

  // What the person decides from comes first: what it is for, what it may do, and their own copy
  // with the one thing to do. How the crew is built and who else runs it follow.
  const summary = summaryOf(def);
  return html`<${Split} gap="small" heavy>
    <${SubHeading} level=${3}>${def.agent_name || ''}<//>
    ${summary ? html`<${Note} kind="hint">${summary}<//>` : null}
    <${Label} block>${x('agents.permsTitle')}<//>
    ${scopes.length
      ? html`<${Stack} list gap="tight">${scopes.map((s) => html`<${Note} key=${s} kind="hint" inline>${scopeSentence(s, t)}<//>`)}<//>`
      : html`<${Note} kind="hint">${x('agents.permsBase')}<//>`}
    ${leftOut.length ? html`<${Note} kind="hint">${x('agents.permsLeftOut', { list: leftOut.map((s) => (s === '*' ? x('agents.permAll') : s)).join(', ') })}<//>` : null}
    <${Label} block>${x('agents.yoursTitle')}<//>
    ${signedIn
      ? html`<${Mine} status=${status} busy=${busy} forge=${forge} organisms=${organisms}
          organism=${organism} setOrganism=${setOrganism} onAct=${onAct} />`
      : html`<${Note} kind="quiet">${x('agents.needLogin')}<//>`}
    <${Line} gap="small" wrap>
      <${Label}>${x('agents.crew')}<//>
      ${def.llm_profile ? html`<${Mark}>${def.llm_profile}<//>` : null}
      ${def.process ? html`<${Mark}>${def.process}<//>` : null}
    <//>
    <${List} dense>${crew}<//>
    <${Label} block>${x('agents.tasks')}<//>
    <${Stack} list gap="tight">${tasks.map((line, i) => html`<${Note} key=${i} kind="hint" inline>${line}<//>`)}<//>
    <${Label} block>${x('agents.hostedTitle')}<//>
    ${failed ? html`<${Note} kind="quiet">${x('agents.hostedError')}<//>`
      : instances === null ? html`<${Note} kind="quiet">${x('agents.loading')}<//>`
      : instances.length ? html`<${List} dense>${instances.map((inst, i) => html`<${Instance} key=${i} inst=${inst} />`)}<//>`
      : html`<${Note} kind="quiet">${x('agents.hostedNone')}<//>`}
  <//>`;
}

export default function AgentsDialog({ owner, filename, agents, close }) {
  const cat = useCatalog();
  const row = findRow(cat.all, owner, filename);
  const manifestAgents = row && row.manifest && row.manifest.cortex && Array.isArray(row.manifest.cortex.agents) ? row.manifest.cortex.agents : [];
  const defs = Array.isArray(agents) && agents.length ? agents : manifestAgents;
  const [forge, setForge] = useState(false);
  const [organisms, setOrganisms] = useState([]);

  useEffect(() => {
    if (!defs.length) { notice(x('agents.none')); close?.(); return undefined; }
    const session = getSession();
    if (!session) return undefined;
    let live = true;
    // The organism is asked only of a person whose own crew-forge sets the agent up; nobody else's choice is read.
    apiGet('/v1/agents').then((json) => {
      if (!live) return;
      const has = ((json.data && json.data.agents) || []).some((a) => a.name === FLEET_RUNNER);
      setForge(has);
      if (has && session.owner) {
        apiGet('/v1/organisms?member=' + encodeURIComponent(session.owner)).then((orgs) => {
          if (live) setOrganisms((orgs.data && orgs.data.organisms) || []);
        }).catch((e) => console.warn('[appcat] organisms not read; the organism stays optional', e));
      }
    }).catch((e) => console.warn('[appcat] the person\'s agents were not read; the organism is not asked', e));
    return () => { live = false; };
  }, [defs.length, close]);

  if (!defs.length) return null;
  return html`<${Dialog} title=${x('agents.title')} titleRef=${`${owner}/${filename}`} size="lg"
    footer=${html`<${Action} onClick=${close}>${x('common.close')}<//>`}>
    <${Stack} gap="large">
      <${Note} kind="hint">${x('agents.declares')}<//>
      ${defs.map((def, i) => html`<${Definition} key=${i} def=${def} owner=${owner} filename=${filename} forge=${forge} organisms=${organisms} />`)}
    <//>
  <//>`;
}
