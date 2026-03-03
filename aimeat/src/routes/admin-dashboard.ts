import { createT, type Locale, type TFunction } from '../i18n.js';

/** Build the full translations object used by the admin dashboard client-side JS. */
export function buildDashboardTranslations(t: TFunction): Record<string, string> {
    return {
        title: t('dashboard.title'),
        overview: t('dashboard.overview'), owners: t('dashboard.owners'), agents: t('dashboard.agents'),
        actions: t('dashboard.actions'), boards: t('dashboard.boards'), work: t('dashboard.work'),
        economy: t('dashboard.economy'), federation: t('dashboard.federation'), hooks: t('dashboard.hooks'),
        maintenance: t('dashboard.maintenance'), config: t('dashboard.config'), refresh: t('dashboard.refresh'),
        logout: t('dashboard.logout'), loading: t('dashboard.loading'), login: t('dashboard.login'),
        signingIn: t('dashboard.signingIn'), loginFailed: t('dashboard.loginFailed'),
        usernamePasswordRequired: t('dashboard.usernamePasswordRequired'),
        nodeHealth: t('dashboard.nodeHealth'), economyToday: t('dashboard.economyToday'),
        quickConfig: t('dashboard.quickConfig'), noOwnersFound: t('dashboard.noOwnersFound'),
        noAgentsRegistered: t('dashboard.noAgentsRegistered'), noActionsPublished: t('dashboard.noActionsPublished'),
        noBoardsCreated: t('dashboard.noBoardsCreated'), noWorkContracts: t('dashboard.noWorkContracts'),
        noFederationPeers: t('dashboard.noFederationPeers'),
        name: t('dashboard.name'), displayName: t('dashboard.displayName'), roles: t('dashboard.roles'),
        created: t('dashboard.created'), trust: t('dashboard.trust'), morsels: t('dashboard.totalMorsels'),
        lastSeen: t('dashboard.lastSeen'), details: t('dashboard.details'), hide: t('dashboard.hide'),
        grantOperator: t('dashboard.grantOperator'), gaii: t('dashboard.gaii'), amount: t('dashboard.amount'),
        morselSupply: t('dashboard.morselSupply'), todayActivity: t('dashboard.todayActivity'),
        morselPolicy: t('dashboard.morselPolicy'), mintMorsels: t('dashboard.mintMorsels'), mint: t('dashboard.mint'),
        maintenanceMode: t('dashboard.maintenanceMode'), operational: t('dashboard.operational'),
        maintenanceOn: t('dashboard.maintenanceOn'), backupRestore: t('dashboard.backupRestore'),
        downloadBackup: t('dashboard.downloadBackup'), restoreFromFile: t('dashboard.restoreFromFile'),
        extensionHooks: t('dashboard.extensionHooks'), nodeSettings: t('dashboard.nodeSettings'),
        configApi: t('dashboard.configApi'), peeringRequests: t('dashboard.peeringRequests'),
        federationInfo: t('dashboard.federationInfo'), trackingCode: t('dashboard.trackingCode'),
        status: t('dashboard.status'), action: t('dashboard.action'), requester: t('dashboard.requester'),
        provider: t('dashboard.provider'), cost: t('dashboard.cost'), id: t('dashboard.id'),
        category: t('dashboard.category'), tags: t('dashboard.tags'), baseCost: t('dashboard.baseCost'),
        fromNode: t('dashboard.fromNode'), url: t('dashboard.url'), message: t('dashboard.message'),
        loadPosts: t('dashboard.loadPosts'), clear: t('dashboard.clear'),
        uptime: t('dashboard.uptime'), storage: t('dashboard.storage'),
        active24h: t('dashboard.active24h'), inCirculation: t('dashboard.inCirculation'),
        transactionsToday: t('dashboard.transactionsToday'), morselsMovedToday: t('dashboard.morselsMovedToday'),
        burnedToday: t('dashboard.burnedToday'), port: t('dashboard.port'), jwtTtl: t('dashboard.jwtTtl'),
        keyedBrowse: t('dashboard.keyedBrowse'), welcomeBonus: t('dashboard.welcomeBonus'),
        enabled: t('dashboard.enabled'), disabled: t('dashboard.disabled'),
        warnings: t('dashboard.warnings'), noData: t('dashboard.noData'),
        failedToLoad: t('dashboard.failedToLoad'),
        registeredOwners: t('dashboard.registeredOwners'), registeredAgents: t('dashboard.registeredAgents'),
        publishedActions: t('dashboard.publishedActions'), activeBoards: t('dashboard.activeBoards'),
        chatInstances: t('dashboard.chatInstances'), activeChatSessions: t('dashboard.activeChatSessions'), noChatInstances: t('dashboard.noChatInstances'),
        healthBurnMintRatio: t('dashboard.healthBurnMintRatio'), healthAgentChurn: t('dashboard.healthAgentChurn'),
        healthWorkExpiry: t('dashboard.healthWorkExpiry'), healthDisputeRate: t('dashboard.healthDisputeRate'),
        metric: t('dashboard.metric'), value: t('dashboard.value'), zone: t('dashboard.zone'), threshold: t('dashboard.threshold'),
        totalMintedAllTime: t('dashboard.totalMintedAllTime'), totalBurnedAllTime: t('dashboard.totalBurnedAllTime'),
        inflationRate30d: t('dashboard.inflationRate30d'), burnMintRatio: t('dashboard.burnMintRatio'),
        networkFees: t('dashboard.networkFees'), burned: t('dashboard.burned'),
        dailyAllowancesIssued: t('dashboard.dailyAllowancesIssued'), dailyAllowance: t('dashboard.dailyAllowance'),
        allowanceCap: t('dashboard.allowanceCap'), burnRate: t('dashboard.burnRate'),
        maxOperatorMint: t('dashboard.maxOperatorMint'), morselUnit: t('dashboard.morselUnit'),
        mintGaiiRequired: t('dashboard.mintGaiiRequired'), mintedSuccess: t('dashboard.mintedSuccess'),
        issueToAgent: t('dashboard.issueToAgent'),
        customMessage: t('dashboard.customMessage'), customMessagePlaceholder: t('dashboard.customMessagePlaceholder'),
        disableMaintenance: t('dashboard.disableMaintenance'), enableMaintenance: t('dashboard.enableMaintenance'),
        maintenanceExplain: t('dashboard.maintenanceExplain'), since: t('dashboard.since'), by: t('dashboard.by'),
        backupExplain: t('dashboard.backupExplain'), backupDownloaded: t('dashboard.backupDownloaded'),
        restoreConfirm: t('dashboard.restoreConfirm'), dataRestored: t('dashboard.dataRestored'),
        maxRelayHops: t('dashboard.maxRelayHops'), federationPeerExplain: t('dashboard.federationPeerExplain'),
        hooksExplain: t('dashboard.hooksExplain'), hook: t('dashboard.hook'),
        boundActions: t('dashboard.boundActions'), noneLabel: t('dashboard.noneLabel'),
        clearHookConfirm: t('dashboard.clearHookConfirm'),
        configNotAvailable: t('dashboard.configNotAvailable'), pendingChanges: t('dashboard.pendingChanges'),
        saveChanges: t('dashboard.saveChanges'), cancelLabel: t('dashboard.cancelLabel'),
        readOnly: t('dashboard.readOnly'), yesLabel: t('dashboard.yesLabel'), noLabel: t('dashboard.noLabel'),
        noChanges: t('dashboard.noChanges'), savedChanges: t('dashboard.savedChanges'),
        topPlatform: t('dashboard.topPlatform'), platform: t('dashboard.platform'), owner: t('dashboard.owner'),
        totalGhiiUsers: t('dashboard.totalGhiiUsers'), totpEnabled: t('dashboard.totpEnabled'),
        verifiedL2: t('dashboard.verifiedL2'), noGhiiUsers: t('dashboard.noGhiiUsers'),
        verification: t('dashboard.verification'), totp: t('dashboard.totp'),
        deleteLabel: t('dashboard.deleteLabel'), deleteGhiiConfirm: t('dashboard.deleteGhiiConfirm'),
        emailNotAvailable: t('dashboard.emailNotAvailable'), smtpHost: t('dashboard.smtpHost'),
        smtpPort: t('dashboard.smtpPort'), notConfigured: t('dashboard.notConfigured'),
        confirmationRequired: t('dashboard.confirmationRequired'), smtpConfig: t('dashboard.smtpConfig'),
        fromAddress: t('dashboard.fromAddress'), secureTls: t('dashboard.secureTls'),
        smtpUser: t('dashboard.smtpUser'), smtpPassword: t('dashboard.smtpPassword'),
        configured: t('dashboard.configured'), notSet: t('dashboard.notSet'),
        sendTestEmail: t('dashboard.sendTestEmail'), sendTest: t('dashboard.sendTest'),
        testEmailSent: t('dashboard.testEmailSent'), enterEmail: t('dashboard.enterEmail'),
        totalIndexed: t('dashboard.totalIndexed'), totalInterests: t('dashboard.totalInterests'),
        totalCities: t('dashboard.totalCities'), directoryIndex: t('dashboard.directoryIndex'),
        rebuildIndex: t('dashboard.rebuildIndex'), directoryNotAvailable: t('dashboard.directoryNotAvailable'),
        indexRebuilt: t('dashboard.indexRebuilt'),
        interval: t('dashboard.interval'), maxSuggestions: t('dashboard.maxSuggestions'),
        maxDistance: t('dashboard.maxDistance'), cooldown: t('dashboard.cooldown'),
        daysUnit: t('dashboard.daysUnit'), runMatchingRound: t('dashboard.runMatchingRound'),
        triggerMatching: t('dashboard.triggerMatching'), matchingNotAvailable: t('dashboard.matchingNotAvailable'),
        matchingComplete: t('dashboard.matchingComplete'),
        totalListings: t('dashboard.totalListings'), listingFee: t('dashboard.listingFee'),
        txFee: t('dashboard.txFee'), recentListings: t('dashboard.recentListings'),
        titleLabel: t('dashboard.titleLabel'), price: t('dashboard.price'), seller: t('dashboard.seller'),
        marketplaceNotAvailable: t('dashboard.marketplaceNotAvailable'), escrowEnabled: t('dashboard.escrowEnabled'),
        vapidKeys: t('dashboard.vapidKeys'), missing: t('dashboard.missing'),
        totalSubscriptions: t('dashboard.totalSubscriptions'), lastUsed: t('dashboard.lastUsed'),
        pushNotAvailable: t('dashboard.pushNotAvailable'),
        totalTemplates: t('dashboard.totalTemplates'), noCsmTemplates: t('dashboard.noCsmTemplates'),
        serviceType: t('dashboard.serviceType'), registeredBy: t('dashboard.registeredBy'),
        federate: t('dashboard.federate'), registered: t('dashboard.registered'), updated: t('dashboard.updated'),
        csmNotAvailable: t('dashboard.csmNotAvailable'),
        totalPeers: t('dashboard.totalPeers'), active: t('dashboard.active'),
        pending: t('dashboard.pending'), suspended: t('dashboard.suspended'),
        federatedUsers: t('dashboard.federatedUsers'), federatedListings: t('dashboard.federatedListings'),
        noGenesisPeers: t('dashboard.noGenesisPeers'), lastSync: t('dashboard.lastSync'),
        approve: t('dashboard.approve'), suspend: t('dashboard.suspend'), remove: t('dashboard.remove'),
        genesisNotAvailable: t('dashboard.genesisNotAvailable'), removeConfirm: t('dashboard.removeConfirm'),
        noDescription: t('dashboard.noDescription'), author: t('dashboard.author'), untitled: t('dashboard.untitled'),
        capabilities: t('dashboard.capabilities'), trustDetails: t('dashboard.trustDetails'),
        score: t('dashboard.score'), deliveries: t('dashboard.deliveries'),
        successRate: t('dashboard.successRate'), avgDeliveryTime: t('dashboard.avgDeliveryTime'),
        ratings: t('dashboard.ratings'), age: t('dashboard.age'),
        home: t('dashboard.home'), grantConfirm: t('dashboard.grantConfirm'),
        errorLabel: t('dashboard.errorLabel'), networkError: t('dashboard.networkError'),
        ghiiLabel: t('dashboard.ghii'), emailLabel: t('dashboard.email'),
        directoryLabel: t('dashboard.directory'), matchingLabel: t('dashboard.matching'),
        marketplaceLabel: t('dashboard.marketplace'), pushLabel: t('dashboard.push'),
        csmLabel: t('dashboard.csm'), genesisLabel: t('dashboard.genesis'),
        language: t('dashboard.language'),
    };
}

