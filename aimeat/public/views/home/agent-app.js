/**
 * @file public/views/home/agent-app.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description From an agent to an app: a person says in one sentence what they want to see of an
 *   agent's work, reads three apps that could show it before anything is made, picks one, and gets
 *   the text that has an AI build it.
 *
 *   THE SAME WAY IN AS THE AGENT. An agent on the home starts from one sentence and a page that
 *   shows it before it is made (views/home/agent-new.js). This page is that step again for an app,
 *   which is why it comes right after an agent is made (decision "From an agent to an app", Jouni,
 *   2026-10-11).
 *
 *   NOTHING IS BUILT HERE. The page ends in a prompt, and the person chooses which AI gets it: their
 *   own AI that is connected to this AIMEAT, this AIMEAT's own chat, or an AI that cannot connect.
 *   The first two read the agent and the build specification themselves, so they get a short
 *   request; the third gets everything in one text and the person brings the app back. The chat
 *   path puts the request in the chat's composer and sends nothing: the person reads it and
 *   presses send.
 *
 *   WHEN NO MODEL ANSWERS, the page shows one option made from the person's own words and says so,
 *   and everything after it works as it does with three.
 *
 *   Composed from library components only; it has no sheet of its own.
 * @structure default AgentAppView({ navigate })
 * @usage routed at /v1/home?agent=<name>&new-app=1[&say=<sentence>] by spa.html
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (wish-agentista-sovellukseen-sovelluksen-teko-agentin-j-lkeen-ja-a).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { useSession } from '/js/use-session.js';
import { swallowed } from '/js/swallowed.js';
import { PageFrame } from '/components/PageFrame.js';
import { PageIntro } from '/components/PageIntro.js';
import { BackLink } from '/components/BackLink.js';
import { Spinner } from '/components/Spinner.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { Note } from '/components/Note.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { Action, Loud } from '/components/Action.js';
import { PageSection } from '/components/PageSection.js';
import { PromptCard } from '/components/PromptCard.js';
import { readHomeAgents } from '/js/services/agent-draft.js';
import { draftAppOptions, plainOption, buildRequest, readFullBuildPrompt } from '/js/services/agent-ties.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const p = (key, fallback) => tr('home.agentApp.' + key, fallback);

export default function AgentAppView({ navigate }) {
  const session = useSession();
  const query = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const name = query.get('agent') || '';
  // `say` present, even empty, means "show me options now"; absent means "ask me first".
  const asked = query.has('say');

  const [worker, setWorker] = useState(undefined);
  const [loadError, setLoadError] = useState('');
  const [sentence, setSentence] = useState(query.get('say') || '');
  const [phase, setPhase] = useState(asked ? 'drafting' : 'ask');
  const [options, setOptions] = useState([]);
  const [fallback, setFallback] = useState('');
  const [picked, setPicked] = useState('0');
  const [appName, setAppName] = useState('');
  const [shows, setShows] = useState('');
  const [who, setWho] = useState('me');
  const [builder, setBuilder] = useState('own');
  const [chatOn, setChatOn] = useState(false);
  const [full, setFull] = useState({ state: 'none', text: '' });

  const take = (list, index) => {
    const o = list[Number(index)] ?? list[0];
    setPicked(String(index));
    setAppName(o?.name ?? '');
    setShows(o?.shows ?? '');
    setFull({ state: 'none', text: '' });
  };

  const draft = useCallback(async (w, said) => {
    setPhase('drafting');
    setFallback('');
    let list;
    try { list = await draftAppOptions(w, said.trim()); }
    catch (err) {
      swallowed('agent app: draft', err);
      list = [plainOption(w, said.trim())];
      setFallback(err?.code || 'NO_ANSWER');
    }
    setOptions(list);
    take(list, 0);
    setPhase('ready');
  }, []);

  const started = useRef(false);
  useEffect(() => {
    if (!session || !name) return;
    let live = true;
    (async () => {
      try {
        const data = await readHomeAgents(1, name);
        const w = (data?.workers ?? [])[0] ?? null;
        if (!live) return;
        setWorker(w);
        if (w && asked && !started.current) { started.current = true; draft(w, query.get('say') || ''); }
      } catch (err) { if (live) setLoadError(err?.message || String(err)); }
    })();
    // The node's own chat is offered only where it is switched on.
    apiGet('/v1/chat/status').then((r) => { if (live) setChatOn(r?.data?.available === true || r?.data?.enabled === true); })
      .catch((err) => swallowed('agent app: chat status', err));
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the address is read once per page
  }, [session, name]);

  const agentHome = `/v1/home?agent=${encodeURIComponent(name)}`;
  const goBack = useCallback((e) => { e?.preventDefault?.(); navigate(agentHome); }, [navigate, agentHome]);
  const back = html`<${BackLink} href=${agentHome} onClick=${goBack}>↩ ${tr('home.agentWork.back', 'Back to the agent')}<//>`;

  if (!session) {
    return html`
      <${PageFrame} width="narrow">
        <${PageIntro} title=${tr('home.agentPage.signInTitle', 'Your agent')} sub=${tr('home.signInDesc', 'Sign in to see where you left off.')} />
        <${FormActions}><${Loud} onClick=${() => navigate('/v1/portal')}>${tr('home.signIn', 'Sign in')}<//><//>
      <//>`;
  }
  if (loadError) return html`<${PageFrame} width="narrow">${back}<${ErrorNote} text=${loadError} /><//>`;
  if (worker === undefined) return html`<${PageFrame} width="narrow" loading=${true}><${Spinner} /><//>`;
  if (!worker) {
    return html`
      <${PageFrame} width="narrow">
        ${back}
        <${PageIntro} title=${tr('home.agentPage.missingTitle', 'No such agent')}
          sub=${tr('home.agentPage.missingSub', 'You have no agent by that name. Your agents are on your home.')} />
      <//>`;
  }

  const display = worker.display_name || worker.name;

  if (phase === 'ask') {
    return html`
      <${PageFrame} width="narrow">
        ${back}
        <${PageIntro} title=${p('askTitle', 'An app of its work')}
          sub=${p('askSub', 'Say in one sentence what you want to see of the work of {agent}. You see the app before anything is made.').replace('{agent}', display)} />
        <${Fields}>
          <${TextArea} label=${p('askLabel', 'What do you want to see?')} rows=${2} value=${sentence} onInput=${setSentence}
            onSend=${() => draft(worker, sentence)} placeholder=${p('askPlaceholder', 'For example: the newest work on my phone, and the earlier ones by date.')} />
          <${FormActions}>
            <${Loud} control onClick=${() => draft(worker, sentence)}>${sentence.trim() ? p('askShow', 'Show the options') : p('askSuggest', 'Suggest some to me')}<//>
            <${Action} onClick=${goBack}>${tr('home.agentNew.cancel', 'Cancel')}<//>
          <//>
        <//>
      <//>`;
  }

  if (phase === 'drafting') {
    return html`
      <${PageFrame} width="narrow">
        ${back}
        <${PageIntro} title=${p('title', 'This is how it would work')} />
        <${Spinner} text=${p('writing', 'Your AI model is writing three apps for this agent\'s work. This takes a moment.')} />
      <//>`;
  }

  const option = { name: appName.trim() || display, shows: shows.trim() };
  const request = buildRequest(option, worker, who);

  const toChat = () => {
    try { sessionStorage.setItem('aimeat.wish', request); } catch (err) { swallowed('agent app: wish', err); }
    navigate('/v1/chat');
  };
  const loadFull = async () => {
    setFull({ state: 'loading', text: '' });
    try { setFull({ state: 'ready', text: await readFullBuildPrompt(option, worker, who) }); }
    catch (err) { setFull({ state: 'failed', text: err?.message || String(err) }); }
  };

  return html`
    <${PageFrame} width="narrow">
      ${back}
      <${PageIntro} title=${p('title', 'This is how it would work')} />
      ${sentence.trim() && html`<${Note} kind="quiet">${p('asked', 'You asked: “{sentence}”').replace('{sentence}', sentence.trim())}<//>`}
      <${Note} kind="lead">${p('nothingYet', 'Nothing has been made yet. Pick an option, change what you want, and then choose who builds it.')}<//>
      ${fallback && html`
        <${Note} kind="message">${p('fallback', 'No AI model answered here, so this is one option made from your own words. You can change it below.')}<//>
        <${FormActions}><${Action} onClick=${() => draft(worker, sentence)}>${p('retry', 'Ask the model again')}<//><//>`}

      ${options.length > 1 && html`
        <${PageSection} group ends title=${p('optionsTitle', 'Three ways to show its work')}>
          <${Fields}>
            <${Choice} boxed cols=${1} ariaLabel=${p('optionsTitle', 'Three ways to show its work')} value=${picked}
              onChange=${(v) => take(options, v)}
              options=${options.map((o, i) => ({ value: String(i), label: o.name, hint: o.shows }))} />
            <${FormActions}>
              <${Action} onClick=${() => draft(worker, sentence)}>${p('again', 'Suggest three others')}<//>
            <//>
          <//>
        <//>`}

      <${PageSection} group ends title=${p('chosenTitle', 'The chosen app')}>
        <${Fields}>
          <${TextField} label=${p('name', 'Name')} value=${appName} onInput=${(v) => { setAppName(v); setFull({ state: 'none', text: '' }); }} />
          <${TextArea} label=${p('shows', 'What it shows')} rows=${3} value=${shows} onInput=${(v) => { setShows(v); setFull({ state: 'none', text: '' }); }} />
          <${Note} kind="quiet">${p('reads', 'It reads the finished work of {agent}. It keeps no copy, and the agent\'s page lists the app under Apps.').replace('{agent}', display)}<//>
          <${Choice} boxed cols=${1} label=${p('who', 'Who may open it')} value=${who} onChange=${(v) => { setWho(v); setFull({ state: 'none', text: '' }); }}
            options=${[
              { value: 'me', label: p('whoMe', 'Only you') },
              { value: 'members', label: p('whoMembers', 'The members of one of your organisms'), hint: p('whoMembersHint', 'The building AI asks you which one.') },
              { value: 'anyone', label: p('whoAnyone', 'Anyone who has the address') },
            ]} />
        <//>
      <//>

      <${PageSection} group ends title=${p('builderTitle', 'Who builds it')}>
        <${Note} kind="quiet">${p('builderLead', 'An AI builds the app. Choose which one. You read the prompt before any AI gets it.')}<//>
        <${Choice} boxed cols=${1} ariaLabel=${p('builderTitle', 'Who builds it')} value=${builder} onChange=${setBuilder}
          options=${[
            { value: 'own', label: p('builderOwn', 'Your own AI that is connected here'), hint: p('builderOwnHint', 'Claude Code, Codex, Cursor or another connected AI. It builds and publishes the app itself.') },
            ...(chatOn ? [{ value: 'chat', label: p('builderChat', 'This AIMEAT\'s own chat'), hint: p('builderChatHint', 'The prompt opens in the chat, ready. You read it and send it. Nothing is sent before you press.') }] : []),
            { value: 'other', label: p('builderOther', 'An AI that cannot connect'), hint: p('builderOtherHint', 'For example ChatGPT or Gemini without a connection. You copy the prompt, the AI writes the app, and you bring it back here.') },
          ]} />
      <//>

      <${PageSection} group ends title=${p('promptTitle', 'The prompt')}>
        ${builder !== 'other' && html`
          <${PromptCard} loud=${builder === 'own'} quiet=${builder !== 'own'} label=${p('promptLabel', 'What you say to your AI')} prompt=${request}
            copyLabel=${p('copy', 'Copy the prompt')} copiedLabel=${p('copied', 'Copied. Paste it to your AI')} />`}
        ${builder === 'chat' && html`
          <${FormActions}><${Loud} control onClick=${toChat}>${p('toChat', 'Open the chat with this prompt')}<//><//>`}
        ${builder === 'other' && html`
          <${Note} kind="quiet">${p('otherLead', 'This AI cannot read your AIMEAT, so the prompt carries everything: the agent, the structure of its latest result and the whole build specification. It is long.')}<//>
          ${full.state === 'none' && html`<${FormActions}><${Loud} control onClick=${loadFull}>${p('otherMake', 'Make the whole prompt')}<//><//>`}
          ${full.state === 'loading' && html`<${Spinner} />`}
          ${full.state === 'failed' && html`<${Note} kind="message" error>${full.text}<//>`}
          ${full.state === 'ready' && html`
            <${PromptCard} loud showPrompt=${false} label=${p('otherLabel', 'The whole prompt ({n} characters)').replace('{n}', String(full.text.length))} prompt=${full.text}
              copyLabel=${p('copy', 'Copy the prompt')} copiedLabel=${p('copied', 'Copied. Paste it to your AI')} />
            <${FormActions}><${Action} href="/v1/appcat?create=1">${p('otherAdd', 'Add the finished app here →')}<//><//>
            <${Note} kind="quiet">${p('otherTie', 'When the app is added, tie it to the agent on the agent\'s page: Apps, "Tie an app that already exists".')}<//>`}`}
      <//>

      <${PageSection} group ends title=${p('nextTitle', 'What happens then')}>
        <${Note} kind="quiet">${builder === 'other'
          ? p('nextOther', 'The AI writes the app as one file. You add it here and tie it to the agent. Nobody else sees it until you decide so.')
          : p('next', 'The AI builds the app and publishes it to your AIMEAT. The app then shows on the agent\'s page under Apps, and you open it from there. Nobody else sees it until you decide so.')}<//>
        <${FormActions}><${Action} href=${agentHome} onClick=${goBack}>${p('toAgent', 'Back to the agent →')}<//><//>
      <//>
    <//>`;
}
