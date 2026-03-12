import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { randomBytes } from 'node:crypto';
import { generateKeyPair, sign } from '../auth/keypair.js';
import { validateOwnerName, buildGAII } from '../utils/gaii.js';
import { issueJWT } from '../auth/jwt.js';
import { generateOtk } from '../utils/otk.js';
// i18n imports removed — admin UI is now a client-side SPA
// admin-dashboard.ts SSR removed — admin UI is now a SPA at /v1/admin
import { hashPassword } from '../services/password.js';
import type { ConfigProvenance } from '../services/config-provenance.js';
import type { ConsulConfigService } from '../services/consul-config.js';
import { emitChange } from '../services/event-bus.js';

// Sub-routers (domain-split from admin.ts)
import { adminConfigRouter } from './admin-config.js';
import { adminMonitoringRouter } from './admin-monitoring.js';
import { adminAgentsRouter } from './admin-agents.js';
import { adminMaintenanceRouter } from './admin-maintenance.js';
import { adminEconomyRouter } from './admin-economy.js';

export function adminRouter(
    config: AimeatConfig,
    storage: Storage,
    maintenanceCache?: {
        get: () => import('../storage/interface.js').MaintenanceState;
        set: (state: import('../storage/interface.js').MaintenanceState) => void;
    },
    provenance?: ConfigProvenance,
    consulService?: ConsulConfigService | null,
): Router {
    const router = Router();

    // ── Admin session management (in-memory, ephemeral) ──
    const adminSessions = new Map<string, { createdAt: number }>();
    const ADMIN_SESSION_TTL = 3600_000; // 1 hour

    function createAdminSession(): string {
        const sessionId = randomBytes(32).toString('hex');
        adminSessions.set(sessionId, { createdAt: Date.now() });
        return sessionId;
    }

    function validateAdminSession(sessionId: string): boolean {
        const session = adminSessions.get(sessionId);
        if (!session) return false;
        if (Date.now() - session.createdAt > ADMIN_SESSION_TTL) {
            adminSessions.delete(sessionId);
            return false;
        }
        return true;
    }

    /** Parse a named cookie from the raw Cookie header */
    function getCookie(req: import('express').Request, name: string): string | undefined {
        const header = req.headers.cookie;
        if (!header) return undefined;
        const match = header.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
        return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
    }

    /** Inject CSP nonce attributes into all <script> and <style> tags in an HTML string */
    function injectCspNonce(html: string, res: import('express').Response): string {
        const nonce = res.locals.cspNonce as string || '';
        if (!nonce) return html;
        return html
            .replace(/<script(?=[ >])/g, `<script nonce="${nonce}"`)
            .replace(/<style(?=[ >])/g, `<style nonce="${nonce}"`);
    }

    // ── Admin Setup Pages (password-protected, no JWT needed) ──

    function checkSetupPassword(req: import('express').Request, res: import('express').Response): boolean {
        // Check admin session cookie first
        const sessionId = getCookie(req, 'admin_session') ?? (req.headers['x-admin-session'] as string);
        if (sessionId && validateAdminSession(sessionId)) return true;

        // Accept password via header only (NOT query param — password must not appear in URLs)
        const pw = (req.headers['x-admin-password'] as string) ?? '';
        if (!config.adminPassword || pw !== config.adminPassword) {
            res.status(401).type('text/html').send(injectCspNonce(ADMIN_LOGIN_HTML, res));
            return false;
        }
        return true;
    }

    /** Set the admin session cookie on a response */
    function setSessionCookie(res: import('express').Response, sessionId: string): void {
        const isHttps = config.baseUrl?.startsWith('https://');
        res.setHeader('Set-Cookie',
            `admin_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/v1/admin; Max-Age=3600${isHttps ? '; Secure' : ''}`);
    }

    // POST /v1/admin/setup/auth — authenticate with admin password, get session cookie
    router.post('/v1/admin/setup/auth', (req, res) => {
        const pw = (req.headers['x-admin-password'] as string) ?? req.body?.admin_password ?? '';
        if (!config.adminPassword || pw !== config.adminPassword) {
            res.status(401).json({ ok: false, error: 'Invalid admin password' });
            return;
        }
        const sessionId = createAdminSession();
        setSessionCookie(res, sessionId);
        res.json({ ok: true, session_id: sessionId });
    });

    // GET /v1/admin/setup — setup wizard (password never embedded in HTML)
    router.get('/v1/admin/setup', (req, res) => {
        // Check if already authenticated via session cookie
        const sessionId = getCookie(req, 'admin_session');
        if (sessionId && validateAdminSession(sessionId)) {
            res.type('text/html').send(injectCspNonce(ADMIN_SETUP_HTML.replace(/\{\{NODE_ID\}\}/g, config.nodeId), res));
            return;
        }
        // Show login page (no password embedded anywhere)
        res.type('text/html').send(injectCspNonce(ADMIN_LOGIN_HTML, res));
    });

    // POST /v1/admin/setup/register — register owner (password-protected, no auth)
    router.post('/v1/admin/setup/register', async (req, res) => {
        // Check admin session (cookie or header) or password via header (NOT query param)
        const sessionId = getCookie(req, 'admin_session') ?? (req.headers['x-admin-session'] as string);
        const pw = (req.headers['x-admin-password'] as string) ?? '';
        if (!(sessionId && validateAdminSession(sessionId)) && (!config.adminPassword || pw !== config.adminPassword)) {
            res.status(401).json({ ok: false, error: 'Invalid admin password' });
            return;
        }

        const { name, display_name, password } = req.body ?? {};
        if (!name || typeof name !== 'string') {
            res.status(400).json({ ok: false, error: 'name is required' });
            return;
        }

        const nameError = validateOwnerName(name);
        if (nameError) {
            res.status(400).json({ ok: false, error: nameError });
            return;
        }

        const existing = await storage.getOwner(name);
        if (existing) {
            res.status(409).json({ ok: false, error: `Owner "${name}" already exists` });
            return;
        }

        const keyPair = await generateKeyPair();
        const allOwners = await storage.listOwners();
        const realOwners = allOwners.filter(o => o.name !== 'anonymous');
        // Setup wizard is admin-password-protected — always grant operator
        const roles = ['owner', 'operator'];

        const owner = await storage.createOwner({
            name,
            displayName: display_name,
            publicKey: keyPair.publicKey,
            roles,
            createdAt: new Date().toISOString(),
        });

        // Create GHII profile if password provided (human-friendly login)
        let hasPassword = false;
        if (password && typeof password === 'string' && password.length >= 4) {
            const passwordHash = await hashPassword(password);
            const ghii = `${name}@${config.nodeId}`;
            const now = new Date().toISOString();
            try {
                await storage.createGHII({
                    username: name,
                    nodeId: config.nodeId,
                    ghii,
                    displayName: display_name ?? name,
                    passwordHash,
                    verificationLevel: 0,
                    ownerName: name,
                    totpEnabled: false,
                    createdAt: now,
                    updatedAt: now,
                });
                hasPassword = true;
            } catch { /* GHII record may already exist */ }
        }

        res.json({ ok: true, owner: { name: owner.name, roles: owner.roles }, private_key: keyPair.privateKey, public_key: keyPair.publicKey, has_password: hasPassword });
        emitChange('config');
    });

    // POST /v1/admin/setup/token — sign + get JWT for an owner (password-protected)
    router.post('/v1/admin/setup/token', async (req, res) => {
        // Check admin session (cookie or header) or password via header (NOT query param)
        const sessionId = getCookie(req, 'admin_session') ?? (req.headers['x-admin-session'] as string);
        const pw = (req.headers['x-admin-password'] as string) ?? '';
        if (!(sessionId && validateAdminSession(sessionId)) && (!config.adminPassword || pw !== config.adminPassword)) {
            res.status(401).json({ ok: false, error: 'Invalid admin password' });
            return;
        }

        const { owner: ownerName, private_key } = req.body ?? {};
        if (!ownerName || !private_key) {
            res.status(400).json({ ok: false, error: 'owner and private_key are required' });
            return;
        }

        const ownerRecord = await storage.getOwner(ownerName);
        if (!ownerRecord) {
            res.status(404).json({ ok: false, error: `Owner not found: ${ownerName}` });
            return;
        }

        const timestamp = new Date().toISOString();
        const message = ownerName + config.nodeId + timestamp;
        const signature = await sign(private_key, message);

        // Verify signature matches stored public key (sanity check)
        const { verify: ed25519Verify } = await import('../auth/keypair.js');
        const valid = await ed25519Verify(ownerRecord.publicKey, message, signature);
        if (!valid) {
            res.status(401).json({ ok: false, error: 'Private key does not match the owner\'s public key' });
            return;
        }

        const token = await issueJWT({
            sub: ownerName,
            owner: ownerName,
            node: config.nodeId,
            roles: [...ownerRecord.roles],
        }, config.jwtTtlSeconds);

        res.json({
            ok: true,
            token,
            expires_at: new Date(Date.now() + config.jwtTtlSeconds * 1000).toISOString(),
            roles: ownerRecord.roles,
            dashboard_url: '/v1/admin',
        });
    });

    // POST /v1/admin/setup/initial-otk — generate an Initial OTK (password-protected)
    router.post('/v1/admin/setup/initial-otk', async (req, res) => {
        // Check admin session or password via header (NOT query param)
        const sessionId = getCookie(req, 'admin_session') ?? (req.headers['x-admin-session'] as string);
        const pw = (req.headers['x-admin-password'] as string) ?? '';
        if (!(sessionId && validateAdminSession(sessionId)) && (!config.adminPassword || pw !== config.adminPassword)) {
            res.status(401).json({ ok: false, error: 'Invalid admin password' });
            return;
        }

        const { owner } = req.body ?? {};
        if (!owner || typeof owner !== 'string') {
            res.status(400).json({ ok: false, error: 'owner name is required' });
            return;
        }

        // Find agent or use owner as identity
        const agents = await storage.getAgentsByOwner(owner);
        const ownerGaii = agents.length > 0 ? agents[0].gaii : owner;

        const key = generateOtk();
        const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString();

        await storage.createOtk({
            key,
            ownerGaii,
            action: 'initial',
            params: {},
            expiresAt: farFuture,
            initial: true,
            used: false,
            usedAt: null,
            sessionId: null,
            createdAt: new Date().toISOString(),
        });

        res.json({
            ok: true,
            otk: key,
            initial: true,
            owner: ownerGaii,
            grace_ms: config.otkGraceMs,
            dev_mode: config.devMode,
            node_url: config.baseUrl,
            note: `Initial OTK — no expiry until first use. After first use, valid for ${config.otkGraceMs / 1000}s.`,
        });
    });

    // GET /v1/admin/dashboard — node overview (operator only)
    router.get('/v1/admin/dashboard', requireAuth(), requireRole('operator'), async (_req, res) => {
        const owners = await storage.listOwners();
        const agents = await storage.listAgents();
        const actions = await storage.listActions();
        const boards = await storage.listBoards();
        const chatInstances = await storage.listChatInstances({});
        const allWork = await storage.listAllWork();
        const allDisputes = await storage.listAllDisputes();

        let totalMorsels = 0;
        let activeAgents = 0;
        const now = Date.now();
        const dayStart = new Date();
        dayStart.setUTCHours(0, 0, 0, 0);

        for (const a of agents) {
            totalMorsels += a.morselBalance;
            if (a.lastSeen && now - new Date(a.lastSeen).getTime() < 86_400_000) {
                activeAgents++;
            }
        }

        // §14.2 / §14.3: Compute full economy metrics from transaction history
        const allTx = await storage.listAllTransactions();
        const thirtyDaysAgo = new Date(now - 30 * 86_400_000);

        let totalMinted = 0;
        let totalBurned = 0;
        let minted30d = 0;
        let burned30d = 0;
        // Daily metrics (§14.2)
        let transactionsToday = 0;
        let morselsTransactedToday = 0;
        let networkFeesToday = 0;
        let burnedToday = 0;
        let dailyAllowancesIssuedToday = 0;

        for (const tx of allTx) {
            const txDate = new Date(tx.timestamp);
            const isToday = txDate >= dayStart;

            if (tx.type === 'mint' || tx.type === 'welcome_bonus' || tx.type === 'daily_allowance') {
                totalMinted += tx.amount;
                if (txDate >= thirtyDaysAgo) minted30d += tx.amount;
            }
            if (tx.type === 'burn') {
                totalBurned += Math.abs(tx.amount);
                if (txDate >= thirtyDaysAgo) burned30d += Math.abs(tx.amount);
            }

            // Daily aggregations
            if (isToday) {
                transactionsToday++;
                morselsTransactedToday += Math.abs(tx.amount);
                if (tx.type === 'network_fee') networkFeesToday += Math.abs(tx.amount);
                if (tx.type === 'burn') burnedToday += Math.abs(tx.amount);
                if (tx.type === 'daily_allowance') dailyAllowancesIssuedToday++;
            }
        }

        // Inflation rate = net new morsels over 30d as % of current supply
        const netNew30d = minted30d - burned30d;
        const inflationRate30d = totalMorsels > 0
            ? parseFloat(((netNew30d / totalMorsels) * 100).toFixed(2))
            : 0;
        const burnMintRatio = minted30d > 0
            ? parseFloat((burned30d / minted30d).toFixed(4))
            : 0;

        // §14.3: Health thresholds (Table 14.3)
        // Compute rates for threshold evaluation
        const recentWork30d = allWork.filter(w => new Date(w.createdAt) >= thirtyDaysAgo);
        const expiredWork30d = recentWork30d.filter(w => w.status === 'expired' || (w.status === 'pending' && new Date(w.ttlExpiresAt) < new Date()));
        const workExpiryRate = recentWork30d.length > 0
            ? parseFloat((expiredWork30d.length / recentWork30d.length).toFixed(4))
            : 0;

        const recentDisputes30d = allDisputes.filter(d => new Date(d.createdAt) >= thirtyDaysAgo);
        const disputeRate = recentWork30d.length > 0
            ? parseFloat((recentDisputes30d.length / recentWork30d.length).toFixed(4))
            : 0;

        // Agent churn: agents created in last 30d that have no work
        const newAgents30d = agents.filter(a => new Date(a.createdAt) >= thirtyDaysAgo);
        const churned30d = newAgents30d.filter(a =>
            !a.lastSeen || (now - new Date(a.lastSeen).getTime() > 7 * 86_400_000)
        );
        const agentChurnRate = newAgents30d.length > 0
            ? parseFloat((churned30d.length / newAgents30d.length).toFixed(4))
            : 0;

        type HealthZone = 'healthy' | 'watch' | 'danger';
        const warnings: { metric: string; zone: HealthZone; value: number; threshold: string; message: string }[] = [];

        function evaluateThreshold(metric: string, value: number, watchMin: number, dangerMin: number, direction: 'above' | 'below'): HealthZone {
            let zone: HealthZone = 'healthy';
            if (direction === 'above') {
                if (value >= dangerMin) zone = 'danger';
                else if (value >= watchMin) zone = 'watch';
            } else {
                if (value <= dangerMin) zone = 'danger';
                else if (value <= watchMin) zone = 'watch';
            }
            if (zone !== 'healthy') {
                warnings.push({
                    metric,
                    zone,
                    value,
                    threshold: `${direction === 'above' ? '>=' : '<='} ${zone === 'danger' ? dangerMin : watchMin} (${zone})`,
                    message: `${metric} is ${value} — ${zone} zone`,
                });
            }
            return zone;
        }

        // Thresholds per RFC Table 14.3
        const bmrZone = evaluateThreshold('burn_mint_ratio', burnMintRatio, 0, 0.1, 'below');
        const churnZone = evaluateThreshold('agent_churn_rate_30d', agentChurnRate, 0.3, 0.5, 'above');
        const expiryZone = evaluateThreshold('work_expiry_rate_30d', workExpiryRate, 0.1, 0.25, 'above');
        const disputeZone = evaluateThreshold('dispute_rate_30d', disputeRate, 0.05, 0.15, 'above');

        // Overall health = worst zone
        const zones: HealthZone[] = [bmrZone, churnZone, expiryZone, disputeZone];
        const overallHealth: HealthZone = zones.includes('danger') ? 'danger' : zones.includes('watch') ? 'watch' : 'healthy';

        res.json(success(config.nodeId, {
            node_id: config.nodeId,
            uptime_seconds: Math.floor(process.uptime()),
            storage_type: config.dbUrl ? 'mongodb' : 'in-memory',
            health: {
                status: overallHealth,
                burn_mint_ratio: { value: burnMintRatio, zone: bmrZone },
                agent_churn_rate_30d: { value: agentChurnRate, zone: churnZone },
                work_expiry_rate_30d: { value: workExpiryRate, zone: expiryZone },
                dispute_rate_30d: { value: disputeRate, zone: disputeZone },
            },
            warnings,
            counts: {
                owners: owners.length,
                agents: agents.length,
                active_agents_24h: activeAgents,
                actions: actions.length,
                boards: boards.length,
                chat_instances: chatInstances.length,
            },
            economy: {
                total_morsels_in_circulation: totalMorsels,
                total_minted_all_time: totalMinted,
                total_burned_all_time: totalBurned,
                inflation_rate_30d_percent: inflationRate30d,
                burn_mint_ratio: burnMintRatio,
                transactions_today: transactionsToday,
                morsels_transacted_today: morselsTransactedToday,
                network_fees_today: networkFeesToday,
                burned_today: burnedToday,
                daily_allowances_issued_today: dailyAllowancesIssuedToday,
                welcome_bonus: config.welcomeBonus,
                daily_allowance: config.dailyAllowance,
                daily_allowance_cap: config.dailyAllowanceCap,
                burn_rate: config.burnRate,
                max_operator_mint_per_day: config.maxOperatorMintPerDay,
            },
            config: {
                port: config.port,
                jwt_ttl_seconds: config.jwtTtlSeconds,
                keyed_browse_enabled: config.keyedBrowseEnabled,
            },
            ...(config.personalNodesEnabled ? await (async () => {
                const personalNodes = await storage.listPersonalNodes();
                let mailboxTotalBytes = 0;
                const statusCounts = { online: 0, offline: 0, degraded: 0, detached: 0 };
                for (const pn of personalNodes) {
                    statusCounts[pn.status] = (statusCounts[pn.status] ?? 0) + 1;
                    const stats = await storage.getMailboxStats(pn.nodeId);
                    mailboxTotalBytes += stats.totalBytes;
                }
                return {
                    personal_nodes: {
                        total: personalNodes.length,
                        max_slots: config.personalNodeMaxSlots,
                        ...statusCounts,
                        mailbox_total_bytes: mailboxTotalBytes,
                    },
                };
            })() : {}),
        }, [
            { description: 'View all agents', method: 'GET', url: '/v1/agents' },
            { description: 'Update config', method: 'PUT', url: '/v1/admin/config' },
        ]));
    });

    // GET /v1/admin/ui — legacy URL, redirect to SPA
    router.get('/v1/admin/ui', (_req, res) => {
        res.redirect(301, '/v1/admin');
    });

    // ── Mount domain sub-routers ──
    router.use(adminConfigRouter(config, storage, provenance, consulService));
    router.use(adminMonitoringRouter(config, storage));
    router.use(adminAgentsRouter(config, storage));
    router.use(adminMaintenanceRouter(config, storage, maintenanceCache));
    router.use(adminEconomyRouter(config, storage));

    return router;
}


