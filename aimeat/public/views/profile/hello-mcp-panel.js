/**
 * @file hello-mcp-panel.js
 * @description Hello MCP: the panel that removes the founder from onboarding. The MCP connection
 *   fails silently today, so this makes one observable sign of it, as early as possible.
 *
 *   Order is the design. Preconditions BEFORE anything is attempted (including the paid-tier
 *   requirement, stated plainly: a user on a free tier will fail and conclude the product is
 *   mediocre). Then the connection. Then, immediately and before anything else, the proof: one
 *   prompt the user runs in their own AI chat, one button that checks, one answer on screen with
 *   nothing to refresh and nothing to hunt for. When the key exists, Hello MCP is done.
 *
 *   Everything after the pass (create your organism, then the instruction block) is onboarding
 *   that CONTINUES; none of it gates the pass, and it only renders once the pass is in.
 * @structure HelloMcpPanel({ onPassed }) — Preconditions · Connect · Proof · Failure checklist ·
 *   AfterPass (organism prompt + per-organism instruction block)
 * @usage import { HelloMcpPanel } from '/views/profile/hello-mcp-panel.js';
 * @version-history
 *   v1.0.0 — 2026-07-31 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { ManagedEnvNote } from '/components/ManagedEnvNote.js';
import { checkHelloMcp, fetchHelloMcpPrompt, fetchOrganismSetupPrompt } from '/js/services/hello-mcp.js';
import { InstructionBlock } from '/views/profile/instruction-block.js';
import { getOrganismsTab } from '/js/services/organisms.js';
import { getNodeUrl } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/* ── Step 0: what this costs you before you spend any of it ── */
function Preconditions() {
  return html`
    <div class="hm-step">
      <div class="hm-step-head"><span class="hm-step-n">0</span>${tr('helloMcp.pre.title', 'Before you start')}</div>
      <ul class="hm-list">
        <li>${tr('helloMcp.pre.paid', 'A paid tier of your AI tool. Custom connectors are not on the free tiers, and an attempt on a free tier fails in a way that looks like our fault rather than a missing feature. This is the single most common reason onboarding does not work.')}</li>
        <li>${tr('helloMcp.pre.tools', 'An AI tool that supports MCP: Claude (app or web), Claude Code, Cursor, VS Code with Copilot, Codex CLI, Gemini CLI. The Gemini consumer app and Microsoft Copilot do not, and for those the copy-paste route is the one that works.')}</li>
        <li>${tr('helloMcp.pre.time', 'About five minutes, and the ability to paste one prompt into your chat.')}</li>
      </ul>
      <${ManagedEnvNote} compact=${true} />
    </div>`;
}

/* ── Step 1: the connection, in the order it actually has to happen ── */
function Connect() {
  const node = getNodeUrl();
  return html`
    <div class="hm-step">
      <div class="hm-step-head"><span class="hm-step-n">1</span>${tr('helloMcp.connect.title', 'Connect your AI to this node')}</div>
      <p class="hm-p">${tr('helloMcp.connect.lead', 'Everything else is done through this connection, so it goes first.')}</p>
      <ol class="hm-list hm-list--ol">
        <li>${tr('helloMcp.connect.s1', 'In your AI tool, open Settings and find Connectors (in Claude Code, run the one-line command on the connect page instead).')}</li>
        <li>${tr('helloMcp.connect.s2', 'Add a custom connector with this address:')} <code class="hm-code">${node}/v1/mcp</code></li>
        <li>${tr('helloMcp.connect.s3', 'Sign in to this node when the browser tab opens. You sign in as yourself; there is no shared key to paste.')}</li>
        <li>${tr('helloMcp.connect.s4', 'Start a NEW conversation. A chat that was already open does not pick up a connector added after it started, and that alone accounts for several failed attempts.')}</li>
      </ol>
      <a class="hm-link" href="/v1/connect" target="_blank" rel="noopener">${tr('helloMcp.connect.more', 'Per-tool instructions and the technical details →')}</a>
    </div>`;
}

