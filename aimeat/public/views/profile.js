import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo, copyToClipboard } from '/js/utils.js';
import { useViewCSS } from '/components/useViewCSS.js';

/* ── Auth helpers ── */
function getSession() {
  const a = window.AIMEAT?.auth;
  if (!a || typeof a.getSession !== 'function') return null;
  const s = a.getSession();
  if (!s || !s.jwt) return null;
  return s;
}

const NODE_URL = typeof window !== 'undefined' ? window.location.origin : '';

async function apiFetch(path) {
  const s = getSession();
  if (!s?.fetch) return null;
  const resp = await s.fetch(path);
  return resp.json ? await resp.json() : resp;
}

async function publicFetch(path) {
  const resp = await fetch(NODE_URL + path);
  return await resp.json();
}

/* ── Agent prompt builder ── */
function buildAgentPrompt(sess) {
  const ghii = sess.ghii || (sess.owner + '@unknown');
  const url = NODE_URL;
  return `I want you to register a new automation agent on my AIMEAT node.

IMPORTANT: I already have an account. Do NOT create a new owner. Use my existing identity.

My GHII: ${ghii}
My owner name (for API calls): ${sess.owner}
Node URL: ${url}

Steps:
1. First, authenticate as my owner:
   POST ${url}/v1/auth/token
   You need my owner private key to sign (ownerName + nodeId + timestamp) with Ed25519.
   My owner key is stored in my browser (I will provide it if needed).

2. Register a new agent under my account:
   POST ${url}/v1/agents
   Header: Authorization: Bearer <owner_jwt>
   Body: {"name": "<choose-a-name>", "owner": "${sess.owner}", "display_name": "<Your Agent Name>", "description": "<What this agent does>"}
   The new agent will get a GAII in the format: <name>#${ghii}
   SAVE the private_key from the response!

3. Authenticate as the new agent:
   Sign (gaii + timestamp) with the agent's Ed25519 private key
   POST ${url}/v1/auth/token with {"gaii": "<agent-gaii>", "timestamp": "<iso>", "signature": "<sig>"}

4. You're connected! Use the JWT to access:
   GET ${url}/v1/catalogue \u2014 Browse services
   POST ${url}/v1/memory \u2014 Store/retrieve memories
   GET ${url}/v1/wallet \u2014 Check balance
   Full API spec: ${url}/v1/spec
   Operating instructions: ${url}/v1/prompts/tier1`;
}

/* ── Platform instructions data ── */
const PLATFORMS = {
  windows: `<h4>OpenClaw (Recommended)</h4>
<p><a href="https://openclaw.ai" target="_blank">OpenClaw</a> is an open-source AI automation agent \u2014 perfect for AIMEAT.</p>
<p>Windows requires WSL2. Open PowerShell as Admin:</p>
<ol><li>Install WSL2: <code>wsl --install</code> (restart if prompted)</li>
<li>In WSL2 terminal, install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>`,
  mac: `<h4>OpenClaw (Recommended)</h4>
<p><a href="https://openclaw.ai" target="_blank">OpenClaw</a> is an open-source AI automation agent \u2014 perfect for AIMEAT.</p>
<ol><li>Install Node.js 22+: <code>brew install node</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>
<h4>Alternative: one-liner install</h4>
<pre><code>curl -fsSL https://openclaw.ai/install.sh | bash</code></pre>`,
  linux: `<h4>OpenClaw (Recommended)</h4>
<p><a href="https://openclaw.ai" target="_blank">OpenClaw</a> is an open-source AI automation agent \u2014 perfect for AIMEAT.</p>
<ol><li>Install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>
<h4>Alternative: one-liner install</h4>
<pre><code>curl -fsSL https://openclaw.ai/install.sh | bash</code></pre>`,
  wsl2: `<h4>Setup WSL2 (if not already)</h4>
<ol><li>Open PowerShell as Admin: <code>wsl --install</code></li>
<li>Restart and set up your Linux username/password</li></ol>
<h4>Install OpenClaw</h4>
<ol><li>In WSL2 terminal, install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>`,
  android: `<h4>Option A: Termux (CLI only)</h4>
<ol><li>Install <a href="https://f-droid.org/packages/com.termux/" target="_blank">Termux from F-Droid</a> (not Play Store)</li>
<li>Run: <code>pkg update && pkg install nodejs</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>
<h4>Option B: andClaw (on-device with camera/mic)</h4>
<p><a href="https://play.google.com/store/apps/details?id=com.coderred.andclaw" target="_blank">andClaw</a> runs the OpenClaw gateway directly on your phone \u2014 no server needed.</p>
<p><strong>\u26A0\uFE0F Heads up:</strong> This means an AI agent can see through your camera and hear your mic. Only use this if you understand the privacy implications and trust your LLM provider.</p>`,
  aws: `<h4>Quick EC2 Setup</h4>
<ol><li>Launch an EC2 instance (Amazon Linux 2023 or Ubuntu, t3.micro is fine)</li>
<li>SSH in: <code>ssh -i key.pem ec2-user@your-ip</code></li>
<li>Install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo yum install -y nodejs</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>
<h4>For a persistent agent</h4>
<ol><li>Use <code>tmux</code> or <code>screen</code> to keep the session alive</li>
<li>Or set up a systemd service for always-on operation</li></ol>`,
};
const PLATFORM_KEYS = ['windows','mac','linux','wsl2','android','aws'];
const PLATFORM_LABELS = { windows:'profile.platforms.windows', mac:'profile.platforms.mac', linux:'profile.platforms.linux', wsl2:'profile.platforms.wsl2', android:'profile.platforms.android', aws:'profile.platforms.aws' };
const SERVICE_CATEGORIES = ['language','translation','analysis','generation','coding','data','image','audio','video','search','utility','other'];
const TABS = [
  { id:'agents', key:'profile.tabs.agents' },
  { id:'chatsessions', key:'profile.tabs.chatSessions' },
  { id:'wallet', key:'profile.tabs.wallet' },
  { id:'memory', key:'profile.tabs.memory' },
  { id:'work', key:'profile.tabs.work' },
  { id:'actions', key:'profile.tabs.services' },
  { id:'boards', key:'profile.tabs.boards' },
  { id:'apps', key:'profile.tabs.apps' },
  { id:'federation', key:'profile.tabs.federation' },
  { id:'nodes', key:'profile.tabs.nodes' },
  { id:'access', key:'profile.tabs.access' },
  { id:'dataWallet', key:'profile.tabs.dataWallet' },
];

/* ── Loading indicator ── */
function Spinner({ text }) {
  return html`<span class="spinner"></span><span class="loading-text">${text || t('profile.loading')}</span>`;
}

