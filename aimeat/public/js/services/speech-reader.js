/**
 * @file public/js/services/speech-reader.js
 * @description Shared "read this aloud" engine for the SPA, built on the browser's Web Speech API
 *   (`speechSynthesis`) — no server call, no API key, no audio download. One reader is active at a
 *   time: it owns an id (whatever the caller passes — a message id, `'thread'`, …) so a view can show
 *   which block is currently being spoken, and subscribers are notified on every phase change.
 *
 *   The pacing is the interesting part, ported from the (L)AIMEAT Sanomat app's read-aloud: a single
 *   long utterance is spoken as one breathless run (the engine only pauses on . ! ?, and collapses
 *   blank lines), AND Chrome fires `onend` early on long utterances then queues the rest with no gap.
 *   So the text is cut into SHORT pieces (<=160 chars, split on sentences → clauses → words) and each
 *   piece is spoken as its own utterance, with a deliberate silence after it: tiny mid-sentence, short
 *   at a sentence boundary, long at a paragraph end. That is what makes a chat message sound read
 *   rather than recited.
 *
 * @structure isSpeechSupported/getSpeechState/subscribeSpeech (public state) · textToParagraphs
 *   (markdown → speakable paragraphs) · packParagraph/atomize/sentences (chunking) · speak/stop/
 *   pause/resume (transport) · voice selection + locale default.
 * @usage import { speak, stop, subscribeSpeech } from '/js/services/speech-reader.js';
 *   speak('msg-42', textToParagraphs(msg.body));
 * @version-history
 *   v1.1.0 — 2026-08-16 — primeSpeech(): one silent utterance inside a user gesture, so automatic
 *     read-aloud is not a no-op on iOS. It refuses without a gesture and refuses SILENTLY, which is
 *     the hardest kind of missing sound to chase.
 *   v1.0.0 — 2026-07-31 — Initial version: extracted the Sanomat read-aloud pacing into a shared SPA
 *     service so the Inbox thread (and any later view) can speak its content.
 */

// ── Chunking constants (tuned in Sanomat; short pieces keep Chrome's onend reliable) ──
const MAX_LEN = 160;      // hard ceiling for one utterance
const GAP_PARA = 1800;    // silence after a paragraph
const GAP_SENT = 200;     // silence after a sentence
const GAP_CLAUSE = 80;    // silence after a mid-sentence (comma/clause) split

/** @type {Set<(s: { id: string|null, phase: string }) => void>} */
const listeners = new Set();

/** @type {{ id: string|null, phase: 'idle'|'speaking'|'paused' }} */
let _state = { id: null, phase: 'idle' };

/** @type {{ items: Array<{ text: string, gap: number }>, idx: number, timer: any, active: boolean }} */
const _chain = { items: [], idx: 0, timer: null, active: false };

/** @type {SpeechSynthesisVoice[]} */
let _voices = [];

/** True when this browser can speak at all. Safari/Chrome/Edge/Firefox all can; some embedded
 *  webviews cannot, and the calling view should hide its button rather than offer a dead control. */
export function isSpeechSupported() {
  return typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof window.SpeechSynthesisUtterance === 'function';
}

/** Current reader state: which id is playing and whether it is speaking or paused. */
export function getSpeechState() { return _state; }