/* ── Step 2: the proof. One prompt, one button, one answer. ── */
function Proof({ prompt, state, checking, onCheck }) {
  return html`
    <div class="hm-step hm-step--proof">
      <div class="hm-step-head"><span class="hm-step-n">2</span>${tr('helloMcp.proof.title', 'Prove the connection works')}</div>
      <p class="hm-p">${tr('helloMcp.proof.lead', 'Do this before anything else. A connection that looks fine and is not there fails quietly: the AI keeps answering, nothing errors, and what it says stops matching what is really stored. This prompt makes that visible in one step. Paste it into the chat you just opened.')}</p>
      <pre class="hm-prompt">${prompt || tr('helloMcp.proof.loading', 'Loading the prompt from this node…')}</pre>
      <div class="hm-actions">
        <${CopyButton} text=${prompt} className="btn-primary"
          label=${tr('helloMcp.proof.copy', 'Copy the prompt')}
          copiedLabel=${tr('helloMcp.proof.copied', 'Copied')} />
        <button class="btn-outline" onClick=${onCheck} disabled=${checking}>
          ${checking ? tr('helloMcp.proof.checking', 'Checking…') : tr('helloMcp.proof.check', 'I ran it, check now')}
        </button>
      </div>
      ${state === 'fail' ? html`<${FailureChecklist} />` : null}
    </div>`;
}

/* ── The failure path. The connection first, because it is the usual answer. ── */
function FailureChecklist() {
  return html`
    <div class="hm-fail">
      <div class="hm-fail-title">${tr('helloMcp.fail.title', 'Not there yet. Check these, in this order:')}</div>
      <ol class="hm-list hm-list--ol">
        <li>${tr('helloMcp.fail.s1', 'Is the connector actually connected? In your AI tool, open Settings and Connectors and look at this node. If it is missing or shows an error, nothing else on this list matters.')}</li>
        <li>${tr('helloMcp.fail.s2', 'Did you start a new conversation after adding it? An older chat does not have the tools.')}</li>
        <li>${tr('helloMcp.fail.s3', 'What did the AI actually say? If it described what it would do, or produced code, it does not have the tools and told you so indirectly. The prompt asks it to say that plainly; some models still hedge.')}</li>
        <li>${tr('helloMcp.fail.s4', 'Are you on a paid tier? Custom connectors are not available on the free tiers.')}</li>
        <li>${tr('helloMcp.fail.s5', 'Company-managed account? Your administrator may have to approve the connector before it works at all.')}</li>
      </ol>
      <p class="hm-p hm-p--dim">${tr('helloMcp.fail.retry', 'Fix one thing, run the prompt again, and press check again. Nothing is lost by repeating it.')}</p>
    </div>`;
}