/* ── Main component ── */
export default function Profile({ navigate, locale }) {
  const [session, setSession] = useState(null);
  const [activeTab, setActiveTab] = useState('agents');
  const [stats, setStats] = useState({ agents:'-', chatSessions:'-', balance:'-', memory:'-', services:'-', work:'-', apps:'-', files:'-', nodes:'-' });

  // Tab data
  const [agents, setAgents] = useState(null);
  const [chatSessions, setChatSessions] = useState(null);
  const [walletData, setWalletData] = useState(null);
  const [walletTx, setWalletTx] = useState(null);
  const [memories, setMemories] = useState(null);
  const [files, setFiles] = useState(null);
  const [workInbox, setWorkInbox] = useState(null);
  const [workSent, setWorkSent] = useState(null);
  const [myServices, setMyServices] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  const [myBoards, setMyBoards] = useState(null);
  const [allBoards, setAllBoards] = useState(null);
  const [boardView, setBoardView] = useState(null); // {id, name, posts}
  const [myApps, setMyApps] = useState(null);
  const [allApps, setAllApps] = useState(null);
  const [federation, setFederation] = useState(null);
  const [nodes, setNodes] = useState(null);
  const [consents, setConsents] = useState(null);
  const [auditEntries, setAuditEntries] = useState(null);
  const [auditDays, setAuditDays] = useState(30);

  // UI state
  const [toast, setToast] = useState(null);
  const [showMemForm, setShowMemForm] = useState(false);
  const [showFileForm, setShowFileForm] = useState(false);
  const [showPubForm, setShowPubForm] = useState(false);
  const [showBrdForm, setShowBrdForm] = useState(false);
  const [showNodeForm, setShowNodeForm] = useState(false);
  const [showAppUpload, setShowAppUpload] = useState(false);
  const [expandedMem, setExpandedMem] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [rateModal, setRateModal] = useState(null);
  const [platExpand, setPlatExpand] = useState(false);
  const [activePlat, setActivePlat] = useState('windows');
  const [memSubTab, setMemSubTab] = useState('entries');
  const [workSubTab, setWorkSubTab] = useState('inbox');
  const [svcSubTab, setSvcSubTab] = useState('mine');
  const [brdSubTab, setBrdSubTab] = useState('mine');
  const [catFilter, setCatFilter] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [expandedSetups, setExpandedSetups] = useState(new Set());
  const loadedRef = useRef(new Set());
  const toastTimer = useRef(null);

  // Toast helper
  const showToast = useCallback((msg, isError) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, isError });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // Auth listener
  useEffect(() => {
    const s = getSession();
    if (s) { setSession(s); }
    const handler = () => {
      const ns = getSession();
      setSession(ns);
      if (!ns) {
        loadedRef.current = new Set();
        setActiveTab('agents');
      }
    };
    window.addEventListener('aimeat-auth-change', handler);
    return () => window.removeEventListener('aimeat-auth-change', handler);
  }, []);

  // Load all data when session becomes available
  useEffect(() => {
    if (!session) return;
    loadedRef.current = new Set();
    loadAll();
  }, [session]);

  async function loadAll() {
    if (!session) return;
    const results = await Promise.allSettled([
      loadAgentsData(), loadChatSessionsData(), loadWalletData(),
      loadMemoryData(), loadFilesData(), loadWorkData(),
      loadMyServicesData(), loadAppsData(), loadFederationData(),
      loadNodesData(), loadConsentsData(), loadAuditData(30),
    ]);
    loadedRef.current = new Set(TABS.map(t => t.id));
  }

  // ── Data loaders ──
  async function loadAgentsData() {
    try {
      const data = await apiFetch('/v1/agents');
      const list = data?.data?.agents || data?.data || [];
      const own = list.filter(a => a.owner === session.owner);
      setAgents(own);
      setStats(s => ({ ...s, agents: own.length }));
    } catch { setAgents([]); }
  }

  async function loadChatSessionsData() {
    try {
      const data = await apiFetch('/v1/agents');
      const list = data?.data?.agents || data?.data || [];
      const sessions = list.filter(a => a.owner === session.owner && a.name?.startsWith('session-'));
      setChatSessions(sessions);
      setStats(s => ({ ...s, chatSessions: sessions.length }));
    } catch { setChatSessions([]); }
  }

  async function loadWalletData() {
    try {
      const data = await apiFetch('/v1/wallet');
      const w = data?.data || data || {};
      setWalletData(w);
      setStats(s => ({ ...s, balance: w.balance ?? '-' }));
      // Load transactions
      try {
        const txData = await apiFetch('/v1/wallet/transactions?limit=20');
        setWalletTx(txData?.data?.transactions || txData?.data || []);
      } catch { setWalletTx([]); }
    } catch { setWalletData(null); }
  }

  async function loadMemoryData() {
    try {
      const data = await apiFetch('/v1/memory');
      const list = data?.data?.entries || data?.data || [];
      setMemories(Array.isArray(list) ? list : []);
      setStats(s => ({ ...s, memory: Array.isArray(list) ? list.length : 0 }));
    } catch { setMemories([]); }
  }

  async function loadFilesData() {
    try {
      const data = await apiFetch('/v1/memory/files');
      const list = data?.data?.files || data?.data || [];
      setFiles(Array.isArray(list) ? list : []);
      setStats(s => ({ ...s, files: Array.isArray(list) ? list.length : 0 }));
    } catch { setFiles([]); }
  }

  async function loadWorkData() {
    try {
      const data = await apiFetch('/v1/work/inbox');
      const list = data?.data?.items || data?.data || [];
      setWorkInbox(Array.isArray(list) ? list : []);
      setStats(s => ({ ...s, work: Array.isArray(list) ? list.length : 0 }));
    } catch { setWorkInbox([]); }
    try {
      const data = await apiFetch('/v1/work/sent');
      setWorkSent(data?.data?.items || data?.data || []);
    } catch { setWorkSent([]); }
  }

  async function loadMyServicesData() {
    try {
      const data = await apiFetch('/v1/catalogue?owner=' + encodeURIComponent(session.owner));
      const list = data?.data?.actions || data?.data || [];
      setMyServices(Array.isArray(list) ? list : []);
      setStats(s => ({ ...s, services: Array.isArray(list) ? list.length : 0 }));
    } catch { setMyServices([]); }
  }

  async function loadCatalogueData(cat) {
    try {
      const q = cat ? '?category=' + encodeURIComponent(cat) : '';
      const data = await publicFetch('/v1/catalogue' + q);
      setCatalogue(data?.data?.actions || data?.data || []);
    } catch { setCatalogue([]); }
  }

  async function loadAppsData() {
    try {
      const data = await publicFetch('/v1/apps');
      const list = data?.data?.apps || [];
      const own = list.filter(a => a.owner === session.owner);
      setMyApps(own);
      setAllApps(list);
      setStats(s => ({ ...s, apps: own.length }));
    } catch { setMyApps([]); setAllApps([]); }
  }

  async function loadFederationData() {
    try {
      const data = await publicFetch('/v1/federation/directory');
      setFederation(data?.data?.peers || []);
    } catch { setFederation([]); }
  }

  async function loadNodesData() {
    try {
      const data = await apiFetch('/v1/personal/status');
      const list = [];
      if (data?.data?.node_id) list.push(data.data);
      setNodes(list);
      setStats(s => ({ ...s, nodes: list.length }));
    } catch {
      setNodes([]);
      setStats(s => ({ ...s, nodes: 0 }));
    }
  }

  async function loadConsentsData() {
    try {
      const data = await apiFetch('/v1/consent');
      setConsents(data?.data?.consents || (Array.isArray(data?.data) ? data.data : []));
    } catch { setConsents([]); }
  }

  async function loadAuditData(days) {
    try {
      const data = await apiFetch('/v1/consent/audit?days=' + days);
      setAuditEntries(data?.data?.entries || (Array.isArray(data?.data) ? data.data : []));
    } catch { setAuditEntries([]); }
  }

  // ── CRUD actions ──
  async function createMemory(key, value, visibility, tags) {
    const s = getSession();
    if (!s?.fetch) return;
    const body = { key, value, visibility: visibility || 'private' };
    if (tags) body.tags = tags.split(',').map(t => t.trim()).filter(Boolean);
    const resp = await s.fetch('/v1/memory', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.ok !== false) { showToast(t('profile.memory.saved')); setShowMemForm(false); loadMemoryData(); }
    else showToast(t('profile.memory.saveFailed'), true);
  }

  async function deleteMemory(key) {
    if (!confirm(t('profile.memory.deleteConfirm') + ': ' + key + '?')) return;
    const s = getSession();
    await s.fetch('/v1/memory/' + encodeURIComponent(key), { method: 'DELETE' });
    showToast(t('profile.memory.deleted'));
    setExpandedMem(null);
    loadMemoryData();
  }

  async function saveMemoryEdit(key, value) {
    const s = getSession();
    await s.fetch('/v1/memory/' + encodeURIComponent(key), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    showToast(t('profile.memory.updated'));
    setEditModal(null);
    loadMemoryData();
  }

  async function searchMemory(query) {
    if (!query) { loadMemoryData(); return; }
    try {
      const data = await apiFetch('/v1/memory/search?q=' + encodeURIComponent(query));
      const list = data?.data?.results || data?.data || [];
      setMemories(Array.isArray(list) ? list : []);
    } catch { showToast(t('profile.memory.searchFailed'), true); }
  }

  async function uploadFile(key, file, visibility) {
    const s = getSession();
    if (!s?.fetch || !file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];
      const resp = await s.fetch('/v1/memory/files', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key || file.name, content: base64, mime_type: file.type || 'application/octet-stream', visibility: visibility || 'private' }),
      });
      if (resp.ok !== false) { showToast(t('profile.files.uploaded')); setShowFileForm(false); loadFilesData(); }
      else showToast(t('profile.files.uploadFailed'), true);
    };
    reader.readAsDataURL(file);
  }

  async function deleteFile(key) {
    if (!confirm(t('profile.files.deleteConfirm'))) return;
    const s = getSession();
    await s.fetch('/v1/memory/files/' + encodeURIComponent(key), { method: 'DELETE' });
    showToast(t('profile.files.deleted'));
    loadFilesData();
  }

  async function publishService(name, desc, category, price, unit, webhook) {
    const s = getSession();
    const body = { display_name: name, description: desc, category, price_morsels: Number(price) || 0, unit: unit || 'call' };
    if (webhook) body.webhook_url = webhook;
    const resp = await s.fetch('/v1/catalogue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.ok !== false) { showToast(t('profile.services.published')); setShowPubForm(false); loadMyServicesData(); }
    else showToast(t('profile.error'), true);
  }

  async function unpublishService(id) {
    if (!confirm(t('profile.services.unpublishConfirm'))) return;
    const s = getSession();
    await s.fetch('/v1/catalogue/' + encodeURIComponent(id), { method: 'DELETE' });
    showToast(t('profile.services.unpublished'));
    loadMyServicesData();
  }

  async function createBoard(name, desc, vis) {
    const s = getSession();
    const resp = await s.fetch('/v1/boards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: desc, visibility: vis || 'private' }),
    });
    if (resp.ok !== false) { showToast(t('profile.boards.created')); setShowBrdForm(false); loadMyBoardsData(); }
    else showToast(t('profile.boards.createFailed'), true);
  }

  async function loadMyBoardsData() {
    try {
      const data = await apiFetch('/v1/boards/subscriptions');
      setMyBoards(data?.data?.boards || data?.data || []);
    } catch { setMyBoards([]); }
  }

  async function loadAllBoardsData() {
    try {
      const data = await publicFetch('/v1/boards');
      setAllBoards(data?.data?.boards || data?.data || []);
    } catch { setAllBoards([]); }
  }

  async function subscribeBoard(boardId) {
    const s = getSession();
    try {
      await s.fetch('/v1/boards/' + encodeURIComponent(boardId) + '/subscribe', { method: 'POST' });
      showToast(t('profile.boards.subscribed'));
    } catch { showToast(t('profile.boards.subscribeFailed'), true); }
  }

  async function viewBoardPosts(boardId, boardName) {
    try {
      const data = await apiFetch('/v1/boards/' + encodeURIComponent(boardId) + '/posts');
      setBoardView({ id: boardId, name: boardName, posts: data?.data?.posts || data?.data || [] });
    } catch { setBoardView({ id: boardId, name: boardName, posts: [] }); }
  }

  async function createPost(boardId, content) {
    if (!content?.trim()) { showToast(t('profile.boards.writeFirst'), true); return; }
    const s = getSession();
    await s.fetch('/v1/boards/' + encodeURIComponent(boardId) + '/posts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    showToast(t('profile.boards.posted'));
    viewBoardPosts(boardId, boardView?.name);
  }

  async function reactToPost(boardId, postId, emoji) {
    const s = getSession();
    await s.fetch('/v1/boards/' + encodeURIComponent(boardId) + '/posts/' + encodeURIComponent(postId) + '/react', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    });
    viewBoardPosts(boardId, boardView?.name);
  }

  async function uploadApp(file, screenshot, accessCode) {
    const s = getSession();
    if (!file) { showToast(t('profile.apps.selectFile'), true); return; }
    const readFile = (f) => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(f); });
    const body = { filename: file.name, content: await readFile(file), mime_type: file.type || 'text/html' };
    if (accessCode) body.access_code = accessCode;
    if (screenshot) { body.screenshot = await readFile(screenshot); body.screenshot_mime_type = screenshot.type || 'image/png'; }
    const resp = await s.fetch('/v1/apps', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.ok !== false) { showToast(t('profile.apps.uploaded')); setShowAppUpload(false); loadAppsData(); }
    else showToast(t('profile.apps.uploadFailed'), true);
  }

  async function registerNode(nodeId, visibility, gaiis) {
    const s = getSession();
    let nid = nodeId.trim();
    if (!nid) { showToast(t('profile.nodes.registerFailed'), true); return; }
    if (!nid.startsWith('personal-')) nid = 'personal-' + nid;
    const agentGaiis = gaiis ? gaiis.split(',').map(s => s.trim()).filter(Boolean) : [];
    const resp = await s.fetch('/v1/personal/anchor', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: nid, owner_name: s.owner, public_key: s.publicKey || 'placeholder', agent_gaiis: agentGaiis, visibility: visibility || 'private' }),
    });
    if (resp.ok !== false) { showToast(t('profile.nodes.registered')); setShowNodeForm(false); loadNodesData(); }
    else showToast(t('profile.nodes.registerFailed'), true);
  }

  async function detachNode(nodeId) {
    if (!confirm(t('profile.nodes.detachConfirm'))) return;
    const s = getSession();
    await s.fetch('/v1/personal/anchor/' + encodeURIComponent(nodeId), { method: 'DELETE' });
    showToast(t('profile.nodes.detachedToast'));
    loadNodesData();
  }

  async function setNodeVis(nodeId, vis) {
    const s = getSession();
    await s.fetch('/v1/personal/anchor/' + encodeURIComponent(nodeId), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: vis }),
    });
    showToast(t('profile.nodes.visUpdated'));
    loadNodesData();
  }

  async function revokeConsent(consentId) {
    const s = getSession();
    await s.fetch('/v1/consent/' + encodeURIComponent(consentId), { method: 'DELETE' });
    showToast(t('wallet.consents.revoked'));
    loadConsentsData();
  }

  async function exportGdpr() {
    try {
      const data = await apiFetch('/v1/owners/' + encodeURIComponent(session.owner) + '/export');
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'aimeat-export-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { showToast(t('profile.error'), true); }
  }

  async function submitRating(workId, rating, comment) {
    if (!rating) { showToast(t('profile.work.selectRating'), true); return; }
    const s = getSession();
    await s.fetch('/v1/work/' + encodeURIComponent(workId) + '/rate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating, comment }),
    });
    showToast(t('profile.work.ratingSubmitted'));
    setRateModal(null);
    loadWorkData();
  }

  useViewCSS('/css/views/profile.css');

  // URL tab param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && TABS.some(t => t.id === tab)) setActiveTab(tab);
  }, []);

  // ── Not logged in ──
  if (!session) {
    return html`
      <div class="bg-aurora" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none">
        <div class="aurora-wave"></div><div class="aurora-wave"></div><div class="aurora-wave"></div>
      </div>
      <div class="pf">
        <div class="login-prompt">
          <h1>\u{1F496} ${t('profile.signInTitle')}</h1>
          <p>${t('profile.signInDesc')}</p>
        </div>
      </div>`;
  }

  // ── Tab switch handler ──
  function switchTab(tabId) {
    setActiveTab(tabId);
    // Lazy load sub-data on first visit
    if (tabId === 'actions' && svcSubTab === 'catalogue' && !catalogue) loadCatalogueData(catFilter);
    if (tabId === 'boards' && brdSubTab === 'mine' && !myBoards) loadMyBoardsData();
    if (tabId === 'boards' && brdSubTab === 'browse' && !allBoards) loadAllBoardsData();
  }

  // ── Render helpers ──
  const renderAgents = () => {
    if (!agents) return html`<${Spinner} text=${t('profile.agents.loadingAgents')} />`;
    return html`
      <div class="section-title">${t('profile.agents.title')}</div>
      <div class="section-desc">${t('profile.agents.desc')}</div>

      <!-- Agent CTA -->
      <div class="agent-cta">
        <h3>${t('profile.agents.connect')}</h3>
        <p>${t('profile.agents.connectDesc')}</p>
        <div class="agent-prompt-box">${buildAgentPrompt(session)}</div>
        <button class="copy-prompt-btn" onClick=${() => {
          copyToClipboard(buildAgentPrompt(session)).then(() => {
            setPromptCopied(true);
            setTimeout(() => setPromptCopied(false), 2000);
          });
        }}>${promptCopied ? '\u2705 ' + t('profile.agents.copied') : t('profile.agents.copyPrompt')}</button>

        <div style="margin-top:1.25rem;border-top:1px solid var(--border);padding-top:1.25rem">
          <p style="margin-bottom:.75rem">${t('profile.agents.noAgent')}</p>
          <button class="expand-btn" onClick=${() => setPlatExpand(!platExpand)}>
            <span>${t('profile.agents.seeHow')}</span>
            <span style="transition:transform .2s;${platExpand ? 'transform:rotate(180deg)' : ''}">\u25BC</span>
          </button>
          ${platExpand && html`
            <div class="platform-instructions expanded">
              <div class="platform-tabs">
                ${PLATFORM_KEYS.map(k => html`
                  <button class="platform-tab ${k === activePlat ? 'active' : ''}" onClick=${() => setActivePlat(k)}>${t(PLATFORM_LABELS[k])}</button>
                `)}
              </div>
              <div class="platform-content" dangerouslySetInnerHTML=${{ __html: PLATFORMS[activePlat] }}></div>
            </div>
          `}
        </div>
      </div>

      ${agents.length === 0
        ? html`<div class="empty">${t('profile.agents.empty')}</div>`
        : agents.map(a => html`
          <div class="card agent-card">
            <div class="card-header">
              <div class="card-title">${escHtml(a.display_name || a.name)}</div>
              <span class="badge badge-info">${escHtml(a.name)}</span>
            </div>
            <div class="gaii">${escHtml(a.gaii || '')}</div>
            <div class="card-subtitle">
              ${t('profile.agents.trust')}: ${a.trust_score ?? '-'} \u2502
              ${t('profile.agents.balance')}: ${a.balance ?? '-'} \u2502
              ${t('profile.agents.lastSeen')}: ${a.last_seen ? timeAgo(a.last_seen) : '-'}
            </div>
            ${a.capabilities?.length > 0 && html`
              <div class="caps">${a.capabilities.map(c => html`<span class="cap">${escHtml(c)}</span>`)}</div>
            `}
          </div>
        `)
      }`;
  };

  const renderChatSessions = () => {
    if (!chatSessions) return html`<${Spinner} text=${t('profile.chatSessions.loading')} />`;
    return html`
      <div class="section-title">${t('profile.chatSessions.title')}</div>
      <div class="section-desc">${t('profile.chatSessions.desc')}</div>
      ${chatSessions.length === 0
        ? html`<div class="empty">${t('profile.chatSessions.empty')}</div>`
        : chatSessions.map(s => html`
          <div class="card">
            <div class="card-header">
              <div class="card-title">${escHtml(s.display_name || s.name || t('profile.chatSessions.anonymous'))}</div>
              <span class="badge badge-info">${escHtml(s.name || '')}</span>
            </div>
            <div class="card-subtitle">${t('profile.chatSessions.lastSeen')}: ${s.last_seen ? timeAgo(s.last_seen) : '-'}</div>
          </div>
        `)
      }`;
  };

  const renderWallet = () => {
    if (!walletData) return html`<${Spinner} text=${t('profile.wallet.loading')} />`;
    const w = walletData;
    return html`
      <div class="section-title">${t('profile.wallet.title')}</div>
      <div class="section-desc">${t('profile.wallet.desc')}</div>
      <div class="wallet-overview">
        <div class="wallet-card"><div class="amount neutral">${w.balance ?? 0} \u2764\uFE0F</div><div class="wlabel">${t('profile.wallet.balance')}</div></div>
        <div class="wallet-card"><div class="amount neutral">${w.escrow ?? 0}</div><div class="wlabel">${t('profile.wallet.inEscrow')}</div></div>
        <div class="wallet-card"><div class="amount positive">${(w.balance ?? 0) - (w.escrow ?? 0)}</div><div class="wlabel">${t('profile.wallet.available')}</div></div>
        <div class="wallet-card"><div class="amount neutral">${w.daily_allowance ?? 50}</div><div class="wlabel">${t('profile.wallet.dailyAllowance')}</div></div>
      </div>
      <div class="section-title" style="margin-top:1rem">${t('profile.wallet.recentTx')}</div>
      ${(!walletTx || walletTx.length === 0)
        ? html`<div class="empty">${t('profile.wallet.empty')}</div>`
        : html`<div class="card"><div class="tx-list">
            ${walletTx.map(tx => {
              const isCredit = tx.amount > 0;
              const typeLabel = tx.type === 'daily_allowance' ? t('profile.wallet.earned')
                : tx.type === 'welcome_bonus' ? t('profile.wallet.welcomeBonus')
                : isCredit ? t('profile.wallet.earned') : t('profile.wallet.shared');
              return html`
                <div class="tx-item">
                  <div><span class="tx-type">${typeLabel}</span> <span style="font-size:.8rem">${escHtml(tx.description || tx.memo || '')}</span></div>
                  <div style="text-align:right">
                    <div class="tx-amount ${isCredit ? 'credit' : 'debit'}">${isCredit ? '+' : ''}${tx.amount}</div>
                    <div class="tx-date">${tx.created_at ? timeAgo(tx.created_at) : ''}</div>
                  </div>
                </div>`;
            })}
          </div></div>`
      }`;
  };

  const renderMemory = () => {
    const searchRef = useRef(null);
    return html`
      <div class="section-title">${t('profile.memory.title')}</div>
      <div class="section-desc">${t('profile.memory.desc')}</div>
      <div class="sub-tabs">
        <button class="sub-tab ${memSubTab === 'entries' ? 'active' : ''}" onClick=${() => setMemSubTab('entries')}>${t('profile.memory.entries')}</button>
        <button class="sub-tab ${memSubTab === 'files' ? 'active' : ''}" onClick=${() => setMemSubTab('files')}>${t('profile.memory.files')}</button>
      </div>
      ${memSubTab === 'entries' ? renderMemoryEntries(searchRef) : renderFiles()}
    `;
  };

  const renderMemoryEntries = (searchRef) => {
    if (!memories) return html`<${Spinner} text=${t('profile.memory.loading')} />`;
    return html`
      <div class="action-bar">
        <div class="search-bar">
          <input type="text" ref=${searchRef} class="input-field" placeholder=${t('profile.memory.search')} onKeyDown=${e => e.key === 'Enter' && searchMemory(e.target.value)} />
          <button class="btn-sm" onClick=${() => searchMemory(searchRef.current?.value)}>${t('profile.memory.searchBtn')}</button>
          <button class="btn-sm btn-outline" onClick=${() => { if (searchRef.current) searchRef.current.value = ''; loadMemoryData(); }}>${t('profile.memory.clearBtn')}</button>
        </div>
        <button class="btn-primary" onClick=${() => setShowMemForm(!showMemForm)}>${t('profile.memory.newBtn')}</button>
      </div>
      ${showMemForm && html`<${MemoryForm} onSave=${createMemory} onCancel=${() => setShowMemForm(false)} />`}
      ${memories.length === 0
        ? html`<div class="empty">${t('profile.memory.empty')}</div>`
        : memories.map(m => html`
          <div>
            <div class="mem-item" onClick=${() => setExpandedMem(expandedMem === m.key ? null : m.key)}>
              <span class="mem-key">${escHtml(m.key)}</span>
              <span class="mem-vis badge ${m.visibility === 'public' ? 'badge-success' : m.visibility === 'shared' ? 'badge-info' : 'badge-muted'}">${m.visibility || 'private'}</span>
            </div>
            ${expandedMem === m.key && html`
              <div class="mem-detail">
                <pre>${escHtml(typeof m.value === 'object' ? JSON.stringify(m.value, null, 2) : String(m.value || ''))}</pre>
                ${m.tags?.length > 0 && html`<div style="margin-top:.5rem;font-size:.75rem;color:var(--muted)">${m.tags.join(', ')}</div>`}
                <div class="mem-actions">
                  <button class="btn-sm" onClick=${() => setEditModal({ key: m.key, value: typeof m.value === 'object' ? JSON.stringify(m.value, null, 2) : String(m.value || '') })}>${t('profile.memory.editBtn')}</button>
                  <button class="btn-danger" onClick=${() => deleteMemory(m.key)}>${t('profile.memory.deleteBtn')}</button>
                </div>
              </div>
            `}
          </div>
        `)
      }`;
  };

  const renderFiles = () => {
    if (!files) return html`<${Spinner} text=${t('profile.files.loading')} />`;
    return html`
      <div class="action-bar">
        <button class="btn-primary" onClick=${() => setShowFileForm(!showFileForm)}>${t('profile.files.uploadBtn')}</button>
        <span style="font-size:.75rem;color:var(--muted)">${t('profile.files.sizeLimit')}</span>
      </div>
      ${showFileForm && html`<${FileUploadForm} onUpload=${uploadFile} onCancel=${() => setShowFileForm(false)} />`}
      ${files.length === 0
        ? html`<div class="empty">${t('profile.files.empty')}</div>`
        : html`<div class="file-grid">
            ${files.map(f => {
              const icon = f.mime_type?.startsWith('image') ? '\u{1F5BC}\uFE0F' : f.mime_type?.includes('pdf') ? '\u{1F4C4}' : '\u{1F4CE}';
              return html`
                <div class="file-card">
                  <div class="file-icon">${icon}</div>
                  <div class="file-info">
                    <div class="file-name">${escHtml(f.key || f.name)}</div>
                    <div class="file-meta">${f.size ? Math.round(f.size / 1024) + ' KB' : ''} \u2502 ${f.visibility || 'private'}</div>
                  </div>
                  <div class="file-actions">
                    <a class="btn-sm" href="${NODE_URL}/v1/memory/files/${encodeURIComponent(f.key || f.name)}" target="_blank" style="text-decoration:none">${t('profile.files.download')}</a>
                    <button class="btn-danger" onClick=${() => deleteFile(f.key || f.name)}>${t('profile.files.delete')}</button>
                  </div>
                </div>`;
            })}
          </div>`
      }`;
  };

  const renderWork = () => {
    return html`
      <div class="section-title">${t('profile.work.title')}</div>
      <div class="section-desc">${t('profile.work.desc')}</div>
      <div class="sub-tabs">
        <button class="sub-tab ${workSubTab === 'inbox' ? 'active' : ''}" onClick=${() => setWorkSubTab('inbox')}>${t('profile.work.inbox')}</button>
        <button class="sub-tab ${workSubTab === 'sent' ? 'active' : ''}" onClick=${() => setWorkSubTab('sent')}>${t('profile.work.sent')}</button>
      </div>
      ${workSubTab === 'inbox' ? renderWorkList(workInbox, 'inbox') : renderWorkList(workSent, 'sent')}
    `;
  };

  const renderWorkList = (items, type) => {
    if (!items) return html`<${Spinner} text=${t('profile.work.loading')} />`;
    if (items.length === 0) return html`<div class="empty">${t(type === 'sent' ? 'profile.work.sentEmpty' : 'profile.work.empty')}</div>`;
    return items.map(w => html`
      <div class="card">
        <div class="card-header">
          <div class="card-title">${escHtml(w.description || w.action_name || '-')}</div>
          <span class="badge ${w.status === 'completed' ? 'badge-success' : w.status === 'accepted' ? 'badge-info' : w.status === 'delivered' ? 'badge-warn' : 'badge-muted'}">${w.status || '-'}</span>
        </div>
        <div class="card-subtitle">
          ${type === 'sent' ? t('profile.work.provider') + ': ' + escHtml(w.provider_gaii || '-') : t('profile.work.from') + ': ' + escHtml(w.requester_gaii || '-')}
          ${w.price_morsels != null ? ' \u2502 ' + t('profile.work.cost') + ': ' + w.price_morsels + ' \u2764\uFE0F' : ''}
          ${w.created_at ? ' \u2502 ' + timeAgo(w.created_at) : ''}
        </div>
        ${type === 'sent' && w.status === 'delivered' && html`
          <button class="btn-sm" style="margin-top:.5rem" onClick=${() => setRateModal({ workId: w.id || w.work_id, desc: w.description || w.action_name })}>${t('profile.work.rateBtn')}</button>
        `}
      </div>
    `);
  };

  const renderServices = () => {
    return html`
      <div class="section-title">${t('profile.services.title')}</div>
      <div class="section-desc">${t('profile.services.desc')}</div>
      <div class="sub-tabs">
        <button class="sub-tab ${svcSubTab === 'mine' ? 'active' : ''}" onClick=${() => setSvcSubTab('mine')}>${t('profile.services.mine')}</button>
        <button class="sub-tab ${svcSubTab === 'catalogue' ? 'active' : ''}" onClick=${() => { setSvcSubTab('catalogue'); if (!catalogue) loadCatalogueData(catFilter); }}>${t('profile.services.catalogue')}</button>
      </div>
      ${svcSubTab === 'mine' ? renderMyServices() : renderCatalogue()}
    `;
  };

  const renderMyServices = () => {
    if (!myServices) return html`<${Spinner} text=${t('profile.services.loading')} />`;
    return html`
      <button class="btn-primary" style="margin-bottom:1rem" onClick=${() => setShowPubForm(!showPubForm)}>${t('profile.services.publishBtn')}</button>
      ${showPubForm && html`<${PublishForm} onPublish=${publishService} onCancel=${() => setShowPubForm(false)} />`}
      ${myServices.length === 0
        ? html`<div class="empty">${t('profile.services.empty')}</div>`
        : myServices.map(s => html`
          <div class="card">
            <div class="card-header">
              <div class="card-title">${escHtml(s.display_name || s.name)}</div>
              <div>
                <span class="badge badge-info">${escHtml(s.category || '')}</span>
                <span class="badge badge-success" style="margin-left:.25rem">${s.price_morsels ? s.price_morsels + ' \u2764\uFE0F' : t('profile.services.free')}</span>
              </div>
            </div>
            <div class="card-subtitle">${escHtml(s.description || '')}</div>
            <button class="btn-danger" style="margin-top:.5rem" onClick=${() => unpublishService(s.id || s.action_id)}>${t('profile.delete')}</button>
          </div>
        `)
      }`;
  };

  const renderCatalogue = () => {
    return html`
      <div class="action-bar">
        <select class="input-field" style="max-width:200px" value=${catFilter} onChange=${e => { setCatFilter(e.target.value); loadCatalogueData(e.target.value); }}>
          <option value="">${t('profile.services.allCategories')}</option>
          ${SERVICE_CATEGORIES.map(c => html`<option value=${c}>${c}</option>`)}
        </select>
      </div>
      ${!catalogue ? html`<${Spinner} text=${t('profile.services.loading')} />`
        : catalogue.length === 0 ? html`<div class="empty">${t('profile.services.catalogueEmpty')}</div>`
        : catalogue.map(s => html`
          <div class="card">
            <div class="card-header">
              <div class="card-title">${escHtml(s.display_name || s.name)}</div>
              <div>
                <span class="badge badge-info">${escHtml(s.category || '')}</span>
                <span class="badge badge-success" style="margin-left:.25rem">${s.price_morsels ? s.price_morsels + ' \u2764\uFE0F' : t('profile.services.free')}</span>
              </div>
            </div>
            <div class="card-subtitle">${escHtml(s.description || '')} \u2502 ${escHtml(s.owner || '')}</div>
          </div>
        `)
      }`;
  };

  const renderBoards = () => {
    if (boardView) return renderBoardDetail();
    return html`
      <div class="section-title">${t('profile.boards.title')}</div>
      <div class="section-desc">${t('profile.boards.desc')}</div>
      <div class="sub-tabs">
        <button class="sub-tab ${brdSubTab === 'mine' ? 'active' : ''}" onClick=${() => { setBrdSubTab('mine'); if (!myBoards) loadMyBoardsData(); }}>${t('profile.boards.mine')}</button>
        <button class="sub-tab ${brdSubTab === 'browse' ? 'active' : ''}" onClick=${() => { setBrdSubTab('browse'); if (!allBoards) loadAllBoardsData(); }}>${t('profile.boards.browse')}</button>
      </div>
      ${brdSubTab === 'mine' ? renderMyBoards() : renderAllBoards()}
    `;
  };

  const renderMyBoards = () => {
    if (!myBoards) return html`<${Spinner} text=${t('profile.boards.loading')} />`;
    return html`
      <button class="btn-primary" style="margin-bottom:1rem" onClick=${() => setShowBrdForm(!showBrdForm)}>${t('profile.boards.createBtn')}</button>
      ${showBrdForm && html`<${BoardForm} onCreate=${createBoard} onCancel=${() => setShowBrdForm(false)} />`}
      ${myBoards.length === 0
        ? html`<div class="empty">${t('profile.boards.empty')}</div>`
        : myBoards.map(b => html`
          <div class="card" style="cursor:pointer" onClick=${() => viewBoardPosts(b.id || b.board_id, b.name)}>
            <div class="card-header">
              <div class="card-title">${escHtml(b.name)}</div>
              <span class="badge ${b.visibility === 'public' ? 'badge-success' : 'badge-muted'}">${b.visibility || 'private'}</span>
            </div>
            <div class="card-subtitle">${escHtml(b.description || '')}</div>
          </div>
        `)
      }`;
  };

  const renderAllBoards = () => {
    if (!allBoards) return html`<${Spinner} text=${t('profile.boards.browseLoading')} />`;
    if (allBoards.length === 0) return html`<div class="empty">${t('profile.boards.browseEmpty')}</div>`;
    return allBoards.map(b => html`
      <div class="card">
        <div class="card-header">
          <div class="card-title" style="cursor:pointer" onClick=${() => viewBoardPosts(b.id || b.board_id, b.name)}>${escHtml(b.name)}</div>
          <button class="btn-sm" onClick=${() => subscribeBoard(b.id || b.board_id)}>${t('profile.boards.subscribe')}</button>
        </div>
        <div class="card-subtitle">${escHtml(b.description || '')}</div>
      </div>
    `);
  };

  const renderBoardDetail = () => {
    const postRef = useRef(null);
    return html`
      <button class="btn-outline" style="margin-bottom:1rem" onClick=${() => setBoardView(null)}>\u2190 ${t('profile.boards.backToBoards')}</button>
      <div class="section-title">${escHtml(boardView.name)}</div>
      <div style="margin-bottom:1rem">
        <textarea ref=${postRef} class="input-field" rows="2" placeholder=${t('profile.boards.postPlaceholder')}></textarea>
        <button class="btn-primary" style="margin-top:.5rem" onClick=${() => { createPost(boardView.id, postRef.current?.value); if (postRef.current) postRef.current.value = ''; }}>${t('profile.boards.postBtn')}</button>
      </div>
      ${boardView.posts.length === 0
        ? html`<div class="empty">${t('profile.boards.postsEmpty')}</div>`
        : boardView.posts.map(p => html`
          <div class="post-card">
            <div class="post-content">${escHtml(p.content)}</div>
            <div class="post-meta">
              <span>${escHtml(p.author_gaii || p.author || '-')}</span>
              <span>${p.created_at ? timeAgo(p.created_at) : ''}</span>
            </div>
            <div class="post-reactions">
              ${['\u{1F44D}','\u2764\uFE0F','\u{1F525}','\u{1F4A1}','\u{1F602}'].map(emoji => html`
                <button class="reaction-btn" onClick=${() => reactToPost(boardView.id, p.id || p.post_id, emoji)}>${emoji} ${p.reactions?.[emoji] || ''}</button>
              `)}
            </div>
          </div>
        `)
      }`;
  };

  const renderApps = () => {
    return html`
      <div class="section-title">${t('profile.apps.title')}</div>
      <div class="section-desc">${t('profile.apps.desc')}</div>

      <!-- App launcher -->
      <div class="card" style="margin-bottom:1rem">
        <h3 style="color:var(--love1);font-size:1rem;margin-bottom:.5rem">\u{1F680} ${t('profile.apps.launcherTitle')}</h3>
        <p style="font-size:.85rem;color:var(--muted);margin-bottom:.75rem">${t('profile.apps.launcherDesc')}</p>
        <a href="/v1/apps/launcher" target="_blank" class="btn-primary" style="text-decoration:none;display:inline-block">${t('profile.apps.launcherOpen')}</a>
      </div>

      <!-- Create guide -->
      <div class="card" style="margin-bottom:1rem">
        <h3 style="color:var(--love1);font-size:1rem;margin-bottom:.5rem">\u2728 ${t('profile.apps.createGuide')}</h3>
        <p style="font-size:.85rem;color:var(--muted);margin-bottom:.75rem">${t('profile.apps.createGuideDesc')}</p>
        <a href="/v1/aimeat-os" target="_blank" class="btn-primary" style="text-decoration:none;display:inline-block;margin-bottom:.5rem">${t('profile.apps.downloadGuide')}</a>
        <p style="font-size:.8rem;color:var(--muted)">${t('profile.apps.guideDesc')}</p>
      </div>

      <!-- Upload -->
      <button class="btn-primary" style="margin-bottom:1rem" onClick=${() => setShowAppUpload(!showAppUpload)}>${t('profile.apps.uploadBtn')}</button>
      ${showAppUpload && html`<${AppUploadForm} onUpload=${uploadApp} onCancel=${() => setShowAppUpload(false)} />`}

      <!-- My Apps -->
      <div class="section-title" style="margin-top:1.5rem">${t('profile.apps.mine')}</div>
      ${!myApps ? html`<${Spinner} text=${t('profile.apps.loading')} />`
        : myApps.length === 0 ? html`<div class="empty">${t('profile.apps.empty')}</div>`
        : myApps.map(a => html`
          <div class="card">
            <div class="card-header">
              <div class="card-title">${escHtml(a.filename || a.name)}</div>
              <span class="badge badge-info">${escHtml(a.content_type || 'html')}</span>
            </div>
            <div class="card-subtitle">
              <a href="${NODE_URL}/v1/apps/${encodeURIComponent(a.owner || session.owner)}/${encodeURIComponent(a.filename || a.name)}" target="_blank">${t('profile.apps.download')}</a>
              ${a.size ? ' \u2022 ' + Math.round(a.size / 1024) + ' KB' : ''}
            </div>
          </div>
        `)
      }

      <!-- Gallery -->
      <div class="section-title" style="margin-top:1.5rem">${t('profile.apps.gallery')}</div>
      ${!allApps ? html`<${Spinner} text=${t('profile.apps.galleryLoading')} />`
        : allApps.length === 0 ? html`<div class="empty">${t('profile.apps.galleryEmpty')}</div>`
        : html`<div class="app-grid">
            ${allApps.map(a => {
              const ssUrl = a.screenshot_url ? NODE_URL + a.screenshot_url : null;
              return html`
                <div class="app-card">
                  <div class="app-screenshot">
                    ${ssUrl ? html`<img src=${ssUrl} alt=${a.filename} onError=${e => { e.target.parentElement.innerHTML = '<div class="placeholder">\u{1F4F1}</div>'; }} />` : html`<div class="placeholder">\u{1F4F1}</div>`}
                  </div>
                  <div class="app-info">
                    <div class="app-name">${escHtml(a.filename)}</div>
                    <div class="app-meta">${escHtml(a.owner)} \u2022 ${Math.round((a.size || 0) / 1024)} KB${a.protected ? ' \u2022 \u{1F512} ' + t('profile.apps.protected') : ''}</div>
                    <div style="margin-top:.5rem"><a href="${NODE_URL + (a.download_url || '/v1/apps/' + encodeURIComponent(a.owner) + '/' + encodeURIComponent(a.filename))}" class="btn-sm" style="text-decoration:none;display:inline-block">${t('profile.apps.download')}</a></div>
                  </div>
                </div>`;
            })}
          </div>`
      }`;
  };

  const renderFederation = () => {
    return html`
      <div class="section-title">${t('profile.federation.title')}</div>
      <div class="section-desc">${t('profile.federation.desc')}</div>
      ${!federation ? html`<${Spinner} text=${t('profile.federation.loading')} />`
        : federation.length === 0 ? html`<div class="empty">${t('profile.federation.empty')}</div>`
        : html`<div class="section-title" style="margin-top:0">${t('profile.federation.peers')}</div>
            ${federation.map(p => {
              const alive = p.status === 'active' || p.alive;
              return html`
                <div class="card">
                  <div class="peer-card">
                    <div>
                      <div class="card-title">${escHtml(p.node_id || p.nodeId || p.url)}</div>
                      <div class="card-subtitle">${escHtml(p.url || '')}</div>
                    </div>
                    <div class="peer-status">
                      <span class="peer-dot ${alive ? 'alive' : 'dead'}"></span>
                      <span style="font-size:.8rem;color:${alive ? 'var(--success)' : 'var(--danger)'}">${alive ? t('profile.federation.online') : t('profile.federation.offline')}</span>
                    </div>
                  </div>
                </div>`;
            })}`
      }`;
  };

  const renderNodes = () => {
    const tunnelUrl = NODE_URL.replace(/^http/, 'ws') + '/v1/personal/tunnel';
    return html`
      <div class="section-title">${t('profile.nodes.title')}</div>
      <div class="section-desc">${t('profile.nodes.desc')}</div>
      <button class="btn-primary" style="margin-bottom:1rem" onClick=${() => setShowNodeForm(!showNodeForm)}>${t('profile.nodes.addBtn')}</button>
      ${showNodeForm && html`<${NodeForm} onRegister=${registerNode} onCancel=${() => setShowNodeForm(false)} />`}
      ${!nodes ? html`<${Spinner} text=${t('profile.nodes.loading')} />`
        : nodes.length === 0 ? html`<div class="empty">${t('profile.nodes.empty')}</div>`
        : nodes.map((node, idx) => {
            const statusClass = node.status || 'offline';
            const statusLabel = t('profile.nodes.' + statusClass) || statusClass;
            const isPublic = node.visibility === 'public';
            const agentCount = node.agent_gaiis?.length || 0;
            const agentWord = agentCount === 1 ? t('profile.nodes.agent') : t('profile.nodes.agents');
            const mailboxCount = node.mailbox?.items || 0;
            const isOpen = expandedNodes.has(idx);
            const setupOpen = expandedSetups.has(idx);
            const mbUsedMB = ((node.mailbox?.used_bytes || 0) / 1024 / 1024).toFixed(1);
            const mbQuotaMB = ((node.mailbox?.quota_bytes || 0) / 1024 / 1024).toFixed(0);

            return html`
              <div class="pn-card">
                <div class="pn-header" onClick=${() => {
                  const s = new Set(expandedNodes);
                  s.has(idx) ? s.delete(idx) : s.add(idx);
                  setExpandedNodes(s);
                }}>
                  <div class="pn-header-left">
                    <div class="pn-status-dot ${statusClass}"></div>
                    <span class="pn-name">${escHtml(node.node_id)}</span>
                  </div>
                  <div class="pn-badges">
                    ${isPublic
                      ? html`<span class="badge badge-success">${t('profile.nodes.public')}</span>`
                      : html`<span class="badge badge-muted">${t('profile.nodes.private')}</span>`}
                    <span class="badge badge-${statusClass === 'online' ? 'success' : statusClass === 'degraded' ? 'warn' : 'danger'}">${statusLabel}</span>
                    <span class="pn-arrow ${isOpen ? 'open' : ''}">\u25BC</span>
                  </div>
                </div>
                <div class="pn-quick">${agentCount} ${agentWord} \u2502 ${t('profile.nodes.mailboxItems')}: ${mailboxCount} ${t('profile.nodes.items')}</div>
                ${isOpen && html`
                  <div class="pn-details open">
                    <div class="pn-detail-row">
                      <span class="pn-detail-label">${t('profile.nodes.tunnelUrl')}</span>
                      <span class="pn-detail-value" style="display:flex;align-items:center;gap:.5rem">
                        <code style="font-size:.75rem">${tunnelUrl}</code>
                        <button onClick=${() => { copyToClipboard(tunnelUrl).then(() => showToast(t('profile.nodes.copied'))); }} style="padding:2px 8px;background:var(--card2);border:1px solid var(--border);border-radius:4px;color:var(--love4);cursor:pointer;font-size:.7rem">${t('profile.nodes.copyUrl')}</button>
                      </span>
                    </div>
                    <div style="padding:.5rem 0">
                      <span class="pn-detail-label">${t('profile.nodes.agentList')}</span>
                      ${node.agent_gaiis?.length > 0
                        ? html`<div class="pn-agent-list">${node.agent_gaiis.map(g => html`<div class="pn-agent-item">${escHtml(g)}</div>`)}</div>`
                        : html`<div style="font-size:.8rem;color:var(--muted);margin-top:.3rem">${t('profile.nodes.noAgents')}</div>`}
                    </div>
                    <div class="pn-detail-row">
                      <span class="pn-detail-label">${t('profile.nodes.mailbox')}</span>
                      <span class="pn-detail-value">${mailboxCount} ${t('profile.nodes.items')} (${mbUsedMB} ${t('profile.nodes.mailboxOf')} ${mbQuotaMB} MB)</span>
                    </div>
                    <div class="pn-detail-row">
                      <span class="pn-detail-label">${t('profile.nodes.lastSeen')}</span>
                      <span class="pn-detail-value">${node.last_seen ? timeAgo(node.last_seen) : '-'}</span>
                    </div>
                    <div class="pn-detail-row">
                      <span class="pn-detail-label">${t('profile.nodes.visibility')}</span>
                      <div class="pn-vis-toggle">
                        <button class="pn-vis-btn ${!isPublic ? 'active' : ''}" onClick=${() => setNodeVis(node.node_id, 'private')}>${t('profile.nodes.private')}</button>
                        <button class="pn-vis-btn ${isPublic ? 'active' : ''}" onClick=${() => setNodeVis(node.node_id, 'public')}>${t('profile.nodes.public')}</button>
                      </div>
                    </div>
                    <div style="margin-top:.75rem">
                      <button class="expand-btn" style="font-size:.8rem;padding:6px 12px" onClick=${() => {
                        const s = new Set(expandedSetups);
                        s.has(idx) ? s.delete(idx) : s.add(idx);
                        setExpandedSetups(s);
                      }}>${t('profile.nodes.setupTitle')} <span style="transition:transform .2s;${setupOpen ? 'transform:rotate(180deg)' : ''}">\u25BC</span></button>
                      ${setupOpen && html`
                        <div class="pn-setup open">
                          <ol>
                            <li>${t('profile.nodes.setupStep1')}</li>
                            <li>${t('profile.nodes.setupStep2')}</li>
                            <li>${t('profile.nodes.setupStep3')}</li>
                            <li>${t('profile.nodes.setupStep4')}</li>
                          </ol>
                          <a href="/docs/personal-node-setup-guide.md" target="_blank" style="color:var(--love1);font-size:.8rem">${t('profile.nodes.setupDocs')} \u2192</a>
                        </div>
                      `}
                    </div>
                    <button class="pn-detach-btn" onClick=${() => detachNode(node.node_id)}>${t('profile.nodes.detachBtn')}</button>
                  </div>
                `}
              </div>`;
          })
      }`;
  };

  const renderAccess = () => {
    const ownerKey = typeof localStorage !== 'undefined' ? localStorage.getItem('aimeat_owner_key') : null;
    const [keyBlurred, setKeyBlurred] = useState(true);
    return html`
      <div class="section-title">${t('profile.access.title')}</div>
      <div class="section-desc">${t('profile.access.desc')}</div>

      <h3 style="color:var(--love1);margin-bottom:.75rem">\u{1F4BB} ${t('profile.access.session')}</h3>
      <div class="card">
        <div class="mem-item"><span class="mem-key">${t('profile.access.owner')}</span><span>${escHtml(session.owner || '-')}</span></div>
        <div class="mem-item"><span class="mem-key">${t('profile.access.ghii')}</span><span>${escHtml(session.ghii || '-')}</span></div>
        <div class="mem-item"><span class="mem-key">${t('profile.access.agentGaii')}</span><span>${escHtml(session.gaii || '-')}</span></div>
        <div class="mem-item"><span class="mem-key">${t('profile.access.node')}</span><span>${escHtml(NODE_URL)}</span></div>
        <div class="mem-item"><span class="mem-key">${t('profile.access.jwtValid')}</span><span>${session.valid ? html`<span class="badge badge-success">${t('profile.access.yes')}</span>` : html`<span class="badge badge-danger">${t('profile.access.expired')}</span>`}</span></div>
      </div>

      <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\u{1F510} ${t('profile.access.publicKey')}</h3>
      <div class="card"><div style="font-family:monospace;font-size:.75rem;word-break:break-all;color:var(--muted)">${escHtml(session.publicKey || 'N/A')}</div></div>

      ${ownerKey && html`
        <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\u{1F5DD}\uFE0F ${t('profile.access.ownerKey')}</h3>
        <div class="card" style="border-color:var(--warn);cursor:pointer" onClick=${() => copyToClipboard(ownerKey).then(() => showToast(t('profile.access.keyCopied')))}>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-family:monospace;font-size:.75rem;word-break:break-all;color:var(--muted);filter:${keyBlurred ? 'blur(4px)' : 'none'};transition:filter .2s"
              onMouseEnter=${() => setKeyBlurred(false)} onMouseLeave=${() => setKeyBlurred(true)}>
              ${escHtml(ownerKey)}
            </div>
            <span class="badge badge-warn">${t('profile.access.hoverReveal')}</span>
          </div>
          <div style="font-size:.75rem;color:var(--warn);margin-top:.5rem">\u26A0 ${t('profile.access.keepSafe')}</div>
        </div>
      `}

      <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\u{1F517} ${t('profile.access.mcpEndpoint')}</h3>
      <div class="card">
        <div style="font-family:monospace;font-size:.85rem;color:var(--love3)">${escHtml(NODE_URL + '/v1/mcp')}</div>
        <div style="font-size:.75rem;color:var(--muted);margin-top:.3rem">${t('profile.access.mcpDesc')}</div>
      </div>
    `;
  };

  const renderDataWallet = () => {
    return html`
      <div class="section-title">\u{1F6E1}\uFE0F ${t('profile.tabs.dataWallet')}</div>

      <!-- Consents -->
      <h3 style="color:var(--love1);margin:1rem 0 .75rem">${t('wallet.consents.title')}</h3>
      ${!consents ? html`<${Spinner} />`
        : consents.length === 0 ? html`<div class="empty">${t('wallet.consents.empty')}</div>`
        : html`<div class="card" style="overflow-x:auto">
            <table class="consent-table"><thead><tr>
              <th>${t('wallet.consents.pattern')}</th>
              <th>${t('wallet.consents.recipient')}</th>
              <th>${t('wallet.consents.purpose')}</th>
              <th>${t('wallet.consents.scope')}</th>
              <th>${t('wallet.consents.granted')}</th>
              <th>${t('wallet.consents.expires')}</th>
              <th></th>
            </tr></thead><tbody>
              ${consents.map(c => {
                const isExpired = c.expires_at && new Date(c.expires_at) < new Date();
                return html`<tr>
                  <td><span style="font-family:monospace;font-size:.8rem;color:var(--love3)">${escHtml(c.data_pattern || c.pattern || '-')}</span></td>
                  <td>${escHtml(c.recipient_gaii || c.recipient || '-')}</td>
                  <td>${escHtml(c.purpose || '-')}</td>
                  <td>${isExpired ? html`<span class="badge badge-muted">expired</span>` : html`<span class="badge badge-success">active</span>`} ${escHtml(c.scope || '-')}</td>
                  <td style="font-size:.8rem;color:var(--muted)">${c.granted_at ? new Date(c.granted_at).toLocaleDateString() : '-'}</td>
                  <td style="font-size:.8rem;color:var(--muted)">${c.expires_at ? new Date(c.expires_at).toLocaleDateString() : t('wallet.consents.never')}</td>
                  <td>${!isExpired && html`<button class="revoke-btn" onClick=${() => revokeConsent(c.id || c.consent_id)}>${t('wallet.consents.revoke')}</button>`}</td>
                </tr>`;
              })}
            </tbody></table>
          </div>`
      }

      <!-- Audit -->
      <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">${t('wallet.audit.title')}</h3>
      <div style="display:flex;gap:.5rem;margin-bottom:1rem">
        ${[7, 30, 90].map(d => html`
          <button class="audit-day-btn ${auditDays === d ? 'active' : ''}" onClick=${() => { setAuditDays(d); loadAuditData(d); }}>${d} ${t('wallet.audit.days')}</button>
        `)}
      </div>
      ${!auditEntries ? html`<${Spinner} />`
        : auditEntries.length === 0 ? html`<div class="empty">${t('wallet.audit.empty')}</div>`
        : html`<div class="card" style="overflow-x:auto">
            <table class="audit-table"><thead><tr>
              <th>${t('wallet.audit.who')}</th>
              <th>${t('wallet.audit.what')}</th>
              <th>${t('wallet.audit.when')}</th>
              <th>${t('wallet.audit.purpose')}</th>
            </tr></thead><tbody>
              ${auditEntries.map(e => html`<tr>
                <td>${escHtml(e.accessor_gaii || e.accessed_by || e.who || '-')}</td>
                <td><span style="font-family:monospace;font-size:.8rem;color:var(--love3)">${escHtml(e.data_key || e.key || e.what || '-')}</span></td>
                <td style="font-size:.8rem;color:var(--muted)">${e.accessed_at ? timeAgo(e.accessed_at) : (e.timestamp ? timeAgo(e.timestamp) : '-')}</td>
                <td>${escHtml(e.purpose || '-')}</td>
              </tr>`)}
            </tbody></table>
          </div>`
      }

      <!-- GDPR Export -->
      <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">${t('wallet.export.title')}</h3>
      <div class="card">
        <p style="font-size:.85rem;color:var(--muted);margin-bottom:1rem">${t('wallet.export.description')}</p>
        <button class="btn-primary" onClick=${exportGdpr}>${t('wallet.export.button')}</button>
      </div>
    `;
  };

  // ── Tab panel map ──
  const tabContent = {
    agents: renderAgents,
    chatsessions: renderChatSessions,
    wallet: renderWallet,
    memory: renderMemory,
    work: renderWork,
    actions: renderServices,
    boards: renderBoards,
    apps: renderApps,
    federation: renderFederation,
    nodes: renderNodes,
    access: renderAccess,
    dataWallet: renderDataWallet,
  };

  // ── Main render ──
  return html`
    <div class="bg-aurora" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none">
      <div class="aurora-wave"></div><div class="aurora-wave"></div><div class="aurora-wave"></div>
    </div>
    <div class="pf">
      <!-- Profile header -->
      <div class="profile-header">
        <div class="avatar">\u{1F9D1}</div>
        <div class="profile-info">
          <h1>${escHtml(session.displayName || session.owner)}</h1>
          <div class="ghii">${escHtml(session.ghii || '')}</div>
          <div class="meta">${t('profile.node')}: ${escHtml(NODE_URL)}</div>
        </div>
      </div>

      <!-- Stats bar -->
      <div class="stats-bar">
        <div class="stat-card"><div class="num">${stats.agents}</div><div class="label">${t('profile.stats.agents')}</div></div>
        <div class="stat-card"><div class="num">${stats.chatSessions}</div><div class="label">${t('profile.stats.chatSessions')}</div></div>
        <div class="stat-card"><div class="num">${stats.balance}</div><div class="label">${t('profile.stats.morsels')}</div></div>
        <div class="stat-card"><div class="num">${stats.memory}</div><div class="label">${t('profile.stats.memories')}</div></div>
        <div class="stat-card"><div class="num">${stats.services}</div><div class="label">${t('profile.stats.services')}</div></div>
        <div class="stat-card"><div class="num">${stats.work}</div><div class="label">${t('profile.stats.tasks')}</div></div>
        <div class="stat-card"><div class="num">${stats.apps}</div><div class="label">${t('profile.stats.apps')}</div></div>
        <div class="stat-card"><div class="num">${stats.files}</div><div class="label">${t('profile.stats.files')}</div></div>
        <div class="stat-card"><div class="num">${stats.nodes}</div><div class="label">${t('profile.stats.nodes')}</div></div>
      </div>

      <!-- Tabs -->
      <div class="tabs">
        ${TABS.map(tab => html`
          <button class="tab ${activeTab === tab.id ? 'active' : ''}" onClick=${() => switchTab(tab.id)}>${t(tab.key)}</button>
        `)}
      </div>

      <!-- Active panel -->
      <div>${tabContent[activeTab]?.()}</div>

      <!-- Modals -->
      ${editModal && html`
        <${EditMemoryModal}
          memKey=${editModal.key}
          initialValue=${editModal.value}
          onSave=${(v) => saveMemoryEdit(editModal.key, v)}
          onCancel=${() => setEditModal(null)}
        />`}

      ${rateModal && html`
        <${RateModal}
          desc=${rateModal.desc}
          onSubmit=${(rating, comment) => submitRating(rateModal.workId, rating, comment)}
          onCancel=${() => setRateModal(null)}
        />`}

      <!-- Toast -->
      ${toast && html`<div class="toast ${toast.isError ? 'error' : ''}">${toast.msg}</div>`}
    </div>`;
}

