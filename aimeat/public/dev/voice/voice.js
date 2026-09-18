/**
 * @file voice.js
 * @description Interactive voice SDK harness. Local mode is explicit and never sends microphone audio.
 * @structure Controls, configurable real node stages, local delayed text/PCM adapters, event log.
 * @usage Open /dev/voice/index.html on a local sandbox.
 * @version-history v1.0.0 - 2026-09-19 - Browser verification and configuration example.
 */
const el = id => document.getElementById(id);
const sdk = window.AIMEAT;
let session = null;
const log = [];
const wait = (ms, signal) => new Promise((resolve, reject) => {
  signal.throwIfAborted();
  const stop = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(undefined); }, ms);
  signal.addEventListener('abort', stop, { once: true });
});
const localAdapters = {
  async transcribe(blob, { signal }) { await wait(100, signal); return `Local microphone test: ${blob.size} audio bytes captured.`; },
  async *complete(messages, { signal }) {
    for (const sentence of ['Ensimmäinen lause valmistuu heti. ', 'Seuraava lause syntyy samalla kun ääni soi. ', 'Voit keskeyttää vastauksen.']) {
      await wait(300, signal); yield sentence;
    }
  },
  async *speak(text, { signal, config }) {
    for (let block = 0; block < 12; block++) {
      await wait(20, signal);
      const frames = Math.floor(config.tts.sampleRate / 20); const bytes = new Uint8Array(frames * 2 * config.tts.channels); const view = new DataView(bytes.buffer);
      for (let i = 0; i < frames; i++) for (let ch = 0; ch < config.tts.channels; ch++) {
        view.setInt16((i * config.tts.channels + ch) * 2, Math.sin((block * frames + i) * 2 * Math.PI * (220 + text.length) / config.tts.sampleRate) * 1200, true);
      }
      yield bytes;
    }
  },
};
function record(event) { log.push(event); if (log.length > 80) log.shift(); el('events').textContent = log.map(e => JSON.stringify(e)).join('\n'); }
function announce(options) {
  const usesNode = ['stt', 'llm', 'tts'].some(stage => options[stage].provider === 'node');
  el('notice').textContent = usesNode
    ? 'You are talking to AI. Node stages send their inputs to your configured provider and use your AI budget.'
    : 'Local test mode produces tones, not synthesized speech. Microphone audio stays in this browser.';
}
function settings() {
  const local = /** @type {HTMLSelectElement} */ (el('backend')).value === 'local';
  const options = sdk.voice.configure({ appId: 'voice-lab', preset: /** @type {HTMLSelectElement} */ (el('preset')).value,
    input: { mode: /** @type {HTMLSelectElement} */ (el('mode')).value },
    stt: { provider: local ? 'custom' : 'node' }, llm: { provider: local ? 'custom' : 'node' },
    tts: { provider: local ? 'custom' : 'node', model: '', format: 'pcm' } });
  /** @type {HTMLTextAreaElement} */ (el('config')).value = JSON.stringify(options, null, 2);
  announce(options);
}
function controls(active) {
  for (const id of ['send', 'interrupt', 'stop']) /** @type {HTMLButtonElement} */ (el(id)).disabled = !active;
  for (const id of ['record', 'commit']) /** @type {HTMLButtonElement} */ (el(id)).disabled = !active || session?.config.input.mode !== 'manual';
  /** @type {HTMLButtonElement} */ (el('start')).disabled = active;
  for (const id of ['backend', 'preset', 'mode', 'config']) /** @type {HTMLInputElement} */ (el(id)).disabled = active;
}
function fail(error) { if (error.name !== 'AbortError') { el('error').textContent = error.message; record({ type: 'error', message: error.message }); } }
el('start').onclick = async () => {
  el('error').textContent = '';
  try {
    if (session) await session.close();
    session = sdk.voice.createSession(JSON.parse(/** @type {HTMLTextAreaElement} */ (el('config')).value), localAdapters);
    announce(session.config);
    session.on('state', event => { el('state').textContent = event.state; record(event); });
    session.on('transcript', event => {
      let row = document.getElementById('turn-' + event.turn + '-' + event.role);
      if (!row) { row = document.createElement('p'); row.id = 'turn-' + event.turn + '-' + event.role; el('transcript').appendChild(row); }
      row.textContent = event.role + ': ' + event.text;
    });
    session.on('level', event => { /** @type {HTMLMeterElement} */ (el('level')).value = event.value; });
    for (const name of ['segment', 'timing', 'interrupted', 'usage']) session.on(name, record);
    session.on('error', event => fail(event.error));
    await session.start(); controls(true);
  } catch (error) { fail(error); controls(false); }
};
el('send').onclick = () => { void session.sendText(/** @type {HTMLTextAreaElement} */ (el('prompt')).value).catch(fail); };
el('record').onclick = () => session.begin();
el('commit').onclick = () => session.commit();
el('interrupt').onclick = () => session.interrupt();
el('stop').onclick = async () => { await session.stop(); controls(false); };
for (const id of ['backend', 'preset', 'mode']) el(id).onchange = settings;
window.addEventListener('pagehide', () => { void session?.close(); });
sdk.auth.mountLoginButton(el('login'));
settings();
// Read-only inspection seam for direct Playwright MCP verification.
Object.defineProperty(window, '__voiceLab', { value: { get session() { return session; }, get events() { return log.slice(); } } });
