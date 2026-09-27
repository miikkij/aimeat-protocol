/**
 * @file public/views/appcat/dialogs/agents.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The bundled agents of an app (features F147, F341, F218–F222): "Bundled agents
 *   {owner}/{filename}", the intro, and per crew definition "🤖 {agent_name}" with its inspector (the
 *   crew with its model profile and process, one line per member "role — goal" with its tools and its
 *   skills in coral, the tasks cut at 140 characters with "→ expected output" at 80), the hosted
 *   instances (who runs it: online dot, owner, "you" and "author", "trust {score}", Undeploy on the
 *   person's own deployed one, each public offer with its price or "ask for price" and "· instant"
 *   when it can be called at once), and "Deploy your own": the Runner picker (task-runners first, then
 *   autonomous, then the rest, "{name} · {mode}", crew-forge chosen when there), the Organism picker
 *   ("—" and the person's organisms) and "Deploy to my fleet". Signed out: "Sign in to deploy this
 *   agent onto your own fleet." The hosted instances are read signed out too. Unguarded (F176).
 * @structure default AgentsDialog({ owner, filename, agents }) · Definition · Instance · price(offer)
 * @usage openDialog('agents', { owner, filename })  — props: owner, filename; agents (optional: the
 *   manifest's crew definitions, manifest.cortex.agents; without it the store's listing row is read).
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity: "owner/filename" after the title in the typewriter face (titleRef).
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2), from the old app-agents.js.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Loud } from '/components/Action.js';
import { Mark, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';
import { Stack, Row as Line, Split } from '/components/Layout.js';
import { List, Row, Name, Doors } from '/components/List.js';
import { Select } from '/components/Select.js';
import { apiGet, apiPost } from '/js/api.js';
import { authHeaders, getSession } from '/js/services/auth.js';
import { useCatalog, notice } from '/views/appcat/store.js';
import { x } from '/views/appcat/i18n.js';
import { Dialog } from '/views/appcat/dialogs/host.js';
import { appUrl, findRow } from '/views/appcat/dialogs/app-io.js';

const html = htm.bind(h);

/** "12 🥩/run · 2.50 EUR", or "ask for price". */
function price(o) {
  const parts = [];
  if (o.price && typeof o.price.morsels === 'number') parts.push(o.price.morsels + ' \u{1F969}' + (o.price.unit ? '/' + o.price.unit : ''));
  if (o.price_money && typeof o.price_money.amount === 'number') parts.push((o.price_money.amount / 1e6).toFixed(2) + ' ' + (o.price_money.currency || 'EUR'));
  return parts.length ? parts.join(' · ') : x('agents.askPrice');
}

/** Deploy or undeploy on the person's own fleet; the notice says what happened. */
async function act(owner, filename, agentName, action, body, doneWords) {
  if (!getSession()) { notice(x('agents.needLogin'), 'error'); return; }
  try {
    const json = await apiPost(appUrl(owner, filename, 'agents/' + encodeURIComponent(agentName) + '/' + action), body);
    notice(doneWords(json.data || {}), 'success');
  } catch (e) {
    if (e.code === 'RUNNER_NOT_FOUND') notice(x('agents.noRunner'), 'error');
    else if (e.status) notice(e.message || x('agents.deployFailed'), 'error');
    else notice(x('agents.deployFailed') + ': ' + e.message, 'error');
  }
}

function Instance({ inst, owner, filename, agentName }) {
  const offers = inst.offers || [];
  const undeploy = inst.is_yours && inst.source === 'deployed'
    ? html`<${Action} small row onClick=${() => act(owner, filename, agentName, 'undeploy', {}, () => x('agents.undeployQueued'))}>${x('agents.undeploy')}<//>`
    : null;
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
    <${Doors}>${undeploy}<//>
  <//>`;
}