/* ── Form sub-components ── */

function MemoryForm({ onSave, onCancel }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [vis, setVis] = useState('private');
  const [tags, setTags] = useState('');
  return html`
    <div class="create-form">
      <div class="form-row"><label>${t('profile.memory.keyLabel')}</label><input class="input-field" placeholder=${t('profile.memory.keyPlaceholder')} value=${key} onInput=${e => setKey(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.memory.valueLabel')}</label><textarea class="input-field" rows="3" placeholder=${t('profile.memory.valuePlaceholder')} value=${value} onInput=${e => setValue(e.target.value)}></textarea></div>
      <div class="form-row"><label>${t('profile.memory.visLabel')}</label>
        <select class="input-field" value=${vis} onChange=${e => setVis(e.target.value)}>
          <option value="private">${t('profile.memory.visPrivate')}</option>
          <option value="shared">${t('profile.memory.visShared')}</option>
          <option value="public">${t('profile.memory.visPublic')}</option>
        </select>
      </div>
      <div class="form-row"><label>${t('profile.memory.tagsLabel')}</label><input class="input-field" placeholder=${t('profile.memory.tagsPlaceholder')} value=${tags} onInput=${e => setTags(e.target.value)} /></div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => { if (!key || !value) return; onSave(key, value, vis, tags); }}>${t('profile.memory.saveBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.memory.cancelBtn')}</button>
      </div>
    </div>`;
}

