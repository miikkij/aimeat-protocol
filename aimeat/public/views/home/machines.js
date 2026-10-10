/**
 * @file public/views/home/machines.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A person's machines: the places their agents run. Each one with its name, whether
 *   it is connected, how it runs agents, which agents live on it and which wait for it, and on
 *   request what it can do. And the way to add one.
 *
 *   A MACHINE IS A CONNECTOR, said the way a person meets it. The program is `aimeat connect serve`;
 *   what a person has is a computer or a server that their agents run on, with a name they gave it.
 *
 *   WHAT A MACHINE CAN DO IS ASKED, NOT LISTED. The tools and models belong to the runtime on that
 *   machine, so the page asks one of its connected agents when the person wants to see them
 *   (GET /v1/agents/:name/crew/menu). A machine that is not connected cannot be asked, and the page
 *   says so.
 *
 *   AN AGENT CAN ONLY USE WHAT ITS MACHINE CAN DO AND WHAT ITS OWNER ALLOWED. The lede says it,
 *   because it is the one rule that explains every row on this page.
 *
 *   Composed from library components only; it has no sheet of its own.
 * @structure default MachinesView({ navigate }); internal: Machine
 * @usage routed at /v1/home?machines=1 by spa.html
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { api, apiGet, apiPatch, apiDelete } from '/js/api.js';
import { useSession } from '/js/use-session.js';
import { ago } from '/js/format.js';
import { PageFrame } from '/components/PageFrame.js';
import { PageIntro } from '/components/PageIntro.js';
import { BackLink } from '/components/BackLink.js';
import { Spinner } from '/components/Spinner.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { Facts } from '/components/Facts.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Mark, Marks } from '/components/Mark.js';
import { SubHeading } from '/components/SubHeading.js';
import { Stack } from '/components/Layout.js';
import { useConfirm } from '/components/Modal.js';
import { ConnectorSteps } from '/views/profile/agents/agent-guide.js';
import { moveAgent } from '/js/services/agent-draft.js';
import { machineName } from '/views/home/agents-band.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const m = (key, fallback) => tr('home.machines.' + key, fallback);

const HOME = '/v1/home';

/** How a machine runs agents, in the words the proposal page uses. */
function runWords(modes) {
  if (!modes) return m('runUnknown', 'It has not said.');
  return modes.includes('resident')
    ? m('runBoth', 'It starts an agent when work arrives, and it can keep one always on.')
    : m('runSpawn', 'It starts an agent when work arrives.');
}