// ── Admin Dashboard HTML ──
export function buildDashboardHtml(locale: Locale): string {
    const t = createT(locale);
    return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>${t('dashboard.title')}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#94a3b8;
--green:#22c55e;--yellow:#eab308;--red:#ef4444;--blue:#3b82f6;--purple:#a855f7;
--cyan:#06b6d4;--font:system-ui,-apple-system,sans-serif}
body{background:var(--bg);color:var(--text);font-family:var(--font);padding:0;min-height:100vh}
h1{font-size:1.4rem;font-weight:700;margin-bottom:0}
.layout{display:flex;min-height:100vh}
/* Sidebar */
.sidebar{width:220px;background:#0c1222;border-right:1px solid var(--border);padding:16px 0;flex-shrink:0;position:sticky;top:0;height:100vh;overflow-y:auto}
.sidebar h1{padding:0 16px;margin-bottom:16px;font-size:1.1rem}
.sidebar .node-id{padding:0 16px;color:var(--muted);font-size:.7rem;margin-bottom:16px;word-break:break-all}
.nav-item{display:flex;align-items:center;gap:10px;padding:10px 16px;color:var(--muted);font-size:.85rem;cursor:pointer;border:none;background:none;width:100%;text-align:left;font-family:inherit;transition:all .1s}
.nav-item:hover{background:#1e293b;color:var(--text)}
.nav-item.active{background:#1e293b;color:var(--cyan);border-left:3px solid var(--cyan);padding-left:13px}
.nav-item .icon{font-size:1rem;width:20px;text-align:center}
.nav-item .label{flex:1}
.nav-item .count{background:var(--border);color:var(--muted);font-size:.7rem;padding:2px 7px;border-radius:10px}
.nav-sep{height:1px;background:var(--border);margin:8px 16px}
/* Main */
.main{flex:1;padding:20px 28px;overflow-y:auto}
.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px}
.topbar-right{display:flex;align-items:center;gap:12px}
.refresh{background:var(--blue);color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600}
.refresh:hover{opacity:.85}
.refresh:disabled{opacity:.5;cursor:not-allowed}
#lastUpdate{color:var(--muted);font-size:.7rem}
/* Cards */
.grid{display:grid;gap:16px;margin-bottom:20px}
.grid-4{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
.grid-2{grid-template-columns:repeat(auto-fit,minmax(340px,1fr))}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px}
.card h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:10px}
.stat{font-size:1.8rem;font-weight:700;line-height:1.1}
.stat-label{color:var(--muted);font-size:.75rem;margin-top:2px}
.badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:.7rem;font-weight:600;text-transform:uppercase}
.badge-healthy{background:#16a34a22;color:var(--green);border:1px solid #16a34a55}
.badge-watch{background:#ca8a0422;color:var(--yellow);border:1px solid #ca8a0455}
.badge-danger{background:#dc262622;color:var(--red);border:1px solid #dc262655}
.badge-info{background:#3b82f622;color:var(--blue);border:1px solid #3b82f655}
.badge-private{background:#a855f722;color:var(--purple);border:1px solid #a855f755}
.badge-public{background:#16a34a22;color:var(--green);border:1px solid #16a34a55}
.badge-pending{background:#ca8a0422;color:var(--yellow);border:1px solid #ca8a0455}
.badge-accepted,.badge-in_progress{background:#3b82f622;color:var(--blue);border:1px solid #3b82f655}
.badge-delivered,.badge-settled{background:#16a34a22;color:var(--green);border:1px solid #16a34a55}
.badge-cancelled,.badge-expired,.badge-disputed{background:#dc262622;color:var(--red);border:1px solid #dc262655}
.health-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)}
.health-row:last-child{border-bottom:none}
.health-metric{font-size:.85rem}
.health-value{font-family:'SF Mono',Consolas,monospace;font-size:.85rem;color:var(--cyan)}
table{width:100%;border-collapse:collapse;font-size:.82rem}
th{text-align:left;color:var(--muted);font-weight:600;padding:8px 10px;border-bottom:2px solid var(--border);white-space:nowrap}
td{padding:8px 10px;border-bottom:1px solid var(--border)}
tr:hover td{background:#ffffff06}
.econ-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)}
.econ-row:last-child{border-bottom:none}
.econ-label{color:var(--muted);font-size:.85rem}
.econ-val{font-family:'SF Mono',Consolas,monospace;font-size:.85rem;color:var(--text)}
.mono{font-family:'SF Mono',Consolas,monospace;font-size:.78rem}
.loading{text-align:center;padding:40px;color:var(--muted)}
.error-box{background:#dc262622;border:1px solid var(--red);border-radius:8px;padding:16px;color:var(--red);margin:20px 0}
.empty{color:var(--muted);text-align:center;padding:24px;font-size:.85rem}
.detail-row{padding:8px 0;border-bottom:1px solid var(--border);font-size:.85rem}
.detail-row:last-child{border-bottom:none}
.detail-label{color:var(--muted);min-width:140px;display:inline-block}
.expand-btn{background:none;border:1px solid var(--border);color:var(--cyan);padding:3px 10px;border-radius:4px;cursor:pointer;font-size:.75rem;font-family:inherit}
.expand-btn:hover{background:var(--border)}
.sub-panel{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:12px;margin-top:8px;font-size:.8rem}
.page-title{font-size:1.1rem;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:10px}
.page-title .icon{font-size:1.2rem}
.tag{display:inline-block;background:var(--border);color:var(--muted);padding:1px 6px;border-radius:4px;font-size:.7rem;margin:1px}
.scrollable{max-height:600px;overflow-y:auto}
@media(max-width:768px){.sidebar{display:none}.main{padding:12px}}
.hidden{display:none}
</style>
</head>
<body>
<div class="layout">
<nav class="sidebar">
  <h1>&#x2764;&#xFE0F; AIMEAT</h1>
  <div class="node-id" id="sideNodeId"></div>
  <button class="nav-item active" onclick="nav('overview')"><span class="icon">&#x1F4CA;</span><span class="label">${t('dashboard.overview')}</span></button>
  <button class="nav-item" onclick="nav('owners')"><span class="icon">&#x1F464;</span><span class="label">${t('dashboard.owners')}</span><span class="count" id="cntOwners">0</span></button>
  <button class="nav-item" onclick="nav('agents')"><span class="icon">&#x1F916;</span><span class="label">${t('dashboard.agents')}</span><span class="count" id="cntAgents">0</span></button>
  <button class="nav-item" onclick="nav('actions')"><span class="icon">&#x26A1;</span><span class="label">${t('dashboard.actions')}</span><span class="count" id="cntActions">0</span></button>
  <button class="nav-item" onclick="nav('boards')"><span class="icon">&#x1F4CB;</span><span class="label">${t('dashboard.boards')}</span><span class="count" id="cntBoards">0</span></button>
  <button class="nav-item" onclick="nav('chatInstances')"><span class="icon">&#x1F4AC;</span><span class="label">${t('dashboard.chatInstances')}</span><span class="count" id="cntChatInstances">0</span></button>
  <button class="nav-item" onclick="nav('work')"><span class="icon">&#x1F4E6;</span><span class="label">${t('dashboard.work')}</span><span class="count" id="cntWork">0</span></button>
  <div class="nav-sep"></div>
  <button class="nav-item" onclick="nav('economy')"><span class="icon">&#x1FA99;</span><span class="label">${t('dashboard.economy')}</span></button>
  <button class="nav-item" onclick="nav('federation')"><span class="icon">&#x1F310;</span><span class="label">${t('dashboard.federation')}</span><span class="count" id="cntPeers">0</span></button>
  <button class="nav-item" onclick="nav('hooks')"><span class="icon">&#x1F517;</span><span class="label">${t('dashboard.hooks')}</span></button>
  <button class="nav-item" onclick="nav('maintenance')"><span class="icon">&#x1F6A7;</span><span class="label">${t('dashboard.maintenance')}</span></button>
  <button class="nav-item" onclick="nav('config')"><span class="icon">&#x2699;</span><span class="label">${t('dashboard.config')}</span></button>
  <div class="nav-sep"></div>
  <button class="nav-item" onclick="nav('ghii')"><span class="icon">&#x1F511;</span><span class="label">${t('dashboard.ghii')}</span><span class="count" id="cntGhii">0</span></button>
  <button class="nav-item" onclick="nav('email')"><span class="icon">&#x2709;</span><span class="label">${t('dashboard.email')}</span></button>
  <button class="nav-item" onclick="nav('directory')"><span class="icon">&#x1F4D6;</span><span class="label">${t('dashboard.directory')}</span></button>
  <button class="nav-item" onclick="nav('matching')"><span class="icon">&#x1F91D;</span><span class="label">${t('dashboard.matching')}</span></button>
  <button class="nav-item" onclick="nav('marketplace')"><span class="icon">&#x1F6D2;</span><span class="label">${t('dashboard.marketplace')}</span></button>
  <button class="nav-item" onclick="nav('push')"><span class="icon">&#x1F514;</span><span class="label">${t('dashboard.push')}</span></button>
  <button class="nav-item" onclick="nav('csm')"><span class="icon">&#x1F4E6;</span><span class="label">${t('dashboard.csm')}</span></button>
  <button class="nav-item" onclick="nav('genesis')"><span class="icon">&#x1F30D;</span><span class="label">${t('dashboard.genesis')}</span><span class="count" id="cntGenesis">0</span></button>
</nav>
<div class="main">
  <div class="topbar">
    <div id="pageTitle" class="page-title"><span class="icon">&#x1F4CA;</span> ${t('dashboard.overview')}</div>
    <div class="topbar-right">
      <span id="langLabel" style="font-size:.75rem;color:var(--muted);margin-right:4px">${t('dashboard.language')}:</span>
      <span data-lang="en" onclick="switchLang('en')" style="cursor:pointer;color:${'en' === locale ? 'var(--cyan)' : 'var(--muted)'};font-size:.8rem;font-weight:${'en' === locale ? '700' : '400'};margin-right:4px">EN</span>
      <span data-lang="fi" onclick="switchLang('fi')" style="cursor:pointer;color:${'fi' === locale ? 'var(--cyan)' : 'var(--muted)'};font-size:.8rem;font-weight:${'fi' === locale ? '700' : '400'};margin-right:12px">FI</span>
      <button class="refresh" id="btnRefresh" onclick="loadAll()">${t('dashboard.refresh')}</button>
      <button class="refresh" id="btnLogout" style="background:var(--border);color:var(--muted)" onclick="localStorage.removeItem('aimeat_token');TOKEN='';showLoginForm()">${t('dashboard.logout')}</button>
      <span id="lastUpdate"></span>
    </div>
  </div>
  <div id="app"><div class="loading">${t('dashboard.loading')}</div></div>
  <!-- Login form (shown when no valid token) -->
  <div id="loginForm" class="hidden" style="max-width:420px;margin:60px auto">
    <div class="card" style="border-radius:10px;text-align:center">
      <h2 style="font-size:1.2rem;color:var(--text);text-transform:none;letter-spacing:0;margin-bottom:4px">${t('dashboard.loginTitle')}</h2>
      <p style="color:var(--muted);font-size:.85rem;margin-bottom:16px">${t('dashboard.loginDesc')}</p>
      <div id="dashLoginPw">
        <input type="text" id="dashUser" placeholder="${t('dashboard.username')}" autocomplete="username" style="margin-bottom:8px"/>
        <input type="password" id="dashPass" placeholder="${t('dashboard.password')}" autocomplete="current-password" style="margin-bottom:4px"/>
        <button class="refresh" style="width:100%;padding:10px;font-size:.9rem;margin-top:8px" id="btnDashLogin" onclick="dashLogin()">${t('dashboard.login')}</button>
        <p style="color:var(--muted);font-size:.72rem;margin-top:10px"><a href="#" onclick="event.preventDefault();document.getElementById('dashLoginPw').classList.add('hidden');document.getElementById('dashLoginKey').classList.remove('hidden')" style="color:var(--cyan)">${t('dashboard.advancedKeyLogin')}</a></p>
      </div>
      <div id="dashLoginKey" class="hidden">
        <input type="text" id="dashKeyOwner" placeholder="${t('dashboard.ownerName')}" autocomplete="off" style="margin-bottom:8px"/>
        <textarea id="dashKeyPk" placeholder="${t('dashboard.privateKey')}" rows="3" style="width:100%;padding:10px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.85rem;resize:vertical;font-family:monospace;margin-bottom:4px"></textarea>
        <button class="refresh" style="width:100%;padding:10px;font-size:.9rem;margin-top:8px" onclick="dashKeyLogin()">${t('dashboard.loginWithKey')}</button>
        <p style="color:var(--muted);font-size:.72rem;margin-top:10px"><a href="#" onclick="event.preventDefault();document.getElementById('dashLoginKey').classList.add('hidden');document.getElementById('dashLoginPw').classList.remove('hidden')" style="color:var(--cyan)">${t('dashboard.backToPassword')}</a></p>
      </div>
      <div id="dashLoginErr" class="hidden" style="margin-top:10px;padding:8px;border-radius:6px;background:#dc262618;border:1px solid #dc262655;color:var(--red);font-size:.85rem"></div>
    </div>
  </div>
</div>
</div>
<script>
let TOKEN=new URLSearchParams(location.search).get('token')||localStorage.getItem('aimeat_token')||'';
if(TOKEN)localStorage.setItem('aimeat_token',TOKEN);

let D={};// cached data
let currentPage='overview';
var __t=${JSON.stringify(buildDashboardTranslations(t))};

async function api(path,opts){
  const h=opts&&opts.headers?Object.assign({},opts.headers):{};
  if(TOKEN)h['Authorization']='Bearer '+TOKEN;
  if(opts&&opts.body)h['Content-Type']='application/json';
  const r=await fetch(path,{method:(opts&&opts.method)||'GET',headers:h,body:opts&&opts.body?JSON.stringify(opts.body):undefined});
  if(r.status===401){showLoginForm();throw new Error('Unauthorized');}
  if(!r.ok)throw new Error(r.status+' '+r.statusText);
  return r.json();
}

async function switchLang(lang){
  try{
    var r=await fetch('/v1/admin/translations?lang='+lang);
    var j=await r.json();
    if(j.ok&&j.translations){
      __t=j.translations;
      document.cookie='aimeat-lang='+lang+';path=/;max-age=31536000';
      document.documentElement.lang=lang;
      if(__t.title)document.title=__t.title;
      var ll=document.getElementById('langLabel');
      if(ll&&__t.language)ll.textContent=__t.language+':';
      var lo=document.getElementById('btnLogout');
      if(lo&&__t.logout)lo.textContent=__t.logout;
      var rf=document.getElementById('btnRefresh');
      if(rf&&!rf.disabled&&__t.refresh)rf.textContent=__t.refresh;
      updateSidebarLabels();
      nav(currentPage);
      updateLangIndicator(lang);
    }else{
      location.href='?lang='+lang;
    }
  }catch(e){
    location.href='?lang='+lang;
  }
}
function updateSidebarLabels(){
  var btns=document.querySelectorAll('.nav-item');
  var keys=['overview','owners','agents','actions','boards','chatInstances','work','economy','federation','hooks','maintenance','config','ghiiLabel','emailLabel','directoryLabel','matchingLabel','marketplaceLabel','pushLabel','csmLabel','genesisLabel'];
  for(var i=0;i<btns.length&&i<keys.length;i++){
    var lbl=btns[i].querySelector('.label');
    if(lbl&&__t[keys[i]])lbl.textContent=__t[keys[i]];
  }
}
function updateLangIndicator(lang){
  document.querySelectorAll('[data-lang]').forEach(function(el){
    if(el.getAttribute('data-lang')===lang){
      el.style.color='var(--cyan)';el.style.fontWeight='700';
    }else{
      el.style.color='var(--muted)';el.style.fontWeight='400';
    }
  });
}

function showLoginForm(){
  document.querySelector('.layout').style.display='none';
  document.getElementById('loginForm').classList.remove('hidden');
}
function hideLoginForm(){
  document.querySelector('.layout').style.display='flex';
  document.getElementById('loginForm').classList.add('hidden');
}

async function dashLogin(){
  var user=document.getElementById('dashUser').value.trim();
  var pass=document.getElementById('dashPass').value;
  if(!user||!pass){document.getElementById('dashLoginErr').textContent=__t.usernamePasswordRequired;document.getElementById('dashLoginErr').classList.remove('hidden');return;}
  document.getElementById('btnDashLogin').disabled=true;document.getElementById('btnDashLogin').textContent=__t.signingIn;
  try{
    var r=await fetch('/v1/ghii/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user,password:pass})});
    var j=await r.json();
    if(!r.ok||!j.data||!j.data.token){document.getElementById('dashLoginErr').textContent=(j.error&&j.error.message)||j.message||__t.loginFailed;document.getElementById('dashLoginErr').classList.remove('hidden');document.getElementById('btnDashLogin').disabled=false;document.getElementById('btnDashLogin').textContent=__t.login;return;}
    TOKEN=j.data.token;localStorage.setItem('aimeat_token',TOKEN);
    hideLoginForm();loadAll();
  }catch(e){document.getElementById('dashLoginErr').textContent=__t.networkError+': '+e.message;document.getElementById('dashLoginErr').classList.remove('hidden');}
  document.getElementById('btnDashLogin').disabled=false;document.getElementById('btnDashLogin').textContent=__t.login;
}

async function dashKeyLogin(){
  var owner=document.getElementById('dashKeyOwner').value.trim();
  var pk=document.getElementById('dashKeyPk').value.trim();
  if(!owner||!pk)return;
  try{
    var r=await fetch('/v1/admin/setup/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:owner,private_key:pk})});
    var j=await r.json();
    if(!j.ok||!j.token){document.getElementById('dashLoginErr').textContent=(j.error&&j.error.message)||j.message||__t.loginFailed;document.getElementById('dashLoginErr').classList.remove('hidden');return;}
    TOKEN=j.token;localStorage.setItem('aimeat_token',TOKEN);
    hideLoginForm();loadAll();
  }catch(e){document.getElementById('dashLoginErr').textContent=__t.errorLabel+': '+e.message;document.getElementById('dashLoginErr').classList.remove('hidden');}
}

function esc(s){const d=document.createElement('div');d.textContent=String(s??'');return d.innerHTML}
function badge(z){return '<span class="badge badge-'+z+'">'+z+'</span>'}
function num(n){return typeof n==='number'?n.toLocaleString():String(n??'\\u2014')}
function dt(s){return s?new Date(s).toLocaleString():'\\u2014'}
function sc(l,v,sub,col){return '<div class="card"><h2>'+l+'</h2><div class="stat" style="color:'+col+'">'+num(v)+'</div>'+(sub?'<div class="stat-label">'+sub+'</div>':'')+'</div>'}
function er(l,v){return '<div class="econ-row"><span class="econ-label">'+l+'</span><span class="econ-val">'+v+'</span></div>'}
function hRow(l,obj){return '<div class="health-row"><span class="health-metric">'+l+'</span><span>'+badge(obj.zone)+' <span class="health-value">'+obj.value+'</span></span></div>'}
function fmtUp(s){var d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);return (d?d+'d ':'')+(h?h+'h ':'')+(m?m+'m':'<1m')}

function nav(page){
  currentPage=page;
  document.querySelectorAll('.nav-item').forEach(function(b){b.classList.remove('active')});
  var btns=document.querySelectorAll('.nav-item');
  var pages=['overview','owners','agents','actions','boards','chatInstances','work','economy','federation','hooks','maintenance','config','ghii','email','directory','matching','marketplace','push','csm','genesis'];
  for(var i=0;i<btns.length;i++){if(pages[i]===page)btns[i].classList.add('active')}
  var titles={overview:'\\u{1F4CA} '+__t.overview,owners:'\\u{1F464} '+__t.owners,agents:'\\u{1F916} '+__t.agents,actions:'\\u26A1 '+__t.actions,boards:'\\u{1F4CB} '+__t.boards,chatInstances:'\\u{1F4AC} '+__t.chatInstances,work:'\\u{1F4E6} '+__t.work,economy:'\\u{1FA99} '+__t.economy,federation:'\\u{1F310} '+__t.federation,hooks:'\\u{1F517} '+__t.extensionHooks,maintenance:'\\u{1F6A7} '+__t.maintenance,config:'\\u2699 '+__t.config,ghii:'\\u{1F511} '+__t.ghiiLabel,email:'\\u2709 '+__t.emailLabel,directory:'\\u{1F4D6} '+__t.directoryLabel,matching:'\\u{1F91D} '+__t.matchingLabel,marketplace:'\\u{1F6D2} '+__t.marketplaceLabel,push:'\\u{1F514} '+__t.pushLabel,csm:'\\u{1F4E6} '+__t.csmLabel,genesis:'\\u{1F30D} '+__t.genesisLabel};
  document.getElementById('pageTitle').innerHTML=titles[page]||page;
  render();
}

async function loadAll(){
  if(!TOKEN){showLoginForm();return;}
  var btn=document.getElementById('btnRefresh');
  btn.disabled=true;btn.textContent=__t.loading;
  try{
    var [dash,agents,actions,boards]=await Promise.all([
      api('/v1/admin/dashboard'),
      api('/v1/admin/agents'),
      api('/v1/actions'),
      api('/v1/boards')
    ]);
    D.dash=dash.data;D.agents=agents.data;D.actions=actions.data;D.boards=boards.data;
    // Update sidebar counts
    if(D.dash&&D.dash.counts){
      document.getElementById('cntOwners').textContent=D.dash.counts.owners;
      document.getElementById('cntAgents').textContent=D.dash.counts.agents;
      document.getElementById('cntActions').textContent=D.dash.counts.actions;
      document.getElementById('cntBoards').textContent=D.dash.counts.boards;
      document.getElementById('cntChatInstances').textContent=D.dash.counts.chat_instances||0;
    }
    // Load maintenance, work, owners, federation, hooks in parallel
    var extras=await Promise.allSettled([
      api('/v1/admin/maintenance'),
      api('/v1/admin/work'),
      api('/v1/admin/federation'),
      api('/v1/admin/hooks'),
      api('/v1/chat-instances')
    ]);
    D.maintenance=extras[0].status==='fulfilled'?extras[0].value.data:null;
    D.workItems=extras[1].status==='fulfilled'?(extras[1].value.data.work||[]):[];
    D.federation=extras[2].status==='fulfilled'?(extras[2].value.data.peers||[]):[];
    D.hooks=extras[3].status==='fulfilled'?(extras[3].value.data.extension_hooks||{}):{};
    D.chatInstances=extras[4].status==='fulfilled'?(extras[4].value.data.chat_instances||[]):[];
    var features=await Promise.allSettled([
      api('/v1/admin/ghii'),
      api('/v1/admin/email/status'),
      api('/v1/admin/directory/stats'),
      api('/v1/admin/matching'),
      api('/v1/admin/marketplace'),
      api('/v1/admin/push'),
      api('/v1/admin/csm'),
      api('/v1/admin/genesis-peers'),
      api('/v1/admin/config')
    ]);
    D.ghiiUsers=features[0].status==='fulfilled'?(features[0].value.data.ghii_users||[]):[];
    D.emailStatus=features[1].status==='fulfilled'?features[1].value.data:null;
    D.directoryStats=features[2].status==='fulfilled'?features[2].value.data:null;
    D.matchingStats=features[3].status==='fulfilled'?features[3].value.data:null;
    D.marketplaceStats=features[4].status==='fulfilled'?features[4].value.data:null;
    D.pushStats=features[5].status==='fulfilled'?features[5].value.data:null;
    D.csmTemplates=features[6].status==='fulfilled'?features[6].value.data:null;
    D.genesisPeers=features[7].status==='fulfilled'?features[7].value.data:null;
    D.configSchema=features[8].status==='fulfilled'?features[8].value.data:null;
    // Load owners
    try{
      var ownerNames=D.agents&&D.agents.agents?[...new Set(D.agents.agents.map(function(a){return a.owner}))]:[];
      D.owners=[];
      for(var i=0;i<ownerNames.length;i++){
        try{var o=await api('/v1/owners/'+encodeURIComponent(ownerNames[i]));D.owners.push(o.data);}catch(e){}
      }
    }catch(e){D.owners=[];}
    document.getElementById('cntWork').textContent=D.workItems.length;
    document.getElementById('cntPeers').textContent=D.federation.length;
    if(D.ghiiUsers)document.getElementById('cntGhii').textContent=D.ghiiUsers.length;
    if(D.genesisPeers&&D.genesisPeers.peers)document.getElementById('cntGenesis').textContent=D.genesisPeers.peers.length;
    document.getElementById('sideNodeId').textContent=D.dash?D.dash.node_id:'';
    document.getElementById('lastUpdate').textContent=new Date().toLocaleTimeString();
    render();
  }catch(e){
    if(e.message==='Unauthorized')return;
    document.getElementById('app').innerHTML='<div class="error-box"><strong>'+__t.failedToLoad+'</strong><br/>'+esc(e.message)+'</div>';
  }
  btn.disabled=false;btn.textContent=__t.refresh;
}

function render(){
  var app=document.getElementById('app');
  if(!D.dash){app.innerHTML='<div class="loading">'+__t.loading+'</div>';return;}
  switch(currentPage){
    case 'overview':app.innerHTML=renderOverview();break;
    case 'owners':app.innerHTML=renderOwners();break;
    case 'agents':app.innerHTML=renderAgents();break;
    case 'actions':app.innerHTML=renderActions();break;
    case 'boards':app.innerHTML=renderBoards();break;
    case 'chatInstances':app.innerHTML=renderChatInstances();break;
    case 'work':app.innerHTML=renderWork();break;
    case 'economy':app.innerHTML=renderEconomy();break;
    case 'federation':app.innerHTML=renderFederation();break;
    case 'hooks':app.innerHTML=renderHooks();break;
    case 'maintenance':app.innerHTML=renderMaintenance();break;
    case 'config':app.innerHTML=renderConfig();break;
    case 'ghii':app.innerHTML=renderGhii();break;
    case 'email':app.innerHTML=renderEmail();break;
    case 'directory':app.innerHTML=renderDirectory();break;
    case 'matching':app.innerHTML=renderMatching();break;
    case 'marketplace':app.innerHTML=renderMarketplace();break;
    case 'push':app.innerHTML=renderPush();break;
    case 'csm':app.innerHTML=renderCsm();break;
    case 'genesis':app.innerHTML=renderGenesis();break;
    default:app.innerHTML='<div class="empty">Unknown page</div>';
  }
}

/* ── OVERVIEW ── */
function renderOverview(){
  var d=D.dash,h=d.health,c=d.counts,e=d.economy,w=d.warnings||[];
  var hColor=h.status==='healthy'?'green':h.status==='watch'?'yellow':'red';
  var o='';
  o+='<div class="card" style="border-left:4px solid var(--'+hColor+');margin-bottom:20px">';
  o+='<div style="display:flex;justify-content:space-between;align-items:center">';
  o+='<div><h2>'+__t.nodeHealth+'</h2><div class="stat" style="color:var(--'+hColor+')">'+h.status.toUpperCase()+'</div>';
  o+='<div class="stat-label">'+__t.uptime+': '+fmtUp(d.uptime_seconds)+' &middot; '+__t.storage+': '+esc(d.storage_type)+'</div></div>';
  o+='<div>'+badge(h.status)+'</div></div>';
  o+='<div style="margin-top:14px">';
  o+=hRow(__t.healthBurnMintRatio,h.burn_mint_ratio);
  o+=hRow(__t.healthAgentChurn,h.agent_churn_rate_30d);
  o+=hRow(__t.healthWorkExpiry,h.work_expiry_rate_30d);
  o+=hRow(__t.healthDisputeRate,h.dispute_rate_30d);
  o+='</div></div>';
  o+='<div class="grid grid-4">';
  o+=sc(__t.registeredOwners,c.owners,'','var(--blue)');
  o+=sc(__t.registeredAgents,c.agents,'('+c.active_agents_24h+' '+__t.active24h+')','var(--purple)');
  o+=sc(__t.publishedActions,c.actions,'','var(--cyan)');
  o+=sc(__t.activeBoards,c.boards,'','var(--green)');
  o+=sc(__t.activeChatSessions,c.chat_instances||0,'','var(--cyan)');
  o+='</div>';
  o+='<div class="grid grid-2">';
  o+='<div class="card"><h2>'+__t.economyToday+'</h2>';
  o+=er(__t.transactionsToday,num(e.transactions_today));
  o+=er(__t.morselsMovedToday,num(e.morsels_transacted_today));
  o+=er(__t.inCirculation,num(e.total_morsels_in_circulation));
  o+=er(__t.burnedToday,num(e.burned_today));
  o+='</div>';
  o+='<div class="card"><h2>'+__t.quickConfig+'</h2>';
  o+=er(__t.port,d.config.port);
  o+=er(__t.jwtTtl,d.config.jwt_ttl_seconds+'s');
  o+=er(__t.keyedBrowse,d.config.keyed_browse_enabled?__t.enabled:__t.disabled);
  o+=er(__t.welcomeBonus,num(e.welcome_bonus));
  o+='</div></div>';
  if(w.length>0){
    o+='<div class="card" style="border-left:3px solid var(--yellow);margin-bottom:20px"><h2>'+__t.warnings+' ('+w.length+')</h2>';
    o+='<table><thead><tr><th>'+__t.metric+'</th><th>'+__t.value+'</th><th>'+__t.zone+'</th><th>'+__t.threshold+'</th></tr></thead><tbody>';
    for(var i=0;i<w.length;i++){var x=w[i];o+='<tr><td>'+esc(x.metric)+'</td><td>'+x.value+'</td><td>'+badge(x.zone)+'</td><td style="color:var(--muted)">'+esc(x.threshold)+'</td></tr>';}
    o+='</tbody></table></div>';
  }
  return o;
}

/* ── OWNERS ── */
function renderOwners(){
  var owners=D.owners||[];
  if(owners.length===0)return '<div class="empty">'+__t.noOwnersFound+'</div>';
  var o='<div class="card"><div class="scrollable"><table><thead><tr><th>'+__t.name+'</th><th>'+__t.displayName+'</th><th>'+__t.roles+'</th><th>'+__t.agents+'</th><th>'+__t.created+'</th><th></th></tr></thead><tbody>';
  for(var i=0;i<owners.length;i++){
    var ow=owners[i];
    var agCount=ow.agents?ow.agents.length:0;
    var roles=ow.roles||[];
    var roleBadges=roles.map(function(r){return badge(r)}).join(' ');
    var isOp=roles.indexOf('operator')>=0;
    o+='<tr><td><strong>'+esc(ow.name)+'</strong></td><td>'+esc(ow.display_name||'\\u2014')+'</td>';
    o+='<td>'+roleBadges+'</td>';
    o+='<td>'+agCount+'</td>';
    o+='<td style="color:var(--muted)">'+dt(ow.created_at)+'</td>';
    o+='<td>'+(isOp?'':'<button class="expand-btn" onclick="grantOperator(\\''+esc(ow.name)+'\\')">'+__t.grantOperator+'</button>')+'</td></tr>';
  }
  o+='</tbody></table></div></div>';
  return o;
}

async function grantOperator(name){
  if(!confirm(__t.grantConfirm.replace('{name}',name)))return;
  try{
    await api('/v1/admin/roles/grant',{method:'POST',body:{owner:name,role:'operator'}});
    loadAll();
  }catch(e){alert(__t.errorLabel+': '+e.message)}
}

/* ── AGENTS ── */
function renderAgents(){
  var ag=D.agents;
  if(!ag||!ag.agents||ag.agents.length===0)return '<div class="empty">'+__t.noAgentsRegistered+'</div>';
  var o='<div class="card"><div class="scrollable"><table><thead><tr><th>'+__t.gaii+'</th><th>'+__t.owners+'</th><th>'+__t.displayName+'</th><th>'+__t.trust+'</th><th>'+__t.morsels+'</th><th>'+__t.lastSeen+'</th><th></th></tr></thead><tbody>';
  for(var i=0;i<ag.agents.length;i++){
    var a=ag.agents[i];
    var trust=typeof a.trust_score==='number'?a.trust_score.toFixed(1):'—';
    var tColor=a.trust_score>=70?'var(--green)':a.trust_score>=30?'var(--yellow)':'var(--red)';
    o+='<tr><td class="mono">'+esc(a.gaii)+'</td><td>'+esc(a.owner)+'</td><td>'+esc(a.display_name||'—')+'</td>';
    o+='<td style="color:'+tColor+'">'+trust+'</td><td>'+num(a.morsel_balance)+'</td>';
    o+='<td style="color:var(--muted)">'+dt(a.last_seen)+'</td>';
    o+='<td><button class="expand-btn" onclick="loadAgentDetail(\\''+esc(a.gaii)+'\\',this)">'+__t.details+'</button></td></tr>';
    o+='<tr class="agent-detail" id="ad-'+i+'" style="display:none"><td colspan="7"></td></tr>';
  }
  o+='</tbody></table></div></div>';
  return o;
}

/* ── ACTIONS ── */
function renderActions(){
  var ac=D.actions;
  if(!ac||!ac.actions||ac.actions.length===0)return '<div class="empty">'+__t.noActionsPublished+'</div>';
  var o='<div class="card"><div class="scrollable"><table><thead><tr><th>'+__t.id+'</th><th>'+__t.name+'</th><th>'+__t.provider+'</th><th>'+__t.category+'</th><th>'+__t.baseCost+'</th><th>'+__t.tags+'</th></tr></thead><tbody>';
  for(var i=0;i<ac.actions.length;i++){
    var a=ac.actions[i];
    var tags=(a.tags||[]).map(function(t){return '<span class="tag">'+esc(t)+'</span>'}).join(' ');
    var price=a.pricing?num(a.pricing.base_morsels)+' '+__t.morselUnit:'—';
    o+='<tr><td class="mono">'+esc(a.id)+'</td><td><strong>'+esc(a.display_name||a.id)+'</strong><br/><span style="color:var(--muted);font-size:.75rem">'+esc(a.description||'')+'</span></td>';
    o+='<td class="mono" style="font-size:.75rem">'+esc(a.provider_gaii)+'</td>';
    o+='<td>'+badge(a.category||'general')+'</td><td>'+price+'</td>';
    o+='<td>'+tags+'</td></tr>';
  }
  o+='</tbody></table></div></div>';
  return o;
}

/* ── BOARDS ── */
function renderBoards(){
  var bo=D.boards;
  if(!bo||!bo.boards||bo.boards.length===0)return '<div class="empty">'+__t.noBoardsCreated+'</div>';
  var o='';
  for(var i=0;i<bo.boards.length;i++){
    var b=bo.boards[i];
    o+='<div class="card" style="margin-bottom:16px">';
    o+='<div style="display:flex;justify-content:space-between;align-items:flex-start">';
    o+='<div><h2>'+esc(b.name||b.id)+'</h2><p style="color:var(--muted);font-size:.8rem;margin-bottom:8px">'+esc(b.description||__t.noDescription)+'</p></div>';
    o+='<div>'+badge(b.visibility||'public')+'</div></div>';
    o+='<div style="font-size:.8rem;color:var(--muted);margin-bottom:8px">'+__t.id+': <span class="mono">'+esc(b.id)+'</span> &middot; '+__t.created+': '+dt(b.created_at)+'</div>';
    o+='<button class="expand-btn" onclick="loadBoardPosts(\\''+esc(b.id)+'\\',this)">'+__t.loadPosts+'</button>';
    o+='<div id="bp-'+esc(b.id)+'" style="margin-top:8px"></div>';
    o+='</div>';
  }
  return o;
}

/* ── WORK ── */
function renderWork(){
  var items=D.workItems||[];
  if(items.length===0)return '<div class="empty">'+__t.noWorkContracts+'</div>';
  var o='<div class="card"><div class="scrollable"><table><thead><tr><th>'+__t.trackingCode+'</th><th>'+__t.status+'</th><th>'+__t.action+'</th><th>'+__t.requester+'</th><th>'+__t.provider+'</th><th>'+__t.cost+'</th><th>'+__t.created+'</th></tr></thead><tbody>';
  for(var i=0;i<items.length;i++){
    var w=items[i];
    var cost=w.cost?(w.cost.total||w.cost.base_price||0):0;
    o+='<tr><td class="mono" style="font-size:.75rem">'+esc(w.tracking_code)+'</td>';
    o+='<td>'+badge(w.status)+'</td>';
    o+='<td>'+esc(w.action_id||'\\u2014')+'</td>';
    o+='<td class="mono" style="font-size:.75rem">'+esc(w.requester_gaii)+'</td>';
    o+='<td class="mono" style="font-size:.75rem">'+esc(w.provider_gaii)+'</td>';
    o+='<td>'+num(cost)+'</td>';
    o+='<td style="color:var(--muted)">'+dt(w.created_at)+'</td></tr>';
  }
  o+='</tbody></table></div></div>';
  return o;
}

/* ── ECONOMY ── */
function renderEconomy(){
  var e=D.dash.economy;
  var o='<div class="grid grid-2">';
  o+='<div class="card"><h2>'+__t.morselSupply+'</h2>';
  o+=er(__t.inCirculation,num(e.total_morsels_in_circulation));
  o+=er(__t.totalMintedAllTime,num(e.total_minted_all_time));
  o+=er(__t.totalBurnedAllTime,num(e.total_burned_all_time));
  o+=er(__t.inflationRate30d,e.inflation_rate_30d_percent+'%');
  o+=er(__t.burnMintRatio,e.burn_mint_ratio);
  o+='</div>';
  o+='<div class="card"><h2>'+__t.todayActivity+'</h2>';
  o+=er(__t.transactionsToday,num(e.transactions_today));
  o+=er(__t.morselsMovedToday,num(e.morsels_transacted_today));
  o+=er(__t.networkFees,num(e.network_fees_today));
  o+=er(__t.burned,num(e.burned_today));
  o+=er(__t.dailyAllowancesIssued,num(e.daily_allowances_issued_today));
  o+='</div></div>';
  o+='<div class="card"><h2>'+__t.morselPolicy+'</h2>';
  o+=er(__t.welcomeBonus,num(e.welcome_bonus)+' '+__t.morselUnit);
  o+=er(__t.dailyAllowance,num(e.daily_allowance)+' '+__t.morselUnit);
  o+=er(__t.allowanceCap,num(e.daily_allowance_cap)+' '+__t.morselUnit);
  o+=er(__t.burnRate,e.burn_rate);
  o+=er(__t.maxOperatorMint,num(e.max_operator_mint_per_day)+' '+__t.morselUnit);
  o+='</div>';
  // Mint form
  o+='<div class="card" style="margin-top:16px"><h2>'+__t.mintMorsels+'</h2>';
  o+='<p style="color:var(--muted);font-size:.8rem;margin-bottom:10px">'+__t.issueToAgent.replace('{cap}',num(e.max_operator_mint_per_day))+'</p>';
  o+='<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">';
  o+='<div style="flex:2;min-width:200px"><label style="color:var(--muted);font-size:.75rem;margin-bottom:2px;display:block">'+__t.gaii+'</label><input type="text" id="mintGaii" placeholder="agent#owner@node" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.85rem"/></div>';
  o+='<div style="flex:1;min-width:100px"><label style="color:var(--muted);font-size:.75rem;margin-bottom:2px;display:block">'+__t.amount+'</label><input type="number" id="mintAmount" placeholder="100" min="1" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.85rem"/></div>';
  o+='<button class="refresh" style="height:38px;white-space:nowrap" onclick="doMint()">'+__t.mint+'</button>';
  o+='</div><div id="mintResult" style="margin-top:8px;font-size:.85rem"></div></div>';
  return o;
}

async function doMint(){
  var gaii=document.getElementById('mintGaii').value.trim();
  var amount=parseInt(document.getElementById('mintAmount').value);
  if(!gaii||!amount||amount<1){document.getElementById('mintResult').innerHTML='<span style="color:var(--red)">'+__t.mintGaiiRequired+'</span>';return;}
  try{
    var r=await api('/v1/admin/mint',{method:'POST',body:{gaii:gaii,amount:amount}});
    document.getElementById('mintResult').innerHTML='<span style="color:var(--green)">'+__t.mintedSuccess.replace('{amount}',num(r.data.minted)).replace('{balance}',num(r.data.new_balance))+'</span>';
    loadAll();
  }catch(e){document.getElementById('mintResult').innerHTML='<span style="color:var(--red)">'+esc(e.message)+'</span>';}
}

/* ── MAINTENANCE ── */
function renderMaintenance(){
  var m=D.maintenance||{enabled:false,message:'',enabledAt:null,enabledBy:null};
  var color=m.enabled?'red':'green';
  var status=m.enabled?__t.maintenanceOn:__t.operational;
  var o='<div class="card" style="border-left:4px solid var(--'+color+')">';
  o+='<h2>'+__t.maintenanceMode+'</h2>';
  o+='<div class="stat" style="color:var(--'+color+');margin-bottom:12px">'+status+'</div>';
  if(m.enabled){
    o+='<div style="margin-bottom:12px">';
    if(m.message)o+=er(__t.message,esc(m.message));
    if(m.enabledAt)o+=er(__t.since,dt(m.enabledAt));
    if(m.enabledBy)o+=er(__t.by,esc(m.enabledBy));
    o+='</div>';
  }
  o+='<div style="margin-top:16px">';
  o+='<label style="display:block;color:var(--muted);font-size:.8rem;margin-bottom:4px">'+__t.customMessage+'</label>';
  o+='<input type="text" id="maintMsg" value="'+esc(m.message||'')+'" placeholder="'+__t.customMessagePlaceholder+'" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.85rem;margin-bottom:12px"/>';
  if(m.enabled){
    o+='<button class="refresh" style="background:var(--green);width:100%" onclick="toggleMaintenance(false)">'+__t.disableMaintenance+'</button>';
  }else{
    o+='<button class="refresh" style="background:var(--red);width:100%" onclick="toggleMaintenance(true)">'+__t.enableMaintenance+'</button>';
  }
  o+='</div>';
  o+='<p style="color:var(--muted);font-size:.75rem;margin-top:12px">'+__t.maintenanceExplain+'</p>';
  o+='</div>';
  // Backup/Restore
  o+='<div class="card" style="margin-top:16px"><h2>'+__t.backupRestore+'</h2>';
  o+='<div style="display:flex;gap:12px;flex-wrap:wrap">';
  o+='<button class="refresh" style="flex:1;min-width:140px" onclick="doBackup()">'+__t.downloadBackup+'</button>';
  o+='<button class="refresh" style="flex:1;min-width:140px;background:var(--purple)" onclick="document.getElementById(\\'restoreFile\\').click()">'+__t.restoreFromFile+'</button>';
  o+='<input type="file" id="restoreFile" accept=".json" style="display:none" onchange="doRestore(this)"/>';
  o+='</div>';
  o+='<div id="backupResult" style="margin-top:8px;font-size:.85rem"></div>';
  o+='<p style="color:var(--muted);font-size:.72rem;margin-top:8px">'+__t.backupExplain+'</p>';
  o+='</div>';
  return o;
}

async function doBackup(){
  try{
    var r=await api('/v1/admin/backup');
    var blob=new Blob([JSON.stringify(r.data,null,2)],{type:'application/json'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');a.href=url;a.download='aimeat-backup-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
    document.getElementById('backupResult').innerHTML='<span style="color:var(--green)">'+__t.backupDownloaded+'</span>';
  }catch(e){document.getElementById('backupResult').innerHTML='<span style="color:var(--red)">'+esc(e.message)+'</span>';}
}

async function doRestore(input){
  if(!input.files||!input.files[0])return;
  if(!confirm(__t.restoreConfirm))return;
  var reader=new FileReader();
  reader.onload=async function(){
    try{
      var data=JSON.parse(reader.result);
      await api('/v1/admin/restore',{method:'POST',body:data});
      document.getElementById('backupResult').innerHTML='<span style="color:var(--green)">'+__t.dataRestored+'</span>';
      loadAll();
    }catch(e){document.getElementById('backupResult').innerHTML='<span style="color:var(--red)">'+esc(e.message)+'</span>';}
  };
  reader.readAsText(input.files[0]);
  input.value='';
}

async function toggleMaintenance(on){
  try{
    var msg=document.getElementById('maintMsg')?document.getElementById('maintMsg').value:'';
    var r=await api('/v1/admin/maintenance',{method:'POST',body:{enabled:on,message:msg}});
    D.maintenance=r.data;
    render();
  }catch(e){alert(__t.errorLabel+': '+e.message)}
}

/* ── FEDERATION ── */
function renderFederation(){
  var peers=D.federation||[];
  var o='<div class="card"><h2>'+__t.peeringRequests+'</h2>';
  if(peers.length===0){
    o+='<div class="empty">'+__t.noFederationPeers+'</div>';
  }else{
    o+='<div class="scrollable"><table><thead><tr><th>'+__t.fromNode+'</th><th>'+__t.url+'</th><th>'+__t.status+'</th><th>'+__t.message+'</th><th>'+__t.created+'</th></tr></thead><tbody>';
    for(var i=0;i<peers.length;i++){
      var p=peers[i];
      o+='<tr><td class="mono" style="font-size:.8rem">'+esc(p.from_node_id||p.id)+'</td>';
      o+='<td class="mono" style="font-size:.75rem">'+esc(p.from_node_url||p.target_url||'\\u2014')+'</td>';
      o+='<td>'+badge(p.status)+'</td>';
      o+='<td style="color:var(--muted);font-size:.8rem">'+esc(p.message||'\\u2014')+'</td>';
      o+='<td style="color:var(--muted)">'+dt(p.created_at)+'</td></tr>';
    }
    o+='</tbody></table></div>';
  }
  o+='</div>';
  o+='<div class="card" style="margin-top:16px"><h2>'+__t.federationInfo+'</h2>';
  o+=er(__t.nodeSettings,esc(D.dash.node_id));
  o+=er(__t.maxRelayHops,D.dash.config.max_relay_hops||3);
  o+='<p style="color:var(--muted);font-size:.8rem;margin-top:12px">'+__t.federationPeerExplain+'</p>';
  o+='</div>';
  return o;
}

/* ── HOOKS ── */
function renderHooks(){
  var hooks=D.hooks||{};
  var hookNames=Object.keys(hooks);
  var o='<div class="card"><h2>'+__t.extensionHooks+'</h2>';
  o+='<p style="color:var(--muted);font-size:.8rem;margin-bottom:12px">'+__t.hooksExplain+'</p>';
  o+='<div class="scrollable"><table><thead><tr><th>'+__t.hook+'</th><th>'+__t.boundActions+'</th><th></th></tr></thead><tbody>';
  for(var i=0;i<hookNames.length;i++){
    var name=hookNames[i];
    var actions=hooks[name]||[];
    o+='<tr><td class="mono" style="font-size:.8rem">'+esc(name)+'</td>';
    o+='<td>'+(actions.length>0?actions.map(function(a){return '<span class="tag">'+esc(a)+'</span>'}).join(' '):'<span style="color:var(--muted)">'+__t.noneLabel+'</span>')+'</td>';
    o+='<td>';
    if(actions.length>0)o+='<button class="expand-btn" onclick="clearHook(\\''+esc(name)+'\\')">'+__t.clear+'</button>';
    o+='</td></tr>';
  }
  o+='</tbody></table></div></div>';
  return o;
}

async function clearHook(name){
  if(!confirm(__t.clearHookConfirm+' "'+name+'"?'))return;
  try{
    await api('/v1/admin/hooks/'+encodeURIComponent(name),{method:'DELETE'});
    loadAll();
  }catch(e){alert(__t.errorLabel+': '+e.message)}
}

/* ── CONFIG EDITOR ── */
function renderConfig(){
  var s=D.configSchema;
  if(!s||!s.schema)return '<div class="empty">'+__t.configNotAvailable+'</div>';
  var schema=s.schema;
  var groups={};
  for(var path in schema){
    var parts=path.split('.');
    var group=parts[0];
    if(!groups[group])groups[group]=[];
    groups[group].push({path:path,entry:schema[path]});
  }
  var o='<div id="configChanges" style="display:none;margin-bottom:16px;padding:12px;background:#1a2332;border:1px solid var(--yellow);border-radius:8px"><h3 style="color:var(--yellow);margin-bottom:8px">'+__t.pendingChanges+'</h3><div id="configDiff"></div><button class="action-btn" onclick="saveConfig()" style="margin-top:8px">'+__t.saveChanges+'</button> <button class="action-btn" onclick="cancelConfig()" style="margin-top:8px">'+__t.cancelLabel+'</button><div id="configResult" style="margin-top:8px"></div></div>';
  var pendingChanges={};window.__pendingConfig=pendingChanges;
  for(var g in groups){
    var items=groups[g];
    o+='<details class="card" style="margin-bottom:8px" open><summary style="cursor:pointer;font-weight:600;font-size:.95rem;padding:8px 0">'+esc(g.charAt(0).toUpperCase()+g.slice(1).replace(/_/g,' '))+'</summary><div style="padding:8px 0">';
    for(var i=0;i<items.length;i++){
      var item=items[i];
      var e=item.entry;
      var p=item.path;
      o+='<div class="health-row"><span class="health-metric" title="'+esc(e.description)+'">'+esc(p)+'</span><span>';
      if(!e.mutable){
        if(typeof e.value==='boolean'){o+=(e.value?badge('healthy')+' '+__t.yesLabel:badge('critical')+' '+__t.noLabel);}
        else{o+='<code>'+esc(String(e.value))+'</code> <span style="color:var(--muted);font-size:.75rem">'+__t.readOnly+'</span>';}
      } else if(e.type==='boolean'){
        o+='<label style="cursor:pointer"><input type="checkbox" data-config-path="'+esc(p)+'" '+(e.value?'checked':'')+' onchange="configChanged(\\''+esc(p)+'\\',this.checked)"> '+(e.value?__t.enabled:__t.disabled)+'</label>';
      } else if(e.type==='integer'){
        o+='<input type="number" data-config-path="'+esc(p)+'" value="'+e.value+'" style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:4px;width:120px" onchange="configChanged(\\''+esc(p)+'\\',parseInt(this.value))">';
        if(e.range)o+=' <span style="color:var(--muted);font-size:.75rem">'+esc(e.range)+'</span>';
      } else if(e.type==='float'){
        o+='<input type="number" step="0.01" data-config-path="'+esc(p)+'" value="'+e.value+'" style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:4px;width:120px" onchange="configChanged(\\''+esc(p)+'\\',parseFloat(this.value))">';
        if(e.range)o+=' <span style="color:var(--muted);font-size:.75rem">'+esc(e.range)+'</span>';
      } else if(e.type==='string'){
        o+='<input type="text" data-config-path="'+esc(p)+'" value="'+esc(String(e.value||''))+'" style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:4px;width:250px" onchange="configChanged(\\''+esc(p)+'\\',this.value)">';
      } else if(e.type==='object'){
        o+='<code style="font-size:.75rem">'+esc(JSON.stringify(e.value)).substring(0,100)+'...</code>';
      } else {
        o+='<code>'+esc(String(e.value))+'</code>';
      }
      o+='</span></div>';
    }
    o+='</div></details>';
  }
  return o;
}
function configChanged(path,value){
  if(!window.__pendingConfig)window.__pendingConfig={};
  window.__pendingConfig[path]=value;
  var diff=document.getElementById('configDiff');
  var box=document.getElementById('configChanges');
  var keys=Object.keys(window.__pendingConfig);
  if(keys.length===0){box.style.display='none';return;}
  box.style.display='block';
  var h='';
  for(var i=0;i<keys.length;i++){h+='<div>'+esc(keys[i])+' \\u2192 <strong>'+esc(String(window.__pendingConfig[keys[i]]))+'</strong></div>';}
  diff.innerHTML=h;
}
async function saveConfig(){
  var changes=[];
  for(var p in window.__pendingConfig){changes.push({path:p,value:window.__pendingConfig[p]});}
  if(!changes.length){alert(__t.noChanges);return;}
  try{
    var r=await api('/v1/admin/config',{method:'PUT',body:{changes:changes}});
    document.getElementById('configResult').innerHTML='<span style="color:var(--green)">'+__t.savedChanges.replace('{count}',r.data.applied.length)+'</span>';
    window.__pendingConfig={};
    document.getElementById('configChanges').style.display='none';
    loadAll();
  }catch(e){document.getElementById('configResult').innerHTML='<span style="color:var(--red)">'+__t.errorLabel+': '+esc(e.message)+'</span>';}
}
function cancelConfig(){
  window.__pendingConfig={};
  document.getElementById('configChanges').style.display='none';
  render();
}

/* ── Detail loaders ── */
async function loadAgentDetail(gaii,btn){
  btn.textContent=__t.loading;btn.disabled=true;
  try{
    var r=await api('/v1/agents/'+encodeURIComponent(gaii));
    var a=r.data;
    var row=btn.closest('tr').nextElementSibling;
    var o='<div class="sub-panel">';
    o+='<strong>'+esc(a.display_name||a.gaii)+'</strong>';
    if(a.description)o+='<p style="color:var(--muted);font-size:.8rem;margin:4px 0">'+esc(a.description)+'</p>';
    if(a.capabilities&&a.capabilities.length){
      o+='<div style="margin:6px 0">'+__t.capabilities+': '+a.capabilities.map(function(c){return '<span class="tag">'+esc(c)+'</span>'}).join(' ')+'</div>';
    }
    if(a.trust){
      o+='<div style="margin-top:8px"><strong style="font-size:.8rem;color:var(--muted)">'+__t.trustDetails+'</strong></div>';
      o+=er(__t.score,a.trust.score);
      o+=er(__t.deliveries,a.trust.total_deliveries+' ('+a.trust.successful_deliveries+' ok)');
      o+=er(__t.successRate,(a.trust.success_rate*100).toFixed(1)+'%');
      o+=er(__t.avgDeliveryTime,a.trust.avg_delivery_time_seconds+'s');
      o+=er(__t.ratings,'+'+a.trust.positive_ratings+' / -'+a.trust.negative_ratings);
      o+=er(__t.age,a.trust.age_days+' '+__t.daysUnit);
    }
    o+='<div style="margin-top:8px;font-size:.75rem;color:var(--muted)">'+__t.created+': '+dt(a.created_at)+' &middot; '+__t.home+': '+esc(a.home_node)+'</div>';
    o+='</div>';
    row.querySelector('td').innerHTML=o;
    row.style.display='';
    btn.textContent=__t.hide;btn.disabled=false;
    btn.onclick=function(){row.style.display=row.style.display?'':'none';btn.textContent=row.style.display?__t.details:__t.hide};
  }catch(e){btn.textContent=__t.errorLabel;setTimeout(function(){btn.textContent=__t.details;btn.disabled=false},2000)}
}

async function loadBoardPosts(boardId,btn){
  btn.textContent=__t.loading;btn.disabled=true;
  try{
    var r=await api('/v1/boards/'+encodeURIComponent(boardId)+'/posts?limit=50');
    var posts=r.data.posts||[];
    var el=document.getElementById('bp-'+boardId);
    if(posts.length===0){el.innerHTML='<div class="empty">'+__t.noData+'</div>';btn.textContent=__t.loadPosts;btn.disabled=false;return;}
    var o='<table><thead><tr><th>'+__t.titleLabel+'</th><th>'+__t.author+'</th><th>'+__t.category+'</th><th>'+__t.created+'</th></tr></thead><tbody>';
    for(var i=0;i<posts.length;i++){
      var p=posts[i];
      o+='<tr><td><strong>'+esc(p.title||__t.untitled)+'</strong><br/><span style="color:var(--muted);font-size:.75rem">'+esc((p.body||'').substring(0,120))+'</span></td>';
      o+='<td class="mono" style="font-size:.75rem">'+esc(p.author_gaii)+'</td>';
      o+='<td>'+badge(p.category||'general')+'</td>';
      o+='<td style="color:var(--muted)">'+dt(p.created_at)+'</td></tr>';
    }
    o+='</tbody></table>';
    el.innerHTML=o;
    btn.textContent=__t.loadPosts;btn.disabled=false;
  }catch(e){btn.textContent=__t.errorLabel;setTimeout(function(){btn.textContent=__t.loadPosts;btn.disabled=false},2000)}
}

function renderChatInstances(){
  var list=D.chatInstances||[];
  if(!list.length)return '<div class="empty">'+__t.noChatInstances+'</div>';
  var o='<div class="grid grid-4" style="margin-bottom:20px">';
  o+=sc(__t.activeChatSessions,list.length,'','var(--cyan)');
  var platforms={};list.forEach(function(c){platforms[c.platform]=(platforms[c.platform]||0)+1});
  var topPlatform=Object.keys(platforms).sort(function(a,b){return platforms[b]-platforms[a]})[0]||'-';
  o+=sc(__t.topPlatform,topPlatform,'','var(--purple)');
  o+='</div>';
  o+='<div class="card"><table><thead><tr><th>'+__t.id+'</th><th>'+__t.name+'</th><th>'+__t.platform+'</th><th>'+__t.owner+'</th><th>'+__t.lastSeen+'</th></tr></thead><tbody>';
  list.forEach(function(c){
    o+='<tr><td class="mono" title="'+esc(c.id)+'">'+esc(c.id.length>40?c.id.substring(0,40)+'...':c.id)+'</td>';
    o+='<td>'+esc(c.app_name)+'</td>';
    o+='<td>'+esc(c.platform)+'</td>';
    o+='<td>'+esc(c.ghii||'')+'</td>';
    o+='<td>'+dt(c.last_seen)+'</td></tr>';
  });
  o+='</tbody></table></div>';
  return o;
}

/* ── GHII USERS ── */
function renderGhii(){
  var users=D.ghiiUsers||[];
  var o='<div class="stats-grid">'+sc(__t.totalGhiiUsers,users.length,'','var(--cyan)')+sc(__t.totpEnabled,users.filter(function(u){return u.totp_enabled}).length,'','var(--green)')+sc(__t.verifiedL2,users.filter(function(u){return u.verification_level===2}).length,'','var(--purple)')+'</div>';
  if(!users.length)return o+'<div class="empty">'+__t.noGhiiUsers+'</div>';
  o+='<table class="data-table"><thead><tr><th>GHII</th><th>'+__t.displayName+'</th><th>'+__t.verification+'</th><th>'+__t.totp+'</th><th>'+__t.created+'</th><th>'+__t.actions+'</th></tr></thead><tbody>';
  for(var i=0;i<users.length;i++){
    var u=users[i];
    var vBadge=u.verification_level===2?badge('healthy'):u.verification_level===1?badge('watch'):badge('critical');
    o+='<tr><td><code>'+esc(u.ghii).substring(0,16)+'...</code></td><td>'+esc(u.display_name||u.username||'-')+'</td><td>'+vBadge+' L'+u.verification_level+'</td><td>'+(u.totp_enabled?badge('healthy'):badge('critical'))+'</td><td>'+dt(u.created_at)+'</td><td><select onchange="updateGhiiLevel(\\''+esc(u.ghii)+'\\',this.value)"><option value="0"'+(u.verification_level===0?' selected':'')+'>L0</option><option value="1"'+(u.verification_level===1?' selected':'')+'>L1</option><option value="2"'+(u.verification_level===2?' selected':'')+'>L2</option></select> <button class="action-btn" onclick="deleteGhii(\\''+esc(u.ghii)+'\\')">'+__t.deleteLabel+'</button></td></tr>';
  }
  o+='</tbody></table>';
  return o;
}
async function updateGhiiLevel(ghii,level){
  try{await api('/v1/admin/ghii/'+encodeURIComponent(ghii),{method:'PUT',body:{verificationLevel:parseInt(level)}});loadAll();}catch(e){alert(__t.errorLabel+': '+e.message);}
}
async function deleteGhii(ghii){
  if(!confirm(__t.deleteGhiiConfirm+' '+ghii+'?'))return;
  try{await api('/v1/admin/ghii/'+encodeURIComponent(ghii),{method:'DELETE'});loadAll();}catch(e){alert(__t.errorLabel+': '+e.message);}
}

/* ── EMAIL ── */
function renderEmail(){
  var s=D.emailStatus;
  if(!s)return '<div class="empty">'+__t.emailNotAvailable+'</div>';
  var o='<div class="stats-grid">'+sc(__t.status,s.enabled?__t.enabled:__t.disabled,'',s.enabled?'var(--green)':'var(--red)')+sc(__t.smtpHost,s.smtp_host||__t.notConfigured,'','var(--cyan)')+sc(__t.smtpPort,s.smtp_port,'','var(--blue)')+sc(__t.confirmationRequired,s.confirmation_required?__t.yesLabel:__t.noLabel,'','var(--yellow)')+'</div>';
  o+='<div class="card" style="margin-top:16px"><h3>'+__t.smtpConfig+'</h3><div class="health-row"><span class="health-metric">'+__t.fromAddress+'</span><span>'+esc(s.smtp_from||'-')+'</span></div><div class="health-row"><span class="health-metric">'+__t.secureTls+'</span><span>'+(s.smtp_secure?__t.yesLabel:__t.noLabel)+'</span></div><div class="health-row"><span class="health-metric">'+__t.smtpUser+'</span><span>'+(s.smtp_user_configured?badge('healthy')+' '+__t.configured:badge('critical')+' '+__t.notSet)+'</span></div><div class="health-row"><span class="health-metric">'+__t.smtpPassword+'</span><span>'+(s.smtp_pass_configured?badge('healthy')+' '+__t.configured:badge('critical')+' '+__t.notSet)+'</span></div></div>';
  o+='<div class="card" style="margin-top:16px"><h3>'+__t.sendTestEmail+'</h3><div style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="email" id="testEmailTo" placeholder="recipient@example.com" style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:6px;flex:1"><button class="action-btn" onclick="sendTestEmail()">'+__t.sendTest+'</button></div><div id="testEmailResult" style="margin-top:8px"></div></div>';
  return o;
}
async function sendTestEmail(){
  var to=document.getElementById('testEmailTo').value;
  if(!to){alert(__t.enterEmail);return;}
  try{var r=await api('/v1/admin/email/test',{method:'POST',body:{to:to}});document.getElementById('testEmailResult').innerHTML='<span style="color:var(--green)">'+__t.testEmailSent+'</span>';}catch(e){document.getElementById('testEmailResult').innerHTML='<span style="color:var(--red)">'+__t.errorLabel+': '+esc(e.message)+'</span>';}
}

/* ── DIRECTORY ── */
function renderDirectory(){
  var s=D.directoryStats;
  if(!s)return '<div class="empty">'+__t.directoryNotAvailable+'</div>';
  var o='<div class="stats-grid">'+sc(__t.totalIndexed,s.total_indexed||0,'','var(--cyan)')+sc(__t.totalInterests,s.total_interests||0,'','var(--blue)')+sc(__t.totalCities,s.total_cities||0,'','var(--purple)')+'</div>';
  o+='<div class="card" style="margin-top:16px"><h3>'+__t.directoryIndex+'</h3><button class="action-btn" onclick="rebuildDirectory()">'+__t.rebuildIndex+'</button><div id="dirResult" style="margin-top:8px"></div></div>';
  return o;
}
async function rebuildDirectory(){
  try{var r=await api('/v1/admin/directory/rebuild',{method:'POST'});document.getElementById('dirResult').innerHTML='<span style="color:var(--green)">'+__t.indexRebuilt+' '+JSON.stringify(r.data.stats)+'</span>';loadAll();}catch(e){document.getElementById('dirResult').innerHTML='<span style="color:var(--red)">'+__t.errorLabel+': '+esc(e.message)+'</span>';}
}

/* ── MATCHING ── */
function renderMatching(){
  var s=D.matchingStats;
  if(!s)return '<div class="empty">'+__t.matchingNotAvailable+'</div>';
  var o='<div class="stats-grid">'+sc(__t.status,s.enabled?__t.enabled:__t.disabled,'',s.enabled?'var(--green)':'var(--red)')+sc(__t.interval,s.interval_hours+'h','','var(--blue)')+sc(__t.threshold,s.threshold,'','var(--cyan)')+sc(__t.maxSuggestions,s.max_suggestions,'','var(--purple)')+'</div>';
  o+='<div class="stats-grid">'+sc(__t.maxDistance,s.max_distance_km+' km','','var(--blue)')+sc(__t.cooldown,s.cooldown_days+' '+__t.daysUnit,'','var(--yellow)')+'</div>';
  o+='<div class="card" style="margin-top:16px"><h3>'+__t.runMatchingRound+'</h3><button class="action-btn" onclick="runMatching()">'+__t.triggerMatching+'</button><div id="matchResult" style="margin-top:8px"></div></div>';
  return o;
}
async function runMatching(){
  try{var r=await api('/v1/admin/matching/run',{method:'POST'});document.getElementById('matchResult').innerHTML='<span style="color:var(--green)">'+__t.matchingComplete+' '+JSON.stringify(r.data)+'</span>';loadAll();}catch(e){document.getElementById('matchResult').innerHTML='<span style="color:var(--red)">'+__t.errorLabel+': '+esc(e.message)+'</span>';}
}

/* ── MARKETPLACE ── */
function renderMarketplace(){
  var s=D.marketplaceStats;
  if(!s)return '<div class="empty">'+__t.marketplaceNotAvailable+'</div>';
  var st=s.stats||{};
  var o='<div class="stats-grid">'+sc(__t.status,s.enabled?__t.enabled:__t.disabled,'',s.enabled?'var(--green)':'var(--red)')+sc(__t.totalListings,st.total||0,'','var(--cyan)')+sc(__t.listingFee,s.listing_fee+' '+__t.morselUnit,'','var(--blue)')+sc(__t.txFee,s.tx_fee_percent+'%','','var(--yellow)')+'</div>';
  if(st.by_status){
    o+='<div class="stats-grid">';
    for(var k in st.by_status){o+=sc(k,st.by_status[k],'','var(--purple)');}
    o+='</div>';
  }
  if(st.recent_listings&&st.recent_listings.length){
    o+='<h3 style="margin-top:16px">'+__t.recentListings+'</h3><table class="data-table"><thead><tr><th>'+__t.titleLabel+'</th><th>'+__t.category+'</th><th>'+__t.price+'</th><th>'+__t.status+'</th><th>'+__t.seller+'</th><th>'+__t.created+'</th></tr></thead><tbody>';
    for(var i=0;i<st.recent_listings.length;i++){
      var l=st.recent_listings[i];
      o+='<tr><td>'+esc(l.title)+'</td><td>'+esc(l.category)+'</td><td>'+num(l.price_morsels)+' '+__t.morselUnit+'</td><td>'+badge(l.status==='active'?'healthy':l.status==='sold'?'watch':'critical')+' '+esc(l.status)+'</td><td><code>'+esc(l.seller_ghii||'-').substring(0,12)+'</code></td><td>'+dt(l.created_at)+'</td></tr>';
    }
    o+='</tbody></table>';
  }
  return o;
}

/* ── PUSH ── */
function renderPush(){
  var s=D.pushStats;
  if(!s)return '<div class="empty">'+__t.pushNotAvailable+'</div>';
  var o='<div class="stats-grid">'+sc(__t.status,s.enabled?__t.enabled:__t.disabled,'',s.enabled?'var(--green)':'var(--red)')+sc(__t.vapidKeys,s.vapid_configured?__t.configured:__t.missing,'',s.vapid_configured?'var(--green)':'var(--red)')+sc(__t.totalSubscriptions,s.total_subscriptions||0,'','var(--cyan)')+'</div>';
  if(s.subscriptions&&s.subscriptions.length){
    o+='<table class="data-table"><thead><tr><th>'+__t.owner+'</th><th>'+__t.created+'</th><th>'+__t.lastUsed+'</th></tr></thead><tbody>';
    for(var i=0;i<s.subscriptions.length;i++){
      var sub=s.subscriptions[i];
      o+='<tr><td>'+esc(sub.owner_name)+'</td><td>'+dt(sub.created_at)+'</td><td>'+dt(sub.last_used_at)+'</td></tr>';
    }
    o+='</tbody></table>';
  }
  return o;
}

/* ── CSM TEMPLATES ── */
function renderCsm(){
  var s=D.csmTemplates;
  if(!s)return '<div class="empty">'+__t.csmNotAvailable+'</div>';
  var templates=s.templates||[];
  var o='<div class="stats-grid">'+sc(__t.totalTemplates,s.total||0,'','var(--cyan)')+'</div>';
  if(!templates.length)return o+'<div class="empty">'+__t.noCsmTemplates+'</div>';
  o+='<table class="data-table"><thead><tr><th>'+__t.name+'</th><th>'+__t.serviceType+'</th><th>'+__t.registeredBy+'</th><th>'+__t.federate+'</th><th>'+__t.registered+'</th><th>'+__t.updated+'</th></tr></thead><tbody>';
  for(var i=0;i<templates.length;i++){
    var c=templates[i];
    o+='<tr><td><code>'+esc(c.name)+'</code></td><td>'+esc(c.service_type||'-')+'</td><td>'+esc(c.registered_by)+'</td><td>'+(c.federate?badge('healthy'):badge('critical'))+'</td><td>'+dt(c.registered_at)+'</td><td>'+dt(c.updated_at)+'</td></tr>';
  }
  o+='</tbody></table>';
  return o;
}

/* ── GENESIS PEERS ── */
function renderGenesis(){
  var s=D.genesisPeers;
  if(!s)return '<div class="empty">'+__t.genesisNotAvailable+'</div>';
  var peers=s.peers||[];
  var ns=s.network_stats||{};
  var o='<div class="stats-grid">'+sc(__t.totalPeers,s.total||0,'','var(--cyan)')+sc(__t.active,peers.filter(function(p){return p.status==='active'}).length,'','var(--green)')+sc(__t.pending,peers.filter(function(p){return p.status==='pending'}).length,'','var(--yellow)')+sc(__t.suspended,peers.filter(function(p){return p.status==='suspended'}).length,'','var(--red)')+'</div>';
  if(ns.total_federated_users)o+='<div class="stats-grid">'+sc(__t.federatedUsers,ns.total_federated_users,'','var(--blue)')+sc(__t.federatedListings,ns.total_federated_listings||0,'','var(--purple)')+'</div>';
  if(!peers.length)return o+'<div class="empty">'+__t.noGenesisPeers+'</div>';
  o+='<table class="data-table"><thead><tr><th>'+__t.nodeSettings+'</th><th>'+__t.url+'</th><th>'+__t.status+'</th><th>'+__t.lastSync+'</th><th>'+__t.actions+'</th></tr></thead><tbody>';
  for(var i=0;i<peers.length;i++){
    var p=peers[i];
    var sBadge=p.status==='active'?badge('healthy'):p.status==='pending'?badge('watch'):badge('critical');
    o+='<tr><td><code>'+esc(p.genesis_node_id||'-').substring(0,20)+'</code></td><td>'+esc(p.genesis_url||'-')+'</td><td>'+sBadge+' '+esc(p.status)+'</td><td>'+dt(p.last_sync_at)+'</td><td>';
    if(p.status==='pending')o+='<button class="action-btn" onclick="approveGenesisPeer(\\''+esc(p.id)+'\\')">'+__t.approve+'</button> ';
    if(p.status==='active')o+='<button class="action-btn" onclick="suspendGenesisPeer(\\''+esc(p.id)+'\\')">'+__t.suspend+'</button> ';
    o+='<button class="action-btn" onclick="removeGenesisPeer(\\''+esc(p.id)+'\\')">'+__t.remove+'</button></td></tr>';
  }
  o+='</tbody></table>';
  return o;
}
async function approveGenesisPeer(id){
  try{await api('/v1/admin/genesis-peers/'+encodeURIComponent(id)+'/approve',{method:'POST'});loadAll();}catch(e){alert(__t.errorLabel+': '+e.message);}
}
async function suspendGenesisPeer(id){
  try{await api('/v1/admin/genesis-peers/'+encodeURIComponent(id)+'/suspend',{method:'POST'});loadAll();}catch(e){alert(__t.errorLabel+': '+e.message);}
}
async function removeGenesisPeer(id){
  if(!confirm(__t.removeConfirm))return;
  try{await api('/v1/admin/genesis-peers/'+encodeURIComponent(id),{method:'DELETE'});loadAll();}catch(e){alert(__t.errorLabel+': '+e.message);}
}

loadAll();
</script>
</body>
</html>`;
}