function FileUploadForm({ onUpload, onCancel }) {
  const [key, setKey] = useState('');
  const [vis, setVis] = useState('private');
  const fileRef = useRef(null);
  return html`
    <div class="create-form">
      <div class="form-row"><label>${t('profile.files.keyLabel')} <span style="font-weight:normal;font-size:.75rem;color:var(--muted)">${t('profile.files.nameNote')}</span></label><input class="input-field" placeholder=${t('profile.files.keyPlaceholder')} value=${key} onInput=${e => setKey(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.files.fileLabel')}</label><input type="file" ref=${fileRef} class="input-field" onChange=${e => { if (e.target.files[0] && !key) setKey(e.target.files[0].name); }} /></div>
      <div class="form-row"><label>${t('profile.files.visLabel')}</label>
        <select class="input-field" value=${vis} onChange=${e => setVis(e.target.value)}>
          <option value="private">${t('profile.files.visPrivate')}</option>
          <option value="owner">${t('profile.files.visOwner')}</option>
          <option value="public">${t('profile.files.visPublic')}</option>
        </select>
      </div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => { const f = fileRef.current?.files?.[0]; if (!f) return; onUpload(key || f.name, f, vis); }}>${t('profile.files.uploadSaveBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.files.cancelBtn')}</button>
      </div>
    </div>`;
}