/* ── Steps 4 and 5. After the pass, never blocking it. ── */
function AfterPass() {
  const [purpose, setPurpose] = useState('');
  const [prompt, setPrompt] = useState('');
  const [orgs, setOrgs] = useState(null);
  const [orgId, setOrgId] = useState('');

  useEffect(() => {
    fetchOrganismSetupPrompt(purpose).then(setPrompt)
      .catch(err => swallowed('hello-mcp-panel: organism prompt', err));
  }, [purpose]);

  // getOrganismsTab().mine, not listOrganisms({member:'me'}): the member filter returns nothing
  // for the owner's own organisms, and listOrganisms hands back the raw envelope rather than a
  // list. `mine` is the owner's set in one call, which is what this step is asking for.
  const loadOrgs = useCallback(() => {
    getOrganismsTab()
      .then(tab => {
        const arr = (tab && tab.mine) || [];
        setOrgs(arr);
        if (arr.length && !orgId) setOrgId(arr[0].id);
      })
      .catch(err => { swallowed('hello-mcp-panel: organisms', err); setOrgs([]); });
    // orgId intentionally read, not tracked: reloading must not fight the user's own selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  return html`
    <div class="hm-after">
      <div class="hm-step">
        <div class="hm-step-head"><span class="hm-step-n">4</span>${tr('helloMcp.org.title', 'Let your AI build your organism')}</div>
        <p class="hm-p">${tr('helloMcp.org.lead', 'An organism is where the work lives between conversations: notes, documents, tasks and decisions, in one place every one of your agents reads from. Your AI creates it over the connection you just proved, and you watch it appear here.')}</p>
        <label class="hm-label" for="hm-purpose">${tr('helloMcp.org.purposeLabel', 'What will you use it for? (optional: leave it empty and the AI asks you)')}</label>
        <input id="hm-purpose" class="input-field" value=${purpose} placeholder=${tr('helloMcp.org.purposePh', 'e.g. my consulting work, or a product I am building')}
          onInput=${(e) => setPurpose(e.target.value)} />
        <pre class="hm-prompt">${prompt}</pre>
        <div class="hm-actions">
          <${CopyButton} text=${prompt} className="btn-primary"
            label=${tr('helloMcp.org.copy', 'Copy the prompt')}
            copiedLabel=${tr('helloMcp.proof.copied', 'Copied')} />
          <button class="btn-ghost" onClick=${loadOrgs}>${tr('helloMcp.org.refresh', 'It is created, show it')}</button>
        </div>
      </div>

      <div class="hm-step">
        <div class="hm-step-head"><span class="hm-step-n">5</span>${tr('helloMcp.block.title', 'Teach your AI where things are, once')}</div>
        <p class="hm-p">${tr('helloMcp.block.lead', 'Paste this block into your AI’s instructions and every conversation starts already knowing your structure. You stop re-explaining it, the AI stops guessing where things go, your agents write into the same places so they can build on each other’s work, and the same context stops being re-sent as tokens in every chat.')}</p>
        ${orgs === null ? html`<p class="hm-p hm-p--dim">${tr('helloMcp.block.loading', 'Reading your organisms…')}</p>`
          : orgs.length === 0 ? html`<p class="hm-p hm-p--dim">${tr('helloMcp.block.none', 'No organism yet. Run the prompt above first, then press "It is created, show it".')}</p>`
          : html`
            ${orgs.length > 1 ? html`
              <select class="input-field hm-select" value=${orgId} onChange=${(e) => setOrgId(e.target.value)}>
                ${orgs.map(o => html`<option value=${o.id} key=${o.id}>${o.name || o.id}</option>`)}
              </select>` : null}
            <${InstructionBlock} orgId=${orgId} />`}
      </div>
    </div>`;
}

/**
 * @param {{ onPassed?: (passed: boolean) => void }} props onPassed fires on every resolved check
 *   so the surrounding page (profile card badge, next-steps list) can react without its own call.
 */
export function HelloMcpPanel({ onPassed }) {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState(null);      // null = not checked yet
  const [state, setState] = useState('idle');      // idle | fail | pass
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    fetchHelloMcpPrompt().then(setPrompt).catch(err => swallowed('hello-mcp-panel: prompt', err));
  }, []);

  // The initial read decides which half of the panel renders. A user who already passed must
  // never be shown the proof step again.
  useEffect(() => {
    checkHelloMcp()
      .then(r => { setResult(r); setState(r.passed ? 'pass' : 'idle'); onPassed?.(r.passed); })
      .catch(err => swallowed('hello-mcp-panel: initial check', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCheck = useCallback(async () => {
    setChecking(true);
    try {
      const r = await checkHelloMcp();
      setResult(r);
      setState(r.passed ? 'pass' : 'fail');
      onPassed?.(r.passed);
    } catch (err) {
      swallowed('hello-mcp-panel: check', err);
      setState('fail');
    } finally {
      setChecking(false);
    }
  }, [onPassed]);

  if (state === 'pass') {
    return html`
      <div class="hm">
        <div class="hm-passed">
          <span class="hm-passed-dot"></span>
          <div>
            <div class="hm-passed-title">${tr('helloMcp.passed.title', 'MCP connected, and proven')}</div>
            <div class="hm-passed-sub">
              ${tr('helloMcp.passed.sub', 'Your AI wrote through the connection.')}
              ${result?.tool ? ` ${result.tool}.` : ''}
              ${result?.at ? ` ${new Date(result.at).toLocaleString()}` : ''}
            </div>
          </div>
        </div>
        <${AfterPass} />
      </div>`;
  }

  return html`
    <div class="hm">
      <div class="hm-intro">
        <div class="hm-intro-title">${tr('helloMcp.title', 'Hello MCP')}</div>
        <p class="hm-p">${tr('helloMcp.intro', 'Connect your AI to this node and prove it works. Three steps, and the third one is a button. Until it passes, everything else here is guesswork.')}</p>
      </div>
      <${Preconditions} />
      <${Connect} />
      <${Proof} prompt=${prompt} state=${state} checking=${checking} onCheck=${onCheck} />
    </div>`;
}

export default HelloMcpPanel;
