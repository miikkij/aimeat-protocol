/**
 * @file public/views/chat.js
 * @description The chat page: the person's first agent, reachable without connecting anything.
 *
 *   Everything else on this node assumes a person has already wired their own AI tool to it over
 *   MCP. This page is the door for the ones who have not, and for the ones who never will. The agent
 *   it talks to is a real GAII principal with real scopes, so what happens here is the same work
 *   that happens through any other client, under the same permissions, visible in the same places.
 *
 *   The tool calls are on screen for every turn. A chat that reports success without showing what it
 *   did asks to be believed; this one can be checked, and that is what makes it credible as a first
 *   agent rather than a demo.
 * @structure
 *   - ChatView — the page: status, conversations, one live turn
 * @usage import ChatView from '/views/chat.js'
 * @version-history
 *   v1.5.0 — 2026-08-17 — One trust sentence under the welcome (chat.welcomeTrust): what a person
 *     makes here is theirs and stays private until they publish. The first screen asked for a
 *     request without saying where the result would live.
 *   v1.4.0 — 2026-08-16 — The install suggestion (InstallCta, compact) sits where the mobile nudge
 *     does, whichever of the two applies — the browser never proposes installing on its own.
 *   v1.3.0 — 2026-08-16 — Drains the wish (sessionStorage 'aimeat.wish', stored by the landing's
 *     wish box and the wiifm page's GO box) into the composer, same contract as the intake queue:
 *     the person reads it and presses send themselves.
 *   v1.2.0 — 2026-08-16 — Drains the intake queue (OS share sheet + offline-page notes) into the
 *     composer: text becomes draft, shared pictures ride the existing attach path. Reviewed and
 *     sent by the person — nothing from the queue is submitted on its own.
 *   v1.1.0 — 2026-08-16 — Speech: a recording becomes text in the box for the person to read before
 *     they send it, and the engine is primed inside the tap so reading an answer aloud works on iOS.
 *   v1.0.1 — 2026-08-16 — The work log keys tool calls by id rather than title, so a finished call
 *     stops reading as "starting".
 *   v1.0.0 — 2026-08-16 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { hasSession } from '/js/services/auth.js';
import { Spinner } from '/components/Spinner.js';
import * as chat from '/js/services/chat.js';
import { primeSpeech } from '/js/services/speech-reader.js';
import { readIntake, clearIntake, intakeText } from '/js/intake.js';
import { ThreadList, Turn, LiveTurn, TurnError, Composer, StatusBar, GooseCredit, Choices, choicesIn, AiNotice, MobileNudge } from './chat/parts.js';
import { CopyButton } from '/components/CopyButton.js';
import { InstallCta } from '/components/InstallCta.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/**
 * The conversation as plain text, in the order it happened.
 *
 * Who said what, and nothing else: no tool log, no timestamps to the second, no markdown fences
 * around the whole thing. This is the shape that pastes into a document or another chat and still
 * reads as a conversation.
 */
function conversationAsText(title, turns) {
    const head = title ? `# ${title}\n\n` : '';
    const body = (turns ?? []).map((turn) => {
        const who = turn.role === 'user' ? tr('chat.youLabel', 'You') : tr('chat.agentLabel', 'Agent');
        return `## ${who}\n\n${(turn.text || '').trim()}`;
    }).join('\n\n');
    return `${head}${body}\n`;
}

/**
 * The openings offered on an empty conversation.
 *
 * Each one is a request a person could have typed. The first ends with an address they own — a page
 * at /p/<their name> that did not exist a minute ago. The second starts the conversation this place
 * is actually for: what they are trying to get done, in their words, which is the thing everything
 * else attaches to. A person who reads a feature list has told the agent nothing; a person who says
 * what keeps slipping has told it enough to build the whole thing.
 *
 * The button sends the sentence rather than filling the box with it — a half-written prompt waiting
 * to be edited is one more decision, and the point of these is to remove decisions.
 */