function PublishForm({ onPublish, onCancel }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState('language');
  const [price, setPrice] = useState('0');
  const [unit, setUnit] = useState('call');
  const [webhook, setWebhook] = useState('');
  return html`
    <div class="create-form">
      <div class="form-row"><label>${t('profile.services.nameLabel')}</label><input class="input-field" placeholder=${t('profile.services.namePlaceholder')} value=${name} onInput=${e => setName(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.services.descLabel')}</label><textarea class="input-field" rows="3" placeholder=${t('profile.services.descPlaceholder')} value=${desc} onInput=${e => setDesc(e.target.value)}></textarea></div>
      <div class="form-row"><label>${t('profile.services.categoryLabel')}</label>
        <select class="input-field" value=${cat} onChange=${e => setCat(e.target.value)}>
          ${SERVICE_CATEGORIES.map(c => html`<option value=${c}>${c}</option>`)}
        </select>
      </div>
      <div class="form-row"><label>${t('profile.services.priceLabel')}</label><input type="number" class="input-field" value=${price} min="0" onInput=${e => setPrice(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.services.unitLabel')}</label>
        <select class="input-field" value=${unit} onChange=${e => setUnit(e.target.value)}>
          <option value="call">Per call</option><option value="minute">Per minute</option>
          <option value="token">Per token</option><option value="task">Per task</option>
        </select>
      </div>
      <div class="form-row"><label>${t('profile.services.webhookLabel')}</label><input class="input-field" placeholder=${t('profile.services.webhookPlaceholder')} value=${webhook} onInput=${e => setWebhook(e.target.value)} /></div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => onPublish(name, desc, cat, price, unit, webhook)}>${t('profile.services.publishSaveBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
      </div>
    </div>`;
}