// ── Admin Login Page HTML ──
const ADMIN_LOGIN_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>AIMEAT Admin</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f172a;color:#e2e8f0;font-family:system-ui,-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh}
.box{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px;width:380px;text-align:center}
h1{font-size:1.4rem;margin-bottom:8px}
.sub{color:#94a3b8;font-size:.85rem;margin-bottom:24px}
input{width:100%;padding:10px 14px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:.95rem;margin-bottom:16px}
input:focus{outline:none;border-color:#3b82f6}
button{width:100%;padding:10px;border-radius:8px;border:none;background:#3b82f6;color:#fff;font-size:.95rem;font-weight:600;cursor:pointer}
button:hover{background:#2563eb}
button:disabled{opacity:.5;cursor:not-allowed}
.hint{color:#64748b;font-size:.75rem;margin-top:16px}
.err{color:#ef4444;font-size:.85rem;margin-top:8px;display:none}
</style></head><body>
<div class="box">
<h1>&#x2764;&#xFE0F; AIMEAT Admin</h1>
<p class="sub">Enter the admin password to continue</p>
<form id="loginForm">
<input type="password" id="pw" placeholder="Admin password" autofocus autocomplete="current-password"/>
<button type="submit" id="btn">Continue</button>
</form>
<p id="errMsg" class="err"></p>
<p class="hint">Password is printed when the server starts, or set via AIMEAT_ADMIN_PASSWORD</p>
</div>
<script>
document.getElementById('loginForm').addEventListener('submit', go);
async function go(e){
  e.preventDefault();
  var pw=document.getElementById('pw').value;
  if(!pw)return;
  var btn=document.getElementById('btn');
  btn.disabled=true;btn.textContent='Authenticating...';
  document.getElementById('errMsg').style.display='none';
  try{
    var r=await fetch('/v1/admin/setup/auth',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Password':pw},body:'{}'});
    var d=await r.json();
    if(!d.ok){document.getElementById('errMsg').textContent=d.error||'Invalid password';document.getElementById('errMsg').style.display='block';btn.disabled=false;btn.textContent='Continue';return;}
    // Cookie is set by the server response — just reload the page
    location.href='/v1/admin/setup';
  }catch(ex){document.getElementById('errMsg').textContent='Network error';document.getElementById('errMsg').style.display='block';btn.disabled=false;btn.textContent='Continue';}
}
</script>
</body></html>`;

// ── Admin Setup Wizard HTML (Login + Register tabs) ──
const ADMIN_SETUP_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>AIMEAT Admin</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#94a3b8;
--green:#22c55e;--yellow:#eab308;--red:#ef4444;--blue:#3b82f6;--cyan:#06b6d4}
body{background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,sans-serif;padding:20px;min-height:100vh;display:flex;justify-content:center;align-items:flex-start;padding-top:60px}
.container{max-width:480px;width:100%}
h1{font-size:1.5rem;margin-bottom:4px;text-align:center}
.sub{color:var(--muted);font-size:.85rem;margin-bottom:24px;text-align:center}

/* Tabs */
.tabs{display:flex;gap:0;margin-bottom:0;border-bottom:2px solid var(--border)}
.tab{flex:1;padding:12px 16px;text-align:center;font-size:.95rem;font-weight:600;cursor:pointer;border:none;background:transparent;color:var(--muted);border-bottom:3px solid transparent;margin-bottom:-2px;transition:all .15s}
.tab:hover{color:var(--text)}
.tab.active{color:var(--cyan);border-bottom-color:var(--cyan)}
.tab-panel{display:none}
.tab-panel.active{display:block}

.card{background:var(--card);border:1px solid var(--border);border-radius:0 0 10px 10px;padding:24px;margin-bottom:16px}
.card.standalone{border-radius:10px}
label{display:block;color:var(--muted);font-size:.8rem;margin-bottom:4px;margin-top:14px}
label:first-child{margin-top:0}
input[type=text],input[type=password],textarea{width:100%;padding:10px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.9rem;font-family:inherit}
textarea{resize:vertical;min-height:60px;font-family:'SF Mono',Consolas,monospace;font-size:.8rem}
input:focus,textarea:focus{outline:none;border-color:var(--blue)}
button{padding:12px 24px;border-radius:8px;border:none;font-size:.95rem;font-weight:600;cursor:pointer;margin-top:16px;width:100%}
.btn-primary{background:var(--blue);color:#fff}
.btn-primary:hover{background:#2563eb}
.btn-primary:disabled{opacity:.5;cursor:not-allowed}
.btn-green{background:var(--green);color:#000;display:inline-block;text-decoration:none;text-align:center;padding:12px 24px;border-radius:8px;font-weight:600;font-size:.95rem;margin-top:16px;width:100%}
.btn-green:hover{opacity:.85}
.result{margin-top:14px;padding:12px;border-radius:8px;font-size:.85rem;word-break:break-all}
.result-ok{background:#16a34a18;border:1px solid #16a34a55;color:var(--green)}
.result-err{background:#dc262618;border:1px solid #dc262655;color:var(--red)}
.key-box{font-family:'SF Mono',Consolas,monospace;font-size:.8rem;background:var(--bg);padding:8px;border-radius:6px;border:1px solid var(--border);margin-top:6px;word-break:break-all;user-select:all}
.hidden{display:none}
a{color:var(--cyan);text-decoration:none}
a:hover{text-decoration:underline}
.warn{color:var(--yellow);font-size:.8rem;margin-top:8px}
.divider{border-top:1px solid var(--border);margin:20px 0;position:relative}
.divider span{position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--card);padding:0 12px;color:var(--muted);font-size:.75rem}
.success-panel{text-align:center;padding:16px 0}
.success-panel h3{color:var(--green);font-size:1.1rem;margin-bottom:8px}
.desc{font-size:.9rem;color:var(--muted);margin-bottom:4px}
.toggle-link{color:var(--muted);font-size:.75rem;margin-top:12px;text-align:center}
.roles-text{color:var(--muted);font-size:.85rem;margin-bottom:4px}
.jwt-section{margin-top:14px;text-align:left}
.pw-hint{color:var(--muted);font-size:.72rem;margin-top:2px}
.label-tag{color:var(--cyan);font-size:.7rem}
</style></head><body>
<div class="container">
<h1>&#x2764;&#xFE0F; AIMEAT</h1>
<p class="sub">Node: <strong>{{NODE_ID}}</strong></p>

<div class="tabs">
  <button class="tab active" data-tab="login">Login</button>
  <button class="tab" data-tab="register">Register</button>
</div>

<!-- ═══ LOGIN TAB ═══ -->
<div class="tab-panel active" id="panel-login">
<div class="card">
  <!-- Password Login (default for humans) -->
  <div id="loginPasswordMode">
    <p class="desc">Sign in with your username and password.</p>
    <label>Username</label>
    <input type="text" id="loginUser" placeholder="e.g. myname" autocomplete="username" autofocus/>
    <label>Password</label>
    <input type="password" id="loginPass" placeholder="Your password" autocomplete="current-password"/>
    <button class="btn-primary" id="btnPwLogin">Login</button>
    <p class="toggle-link">
      <a href="#" id="toggleToKeyLogin">Advanced: Login with private key</a>
    </p>
  </div>
  <!-- Key Login (advanced, for developers/agents) -->
  <div id="loginKeyMode" class="hidden">
    <p class="desc">Sign in with your owner name and private key.</p>
    <label>Owner Name</label>
    <input type="text" id="loginOwner" placeholder="e.g. myname" autocomplete="off"/>
    <label>Private Key</label>
    <textarea id="loginKey" placeholder="Paste your private key here" rows="3"></textarea>
    <button class="btn-primary" id="btnLogin">Login</button>
    <p class="toggle-link">
      <a href="#" id="toggleToPwLogin">Back to password login</a>
    </p>
  </div>
  <div id="loginResult" class="hidden"></div>
  <div id="loginSuccess" class="hidden">
    <div class="success-panel">
      <h3>&#x2713; Authenticated</h3>
      <p class="roles-text" id="loginRoles"></p>
      <a id="loginDashLink" href="#" class="btn-green">Open Dashboard &#x2192;</a>
      <div class="jwt-section">
        <label>JWT Token (for API use)</label>
        <div class="key-box" id="loginJwtBox"></div>
      </div>
    </div>
  </div>
</div>
</div>

<!-- ═══ REGISTER TAB ═══ -->
<div class="tab-panel" id="panel-register">
<div class="card">
  <p class="desc">Create a new owner account. The first owner gets the <strong>operator</strong> role.</p>
  <label>Owner Name</label>
  <input type="text" id="regOwner" placeholder="e.g. myname" autocomplete="off"/>
  <label>Display Name (optional)</label>
  <input type="text" id="regDisplay" placeholder="e.g. Node Operator"/>
  <label>Password <span class="label-tag">(recommended)</span></label>
  <input type="password" id="regPassword" placeholder="Set a login password" autocomplete="new-password"/>
  <p class="pw-hint">With a password you can login from any device without keys.</p>
  <button class="btn-primary" id="btnRegister">Create Account</button>
  <div id="regResult" class="hidden"></div>
  <div id="regKeys" class="hidden">
    <div class="divider"><span>YOUR KEYS</span></div>
    <div class="warn">&#x26A0; Save your private key NOW \u2014 it cannot be recovered!</div>
    <label>Private Key</label>
    <div class="key-box" id="regPrivateKey"></div>
    <label>Public Key</label>
    <div class="key-box" id="regPublicKey"></div>
    <div class="divider"><span>CONTINUE</span></div>
    <button class="btn-primary" id="btnRegToken">Login &amp; Open Dashboard</button>
    <div id="regTokenResult" class="hidden"></div>
    <div id="regSuccess" class="hidden">
      <div class="success-panel">
        <h3>&#x2713; Authenticated</h3>
        <p class="roles-text" id="regRoles"></p>
        <a id="regDashLink" href="#" class="btn-green">Open Dashboard &#x2192;</a>
        <div class="jwt-section">
          <label>JWT Token (for API use)</label>
          <div class="key-box" id="regJwtBox"></div>
        </div>
      </div>
    </div>
  </div>
</div>
</div>

</div>
<script>
let regOwner='',regKey='';

function switchTab(name){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active')});
  document.querySelectorAll('.tab-panel').forEach(function(p){p.classList.remove('active')});
  document.querySelector('.tab[data-tab="'+name+'"]').classList.add('active');
  document.getElementById('panel-'+name).classList.add('active');
}

function toggleLoginMode(e){
  e.preventDefault();
  document.getElementById('loginPasswordMode').classList.toggle('hidden');
  document.getElementById('loginKeyMode').classList.toggle('hidden');
}

async function api(method,path,body){
  const h={'Content-Type':'application/json'};
  const r=await fetch(path,{method,headers:h,body:body?JSON.stringify(body):undefined,credentials:'same-origin'});
  return r.json();
}

async function apiNoAdmin(method,path,body){
  const h={'Content-Type':'application/json'};
  const r=await fetch(path,{method,headers:h,body:body?JSON.stringify(body):undefined});
  return r.json();
}

function show(id,html,cls){const el=document.getElementById(id);el.className='result '+(cls||'');el.innerHTML=html;el.classList.remove('hidden');}
function esc(s){const d=document.createElement('div');d.textContent=String(s??'');return d.innerHTML;}

function showLoginSuccess(token,roles,dashUrl){
  document.getElementById('loginResult').classList.add('hidden');
  document.getElementById('loginRoles').textContent='Roles: '+(Array.isArray(roles)?roles.join(', '):roles);
  document.getElementById('loginDashLink').href=dashUrl||'/v1/admin';
  document.getElementById('loginJwtBox').textContent=token;
  document.getElementById('loginSuccess').classList.remove('hidden');
}

/* \u2500\u2500 PASSWORD LOGIN \u2500\u2500 */
async function doPasswordLogin(){
  const user=document.getElementById('loginUser').value.trim();
  const pass=document.getElementById('loginPass').value;
  if(!user||!pass){show('loginResult','Username and password are required','result-err');return;}
  document.getElementById('btnPwLogin').disabled=true;
  document.getElementById('btnPwLogin').textContent='Signing in...';
  document.getElementById('loginSuccess').classList.add('hidden');
  try{
    const r=await apiNoAdmin('POST','/v1/ghii/login',{username:user,password:pass});
    if(r.error_code||!r.data){
      show('loginResult',esc((r.error&&r.error.message)||r.error||(r.data&&r.data.error)||'Login failed'),'result-err');
      document.getElementById('btnPwLogin').disabled=false;document.getElementById('btnPwLogin').textContent='Login';return;
    }
    var d=r.data;
    // Store session in localStorage so aimeat-auth.js picks it up on dashboard load
    try{localStorage.setItem('aimeat_session',JSON.stringify({owner:d.owner.name,gaii:d.agent.gaii,ghii:d.ghii.ghii,jwt:d.token,publicKey:'',privateKey:d.agent_private_key}));}catch(e){}
    showLoginSuccess(d.token,['owner','operator'],'/v1/admin');
    document.getElementById('btnPwLogin').textContent='Login';
    document.getElementById('btnPwLogin').disabled=false;
  }catch(e){show('loginResult','Network error: '+esc(e.message),'result-err');document.getElementById('btnPwLogin').disabled=false;document.getElementById('btnPwLogin').textContent='Login';}
}

/* \u2500\u2500 KEY LOGIN \u2500\u2500 */
async function doLogin(){
  const owner=document.getElementById('loginOwner').value.trim();
  const key=document.getElementById('loginKey').value.trim();
  if(!owner||!key){show('loginResult','Owner name and private key are required','result-err');return;}
  document.getElementById('btnLogin').disabled=true;
  document.getElementById('btnLogin').textContent='Signing in...';
  document.getElementById('loginSuccess').classList.add('hidden');
  try{
    const r=await api('POST','/v1/admin/setup/token',{owner:owner,private_key:key});
    if(!r.ok){show('loginResult',esc((r.error&&r.error.message)||r.error||'Login failed'),'result-err');document.getElementById('btnLogin').disabled=false;document.getElementById('btnLogin').textContent='Login';return;}
    // Store session in localStorage so aimeat-auth.js picks it up on dashboard load
    try{localStorage.setItem('aimeat_session',JSON.stringify({owner:owner,jwt:r.token,publicKey:''}));}catch(e){}
    showLoginSuccess(r.token,r.roles,r.dashboard_url);
    document.getElementById('btnLogin').textContent='Login';
    document.getElementById('btnLogin').disabled=false;
  }catch(e){show('loginResult','Network error: '+esc(e.message),'result-err');document.getElementById('btnLogin').disabled=false;document.getElementById('btnLogin').textContent='Login';}
}

/* \u2500\u2500 REGISTER \u2500\u2500 */
async function doRegister(){
  const name=document.getElementById('regOwner').value.trim();
  const dname=document.getElementById('regDisplay').value.trim();
  const password=document.getElementById('regPassword').value;
  if(!name){show('regResult','Owner name is required','result-err');return;}
  document.getElementById('btnRegister').disabled=true;
  try{
    const body={name:name,display_name:dname||undefined};
    if(password&&password.length>=4)body.password=password;
    const r=await api('POST','/v1/admin/setup/register',body);
    if(!r.ok){show('regResult',esc((r.error&&r.error.message)||r.error||'Registration failed'),'result-err');document.getElementById('btnRegister').disabled=false;return;}
    regOwner=r.owner.name;regKey=r.private_key;
    var roles=r.owner.roles.join(', ');
    var msg='<strong>Account created!</strong> Roles: '+roles;
    if(r.has_password)msg+='<br/><span class="label-tag">Password login enabled \u2014 you can login with your username and password.</span>';
    show('regResult',msg,'result-ok');
    document.getElementById('regPrivateKey').textContent=r.private_key;
    document.getElementById('regPublicKey').textContent=r.public_key;
    document.getElementById('regKeys').classList.remove('hidden');
  }catch(e){show('regResult','Network error: '+esc(e.message),'result-err');document.getElementById('btnRegister').disabled=false;}
}

async function doRegToken(){
  if(!regOwner||!regKey){show('regTokenResult','Register first','result-err');return;}
  document.getElementById('btnRegToken').disabled=true;
  document.getElementById('btnRegToken').textContent='Signing in...';
  try{
    const r=await api('POST','/v1/admin/setup/token',{owner:regOwner,private_key:regKey});
    if(!r.ok){show('regTokenResult',esc((r.error&&r.error.message)||r.error||'Token request failed'),'result-err');document.getElementById('btnRegToken').disabled=false;document.getElementById('btnRegToken').textContent='Login & Open Dashboard';return;}
    // Store session in localStorage so aimeat-auth.js picks it up on dashboard load
    try{localStorage.setItem('aimeat_session',JSON.stringify({owner:regOwner,jwt:r.token,publicKey:''}));}catch(e){}
    document.getElementById('regTokenResult').classList.add('hidden');
    document.getElementById('regRoles').textContent='Roles: '+r.roles.join(', ');
    document.getElementById('regDashLink').href=r.dashboard_url;
    document.getElementById('regJwtBox').textContent=r.token;
    document.getElementById('regSuccess').classList.remove('hidden');
    document.getElementById('btnRegToken').classList.add('hidden');
  }catch(e){show('regTokenResult','Network error: '+esc(e.message),'result-err');document.getElementById('btnRegToken').disabled=false;document.getElementById('btnRegToken').textContent='Login & Open Dashboard';}
}

/* ── Bind event listeners ── */
document.querySelectorAll('.tab[data-tab]').forEach(function(t){t.addEventListener('click',function(){switchTab(t.getAttribute('data-tab'))})});
document.getElementById('toggleToKeyLogin').addEventListener('click',toggleLoginMode);
document.getElementById('toggleToPwLogin').addEventListener('click',toggleLoginMode);
document.getElementById('btnPwLogin').addEventListener('click',doPasswordLogin);
document.getElementById('btnLogin').addEventListener('click',doLogin);
document.getElementById('btnRegister').addEventListener('click',doRegister);
document.getElementById('btnRegToken').addEventListener('click',doRegToken);
</script>
</body></html>`;