/** Subscribe to phase changes. Returns an unsubscribe function. */
export function subscribeSpeech(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function setState(id, phase) {
  if (_state.id === id && _state.phase === phase) return;
  _state = { id, phase };
  for (const fn of listeners) fn(_state);
}

// ── Voices ────────────────────────────────────────────────────────────────────

function loadVoices() {
  _voices = isSpeechSupported() ? (speechSynthesis.getVoices() || []) : [];
}
if (isSpeechSupported()) {
  loadVoices();
  // Most browsers populate the voice list asynchronously, well after this module first loads.
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
  // Speech keeps playing after a SPA route change or a tab close — cut it off with the page.
  window.addEventListener('pagehide', () => stop());
}

/** The BCP-47 tag to speak in: the UI locale (that's the language the user reads the app in, and we
 *  have no per-message language signal), normalised to a full tag the voice list can match. */
export function readerLang() {
  const raw = (typeof document !== 'undefined' && document.documentElement.lang) || 'en';
  const base = String(raw).slice(0, 2).toLowerCase();
  if (raw.includes('-')) return raw;
  return base === 'fi' ? 'fi-FI' : base === 'sv' ? 'sv-SE' : base === 'en' ? 'en-US' : base;
}

/** Best available voice for a tag: exact match first, then any voice of the same language. */
function pickVoice(lang) {
  if (!_voices.length) loadVoices();
  const want = String(lang || '').toLowerCase().replace('_', '-');
  const base = want.slice(0, 2);
  return _voices.find(v => (v.lang || '').toLowerCase().replace('_', '-') === want)
    || _voices.find(v => (v.lang || '').toLowerCase().startsWith(base))
    || null;
}

// ── Markdown → speakable paragraphs ───────────────────────────────────────────

/** Turn a markdown message body into the paragraphs a listener should actually hear: code blocks,
 *  images, inline attachment references and bare URLs are dropped (reading a presigned URL aloud is
 *  unlistenable), link text is kept without its target, and the emphasis/heading/list punctuation is
 *  removed so it isn't spelled out. Returns [] when nothing speakable is left. */
export function textToParagraphs(markdown) {
  let s = String(markdown || '');
  s = s.replace(/```[\s\S]*?```/g, ' ');            // fenced code
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');      // images (incl. cid: inline attachments)
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');    // links → their text
  s = s.replace(/<[^>]+>/g, ' ');                   // stray html
  s = s.replace(/\bhttps?:\/\/\S+/gi, ' ');         // bare URLs
  // Line-prefix patterns match [ \t] and never \s — `\s` also matches the newline BEFORE the line, so
  // `^\s{0,3}[-*+]\s+` would eat the blank line separating a paragraph from the list that follows it.
  s = s.replace(/^[ \t]{0,3}\|.*\|[ \t]*$/gm, ' ');           // table rows
  s = s.replace(/^[ \t]{0,3}[-*_]{3,}[ \t]*$/gm, ' ');        // horizontal rules
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]*(.+)$/gm, '\n$1\n');  // headings → their own paragraph
  s = s.replace(/^[ \t]{0,3}>[ \t]?/gm, '');                  // blockquote markers
  // Each list item becomes its own paragraph (a pause per bullet); one blob would be read as one breath.
  s = s.replace(/^[ \t]{0,3}[-*+][ \t]+/gm, '\n');            // bullet markers
  s = s.replace(/^[ \t]{0,3}\d+[.)][ \t]+/gm, '\n');          // ordered-list markers
  s = s.replace(/[*_`~]/g, '');                     // emphasis / inline code
  return s.split(/\n[ \t]*\n+/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// ── Chunking ──────────────────────────────────────────────────────────────────

function sentences(t) {
  return t.match(/[^.!?]+[.!?]+(?:["'”’)\]]+)?|\S[^.!?]*$/g) || [t];
}

/** One over-long sentence → <=MAX_LEN pieces, split on clause punctuation first, then on words. */
function atomize(sentence) {
  const s = (sentence || '').trim();
  if (s.length <= MAX_LEN) return s ? [s] : [];
  const out = [];
  // Split on clause punctuation only, via a sentinel (older Safari has no regex lookbehind).
  const clauses = s.replace(/([,;:])\s+/g, '$1@@SP@@').split('@@SP@@');
  let buf = '';
  for (const raw of clauses) {
    const c = raw.trim();
    if (!c) continue;
    if (c.length > MAX_LEN) {
      if (buf) { out.push(buf); buf = ''; }
      let w = '';
      for (const word of c.split(/\s+/)) {
        if (w && (w.length + word.length + 1) > MAX_LEN) { out.push(w); w = word; }
        else w = w ? `${w} ${word}` : word;
      }
      if (w) out.push(w);
    } else if (buf && (buf.length + c.length + 1) > MAX_LEN) { out.push(buf); buf = c; }
    else buf = buf ? `${buf} ${c}` : c;
  }
  if (buf) out.push(buf);
  return out;
}

/** One paragraph → [{ text, gap }]: short sentences packed together, long ones sub-split. The gap is
 *  the silence AFTER the piece — long at the paragraph's end, short at a sentence end, tiny mid-sentence. */
export function packParagraph(paragraph) {
  const text = (paragraph || '').trim();
  if (!text) return [];
  /** @type {Array<{ text: string, sentEnd: boolean }>} */
  const pieces = [];
  let cur = '';
  const flush = () => { if (cur) { pieces.push({ text: cur, sentEnd: true }); cur = ''; } };
  for (const raw of sentences(text)) {
    const s = (raw || '').trim();
    if (!s) continue;
    if (s.length > MAX_LEN) {
      flush();
      const atoms = atomize(s);
      atoms.forEach((a, i) => { if (a) pieces.push({ text: a, sentEnd: i === atoms.length - 1 }); });
    } else if (cur && (cur.length + s.length + 1) > MAX_LEN) { pieces.push({ text: cur, sentEnd: true }); cur = s; }
    else cur = cur ? `${cur} ${s}` : s;
  }
  flush();
  return pieces.map((p, i) => ({
    text: p.text,
    gap: i === pieces.length - 1 ? GAP_PARA : (p.sentEnd ? GAP_SENT : GAP_CLAUSE),
  }));
}

/** Paragraphs → the flat utterance chain the transport plays. */
function buildChain(paragraphs) {
  const out = [];
  for (const p of paragraphs || []) out.push(...packParagraph(p));
  return out;
}

// ── Transport ─────────────────────────────────────────────────────────────────

function clearChain() {
  _chain.active = false;
  _chain.items = [];
  _chain.idx = 0;
  if (_chain.timer) { clearTimeout(_chain.timer); _chain.timer = null; }
}

function speakNext(lang, voice) {
  if (!_chain.active) return;
  if (_chain.idx >= _chain.items.length) { clearChain(); setState(null, 'idle'); return; }
  const item = _chain.items[_chain.idx++];
  const utt = new SpeechSynthesisUtterance(item.text);
  utt.lang = lang;
  if (voice) utt.voice = voice;
  // onerror is treated exactly like onend: one unspeakable piece must not strand the rest.
  const advance = () => { if (_chain.active) _chain.timer = setTimeout(() => speakNext(lang, voice), item.gap); };
  utt.onend = advance;
  utt.onerror = advance;
  speechSynthesis.speak(utt);
}

/**
 * Wake the speech engine inside a user gesture.
 *
 * iOS refuses `speechSynthesis.speak()` unless the page has spoken at least once from a real tap,
 * and it refuses SILENTLY: automatic read-aloud simply never makes a sound, with no error to find.
 * Speaking one empty utterance in the same click that starts the work removes that, costs nothing
 * audible, and is a no-op on every other platform.
 */
let _primed = false;
export function primeSpeech() {
  if (_primed || !isSpeechSupported()) return;
  _primed = true;
  try {
    const utt = new SpeechSynthesisUtterance('');
    utt.volume = 0;
    speechSynthesis.speak(utt);
  } catch (err) {
    // A browser refusing here IS the answer: it will refuse the real utterance too, and there is
    // nothing to recover. Said out loud so a silent reader has a trace to find.
    console.warn('[speech] the engine refused to prime:', err.message);
  }
}

/** Start reading `paragraphs` under `id`. Any reading already in progress is cancelled first — one
 *  reader at a time. Returns false when there is nothing speakable (or no speech support). */
export function speak(id, paragraphs, opts) {
  if (!isSpeechSupported()) return false;
  const items = buildChain(paragraphs);
  stop();
  if (!items.length) return false;
  const lang = (opts && opts.lang) || readerLang();
  const voice = pickVoice(lang);
  _chain.items = items; _chain.idx = 0; _chain.active = true;
  setState(id, 'speaking');
  speakNext(lang, voice);
  return true;
}

/** Stop the current reading and drop the queue. */
export function stop() {
  clearChain();
  if (isSpeechSupported()) speechSynthesis.cancel();
  setState(null, 'idle');
}

/** Pause the current reading (the queue is kept, resume() picks it back up). */
export function pause() {
  if (!isSpeechSupported() || _state.phase !== 'speaking') return;
  speechSynthesis.pause();
  setState(_state.id, 'paused');
}

/** Resume a paused reading. */
export function resume() {
  if (!isSpeechSupported() || _state.phase !== 'paused') return;
  speechSynthesis.resume();
  setState(_state.id, 'speaking');
}