function BoardForm({ onCreate, onCancel }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [vis, setVis] = useState('private');
  return html`
    <div class="create-form">
      <div class="form-row"><label>${t('profile.boards.nameLabel')}</label><input class="input-field" placeholder=${t('profile.boards.namePlaceholder')} value=${name} onInput=${e => setName(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.boards.descLabel')}</label><input class="input-field" placeholder=${t('profile.boards.descPlaceholder')} value=${desc} onInput=${e => setDesc(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.boards.visLabel')}</label>
        <select class="input-field" value=${vis} onChange=${e => setVis(e.target.value)}>
          <option value="private">${t('profile.boards.visPrivate')}</option>
          <option value="public">${t('profile.boards.visPublic')}</option>
        </select>
      </div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => onCreate(name, desc, vis)}>${t('profile.boards.createSaveBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
      </div>
    </div>`;
}

function NodeForm({ onRegister, onCancel }) {
  const [nodeId, setNodeId] = useState('');
  const [vis, setVis] = useState('private');
  const [gaiis, setGaiis] = useState('');
  return html`
    <div class="create-form">
      <div class="section-title">${t('profile.nodes.addTitle')}</div>
      <div class="form-row"><label>${t('profile.nodes.nodeIdLabel')}</label><input class="input-field" placeholder=${t('profile.nodes.nodeIdPlaceholder')} value=${nodeId} onInput=${e => setNodeId(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.nodes.visLabel')}</label>
        <div style="display:flex;gap:1rem">
          <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer">
            <input type="radio" name="nodeVis" value="private" checked=${vis === 'private'} onChange=${() => setVis('private')} /> ${t('profile.nodes.private')}
          </label>
          <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer">
            <input type="radio" name="nodeVis" value="public" checked=${vis === 'public'} onChange=${() => setVis('public')} /> ${t('profile.nodes.public')}
          </label>
        </div>
      </div>
      <div class="form-row"><label>${t('profile.nodes.agentGaiisLabel')}</label><input class="input-field" placeholder=${t('profile.nodes.agentGaiisPlaceholder')} value=${gaiis} onInput=${e => setGaiis(e.target.value)} /></div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => onRegister(nodeId, vis, gaiis)}>${t('profile.nodes.registerBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.nodes.cancelBtn')}</button>
      </div>
    </div>`;
}

