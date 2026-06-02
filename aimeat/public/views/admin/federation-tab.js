import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, num, Badge, EconRow, StatsGrid, Empty, ExpandableHelp, ErrorBox } from './shared.js';
import {
  getFederationPeers, getFederationDirectory, approvePeeringRequest, rejectPeeringRequest,
  deletePeeringRequest, activatePeer, addPeerDirect, removePeer, removePeerEmergency,
  testFederationNode, joinGenesisNetwork, updatePeerPolicy, getNetworkDirectory,
  getConfig, saveConfig,
} from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';

export default function FederationTab({ data, reload }) {
  const peeringRequests = data.federation || [];
  const livePeers = data.livePeers || [];

  // ── Local state ──
  const [testUrl, setTestUrl] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [addNodeId, setAddNodeId] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addKey, setAddKey] = useState('');
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);
  const [joinUrl, setJoinUrl] = useState('');
  const [joinRole, setJoinRole] = useState('contributor');
  const [joining, setJoining] = useState(false);
  const [joinResult, setJoinResult] = useState(null);

  // ── Federation Auth Policy state ──
  const [authPolicy, setAuthPolicy] = useState('disabled');
  const [defaultScopes, setDefaultScopes] = useState([]);
  const [authPolicyLoading, setAuthPolicyLoading] = useState(true);

  useEffect(() => {
    getConfig().then(res => {
      if (res.ok && res.data?.schema) {
        const s = res.data.schema;
        setAuthPolicy(s['federation.auth_policy']?.value ?? 'disabled');
        const scopes = s['federation.default_scopes']?.value ?? 'memory:read,catalogue:read';
        setDefaultScopes(typeof scopes === 'string' ? scopes.split(',').filter(Boolean) : (scopes || []));
      }
      setAuthPolicyLoading(false);
    });
  }, []);

  const doSaveAuthPolicy = async (policy, scopes) => {
    const changes = [
      { path: 'federation.auth_policy', value: policy },
      { path: 'federation.default_scopes', value: Array.isArray(scopes) ? scopes.join(',') : scopes },
    ];
    const res = await saveConfig(changes);
    if (res.ok) { setActionSuccess(t('dashboard.fedPolicyUpdated')); setTimeout(() => setActionSuccess(null), 3000); }
    else setActionError(res.error?.message || 'Failed to save');
  };

  const toggleScope = (scope) => {
    const next = defaultScopes.includes(scope) ? defaultScopes.filter(s => s !== scope) : [...defaultScopes, scope];
    setDefaultScopes(next);
    doSaveAuthPolicy(authPolicy, next);
  };

  // ── Network Directory state ──
  const [dirEntries, setDirEntries] = useState([]);
  const [dirSearch, setDirSearch] = useState('');
  const [dirLoading, setDirLoading] = useState(false);
  const dirDebounceRef = useRef(null);

  const loadDirectory = useCallback(async (keyword) => {
    setDirLoading(true);
    try {
      const r = await getNetworkDirectory(keyword || '');
      setDirEntries(r.data?.entries || []);
    } catch { setDirEntries([]); }
    finally { setDirLoading(false); }
  }, []);

  useEffect(() => { loadDirectory(''); }, []);

  useEffect(() => {
    const handler = () => loadDirectory(dirSearch);
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [dirSearch]);

  const onDirSearchInput = useCallback((e) => {
    const val = e.target.value;
    setDirSearch(val);
    if (dirDebounceRef.current) clearTimeout(dirDebounceRef.current);
    dirDebounceRef.current = setTimeout(() => loadDirectory(val), 400);
  }, [loadDirectory]);

  // ── Derived stats ──
  const activePeers = livePeers.filter(p => p.status === 'active');
  const degradedPeers = livePeers.filter(p => p.status === 'degraded');
  const offlinePeers = livePeers.filter(p => p.status === 'offline');
  const depeeringPeers = livePeers.filter(p => p.status === 'depeering');
  const pendingRequests = peeringRequests.filter(r => r.status === 'pending');
  const historyRequests = peeringRequests.filter(r => r.status !== 'pending');

  const { confirm, ConfirmUI } = useConfirm();

  function flash(msg) { setActionSuccess(msg); setActionError(null); setTimeout(() => setActionSuccess(null), 4000); }
  function flashErr(msg) { setActionError(msg); setActionSuccess(null); setTimeout(() => setActionError(null), 6000); }

  // ── Actions ──
  const doApprove = useCallback((id) => {
    confirm(t('dashboard.fedApprovePeerConfirm'), async () => {
      try { await approvePeeringRequest(id); flash(t('dashboard.fedPeerApproved')); reload(); }
      catch (e) { flashErr(e.message); }
    });
  }, [reload]);

  const doReject = useCallback((id) => {
    confirm(t('dashboard.fedRejectPeerConfirm'), async () => {
      try { await rejectPeeringRequest(id); flash(t('dashboard.fedPeerRejected')); reload(); }
      catch (e) { flashErr(e.message); }
    }, { danger: true });
  }, [reload]);

  const doDeleteRequest = useCallback((id) => {
    confirm(t('dashboard.fedDeleteRequestConfirm') || 'Delete this peering request?', async () => {
      try { await deletePeeringRequest(id); flash(t('dashboard.fedRequestDeleted') || 'Request deleted'); reload(); }
      catch (e) { flashErr(e.message); }
    }, { danger: true });
  }, [reload]);

  const doActivate = useCallback((nodeId) => {
    confirm(t('dashboard.fedActivateConfirm'), async () => {
      try { await activatePeer(nodeId); flash(t('dashboard.fedPeerActivated')); reload(); }
      catch (e) { flashErr(e.message); }
    });
  }, [reload]);

  const doRemove = useCallback((nodeId) => {
    confirm(t('dashboard.fedRemoveConfirm'), async () => {
      try { await removePeer(nodeId); flash(t('dashboard.fedPeerRemoved')); reload(); }
      catch (e) { flashErr(e.message); }
    }, { danger: true });
  }, [reload]);

  const doEmergencyRemove = useCallback((nodeId) => {
    confirm(t('dashboard.fedEmergencyRemoveConfirm'), async () => {
      try { await removePeerEmergency(nodeId); flash(t('dashboard.fedPeerEmergencyRemoved')); reload(); }
      catch (e) { flashErr(e.message); }
    }, { danger: true });
  }, [reload]);

  const doUpdatePolicy = useCallback(async (nodeId, field, value) => {
    try {
      await updatePeerPolicy(nodeId, { [field]: value });
      flash(t('dashboard.fedPolicyUpdated'));
      reload();
    } catch (e) { flashErr(e.message); }
  }, [reload]);

  const doTest = useCallback(async () => {
    if (!testUrl) return;
    setTesting(true); setTestResult(null);
    try { const r = await testFederationNode(testUrl); setTestResult(r.data || r); }
    catch (e) { setTestResult({ error: e.message }); }
    finally { setTesting(false); }
  }, [testUrl]);

  const doAddPeer = useCallback(async () => {
    if (!addNodeId || !addUrl) { flashErr(t('dashboard.fedAddPeerMissing')); return; }
    try { new URL(addUrl); } catch { flashErr(t('dashboard.fedInvalidUrl') || 'Invalid URL format'); return; }
    try { await addPeerDirect(addNodeId, addUrl, addKey); flash(t('dashboard.fedPeerAdded')); setAddNodeId(''); setAddUrl(''); setAddKey(''); reload(); }
    catch (e) { flashErr(e.message); }
  }, [addNodeId, addUrl, addKey, reload]);

  const doJoinGenesis = useCallback(async () => {
    if (!joinUrl) { flashErr(t('dashboard.fedJoinUrlRequired')); return; }
    setJoining(true); setJoinResult(null);
    try {
      const r = await joinGenesisNetwork(joinUrl, joinRole);
      if (r.data) {
        setJoinResult(r.data);
        flash(t('dashboard.fedJoinSent'));
      } else {
        flashErr(r.error?.message || 'Join failed');
      }
    } catch (e) { flashErr(e.message); }
    finally { setJoining(false); }
  }, [joinUrl, joinRole]);

  function statusBadge(status) {
    const map = { active: 'healthy', approved: 'info', pending: 'watch', degraded: 'watch', offline: 'critical', depeering: 'critical', rejected: 'critical' };
    return html`<${Badge} type=${map[status] || 'watch'} label=${status || 'unknown'} />`;
  }

  return html`
    <p class="adm-text-dim adm-mb-md" style="margin:0">${t('dashboard.federationExplain')}</p>

    <!-- ═══ How Federation Works ═══ -->
    <${ExpandableHelp} title=${t('dashboard.federationHelpTitle')}>
      <p>${t('dashboard.federationHelpDetail')}</p>
      <h5 style="margin:12px 0 6px">${t('dashboard.fedHowBusTitle')}</h5>
      <p>${t('dashboard.fedHowBusDetail')}</p>
      <h5 style="margin:12px 0 6px">${t('dashboard.fedHowJoinTitle')}</h5>
      <p>${t('dashboard.fedHowJoinDetail')}</p>
      <h5 style="margin:12px 0 6px">${t('dashboard.fedHowReplicationTitle')}</h5>
      <p>${t('dashboard.fedHowReplicationDetail')}</p>
      <h5 style="margin:12px 0 6px">${t('dashboard.fedHowSettlementsTitle')}</h5>
      <p>${t('dashboard.fedHowSettlementsDetail')}</p>
      <h5 style="margin:12px 0 6px">${t('dashboard.fedHowRoutingTitle')}</h5>
      <p>${t('dashboard.fedHowRoutingDetail')}</p>
    <//>

    ${actionError && html`<${ErrorBox} message=${actionError} />`}
    ${actionSuccess && html`<div class="adm-card adm-mb-md" style="border-left:3px solid #22c55e"><p style="color:#22c55e;margin:0">${actionSuccess}</p></div>`}

    <!-- ═══ Join Genesis Network ═══ -->
    ${!livePeers.length && html`
      <div class="adm-card adm-mb-lg" style="border-left:3px solid #8b5cf6">
        <h4 class="adm-mb-sm" style="margin:0">\u{1F91D} ${t('dashboard.fedJoinTitle')}</h4>
        <p class="adm-text-dim adm-text-base adm-mb-md" style="margin:0">${t('dashboard.fedJoinExplain')}</p>
        <${ExpandableHelp} title=${t('dashboard.fedJoinHelpTitle')}>
          <p>${t('dashboard.fedJoinHelpDetail')}</p>
        <//>
        <div class="adm-mb-sm" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center">
          <input class="input-field" placeholder=${t('dashboard.fedJoinUrlPlaceholder')} value=${joinUrl} onInput=${e => setJoinUrl(e.target.value)} />
          <select class="input-field" style="min-width:140px" value=${joinRole} onChange=${e => setJoinRole(e.target.value)}>
            <option value="contributor">${t('dashboard.fedJoinRoleContributor')}</option>
            <option value="operator">${t('dashboard.fedJoinRoleOperator')}</option>
          </select>
        </div>
        <button class="adm-btn" style="background:#8b5cf6" onClick=${doJoinGenesis} disabled=${joining}>
          ${joining ? '...' : t('dashboard.fedJoinBtn')}
        </button>
        ${joinResult && html`
          <div class="adm-card" style="margin-top:12px;background:var(--bg-card-inner, rgba(0,0,0,.15))">
            <${EconRow} label=${t('dashboard.fedJoinTargetNode')} value=${escHtml(joinResult.target_node_id || '\u2014')} />
            <${EconRow} label=${t('dashboard.fedJoinStatus')} value=${escHtml(joinResult.status || '\u2014')} />
            <${EconRow} label=${t('dashboard.fedJoinRequestId')} value=${escHtml(joinResult.request_id || '\u2014')} />
            <p class="adm-text-dim adm-text-base adm-mt-sm" style="margin:0">${escHtml(joinResult.message || '')}</p>
          </div>
        `}
      </div>
    `}

    <!-- ═══ Stats Overview ═══ -->
    <${StatsGrid} items=${[
      { label: t('dashboard.fedActivePeers'), value: activePeers.length, tone: 'green' },
      { label: t('dashboard.fedDegradedPeers'), value: degradedPeers.length, tone: 'amber' },
      { label: t('dashboard.fedOfflinePeers'), value: offlinePeers.length, tone: 'red' },
      { label: t('dashboard.fedPendingRequests'), value: pendingRequests.length, tone: 'cyan' },
    ]} />

    <!-- ═══ Federation Auth Policy ═══ -->
    <div class="adm-card adm-mt-lg">
      <h4 class="adm-mb-sm" style="margin:0">${t('dashboard.fedAuthPolicyTitle')}</h4>
      <p class="adm-text-dim adm-text-base adm-mb-md" style="margin:0">${t('dashboard.fedAuthPolicyDesc')}</p>
      ${authPolicyLoading ? html`<p class="adm-text-dim">...</p>` : html`
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <select class="adm-input" style="max-width:240px" value=${authPolicy} onChange=${(e) => { setAuthPolicy(e.target.value); doSaveAuthPolicy(e.target.value, defaultScopes); }}>
            <option value="disabled">${t('dashboard.fedAuthDisabled')}</option>
            <option value="all_peers">${t('dashboard.fedAuthAllPeers')}</option>
            <option value="specific_peers">${t('dashboard.fedAuthSpecificPeers')}</option>
          </select>
        </div>
        ${authPolicy !== 'disabled' && html`
          <div class="adm-mt-md">
            <p class="adm-text-sm adm-text-dim adm-mb-sm">${t('dashboard.fedDefaultScopes')}</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${['memory:read','memory:write','catalogue:read','social:read','social:write','work:request','boards:read','boards:write'].map(s => html`
                <label class="adm-text-sm"><input type="checkbox" checked=${defaultScopes.includes(s)} onChange=${() => toggleScope(s)} /> ${s}</label>
              `)}
            </div>
          </div>
        `}
      `}
    </div>

    <!-- ═══ Network Directory ═══ -->
    <div class="adm-card adm-mt-lg">
      <h4 class="adm-mb-sm" style="margin:0">${t('dashboard.fedNetworkDirectoryTitle')}</h4>
      <p class="adm-text-dim adm-text-base adm-mb-md" style="margin:0">${t('dashboard.fedNetworkDirectoryDesc')}</p>
      <div class="adm-mb-md">
        <input class="input-field" placeholder=${t('dashboard.fedNetworkDirSearch')} value=${dirSearch} onInput=${onDirSearchInput} />
      </div>
      ${dirLoading
        ? html`<p class="adm-text-dim">...</p>`
        : !dirEntries.length
          ? html`<${Empty} text=${t('dashboard.fedNetworkDirEmpty')} />`
          : html`<div class="scrollable"><table>
              <thead><tr>
                <th>${t('dashboard.fedNetworkDirType')}</th>
                <th>${t('dashboard.fedNetworkDirName')}</th>
                <th>${t('dashboard.fedNetworkDirNode')}</th>
                <th>${t('dashboard.fedNetworkDirCategory')}</th>
              </tr></thead>
              <tbody>
                ${dirEntries.map(e => html`<tr>
                  <td><${Badge} type=${e.type === 'action' ? 'info' : e.type === 'agent' ? 'healthy' : e.type === 'board' ? 'watch' : 'neutral'} label=${e.type} /></td>
                  <td>${escHtml(e.name || e.id || '—')}</td>
                  <td class="mono adm-text-sm">${escHtml(e.source_node || '—')}</td>
                  <td>${escHtml(e.category || e.service_type || '—')}</td>
                </tr>`)}
              </tbody>
            </table></div>`
      }
    </div>

    <!-- ═══ Pending Peering Requests ═══ -->
    ${pendingRequests.length > 0 && html`
      <div class="adm-card adm-mt-lg" style="border-left:3px solid #f59e0b">
        <h4 class="adm-mb-sm" style="margin:0">\u{1F514} ${t('dashboard.fedPendingRequestsTitle')}</h4>
        <p class="adm-text-dim adm-text-base adm-mb-md" style="margin:0">${t('dashboard.fedPendingRequestsExplain')}</p>
        <${ExpandableHelp} title=${t('dashboard.fedPendingHelpTitle')}>
          <p>${t('dashboard.fedPendingHelpDetail')}</p>
        <//>
        <div class="scrollable"><table>
          <thead><tr>
            <th>${t('dashboard.fedReqId')}</th>
            <th>${t('dashboard.fedFromNode')}</th>
            <th>${t('dashboard.endpoint')}</th>
            <th>${t('dashboard.fedMessage')}</th>
            <th>${t('dashboard.fedCreatedAt')}</th>
            <th>${t('dashboard.actions')}</th>
          </tr></thead>
          <tbody>
            ${pendingRequests.map(r => html`<tr>
              <td class="mono" style="font-size:.75rem">${escHtml(r.id)}</td>
              <td class="mono adm-text-sm">${escHtml(r.from_node_id || '\u2014')}</td>
              <td class="mono adm-text-sm">${escHtml(r.from_node_url || r.target_url || '\u2014')}</td>
              <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${escHtml(r.message || '\u2014')}</td>
              <td class="adm-text-dim">${dt(r.created_at)}</td>
              <td style="display:flex;gap:4px">
                <button class="adm-btn-sm" style="color:#22c55e" onClick=${() => doApprove(r.id)}>\u2714 ${t('dashboard.approve')}</button>
                <button class="adm-btn-sm adm-text-error" onClick=${() => doReject(r.id)}>\u2718 ${t('dashboard.fedReject')}</button>
              </td>
            </tr>`)}
          </tbody>
        </table></div>
      </div>
    `}

    <!-- ═══ Live Peers ═══ -->
    <div class="adm-card adm-mt-lg">
      <h4 class="adm-mb-sm" style="margin:0">\u{1F5A7} ${t('dashboard.fedLivePeersTitle')}</h4>
      <p class="adm-text-dim adm-text-base adm-mb-md" style="margin:0">${t('dashboard.fedLivePeersExplain')}</p>
      <${ExpandableHelp} title=${t('dashboard.fedLivePeersHelpTitle')}>
        <p>${t('dashboard.fedLivePeersHelpDetail')}</p>
      <//>
      ${!livePeers.length
        ? html`<${Empty} text=${t('dashboard.noFederationPeers')} />`
        : html`<div class="scrollable"><table>
          <thead><tr>
            <th>${t('dashboard.nodeId')}</th>
            <th>URL</th>
            <th>${t('dashboard.statusLabel')}</th>
            <th>${t('dashboard.fedAddedAt')}</th>
            <th>${t('dashboard.lastSeen')}</th>
            <th>${t('dashboard.fedPublicKey')}</th>
            <th>${t('dashboard.fedPolicySectionTitle')}</th>
            <th>${t('dashboard.actions')}</th>
          </tr></thead>
          <tbody>
            ${livePeers.map(p => html`<tr>
              <td class="mono adm-text-sm">${escHtml(p.node_id)}</td>
              <td class="mono adm-text-sm">${escHtml(p.url || '\u2014')}</td>
              <td>${statusBadge(p.status)}</td>
              <td class="adm-text-dim">${dt(p.added_at)}</td>
              <td class="adm-text-dim">${dt(p.last_seen)}</td>
              <td class="mono" style="font-size:.7rem;max-width:100px;overflow:hidden;text-overflow:ellipsis" title=${p.public_key || ''}>${p.public_key ? p.public_key.substring(0, 16) + '...' : '\u2014'}</td>
              <td>
                <label class="adm-text-sm"><input type="checkbox" checked=${p.share_catalogue !== false} onChange=${(e) => doUpdatePolicy(p.node_id, 'share_catalogue', e.target.checked)} /> ${t('dashboard.fedShareCatalogue')}</label>
                <label class="adm-text-sm"><input type="checkbox" checked=${p.replicate_memory !== false} onChange=${(e) => doUpdatePolicy(p.node_id, 'replicate_memory', e.target.checked)} /> ${t('dashboard.fedReplicateMemory')}</label>
                <label class="adm-text-sm"><input type="checkbox" checked=${p.allow_routing !== false} onChange=${(e) => doUpdatePolicy(p.node_id, 'allow_routing', e.target.checked)} /> ${t('dashboard.fedAllowRouting')}</label>
                <label class="adm-text-sm"><input type="checkbox" checked=${!!p.allow_federated_auth} onChange=${(e) => doUpdatePolicy(p.node_id, 'allow_federated_auth', e.target.checked)} /> ${t('dashboard.fedAllowAuth')}</label>
                <select class="adm-input" style="font-size:.75rem;padding:2px 4px;margin-top:4px" value=${p.peer_mode || 'federation'} onChange=${(e) => doUpdatePolicy(p.node_id, 'peer_mode', e.target.value)}>
                  <option value="federation">${t('dashboard.fedPeerModeFederation')}</option>
                  <option value="private">${t('dashboard.fedPeerModePrivate')}</option>
                </select>
              </td>
              <td style="display:flex;gap:4px;flex-wrap:wrap">
                ${p.status === 'approved' && html`
                  <button class="adm-btn-sm" onClick=${() => doActivate(p.node_id)}>\u25B6 ${t('dashboard.fedActivate')}</button>
                `}
                ${(p.status === 'active' || p.status === 'degraded') && html`
                  <button class="adm-btn-sm" onClick=${() => doRemove(p.node_id)}>${t('dashboard.fedDepeer')}</button>
                `}
                ${(p.status === 'active' || p.status === 'degraded' || p.status === 'offline' || p.status === 'depeering') && html`
                  <button class="adm-btn-sm adm-text-error" onClick=${() => doEmergencyRemove(p.node_id)}>\u26A0 ${t('dashboard.fedEmergencyDepeer')}</button>
                `}
              </td>
            </tr>`)}
          </tbody>
        </table></div>`
      }
    </div>

    <!-- ═══ Peering Request History ═══ -->
    ${historyRequests.length > 0 && html`
      <div class="adm-card adm-mt-lg">
        <h4 class="adm-mb-sm" style="margin:0">\u{1F4DC} ${t('dashboard.fedRequestHistoryTitle')}</h4>
        <div class="scrollable"><table>
          <thead><tr>
            <th>${t('dashboard.fedReqId')}</th>
            <th>${t('dashboard.fedFromNode')}</th>
            <th>${t('dashboard.endpoint')}</th>
            <th>${t('dashboard.statusLabel')}</th>
            <th>${t('dashboard.fedCreatedAt')}</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${historyRequests.map(r => html`<tr>
              <td class="mono" style="font-size:.75rem">${escHtml(r.id)}</td>
              <td class="mono adm-text-sm">${escHtml(r.from_node_id || '\u2014')}</td>
              <td class="mono adm-text-sm">${escHtml(r.from_node_url || r.target_url || '\u2014')}</td>
              <td>${statusBadge(r.status)}</td>
              <td class="adm-text-dim">${dt(r.created_at)}</td>
              <td><button class="adm-btn-sm adm-text-error" onClick=${() => doDeleteRequest(r.id)}>\u2718</button></td>
            </tr>`)}
          </tbody>
        </table></div>
      </div>
    `}

    <!-- ═══ Add Peer Directly ═══ -->
    <div class="adm-card adm-mt-lg">
      <h4 class="adm-mb-sm" style="margin:0">\u2795 ${t('dashboard.fedAddPeerTitle')}</h4>
      <p class="adm-text-dim adm-text-base adm-mb-md" style="margin:0">${t('dashboard.fedAddPeerExplain')}</p>
      <${ExpandableHelp} title=${t('dashboard.fedAddPeerHelpTitle')}>
        <p>${t('dashboard.fedAddPeerHelpDetail')}</p>
      <//>
      <div class="adm-mb-sm" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <input class="input-field" placeholder=${t('dashboard.fedAddNodeIdPlaceholder')} value=${addNodeId} onInput=${e => setAddNodeId(e.target.value)} />
        <input class="input-field" placeholder=${t('dashboard.fedAddUrlPlaceholder')} value=${addUrl} onInput=${e => setAddUrl(e.target.value)} />
      </div>
      <input class="input-field adm-mb-sm" placeholder=${t('dashboard.fedAddKeyPlaceholder')} value=${addKey} onInput=${e => setAddKey(e.target.value)} />
      <button class="adm-btn" onClick=${doAddPeer}>${t('dashboard.fedAddPeerBtn')}</button>
    </div>

    <!-- ═══ Test Federation Readiness ═══ -->
    <div class="adm-card adm-mt-lg">
      <h4 class="adm-mb-sm" style="margin:0">\u{1F50D} ${t('dashboard.fedTestTitle')}</h4>
      <p class="adm-text-dim adm-text-base adm-mb-md" style="margin:0">${t('dashboard.fedTestExplain')}</p>
      <${ExpandableHelp} title=${t('dashboard.fedTestHelpTitle')}>
        <p>${t('dashboard.fedTestHelpDetail')}</p>
      <//>
      <div class="adm-flex adm-mb-sm">
        <input class="input-field" style="flex:1" placeholder="https://other-node.example.com" value=${testUrl} onInput=${e => setTestUrl(e.target.value)} />
        <button class="adm-btn" onClick=${doTest} disabled=${testing}>${testing ? '...' : t('dashboard.fedTestBtn')}</button>
      </div>
      ${testResult && html`
        <div class="adm-card adm-mt-sm" style="background:var(--bg-card-inner, rgba(0,0,0,.15))">
          ${testResult.error
            ? html`<p class="adm-text-error">\u2718 ${escHtml(testResult.error)}</p>`
            : html`
              <${EconRow} label=${t('dashboard.fedTestTarget')} value=${escHtml(testResult.target_url || '\u2014')} />
              <${EconRow} label=${t('dashboard.fedTestReady')} value=${testResult.ready ? '\u2714 Yes' : '\u2718 No'} />
              ${testResult.checks && Object.entries(testResult.checks).map(([k, v]) => html`
                <${EconRow} label=${escHtml(k)} value=${v.passed ? '\u2714 ' + escHtml(v.detail) : '\u2718 ' + escHtml(v.detail)} />
              `)}
              <${EconRow} label=${t('dashboard.fedTestTime')} value=${dt(testResult.tested_at)} />
            `
          }
        </div>
      `}
    </div>

    <!-- ═══ Federation Bus — Features Overview ═══ -->
    <div class="adm-card adm-mt-lg">
      <h4 class="adm-mb-sm" style="margin:0">\u{1F680} ${t('dashboard.fedBusTitle')}</h4>
      <p class="adm-text-dim adm-text-base adm-mb-md" style="margin:0">${t('dashboard.fedBusExplain')}</p>

      <${ExpandableHelp} title=${t('dashboard.fedBusHeartbeatTitle')}>
        <p>${t('dashboard.fedBusHeartbeatDetail')}</p>
      <//>

      <${ExpandableHelp} title=${t('dashboard.fedBusReplicateTitle')}>
        <p>${t('dashboard.fedBusReplicateDetail')}</p>
      <//>

      <${ExpandableHelp} title=${t('dashboard.fedBusCatalogueTitle')}>
        <p>${t('dashboard.fedBusCatalogueDetail')}</p>
      <//>

      <${ExpandableHelp} title=${t('dashboard.fedBusRoutingTitle')}>
        <p>${t('dashboard.fedBusRoutingDetail')}</p>
      <//>

      <${ExpandableHelp} title=${t('dashboard.fedBusSettlementTitle')}>
        <p>${t('dashboard.fedBusSettlementDetail')}</p>
      <//>

      <${ExpandableHelp} title=${t('dashboard.fedBusTrustTitle')}>
        <p>${t('dashboard.fedBusTrustDetail')}</p>
      <//>

      <${ExpandableHelp} title=${t('dashboard.fedBusKeyExchangeTitle')}>
        <p>${t('dashboard.fedBusKeyExchangeDetail')}</p>
      <//>

      <${ExpandableHelp} title=${t('dashboard.fedBusCrossWorkTitle')}>
        <p>${t('dashboard.fedBusCrossWorkDetail')}</p>
      <//>

      <${ExpandableHelp} title=${t('dashboard.fedBusResolveTitle')}>
        <p>${t('dashboard.fedBusResolveDetail')}</p>
      <//>
    </div>

    <!-- ═══ API Reference ═══ -->
    <div class="adm-card adm-mt-lg">
      <h4 class="adm-mb-sm" style="margin:0">\u{1F4D6} ${t('dashboard.fedApiRefTitle')}</h4>
      <${ExpandableHelp} title=${t('dashboard.fedApiRefHelpTitle')}>
        <div class="adm-text-base" style="line-height:1.6">
          <p><strong>Peer Management</strong></p>
          <code style="display:block;margin:2px 0">GET  /v1/federation/directory</code>
          <code style="display:block;margin:2px 0">GET  /v1/federation/peers</code>
          <code style="display:block;margin:2px 0">POST /v1/federation/peers</code>
          <code style="display:block;margin:2px 0">PUT  /v1/federation/peers/:nodeId</code>
          <code style="display:block;margin:2px 0">DELETE /v1/federation/peers/:nodeId</code>
          <p class="adm-mt-sm"><strong>Peering Requests</strong></p>
          <code style="display:block;margin:2px 0">POST /v1/federation/peer/introduce</code>
          <code style="display:block;margin:2px 0">POST /v1/federation/peer/request</code>
          <code style="display:block;margin:2px 0">GET  /v1/admin/peering/requests</code>
          <code style="display:block;margin:2px 0">PUT  /v1/admin/peering/requests/:id</code>
          <p class="adm-mt-sm"><strong>Data Exchange</strong></p>
          <code style="display:block;margin:2px 0">POST /v1/federation/replicate</code>
          <code style="display:block;margin:2px 0">POST /v1/federation/catalogue-sync</code>
          <code style="display:block;margin:2px 0">POST /v1/federation/heartbeat</code>
          <code style="display:block;margin:2px 0">POST /v1/federation/ping</code>
          <p class="adm-mt-sm"><strong>Cross-Node Operations</strong></p>
          <code style="display:block;margin:2px 0">POST /v1/federation/route</code>
          <code style="display:block;margin:2px 0">POST /v1/federation/cross-node/work</code>
          <code style="display:block;margin:2px 0">GET  /v1/federation/resolve/:gaii</code>
          <p class="adm-mt-sm"><strong>Economy</strong></p>
          <code style="display:block;margin:2px 0">POST /v1/federation/settle</code>
          <code style="display:block;margin:2px 0">POST /v1/federation/settle/outbound</code>
          <p class="adm-mt-sm"><strong>Security</strong></p>
          <code style="display:block;margin:2px 0">POST /v1/federation/key-exchange</code>
          <code style="display:block;margin:2px 0">POST /v1/federation/trust-advisory</code>
          <code style="display:block;margin:2px 0">POST /v1/federation/test</code>
        </div>
      <//>
    </div>

    <!-- ═══ De-peering Info ═══ -->
    ${depeeringPeers.length > 0 && html`
      <div class="adm-card adm-mt-lg" style="border-left:3px solid #ef4444">
        <h4 class="adm-mb-sm" style="margin:0">\u26A0 ${t('dashboard.fedDepeeringTitle')}</h4>
        <p class="adm-text-dim adm-text-base adm-mb-md" style="margin:0">${t('dashboard.fedDepeeringExplain')}</p>
        ${depeeringPeers.map(p => html`
          <${EconRow} label=${escHtml(p.node_id)} value=${t('dashboard.fedDepeeringGrace') + ': ' + (p.depeer_grace_end ? dt(p.depeer_grace_end) : '\u2014')} />
        `)}
      </div>
    `}
    <${ConfirmUI} />
  `;
}