function Definition({ def, owner, filename, runners, organisms }) {
  const [instances, setInstances] = useState(null);
  const [failed, setFailed] = useState(false);
  const [runner, setRunner] = useState('');
  const [organism, setOrganism] = useState('');
  // crew-forge is chosen when the person has it; otherwise the first runner in the order above.
  useEffect(() => {
    const pre = (runners || []).find((a) => a.name === 'crew-forge');
    setRunner(pre ? pre.name : (runners && runners[0] ? runners[0].name : ''));
  }, [runners]);

  useEffect(() => {
    let live = true;
    fetch(appUrl(owner, filename, 'agents/' + encodeURIComponent(def.agent_name) + '/instances'), { headers: authHeaders() })
      .then((r) => r.json())
      .then((json) => { if (live) setInstances((json.data && json.data.instances) || []); })
      .catch((e) => { console.warn('[appcat] hosted instances not read', e); if (live) setFailed(true); });
    return () => { live = false; };
  }, [owner, filename, def.agent_name]);

  const deploy = () => {
    const body = {};
    if (runner) body.runner_agent = runner;
    if (organism) body.organism_id = organism;
    act(owner, filename, def.agent_name, 'deploy', body, (d) => (d.auto_activated ? x('agents.deployStarted') : x('agents.deployQueued')));
  };

  const crew = (def.agents || []).map((a, i) => html`<${Row} key=${i}>
    <${Name} desc=${a.goal || null} marks=${[
      ...(a.tools || []).map((t) => html`<${Mark} key=${'t' + t}>${t}<//>`),
      ...(a.skills || []).map((s) => html`<${Mark} key=${'s' + s} tone="coral">${s}<//>`),
    ]}>${a.role || ''}<//>
  <//>`);
  const tasks = (def.tasks || []).map((tk) => {
    let d = String(tk.description || '');
    if (d.length > 140) d = d.slice(0, 140) + '…';
    return d + (tk.expected_output ? ' → ' + String(tk.expected_output).slice(0, 80) : '');
  });
  const runnerOptions = runners === null
    ? [['', x('agents.loading')]]
    : runners.length
      ? runners.map((a) => [a.name, a.name + (a.mode ? ' · ' + a.mode : '')])
      : [['', x('agents.noRunnerOption')]];

  return html`<${Split} gap="small" heavy>
    <${SubHeading} level=${3}>\u{1F916} ${def.agent_name || ''}<//>
    <${Line} gap="small" wrap>
      <${Label}>${x('agents.crew')}<//>
      ${def.llm_profile ? html`<${Mark}>${def.llm_profile}<//>` : null}
      ${def.process ? html`<${Mark}>${def.process}<//>` : null}
    <//>
    <${List} dense>${crew}<//>
    <${Label} block>${x('agents.tasks')}<//>
    <${Stack} list gap="tight">${tasks.map((t, i) => html`<${Note} key=${i} kind="hint" inline>${t}<//>`)}<//>
    <${Label} block>${x('agents.hostedTitle')}<//>
    ${failed ? html`<${Note} kind="quiet">${x('agents.hostedError')}<//>`
      : instances === null ? html`<${Note} kind="quiet">${x('agents.loading')}<//>`
      : instances.length ? html`<${List} cols="name-doors" dense>${instances.map((inst, i) => html`<${Instance} key=${i} inst=${inst} owner=${owner} filename=${filename} agentName=${def.agent_name} />`)}<//>`
      : html`<${Note} kind="quiet">${x('agents.hostedNone')}<//>`}
    <${Label} block>${x('agents.deployTitle')}<//>
    ${getSession() ? html`
      <${Line} gap="medium" wrap align="end">
        <${Select} label=${x('agents.runner')} fit value=${runner} options=${runnerOptions} onChange=${setRunner} />
        <${Select} label=${x('agents.organism')} fit value=${organism}
          options=${[['', '—'], ...(organisms || []).map((o) => [o.id, o.name || o.id])]} onChange=${setOrganism} />
        <${Loud} control onClick=${deploy}>${x('agents.deployBtn')}<//>
      <//>
      <${Note} kind="hint">${x('agents.deployDesc')}<//>`
      : html`<${Note} kind="quiet">${x('agents.needLogin')}<//>`}
  <//>`;
}

export default function AgentsDialog({ owner, filename, agents, close }) {
  const cat = useCatalog();
  const row = findRow(cat.all, owner, filename);
  const manifestAgents = row && row.manifest && row.manifest.cortex && Array.isArray(row.manifest.cortex.agents) ? row.manifest.cortex.agents : [];
  const defs = Array.isArray(agents) && agents.length ? agents : manifestAgents;
  const [runners, setRunners] = useState(null);
  const [organisms, setOrganisms] = useState([]);

  useEffect(() => {
    if (!defs.length) { notice(x('agents.none')); close?.(); return undefined; }
    const session = getSession();
    if (!session) return undefined;
    let live = true;
    const rank = (m) => (m === 'task-runner' ? 0 : m === 'autonomous' ? 1 : 2);
    apiGet('/v1/agents').then((json) => {
      if (!live) return;
      const list = ((json.data && json.data.agents) || []).slice().sort((a, b) => rank(a.mode) - rank(b.mode));
      setRunners(list);
    }).catch((e) => console.warn('[appcat] runner agents not read; the picker keeps its loading line', e));
    if (session.owner) {
      apiGet('/v1/organisms?member=' + encodeURIComponent(session.owner)).then((json) => {
        if (live) setOrganisms((json.data && json.data.organisms) || []);
      }).catch((e) => console.warn('[appcat] organisms not read; the organism stays optional', e));
    }
    return () => { live = false; };
  }, [defs.length, close]);

  if (!defs.length) return null;
  return html`<${Dialog} title=${x('agents.title')} titleRef=${`${owner}/${filename}`} size="lg"
    footer=${html`<${Action} onClick=${close}>${x('common.close')}<//>`}>
    <${Stack} gap="large">
      <${Note} kind="hint">${x('agents.declares')}<//>
      ${defs.map((def, i) => html`<${Definition} key=${i} def=${def} owner=${owner} filename=${filename} runners=${runners} organisms=${organisms} />`)}
    <//>
  <//>`;
}