function AppUploadForm({ onUpload, onCancel }) {
  const fileRef = useRef(null);
  const ssRef = useRef(null);
  const [code, setCode] = useState('');
  return html`
    <div class="create-form">
      <div class="form-row"><label>${t('profile.apps.fileLabel')}</label><input type="file" ref=${fileRef} class="input-field" accept=".html,.htm" /></div>
      <div class="form-row"><label>${t('profile.apps.screenshotLabel')}</label><input type="file" ref=${ssRef} class="input-field" accept="image/*" /></div>
      <div class="form-row"><label>${t('profile.apps.accessCodeLabel')}</label><input class="input-field" placeholder=${t('profile.apps.accessCodePlaceholder')} value=${code} onInput=${e => setCode(e.target.value)} /></div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => onUpload(fileRef.current?.files?.[0], ssRef.current?.files?.[0], code)}>${t('profile.apps.uploadSaveBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
      </div>
    </div>`;
}

function EditMemoryModal({ memKey, initialValue, onSave, onCancel }) {
  const [value, setValue] = useState(initialValue);
  return html`
    <div class="modal-overlay" onClick=${e => { if (e.target.className.includes('modal-overlay')) onCancel(); }}>
      <div class="modal">
        <h3>${t('profile.memory.editTitle')}: ${escHtml(memKey)}</h3>
        <textarea class="input-field" rows="6" value=${value} onInput=${e => setValue(e.target.value)}></textarea>
        <div class="form-actions" style="margin-top:1rem">
          <button class="btn-primary" onClick=${() => onSave(value)}>${t('profile.save')}</button>
          <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
        </div>
      </div>
    </div>`;
}

function RateModal({ desc, onSubmit, onCancel }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  return html`
    <div class="modal-overlay" onClick=${e => { if (e.target.className.includes('modal-overlay')) onCancel(); }}>
      <div class="modal">
        <h3>${t('profile.work.rateTitle')}</h3>
        <p style="color:var(--muted);margin-bottom:1rem">${t('profile.work.rateDesc')} ${escHtml(desc || '')}</p>
        <div class="star-rating" style="margin-bottom:1rem">
          ${[1,2,3,4,5].map(i => html`
            <span class="star ${i <= rating ? 'active' : ''}" onClick=${() => setRating(i)}>\u2605</span>
          `)}
        </div>
        <div class="form-row"><label>${t('profile.work.commentLabel')}</label><textarea class="input-field" rows="2" value=${comment} onInput=${e => setComment(e.target.value)}></textarea></div>
        <div class="form-actions">
          <button class="btn-primary" onClick=${() => onSubmit(rating, comment)}>${t('profile.work.submitRating')}</button>
          <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
        </div>
      </div>
    </div>`;
}
