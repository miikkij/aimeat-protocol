/**
 * @file chat.js
 * @description Frontend service for the built-in chat agent: the conversations, and one turn read
 *   as it arrives.
 *
 *   The turn is the reason this is not four `api()` calls. It is `text/event-stream` over a POST, so
 *   `EventSource` cannot open it — that only does GET, and the message has to go in a body. The
 *   stream is read with `fetch` and a reader, and the frames are parsed here rather than in the view,
 *   because a half-frame at a chunk boundary is a protocol detail and not something a component
 *   should know about.
 * @structure
 *   status / listThreads / createThread / getThread / deleteThread / resetThread / streamTurn
 *   speakToText — a recording becomes text the person can read before they send it
 * @usage
 *   import * as chat from '/js/services/chat.js';
 *   for await (const u of chat.streamTurn(threadId, 'build me pong')) { … }
 * @version-history
 *   v1.3.0 — 2026-08-16 — uploadAttachment(): any file, not only a picture.
 *   v1.2.0 — 2026-08-16 — uploadImage(): an attached picture takes the presigned road to the owner's
 *     own storage, and the turn carries its key. The model gets the bytes from the node.
 *   v1.1.0 — 2026-08-16 — speakToText: a spoken message goes through storage and comes back as text.
 *   v1.0.0 — 2026-08-16 — Initial.
 */
import { api, apiGet } from '/js/api.js';
import { authHeaders, getNodeUrl } from '/js/services/auth.js';

const enc = encodeURIComponent;

/** Does this node have a chat agent, what is it called, and what is left to spend. */
export async function status() {
    return apiGet('/v1/chat/status');
}

/** Open conversations, newest first, without their turns. */
export async function listThreads() {
    return apiGet('/v1/chat/threads');
}

/** Start one. The title is a placeholder until the first message replaces it. */
export async function createThread(title) {
    return api('/v1/chat/threads', { method: 'POST', body: JSON.stringify({ title }) });
}

/** One conversation with every turn it holds. */
export async function getThread(id) {
    return apiGet(`/v1/chat/threads/${enc(id)}`);
}

export async function deleteThread(id) {
    return api(`/v1/chat/threads/${enc(id)}`, { method: 'DELETE' });
}

/**
 * Forget the agent session, keep the conversation.
 *
 * What this is for: the session's credential carries the scopes it was minted with, so changing the
 * chat agent's permissions in the Agents tab reaches the chat only once the session is replaced.
 */
export async function resetThread(id) {
    return api(`/v1/chat/threads/${enc(id)}/reset`, { method: 'POST' });
}

/**
 * Send one message and yield each update as it arrives.
 *
 * Yields the server's own events: `text` and `thought` as words are written, `tool_call` as each
 * call starts and finishes, `done` at the end, and `error` when the turn could not run. A turn that
 * ends without a verdict yields one `error` of its own rather than stopping silently, because a
 * conversation that just stops is indistinguishable from one still thinking.
 *
 * `signal` aborts the read. The turn keeps running on the node; the connection is what closes.
 * `starter` names the starter button that fired this turn — funnel bookkeeping, omitted otherwise.
 */