/** One machine: its facts, and the acts that concern it alone. */
function Machine({ c, others, onChanged, confirm }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(c.name || '');
  const [menu, setMenu] = useState(null);
  const [asking, setAsking] = useState(false);
  const [moving, setMoving] = useState(false);
  const [target, setTarget] = useState(others[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);

  const path = `/v1/agents/v2/connectors/${encodeURIComponent(c.id)}`;
  const everyone = [...c.agents, ...c.waiting];

  const rename = async () => {
    if (busy || !name.trim()) return;
    setBusy(true); setSaid(null);
    try { await apiPatch(path, { name: name.trim() }); setNaming(false); onChanged(); }
    catch (err) { setSaid({ ok: false, text: err?.message || String(err) }); }
    finally { setBusy(false); }
  };

  const forget = () => confirm(
    m('forgetAsk', 'Forget {name}? Its agents stay. An agent that was waiting for it goes to the next machine that connects.').replace('{name}', machineName(c)),
    async () => {
      try { await apiDelete(path); onChanged(); }
      catch (err) { setSaid({ ok: false, text: err?.message || String(err) }); }
    },
    { danger: true, confirmLabel: m('forget', 'Forget this machine') },
  );

  const ask = async () => {
    if (asking || !c.agents.length) return;
    setAsking(true); setSaid(null);
    try {
      const resp = await api(`/v1/agents/${encodeURIComponent(c.agents[0])}/crew/menu`, { timeoutMs: 30_000, retries: 0 });
      setMenu(resp?.data ?? { tools: [], models: [] });
    } catch (err) { setSaid({ ok: false, text: err?.message || String(err) }); }
    finally { setAsking(false); }
  };

  const moveAll = async () => {
    if (busy || !target) return;
    setBusy(true); setSaid(null);
    let moved = 0; let last = '';
    for (const agent of everyone) {
      try { await moveAgent(agent, target); moved++; }
      catch (err) { last = err?.message || String(err); }
    }
    setBusy(false);
    setMoving(false);
    setSaid(moved === everyone.length
      ? { ok: true, text: m('movedAll', '{n} agents moved.').replace('{n}', String(moved)) }
      : { ok: false, text: m('movedSome', '{n} of {total} agents moved. {why}').replace('{n}', String(moved)).replace('{total}', String(everyone.length)).replace('{why}', last) });
    onChanged();
  };

  const tools = (menu?.tools ?? []).map((x) => x?.id).filter((x) => typeof x === 'string' && !x.includes(':') && !x.startsWith('exchange_'));

  /** @type {Array<Record<string, any>>} */
  const rows = [
    { k: m('state', 'State'), state: c.online ? 'fine' : 'attention',
      v: c.online ? tr('home.agents.connected', 'Connected') : m('lastSeen', 'Not connected, last seen {when}').replace('{when}', ago(c.last_seen)) },
    { k: m('runs', 'How it runs agents'), v: runWords(c.run_modes) },
    { k: m('agents', 'Agents on it'), v: c.agents.length
      ? html`<${Marks}>${c.agents.map((a) => html`<${Mark} key=${a}><a href=${`${HOME}?agent=${encodeURIComponent(a)}`}>${a}</a><//>`)}<//>`
      : m('noAgents', 'None yet.'), missing: !c.agents.length },
  ];
  if (c.waiting.length) {
    rows.push({ k: m('waiting', 'Waiting for it'), warn: true,
      v: html`<${Marks}>${c.waiting.map((a) => html`<${Mark} key=${a} tone="need"><a href=${`${HOME}?agent=${encodeURIComponent(a)}`}>${a}</a><//>`)}<//>` });
  }
  if (menu) {
    // source 'none': the runtime on the machine did not answer, which is not the same as an
    // answer with nothing in it.
    const silent = menu.source === 'none';
    const models = (menu.models ?? []).length;
    rows.push({ k: m('can', 'What it can do'), missing: silent, v: tools.length
      ? html`<${Marks}>${tools.map((id) => html`<${Mark} key=${id}>${id}<//>`)}<//>`
      : silent ? m('canSilent', 'The machine did not answer. The program that runs agents on it may be stopped.')
        : m('canNone', 'Its runtime named no tools.'),
      sub: models > 0 ? m('models', '{n} AI models are within its reach.').replace('{n}', String(models)) : undefined });
  }
  if (c.reported_name && c.reported_name !== c.name) rows.push({ k: m('reported', 'Its own name'), v: c.reported_name, mono: true });

  return html`
    <${Box} name=${machineName(c)}
      marks=${html`<${Mark} kind="status" tone=${c.online ? 'fine' : 'attention'}>
        ${c.online ? tr('home.agents.connected', 'Connected') : tr('home.agentPage.notConnected', 'Not connected')}
      <//>`}>
      <${Stack} gap="small">
        <${Facts} wide rows=${rows} />

        ${naming && html`
          <${Fields}>
            <${TextField} label=${m('nameLabel', 'Your name for this machine')} value=${name} onInput=${setName} onEnter=${rename}
              maxLength=${60} placeholder=${m('namePlaceholder', 'Home computer')} />
            <${FormActions}>
              <${Loud} control disabled=${busy || !name.trim()} onClick=${rename}>${m('save', 'Save the name')}<//>
              <${Action} disabled=${busy} onClick=${() => setNaming(false)}>${tr('home.agentNew.cancel', 'Cancel')}<//>
            <//>
          <//>`}

        ${moving && html`
          <${Fields}>
            <${Choice} boxed cols=${2} label=${m('moveTo', 'Move its agents to')} value=${target} onChange=${setTarget}
              options=${others.map((o) => ({
                value: o.id, label: machineName(o),
                hint: o.online ? tr('home.agentNew.machineOn', 'Connected.') : tr('home.agentPage.moveOff', 'Not connected. Only an agent that still waits can be sent here.'),
              }))} />
            <${FormActions}>
              <${Loud} control disabled=${busy || !target} onClick=${moveAll}>
                ${busy ? tr('home.agentPage.movingNow', 'Moving…') : m('moveDo', 'Move {n} agents').replace('{n}', String(everyone.length))}
              <//>
              <${Action} disabled=${busy} onClick=${() => setMoving(false)}>${tr('home.agentNew.cancel', 'Cancel')}<//>
            <//>
          <//>`}

        ${said && html`<${Note} kind="message" error=${!said.ok}>${said.text}<//>`}

        <${Actions}>
          ${!naming && html`<${Action} small onClick=${() => { setName(c.name || ''); setNaming(true); }}>${m('rename', 'Rename')}<//>`}
          ${c.online && c.agents.length > 0 && !menu && html`
            <${Action} small disabled=${asking} onClick=${ask}>${asking ? m('asking', 'Asking the machine…') : m('ask', 'Show what it can do')}<//>`}
          ${everyone.length > 0 && others.length > 0 && !moving && html`
            <${Action} small onClick=${() => setMoving(true)}>${m('move', 'Move its agents to another machine')}<//>`}
          ${!c.online && html`<${Action} small tone="danger" onClick=${forget}>${m('forget', 'Forget this machine')}<//>`}
        <//>
      <//>
    <//>`;
}

export default function MachinesView({ navigate }) {
  const session = useSession();
  const [machines, setMachines] = useState(null);
  const [loadError, setLoadError] = useState('');
  const { confirm, ConfirmUI } = useConfirm();

  const load = useCallback(async () => {
    try {
      const resp = await apiGet('/v1/agents/v2/connectors');
      setMachines(resp?.data?.connectors ?? []);
      setLoadError('');
    } catch (err) { setLoadError(err?.message || String(err)); }
  }, []);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => { if (session) loadRef.current(); }, [session]);
  // A machine connecting or going away is an `agents` change, and this page shows exactly that.
  useEffect(() => {
    const handler = () => { if (session) loadRef.current(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [session]);

  const goHome = useCallback((e) => { e?.preventDefault?.(); navigate(HOME); }, [navigate]);
  const back = html`<${BackLink} href=${HOME} onClick=${goHome}>↩ ${tr('home.history.back', 'Back to your home')}<//>`;

  if (!session) {
    return html`
      <${PageFrame} width="narrow">
        <${PageIntro} title=${m('title', 'Your machines')} sub=${tr('home.signInDesc', 'Sign in to see where you left off.')} />
        <${FormActions}><${Loud} onClick=${() => navigate('/v1/portal')}>${tr('home.signIn', 'Sign in')}<//><//>
      <//>`;
  }
  if (loadError && !machines) return html`<${PageFrame} width="narrow">${back}<${ErrorNote} text=${loadError} /><//>`;
  if (!machines) return html`<${PageFrame} width="narrow" loading=${true}><${Spinner} /><//>`;

  return html`
    <${PageFrame} width="narrow">
      ${back}
      <${PageIntro} title=${m('title', 'Your machines')}
        sub=${m('sub', 'A machine is a place where your agents run. An agent can use only what its machine can do and what you allowed it.')} />

      ${machines.length === 0
        ? html`<${Note} kind="aside">
            <b>${tr('home.agents.noMachineTitle', 'An agent needs a machine to run on. You have no machine yet.')}</b>
            ${' '}${m('noneText', 'Add one below. An agent you already made starts on it by itself.')}
          <//>`
        : html`<${Stack} gap="medium">
            ${machines.map((c) => html`
              <${Machine} key=${c.id} c=${c} others=${machines.filter((o) => o.id !== c.id)} onChanged=${load} confirm=${confirm} />`)}
          <//>`}

      <${SubHeading} level=${2} desc=${m('addDesc', 'Your own computer or server. Agents run on it and can use the models it reaches. Run these two commands on it, approve the code it shows, and the machine appears on this page, where you give it a name.')}>
        ${m('addTitle', 'Add a machine')}
      <//>
      <${ConnectorSteps} session=${session} />
      <${Note} kind="quiet">${m('addNote', 'The machine does work only while it is switched on.')}<//>

      <${ConfirmUI} />
    <//>`;
}