const STARTERS = [
    { id: 'page', key: 'chat.starterPageAsk', fallback: 'Put up my welcome page — keep it simple, and tell me the address when it is live.',
      label: 'chat.starterPage', labelFallback: 'Make my welcome page' },
    { id: 'work', key: 'chat.starterWorkAsk', fallback: 'Something on my plate keeps slipping. Ask me about it, then suggest one thing you could take over.',
      label: 'chat.starterWork', labelFallback: 'Take something off my plate' },
    { id: 'connect', key: 'chat.starterConnectAsk', fallback: 'I already pay for an AI subscription. How do I connect it to this node so it can do this work?',
      label: 'chat.starterConnect', labelFallback: 'Connect my own AI' },
];

/** Close enough to the bottom to count as "following the conversation". */
const BOTTOM_SLACK_PX = 48;
/** How long a scroll up suspends auto-follow. Long enough to read a paragraph and look back up. */
const SCROLL_GRACE_MS = 15_000;

export default function ChatView() {
    const [status, setStatus] = useState(null);
    const [threads, setThreads] = useState([]);
    const [thread, setThread] = useState(null);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [live, setLive] = useState({ text: '', thought: '', tools: [], cards: [] });
    const [failure, setFailure] = useState('');
    const [loading, setLoading] = useState(true);
    // On a phone the conversation takes the whole screen, so the list is a separate place rather
    // than a column that would leave neither readable.
    const [listOpen, setListOpen] = useState(false);
    const [listening, setListening] = useState(false);
    // Pictures picked but not yet sent. Each carries its own state, because one failing upload must
    // not take the others with it or block a message that never needed it.
    const [attachments, setAttachments] = useState([]);
    const [nudgeDismissed, setNudgeDismissed] = useState(true);

    const abortRef = useRef(null);
    const bottomRef = useRef(null);
    const lastAskRef = useRef('');

    const loadThreads = useCallback(async () => {
        const res = await chat.listThreads();
        setThreads(res?.data?.threads ?? []);
    }, []);

    const openThread = useCallback(async (id) => {
        const res = await chat.getThread(id);
        setThread(res?.data?.thread ?? null);
        setFailure('');
        setLive({ text: '', thought: '', tools: [], cards: [] });
        setListOpen(false);
    }, []);

    // First load: what this node offers, and where the person left off.
    useEffect(() => {
        if (!hasSession()) { setLoading(false); return; }
        (async () => {
            try {
                const [st, list, nudges] = await Promise.all([
                    chat.status(), chat.listThreads(), chat.readNudges(),
                ]);
                setNudgeDismissed(!!nudges?.mobile);
                setStatus(st?.data ?? null);
                const found = list?.data?.threads ?? [];
                setThreads(found);
                if (found.length > 0) await openThread(found[0].id);
            } catch (err) {
                setFailure(err.message || tr('chat.loadFailed', 'The chat could not be loaded.'));
            } finally {
                setLoading(false);
            }
        })();
    }, [openThread]);

    // Keep the newest turn in view — UNLESS the person has scrolled up to read something.
    //
    // Following the newest line is right when you are at the bottom and wrong the moment you are
    // not: an agent that writes for four minutes yanks you back mid-sentence every time it emits a
    // token, and reading what it did ten lines ago becomes impossible. So: pinned to the bottom
    // means follow, as before. Scrolled up means stop following, and stay stopped for a while after
    // the last scroll — long enough to actually read — rather than resuming on the next token.
    // Returning to the bottom yourself re-pins it immediately, which is the gesture people already
    // use to mean "keep up".
    const [pinned, setPinned] = useState(true);
    const releaseRef = useRef(0);
    const onScrollArea = useCallback((ev) => {
        const el = ev.currentTarget;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK_PX;
        if (atBottom) { releaseRef.current = 0; setPinned(true); return; }
        releaseRef.current = Date.now();
        setPinned(false);
    }, []);
    // Re-pin after the quiet period, so a person who scrolled up and stopped reading is carried
    // back to the live edge instead of being stranded there for good.
    useEffect(() => {
        if (pinned) return undefined;
        const id = setInterval(() => {
            if (releaseRef.current && Date.now() - releaseRef.current >= SCROLL_GRACE_MS) {
                setPinned(true);
            }
        }, 1000);
        return () => clearInterval(id);
    }, [pinned]);

    useEffect(() => {
        if (!pinned) return;
        bottomRef.current?.scrollIntoView({ block: 'end' });
    }, [thread?.turns?.length, live.text, live.tools.length, live.cards.length, pinned]);

    // The on-screen keyboard, measured rather than calculated.
    //
    // `100dvh − keyboard` double-counts on Android Chrome, where dvh already shrinks for the
    // keyboard, and the composer ends up floating above a dead gap. The visual viewport excludes the
    // keyboard on every platform, so the distance from the top of the page to the bottom of it is
    // the space there actually is. Same approach as the inbox, for the same reason.
    useEffect(() => {
        const vv = window.visualViewport;
        const root = document.documentElement;
        if (!vv) return undefined;
        const sync = () => {
            if (!window.matchMedia('(max-width: 760px)').matches) {
                root.style.removeProperty('--chat-avail');
                return;
            }
            root.style.setProperty('--chat-avail', `${Math.max(220, Math.round(vv.height))}px`);
        };
        sync();
        vv.addEventListener('resize', sync);
        vv.addEventListener('scroll', sync);
        window.addEventListener('orientationchange', sync);
        return () => {
            vv.removeEventListener('resize', sync);
            vv.removeEventListener('scroll', sync);
            window.removeEventListener('orientationchange', sync);
            root.style.removeProperty('--chat-avail');
        };
    }, []);

    // A change to the agent's permissions is made elsewhere, so the status line refreshes with the
    // rest of the page rather than going stale until a reload.
    useEffect(() => {
        const handler = async () => {
            try {
                setStatus((await chat.status())?.data ?? null);
            } catch (err) {
                // A stale allowance line is not worth interrupting a conversation over, and the
                // next update will correct it. Said out loud so it is not invisible either.
                console.warn('[chat] the status line could not be refreshed:', err.message);
            }
        };
        window.addEventListener('aimeat-live-update', handler);
        return () => window.removeEventListener('aimeat-live-update', handler);
    }, []);

    const startThread = useCallback(async () => {
        const res = await chat.createThread();
        const created = res?.data?.thread;
        if (!created) return null;
        setThread(created);
        setFailure('');
        setListOpen(false);
        await loadThreads();
        return created;
    }, [loadThreads]);

    /**
     * Send one message and read the answer as it is written.
     *
     * The person's words appear immediately rather than after the round trip: the node has already
     * written them down by the time the first event arrives, and waiting to show them would make a
     * slow turn look like a lost one.
     */
    const send = useCallback(async (retryText, starterId) => {
        const text = (retryText ?? draft).trim();
        if (!text || busy) return;
        // Inside the tap, because that is the only moment iOS will accept it. Without this, reading
        // an answer aloud later is a silent no-op with nothing in the console to find.
        primeSpeech();

        let target = thread;
        if (!target) {
            target = await startThread();
            if (!target) return;
        }

        lastAskRef.current = text;
        setDraft('');
        setFailure('');
        setBusy(true);
        setLive({ text: '', thought: '', tools: [], cards: [] });
        setThread((prev) => (prev ? {
            ...prev,
            turns: [...(prev.turns ?? []), { role: 'user', text, at: new Date().toISOString() }],
        } : prev));
        // Cleared once they are on their way: they belong to the message that was just sent.
        setAttachments((prev) => { prev.forEach((a) => a.preview && URL.revokeObjectURL(a.preview)); return []; });

        // Only the ones that actually landed. An upload still running or failed is not silently
        // dropped from the person's view — it stays in the row, and they can send again with it.
        const attachmentKeys = attachments.filter((a) => a.state === 'ready' && a.key).map((a) => a.key);

        const controller = new AbortController();
        abortRef.current = controller;

        let answer = '';
        const tools = new Map();
        const cards = new Map();
        try {
            for await (const update of chat.streamTurn(target.id, text, controller.signal, attachmentKeys, starterId)) {
                if (update.kind === 'text') {
                    answer += update.text;
                    setLive((l) => ({ ...l, text: answer }));
                } else if (update.kind === 'thought') {
                    setLive((l) => ({ ...l, thought: update.text }));
                } else if (update.kind === 'tool_call') {
                    // By id, not title: a call arrives once as it starts and once as it finishes,
                    // and only the first carries a title.
                    const key = update.id || update.title;
                    const seen = tools.get(key);
                    if (seen) {
                        seen.status = update.status;
                        if (update.title) seen.title = update.title;
                    } else {
                        tools.set(key, { title: update.title, status: update.status });
                    }
                    setLive((l) => ({ ...l, tools: [...tools.values()] }));
                    // Keyed by what it points at: the same thing produced twice is one card.
                    if (update.card) {
                        cards.set(update.card.url || update.card.ref || update.card.title, update.card);
                        setLive((l) => ({ ...l, cards: [...cards.values()] }));
                    }
                } else if (update.kind === 'error') {
                    setFailure(update.message || tr('chat.turnFailed', 'The turn could not be completed.'));
                }
            }
        } catch (err) {
            // An abort is the person's own decision, and half an answer is still an answer.
            if (err.name !== 'AbortError') {
                setFailure(err.message || tr('chat.turnFailed', 'The turn could not be completed.'));
            }
        } finally {
            abortRef.current = null;
            setBusy(false);
            setLive({ text: '', thought: '', tools: [], cards: [] });
            // Read the conversation back from the node: it is the record, and what it holds is what
            // was actually saved rather than what this page happened to see.
            try {
                const fresh = await chat.getThread(target.id);
                if (fresh?.data?.thread) setThread(fresh.data.thread);
                await loadThreads();
            } catch (err) {
                // The turn ran; a failed re-read leaves the optimistic copy on screen, which is the
                // same text, and the next open corrects it.
                console.warn('[chat] the conversation could not be re-read:', err.message);
                if (answer) {
                    setThread((prev) => (prev ? {
                        ...prev,
                        turns: [...(prev.turns ?? []), { role: 'agent', text: answer, at: new Date().toISOString(), tools: [...tools.values()], cards: [...cards.values()] }],
                    } : prev));
                }
            }
        }
    }, [draft, busy, thread, startThread, loadThreads, attachments]);

    const stop = useCallback(() => { abortRef.current?.abort(); }, []);

    /** This device, not this browser's name: is it the one you carry? */
    const onDesktop = typeof window !== 'undefined'
        && window.matchMedia?.('(pointer: fine)').matches
        && (navigator.maxTouchPoints ?? 0) === 0;
    const showMobileNudge = !nudgeDismissed && onDesktop && status && status.push_devices === 0;

    const dismissNudge = useCallback(() => {
        setNudgeDismissed(true);
        // Stored with the PERSON: a second desktop is not a second chance to ask.
        chat.dismissNudge('mobile').catch((err) => console.warn('[chat] the dismissal was not saved:', err.message));
    }, []);

    /**
     * Attach pictures: upload each on its own, in the background, while the person keeps typing.
     *
     * Uploading on ATTACH rather than on send is what keeps the send instant — by the time they have
     * finished the sentence the bytes are already in their storage, and a failure has been reported
     * next to the thumbnail rather than swallowing the message.
     */
    const attach = useCallback((files) => {
        for (const file of files.slice(0, 4)) {
            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            // A thumbnail for a picture; a name and a type for everything else, because a preview
            // of a CSV is a grey rectangle that says nothing.
            const preview = file.type?.startsWith('image/') ? URL.createObjectURL(file) : null;
            setAttachments((prev) => [...prev, { id, name: file.name || 'image', preview, state: 'uploading' }]);
            chat.uploadAttachment(file)
                .then((key) => setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, key, state: 'ready' } : a))))
                .catch((err) => setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, state: 'error', error: err.message } : a))));
        }
    }, []);

    // Drain the intake queue: what arrived through the OS share sheet, and the notes left on the
    // offline page, become composer content here — text joins the draft, pictures ride the same
    // attach path a hand-picked file does. The person reads it and presses send themselves;
    // nothing from the queue is submitted on its own. Runs on mount and again when the
    // connection returns, because that is the moment an offline note has been waiting for.
    useEffect(() => {
        if (!hasSession()) return undefined;
        let gone = false;
        const drain = () => (async () => {
            const items = await readIntake();
            if (gone || items.length === 0) return;
            const texts = items.map(intakeText).filter(Boolean);
            if (texts.length) setDraft((d) => [d.trim(), ...texts].filter(Boolean).join('\n\n'));
            const files = items.flatMap((it) => (it.files ?? [])
                .filter((f) => f && f.blob)
                .map((f) => new File([f.blob], f.name || 'shared', { type: f.type || 'application/octet-stream' })));
            if (files.length) attach(files);
            await clearIntake();
        })().catch((err) => console.warn('[chat] the intake queue could not be drained:', err.message));
        drain();
        window.addEventListener('online', drain);
        return () => { gone = true; window.removeEventListener('online', drain); };
    }, [attach]);

    // The wish from the front door (or the wiifm page's GO box) becomes composer content under
    // the same contract as the intake queue above: the person reads it and presses send
    // themselves. Drained once, on mount — a wish is one sentence, not a subscription.
    useEffect(() => {
        try {
            const wish = sessionStorage.getItem('aimeat.wish');
            if (wish) {
                setDraft((d) => [d.trim(), wish].filter(Boolean).join('\n\n'));
                sessionStorage.removeItem('aimeat.wish');
            }
        } catch (err) { console.warn('[chat] the wish could not be read:', err.message); }
    }, []);

    const dropAttachment = useCallback((id) => {
        setAttachments((prev) => {
            const gone = prev.find((a) => a.id === id);
            if (gone?.preview) URL.revokeObjectURL(gone.preview);
            return prev.filter((a) => a.id !== id);
        });
    }, []);

    /**
     * A recording becomes text in the box, not a sent message.
     *
     * Speech recognition is wrong often enough that sending what it heard would make the person
     * argue with a machine about what they said. They read it first, and edit it if it is wrong.
     */
    const speakToText = useCallback(async (file) => {
        setListening(true);
        setFailure('');
        try {
            const heard = await chat.speakToText(file);
            if (heard) setDraft((d) => (d ? `${d} ${heard}` : heard));
            else setFailure(tr('chat.heardNothing', 'Nothing was heard in that recording.'));
        } catch (err) {
            setFailure(err.message || tr('chat.transcribeFailed', 'That recording could not be turned into text.'));
        } finally {
            setListening(false);
        }
    }, []);

    const removeThread = useCallback(async (id) => {
        await chat.deleteThread(id);
        if (thread?.id === id) setThread(null);
        await loadThreads();
    }, [thread, loadThreads]);

    const resetSession = useCallback(async () => {
        if (!thread) return;
        await chat.resetThread(thread.id);
    }, [thread]);

    if (!hasSession()) {
        return html`
            <div class="chat-view chat-view--signin">
                <h1>${tr('chat.title', 'Chat')}</h1>
                <p>${tr('chat.signIn', 'Sign in and your first agent is waiting here.')}</p>
            </div>`;
    }

    if (loading) return html`<div class="chat-view"><${Spinner} /></div>`;

    const turns = thread?.turns ?? [];
    // Offered by the LAST agent turn only, and only while nothing is running: a fork the agent
    // named three answers ago has been overtaken by everything said since.
    const lastAgentTurn = [...turns].reverse().find((t) => t.role !== 'user');
    const openChoices = busy ? [] : choicesIn(lastAgentTurn?.text);
    const disabled = status ? !status.enabled : false;

    return html`
        <div class="chat-view ${listOpen ? 'chat-view--list' : ''}">
            <${ThreadList}
                threads=${threads}
                activeId=${thread?.id}
                onOpen=${openThread}
                onNew=${startThread}
                onDelete=${removeThread}
                onClose=${() => setListOpen(false)} />

            <section class="chat-main">
                <header class="chat-head">
                    <button type="button" class="btn-ghost chat-list-toggle"
                        onClick=${() => setListOpen((o) => !o)}>
                        ${listOpen ? tr('chat.closeList', 'Close') : tr('chat.openList', 'Conversations')}
                    </button>
                    <h1 class="chat-title">${thread?.title ?? tr('chat.title', 'Chat')}</h1>
                    <!-- The whole conversation as plain text: what you paste into a document, an
                         issue or another AI. Both sides, in order, with the work log left out —
                         it is a record of the conversation, not of the machinery. -->
                    ${turns.length > 0 && html`<${CopyButton}
                        text=${conversationAsText(thread?.title, turns)}
                        className="btn-ghost chat-copy-all"
                        label=${tr('chat.copyAll', 'Copy conversation')}
                        copiedLabel=${'✓ ' + t('common.copied')}
                        title=${tr('chat.copyAllTitle', 'Copy the whole conversation as text')}
                        ariaLabel=${tr('chat.copyAll', 'Copy conversation')} />`}
                </header>

                <${StatusBar} status=${status} onReset=${thread ? resetSession : null} />
                ${/* Full while this is the first conversation and nothing has been said yet; one
                      line from the first answer onwards. */''}
                <${AiNotice} compact=${turns.length > 0 || threads.length > 1} />
                ${showMobileNudge && html`<${MobileNudge} onDismiss=${dismissNudge} />`}
                ${!showMobileNudge && html`<${InstallCta} compact=${true} />`}

                <div class="chat-scroll" onScroll=${onScrollArea}>
                    ${turns.length === 0 && !busy ? html`
                        <div class="chat-welcome">
                            <h2>${tr('chat.welcomeTitle', 'Your first agent')}</h2>
                            <p>${tr('chat.welcomeBody', 'It works here the way your own AI tool would, with the same permissions and the same record of what it did. Ask it for something.')}</p>
                            <p class="chat-welcome-trust">${tr('chat.welcomeTrust', 'Everything you make here lands in your own account, and nothing becomes public until you publish it yourself.')}</p>
                            <!-- One concrete thing to ask for, not a menu. An empty box asks a person
                                 to invent a task for a system they have not used; a first request
                                 that ends in a real address they can open answers "what is this for"
                                 better than any paragraph on this screen could. -->
                            <div class="chat-starters">
                                ${STARTERS.map((st) => html`
                                    <button type="button" class="btn-outline chat-starter" key=${st.key}
                                        disabled=${disabled}
                                        onClick=${() => send(tr(st.key, st.fallback), st.id)}>
                                        ${tr(st.label, st.labelFallback)}
                                    </button>`)}
                            </div>
                        </div>` : ''}

                    ${turns.map((turn, i) => html`<${Turn} key=${i} id=${`${thread?.id}-${i}`} turn=${turn} />`)}
                    <${LiveTurn} text=${live.text} thought=${live.thought} tools=${live.tools} cards=${live.cards} busy=${busy} />
                    ${!busy && html`<${Choices} options=${openChoices} disabled=${disabled}
                        onPick=${(opt) => send(opt)} />`}
                    <${TurnError} message=${failure}
                        onRetry=${lastAskRef.current && !busy ? () => send(lastAskRef.current) : null} />
                    <div ref=${bottomRef}></div>
                </div>

                ${!pinned && html`
                    <button type="button" class="btn-outline chat-jump-latest"
                        onClick=${() => { releaseRef.current = 0; setPinned(true); bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }}>
                        ${tr('chat.jumpLatest', 'Jump to the latest')}
                    </button>`}

                <${Composer}
                    value=${draft}
                    onInput=${setDraft}
                    onSend=${() => send()}
                    onStop=${stop}
                    onSpeak=${speakToText}
                    onAttach=${attach}
                    attachments=${attachments}
                    onDropAttachment=${dropAttachment}
                    listening=${listening}
                    busy=${busy}
                    disabled=${disabled}
                    note=${disabled ? (status?.note ?? '') : ''} />

                <${GooseCredit} />
            </section>
        </div>
    `;
}