export async function* streamTurn(id, text, signal, attachments = [], starter) {
    const res = await fetch(`${getNodeUrl()}/v1/chat/threads/${enc(id)}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...authHeaders() },
        body: JSON.stringify({
            text,
            ...(attachments.length ? { attachments } : {}),
            ...(starter ? { starter } : {}),
        }),
        signal,
    });

    if (!res.ok) {
        // A refusal arrives as ordinary JSON: the stream never opened, so there is nothing to read.
        // A refusal that is not JSON leaves the status as the only fact there is, and the status is
        // what the person is shown. Nothing is hidden by not parsing further.
        const body = await res.json()
            // eslint-disable-next-line aimeat/no-silent-catch -- the status below carries the reason
            .catch(() => null);
        yield { kind: 'error', message: body?.error?.message || `The node refused the message (${res.status}).` };
        return;
    }
    if (!res.body) {
        yield { kind: 'error', message: 'This browser cannot read a streamed answer.' };
        return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sawVerdict = false;

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // Frames are separated by a blank line. Anything after the last one is a partial frame
            // and stays in the buffer until the rest of it arrives.
            let cut;
            while ((cut = buffer.indexOf('\n\n')) !== -1) {
                const frame = buffer.slice(0, cut);
                buffer = buffer.slice(cut + 2);
                for (const line of frame.split('\n')) {
                    if (!line.startsWith('data:')) continue; // `:open` and `:keepalive` are comments
                    let update;
                    try {
                        update = JSON.parse(line.slice(5).trim());
                    } catch (err) {
                        // One malformed frame is not the turn failing. Say so once and keep reading;
                        // dropping the whole stream over a bad line would lose the answer as well.
                        console.warn('[chat] skipped an unreadable frame:', err.message);
                        continue;
                    }
                    if (update.kind === 'done' || update.kind === 'error') sawVerdict = true;
                    yield update;
                }
            }
        }
    } finally {
        // eslint-disable-next-line aimeat/no-silent-catch -- cancelling a stream that already ended is the normal case
        reader.cancel().catch(() => { /* the stream is already gone; nothing to recover */ });
    }

    if (!sawVerdict) {
        yield { kind: 'error', message: 'The connection closed before the answer finished.' };
    }
}

/**
 * Turn a recording into text.
 *
 * The clip goes to storage first and the node is handed a key, never the bytes: a minute of speech
 * is megabytes, and base64 in a JSON body inflates it by a third before hitting a body limit that
 * has nothing to do with the storage quota. The same path the inbox already uses for a voice
 * message, for the same reason.
 *
 * The text comes back to the composer rather than being sent. A person should read what the machine
 * heard before it becomes something they asked for.
 */
export async function speakToText(file) {
    const rand = Math.random().toString(36).slice(2, 8);
    const key = `chat-voice/${Date.now()}-${rand}.${(file.type.split('/')[1] || 'webm').split(';')[0]}`;
    const mime = file.type || 'application/octet-stream';

    const mint = await api('/v1/storage', {
        method: 'POST',
        body: JSON.stringify({ key, mime_type: mime, visibility: 'private', mode: 'presigned' }),
    });
    const uploadUrl = mint?.data?.upload_url;
    if (!uploadUrl) throw new Error(mint?.error?.message || 'The node would not accept the recording.');

    // Checked before the token is spent: it is single-use, so an oversized PUT burns it and answers
    // a bare 413 instead of naming the limit.
    const maxBytes = Number(mint?.data?.max_size_bytes) || 0;
    if (maxBytes && file.size > maxBytes) {
        throw new Error(`That recording is ${(file.size / 1048576).toFixed(1)} MB; the largest accepted here is ${(maxBytes / 1048576).toFixed(0)} MB.`);
    }

    // Plain fetch, deliberately not api(): the presigned token IS the capability, so no
    // Authorization header, and a retry on a consumed one-shot token answers 409 TOKEN_USED.
    const put = await fetch(uploadTarget(uploadUrl), { method: 'PUT', headers: { 'Content-Type': mime }, body: file });
    if (!put.ok) throw new Error(`The recording could not be stored (${put.status}).`);

    const res = await api('/v1/ai/transcribe', {
        method: 'POST',
        body: JSON.stringify({ storage_key: key, mime, app_id: 'chat' }),
        timeoutMs: 180_000,
        retries: 0,
    });
    if (res?.ok === false) throw new Error(res.error?.message || 'The recording could not be transcribed.');
    return String(res?.data?.text ?? '').trim();
}

/**
 * A file the person attached, stored under their own namespace, returned as its key.
 *
 * The same presigned road as a voice recording and for the same reason: bytes never travel through a
 * JSON body, the size is checked against the storage quota before the one-shot token is spent, and
 * the thing that reaches the turn is a key. Private on purpose — the model receives the BYTES from
 * the node, so the picture never needs a public address to be understood.
 */
export async function uploadAttachment(file) {
    const rand = Math.random().toString(36).slice(2, 8);
    const ext = (file.name?.split('.').pop() || (file.type.split('/')[1] || 'bin')).toLowerCase().slice(0, 8);
    const key = `chat-files/${Date.now()}-${rand}.${ext}`;
    const mime = file.type || 'application/octet-stream';

    const mint = await api('/v1/storage', {
        method: 'POST',
        body: JSON.stringify({ key, mime_type: mime, visibility: 'private', mode: 'presigned' }),
    });
    const uploadUrl = mint?.data?.upload_url;
    if (!uploadUrl) throw new Error(mint?.error?.message || 'The node would not accept the file.');

    const maxBytes = Number(mint?.data?.max_size_bytes) || 0;
    if (maxBytes && file.size > maxBytes) {
        throw new Error(`That file is ${(file.size / 1048576).toFixed(1)} MB; the largest accepted here is ${(maxBytes / 1048576).toFixed(0)} MB.`);
    }

    const put = await fetch(uploadTarget(uploadUrl), { method: 'PUT', headers: { 'Content-Type': mime }, body: file });
    if (!put.ok) throw new Error(`The file could not be stored (${put.status}).`);
    return key;
}

/**
 * Which one-off suggestions this person has already waved away.
 *
 * One record, not one key per nudge: the budget is a thousand keys per principal, and a suggestion
 * that costs a key every time somebody says "not now" is a store that fills with refusals. Stored
 * with the person rather than in this browser, so a second desktop is not a second chance to ask.
 */
export async function readNudges() {
    // A read that fails is treated as "already dismissed": the cost of a missing suggestion is
    // nothing, and the cost of showing one to somebody who waved it away is that they stop reading
    // anything this page says.
    const res = await apiGet('/v1/memory/chat.nudges?soft=1').catch((err) => {
        console.warn('[chat] the dismissals could not be read:', err.message);
        return { data: { value: { mobile: true } } };
    });
    const value = res?.data?.value;
    return value && typeof value === 'object' ? value : {};
}

/** Remember that one was dismissed, keeping whatever else the record holds. */
export async function dismissNudge(name) {
    const current = await readNudges();
    return api('/v1/memory', {
        method: 'POST',
        body: JSON.stringify({ key: 'chat.nudges', value: { ...current, [name]: true }, tags: ['chat'] }),
    });
}

/** The node mints an absolute upload URL. Collapse it to a path on the same origin so the PUT stays
 *  a plain request rather than a preflighted one. */
function uploadTarget(url) {
    try {
        const u = new URL(url, window.location.origin);
        return u.origin === window.location.origin ? u.pathname + u.search : u.href;
    } catch {
        return url;   // an unparseable URL is used verbatim; the PUT above reports the failure
    }
}
