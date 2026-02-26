import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { listHooks } from '../services/hooks.js';
import type { HookName } from '../config.js';
import { RoleGrantSchema, validateBody } from '../models/schemas.js';
import { randomBytes } from 'node:crypto';
import { generateKeyPair, sign } from '../auth/keypair.js';
import { validateOwnerName } from '../utils/gaii.js';
import { issueJWT } from '../auth/jwt.js';
import { generateOtk } from '../utils/otk.js';

export function adminRouter(config: MeatConfig, storage: Storage): Router {
    const router = Router();

    // ── Admin Setup Pages (password-protected, no JWT needed) ──

    function checkSetupPassword(req: import('express').Request, res: import('express').Response): boolean {
        const pw = (req.query.pw as string) ?? (req.headers['x-admin-password'] as string) ?? '';
        if (!config.adminPassword || pw !== config.adminPassword) {
            res.status(401).type('text/html').send(ADMIN_LOGIN_HTML);
            return false;
        }
        return true;
    }

    // GET /v1/admin/setup — setup wizard (register owner + get token)
    router.get('/v1/admin/setup', (req, res) => {
        if (!checkSetupPassword(req, res)) return;
        res.type('text/html').send(ADMIN_SETUP_HTML.replace(/\{\{PW\}\}/g, config.adminPassword!).replace(/\{\{NODE_ID\}\}/g, config.nodeId));
    });

    // POST /v1/admin/setup/register — register owner (password-protected, no auth)
    router.post('/v1/admin/setup/register', async (req, res) => {
        const pw = (req.query.pw as string) ?? (req.headers['x-admin-password'] as string) ?? '';
        if (!config.adminPassword || pw !== config.adminPassword) {
            res.status(401).json({ ok: false, error: 'Invalid admin password' });
            return;
        }

        const { name, display_name } = req.body ?? {};
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
        const roles = ['owner'];
        if (allOwners.length === 0) roles.push('operator');

        const owner = await storage.createOwner({
            name,
            displayName: display_name,
            publicKey: keyPair.publicKey,
            roles,
            createdAt: new Date().toISOString(),
        });

        res.json({ ok: true, owner: { name: owner.name, roles: owner.roles }, private_key: keyPair.privateKey, public_key: keyPair.publicKey });
    });

    // POST /v1/admin/setup/token — sign + get JWT for an owner (password-protected)
    router.post('/v1/admin/setup/token', async (req, res) => {
        const pw = (req.query.pw as string) ?? (req.headers['x-admin-password'] as string) ?? '';
        if (!config.adminPassword || pw !== config.adminPassword) {
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
            dashboard_url: `/v1/admin/ui?token=${token}`,
        });
    });

    // POST /v1/admin/setup/initial-otk — generate an Initial OTK (password-protected)
    router.post('/v1/admin/setup/initial-otk', async (req, res) => {
        const pw = (req.query.pw as string) ?? (req.headers['x-admin-password'] as string) ?? '';
        if (!config.adminPassword || pw !== config.adminPassword) {
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
            node_url: `http://localhost:${config.port}`,
            note: `Initial OTK — no expiry until first use. After first use, valid for ${config.otkGraceMs / 1000}s.`,
        });
    });

    // GET /v1/admin/dashboard — node overview (operator only)
    router.get('/v1/admin/dashboard', requireAuth(), requireRole('operator'), async (_req, res) => {
        const owners = await storage.listOwners();
        const agents = await storage.listAgents();
        const actions = await storage.listActions();
        const boards = await storage.listBoards();
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
        }, [
            { description: 'View all agents', method: 'GET', url: '/v1/agents' },
            { description: 'Update config', method: 'PUT', url: '/v1/admin/config' },
        ]));
    });

    // GET /v1/admin/ui — graphical admin dashboard (operator only, serves HTML)
    router.get('/v1/admin/ui', requireAuth(), requireRole('operator'), (_req, res) => {
        res.type('text/html').send(ADMIN_DASHBOARD_HTML);
    });

    // GET /v1/admin/config — full config schema with types, ranges, descriptions (§14.2)
    router.get('/v1/admin/config', requireAuth(), requireRole('operator'), async (_req, res) => {
        const schema: Record<string, { value: unknown; type: string; description: string; range?: string; mutable: boolean; path: string }> = {
            'node.id': { value: config.nodeId, type: 'string', description: 'Unique node identifier', mutable: false, path: 'node.id' },
            'node.port': { value: config.port, type: 'integer', description: 'HTTP listen port', range: '1-65535', mutable: false, path: 'node.port' },
            'node.type': { value: config.nodeType, type: 'string', description: 'Node type: full, relay, or mirror', mutable: false, path: 'node.type' },
            'storage.type': { value: config.dbUrl ? 'mongodb' : 'in-memory', type: 'string', description: 'Storage backend type', mutable: false, path: 'storage.type' },
            'morsel_policy.welcome_bonus': { value: config.welcomeBonus, type: 'integer', description: 'Morsels granted to new agents', range: '0-10000', mutable: true, path: 'morsel_policy.welcome_bonus' },
            'morsel_policy.daily_allowance': { value: config.dailyAllowance, type: 'integer', description: 'Daily morsel allowance per agent', range: '0-10000', mutable: true, path: 'morsel_policy.daily_allowance' },
            'morsel_policy.daily_allowance_cap': { value: config.dailyAllowanceCap, type: 'integer', description: 'Max balance for daily allowance eligibility', range: '0-100000', mutable: true, path: 'morsel_policy.daily_allowance_cap' },
            'morsel_policy.burn_rate': { value: config.burnRate, type: 'float', description: 'Fraction of network fees burned', range: '0.0-1.0', mutable: true, path: 'morsel_policy.burn_rate' },
            'morsel_policy.max_operator_mint_per_day': { value: config.maxOperatorMintPerDay, type: 'integer', description: 'Max morsels operator can mint per day', range: '0-1000000', mutable: true, path: 'morsel_policy.max_operator_mint_per_day' },
            'morsel_policy.board_post_base_cost': { value: config.boardPostBaseCost, type: 'integer', description: 'Base morsel cost for public board posts', range: '0-1000', mutable: true, path: 'morsel_policy.board_post_base_cost' },
            'morsel_policy.board_post_cost_per_kb': { value: config.boardPostCostPerKb, type: 'integer', description: 'Additional morsel cost per KB of post body', range: '0-100', mutable: true, path: 'morsel_policy.board_post_cost_per_kb' },
            'auth.jwt_ttl_seconds': { value: config.jwtTtlSeconds, type: 'integer', description: 'JWT token time-to-live in seconds', range: '60-86400', mutable: true, path: 'auth.jwt_ttl_seconds' },
            'features.keyed_browse_enabled': { value: config.keyedBrowseEnabled, type: 'boolean', description: 'Allow browsing with API keys', mutable: true, path: 'features.keyed_browse_enabled' },
            'features.extended_features_enabled': { value: config.extendedFeaturesEnabled, type: 'boolean', description: 'Enable extended feature set', mutable: true, path: 'features.extended_features_enabled' },
            'work.queue_max_pending': { value: config.workQueueMaxPending, type: 'integer', description: 'Max pending work items per provider', range: '1-1000', mutable: true, path: 'work.queue_max_pending' },
            'work.webhook_max_retries': { value: config.webhookMaxRetries, type: 'integer', description: 'Max webhook delivery retry attempts', range: '0-10', mutable: true, path: 'work.webhook_max_retries' },
            'quota.memory_mb': { value: config.memoryQuotaMb, type: 'integer', description: 'Memory quota per agent in MB', range: '1-10000', mutable: true, path: 'quota.memory_mb' },
            'quota.storage_mb': { value: config.storageQuotaMb, type: 'integer', description: 'Storage quota per agent in MB', range: '1-100000', mutable: true, path: 'quota.storage_mb' },
            'quota.micro_memory_kb': { value: config.microMemoryQuotaKb, type: 'integer', description: 'Micro-memory quota per agent in KB', range: '1-10000', mutable: true, path: 'quota.micro_memory_kb' },
            'federation.max_relay_hops': { value: config.maxRelayHops, type: 'integer', description: 'Max relay hops for federated requests', range: '1-10', mutable: true, path: 'federation.max_relay_hops' },
            'rate_limits': { value: config.rateLimits, type: 'object', description: 'Rate limiting configuration per endpoint category', mutable: true, path: 'rate_limits' },
        };

        res.json(success(config.nodeId, { schema }));
    });

    // PUT /v1/admin/config — atomic config update with dot-path addressing (§14.2, Appendix B)
    // Body format: {"changes": [{"path": "morsel_policy.daily_allowance", "value": 75}, ...]}
    router.put('/v1/admin/config', requireAuth(), requireRole('operator'), async (req, res) => {
        const { changes } = req.body ?? {};

        if (!Array.isArray(changes) || changes.length === 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'Body must contain "changes" array with [{path, value}] entries'));
            return;
        }

        // Map dot-paths to config keys with validation
        const pathMap: Record<string, { key: keyof MeatConfig; validate: (v: unknown) => boolean }> = {
            'morsel_policy.welcome_bonus': { key: 'welcomeBonus', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 },
            'morsel_policy.daily_allowance': { key: 'dailyAllowance', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 },
            'morsel_policy.daily_allowance_cap': { key: 'dailyAllowanceCap', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 },
            'morsel_policy.burn_rate': { key: 'burnRate', validate: v => typeof v === 'number' && (v as number) >= 0 && (v as number) <= 1 },
            'morsel_policy.max_operator_mint_per_day': { key: 'maxOperatorMintPerDay', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 },
            'morsel_policy.board_post_base_cost': { key: 'boardPostBaseCost', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 },
            'morsel_policy.board_post_cost_per_kb': { key: 'boardPostCostPerKb', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 },
            'auth.jwt_ttl_seconds': { key: 'jwtTtlSeconds', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 60 },
            'features.keyed_browse_enabled': { key: 'keyedBrowseEnabled', validate: v => typeof v === 'boolean' },
            'features.extended_features_enabled': { key: 'extendedFeaturesEnabled', validate: v => typeof v === 'boolean' },
            'work.queue_max_pending': { key: 'workQueueMaxPending', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 },
            'work.webhook_max_retries': { key: 'webhookMaxRetries', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 },
            'quota.memory_mb': { key: 'memoryQuotaMb', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 },
            'quota.storage_mb': { key: 'storageQuotaMb', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 },
            'quota.micro_memory_kb': { key: 'microMemoryQuotaKb', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 },
            'federation.max_relay_hops': { key: 'maxRelayHops', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 },
            'rate_limits': { key: 'rateLimits', validate: v => typeof v === 'object' && v !== null },
        };

        const applied: { path: string; old_value: unknown; new_value: unknown }[] = [];
        const errors: { path: string; reason: string }[] = [];

        for (const change of changes) {
            const { path, value } = change ?? {};
            if (typeof path !== 'string' || value === undefined) {
                errors.push({ path: path ?? '(missing)', reason: 'Each change must have "path" (string) and "value"' });
                continue;
            }
            const mapping = pathMap[path];
            if (!mapping) {
                errors.push({ path, reason: `Unknown config path. Valid paths: ${Object.keys(pathMap).join(', ')}` });
                continue;
            }
            if (!mapping.validate(value)) {
                errors.push({ path, reason: `Invalid value for ${path}` });
                continue;
            }
            const oldValue = config[mapping.key];
            (config as any)[mapping.key] = value;
            applied.push({ path, old_value: oldValue, new_value: value });
        }

        if (applied.length === 0 && errors.length > 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'No valid changes applied', undefined, { errors }));
            return;
        }

        res.json(success(config.nodeId, {
            applied,
            errors: errors.length > 0 ? errors : undefined,
            note: 'Runtime config updated. Changes lost on restart unless persisted to environment or config file.',
        }));
    });

    // GET /v1/admin/agents — list all agents with full details (operator only)
    router.get('/v1/admin/agents', requireAuth(), requireRole('operator'), async (_req, res) => {
        const agents = await storage.listAgents();

        res.json(success(config.nodeId, {
            agents: agents.map(a => ({
                gaii: a.gaii,
                owner: a.owner,
                display_name: a.displayName,
                trust_score: a.trustScore,
                morsel_balance: a.morselBalance,
                created_at: a.createdAt,
                last_seen: a.lastSeen,
            })),
            total: agents.length,
        }));
    });

    // GET /v1/admin/stats — aggregate statistics (operator only)
    router.get('/v1/admin/stats', requireAuth(), requireRole('operator'), async (_req, res) => {
        const agents = await storage.listAgents();
        const actions = await storage.listActions();

        const trustBuckets = { low: 0, medium: 0, high: 0 };
        for (const a of agents) {
            if (a.trustScore < 30) trustBuckets.low++;
            else if (a.trustScore < 70) trustBuckets.medium++;
            else trustBuckets.high++;
        }

        res.json(success(config.nodeId, {
            agents: {
                total: agents.length,
                trust_distribution: trustBuckets,
            },
            actions: {
                total: actions.length,
                categories: [...new Set(actions.map(a => a.category).filter(Boolean))],
            },
        }));
    });

    // GET /v1/admin/backup — export all data as JSON (operator only)
    router.get('/v1/admin/backup', requireAuth(), requireRole('operator'), async (_req, res) => {
        const owners = await storage.listOwners();
        const agents = await storage.listAgents();
        const actions = await storage.listActions();
        const boards = await storage.listBoards();

        // Collect all memories and transactions per agent
        const agentData: Record<string, { memories: unknown[]; transactions: unknown[] }> = {};
        for (const a of agents) {
            const memories = await storage.listMemory(a.gaii);
            const transactions = await storage.getTransactions(a.gaii, 100_000);
            agentData[a.gaii] = { memories, transactions };
        }

        res.json(success(config.nodeId, {
            version: '1.2',
            exported_at: new Date().toISOString(),
            node_id: config.nodeId,
            owners,
            agents,
            actions,
            boards,
            agent_data: agentData,
        }));
    });

    // POST /v1/admin/restore — import data from backup (operator only)
    router.post('/v1/admin/restore', requireAuth(), requireRole('operator'), async (req, res) => {
        const { owners, agents, actions, boards, agent_data } = req.body ?? {};
        const imported = { owners: 0, agents: 0, actions: 0, boards: 0, memories: 0 };

        if (owners) {
            for (const o of owners) {
                try { await storage.createOwner(o); imported.owners++; } catch { /* skip duplicates */ }
            }
        }
        if (agents) {
            for (const a of agents) {
                try { await storage.createAgent(a); imported.agents++; } catch { /* skip duplicates */ }
            }
        }
        if (actions) {
            for (const a of actions) {
                try { await storage.createAction(a); imported.actions++; } catch { /* skip duplicates */ }
            }
        }
        if (boards) {
            for (const b of boards) {
                try { await storage.createBoard(b); imported.boards++; } catch { /* skip duplicates */ }
            }
        }
        if (agent_data) {
            for (const [gaii, data] of Object.entries(agent_data as Record<string, any>)) {
                if (data.memories) {
                    for (const m of data.memories) {
                        await storage.setMemory(m);
                        imported.memories++;
                    }
                }
                if (data.transactions) {
                    for (const tx of data.transactions) {
                        await storage.addTransaction(tx);
                    }
                }
            }
        }

        res.json(success(config.nodeId, {
            restored: true,
            imported,
        }));
    });

    // POST /v1/admin/roles/grant — grant operator role (operator only)
    router.post('/v1/admin/roles/grant', requireAuth(), requireRole('operator'), validateBody(RoleGrantSchema, config.nodeId), async (req, res) => {
        const { owner, role } = req.body ?? {};

        const ownerRecord = await storage.getOwner(owner);
        if (!ownerRecord) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner not found: ${owner}`));
            return;
        }

        if (ownerRecord.roles.includes('operator')) {
            res.status(409).json(error(config.nodeId, 'CONFLICT', `Owner "${owner}" already has operator role`));
            return;
        }

        await storage.updateOwner(owner, { roles: [...ownerRecord.roles, 'operator'] });

        res.json(success(config.nodeId, {
            owner,
            role: 'operator',
            granted: true,
        }));
    });

    // GET /v1/admin/hooks — list all extension hooks
    router.get('/v1/admin/hooks', requireAuth(), requireRole('operator'), (_req, res) => {
        res.json(success(config.nodeId, {
            extension_hooks: listHooks(config),
        }));
    });

    // PUT /v1/admin/hooks/:hookName — set actions for a hook
    router.put('/v1/admin/hooks/:hookName', requireAuth(), requireRole('operator'), (req, res) => {
        const hookName = req.params.hookName as string;
        const validHooks: HookName[] = [
            'pre_owner_registration', 'post_owner_registration',
            'pre_agent_registration', 'post_agent_registration',
            'owner_recovery', 'agent_rekey',
            'pre_work_request', 'post_work_delivery', 'post_settlement',
            'pre_board_post', 'pre_federation_peer',
        ];

        if (!validHooks.includes(hookName as HookName)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Invalid hook name. Valid hooks: ${validHooks.join(', ')}`));
            return;
        }

        const { actions } = req.body ?? {};
        if (!Array.isArray(actions) || !actions.every((a: unknown) => typeof a === 'string')) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'actions must be an array of action reference strings'));
            return;
        }

        config.extensionHooks[hookName as HookName] = actions;

        res.json(success(config.nodeId, {
            hook: hookName,
            actions: config.extensionHooks[hookName as HookName],
            updated: true,
        }));
    });

    // DELETE /v1/admin/hooks/:hookName — clear all actions from a hook
    router.delete('/v1/admin/hooks/:hookName', requireAuth(), requireRole('operator'), (req, res) => {
        const hookName = req.params.hookName as string;
        if (!(hookName in config.extensionHooks)) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Hook "${hookName}" not found`));
            return;
        }

        config.extensionHooks[hookName as HookName] = [];

        res.json(success(config.nodeId, {
            hook: hookName,
            actions: [],
            cleared: true,
        }));
    });

    // POST /v1/admin/mint — operator mints morsels for an agent (§16.1)
    router.post('/v1/admin/mint', requireAuth(), requireRole('operator'), async (req, res) => {
        const { gaii, amount } = req.body ?? {};

        if (!gaii || typeof gaii !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'gaii is required'));
            return;
        }
        if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'amount must be a positive integer'));
            return;
        }

        const agent = await storage.getAgent(gaii);
        if (!agent) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent not found: ${gaii}`));
            return;
        }

        // Enforce daily mint cap (§16.1: max_operator_mint_per_day default 10,000)
        const dayStart = new Date();
        dayStart.setUTCHours(0, 0, 0, 0);
        const allTx = await storage.listAllTransactions();
        const mintedToday = allTx
            .filter(tx => tx.type === 'mint' && new Date(tx.timestamp) >= dayStart)
            .reduce((sum, tx) => sum + tx.amount, 0);

        if (mintedToday + amount > config.maxOperatorMintPerDay) {
            res.status(429).json(error(config.nodeId, 'QUOTA_EXCEEDED',
                `Daily mint cap is ${config.maxOperatorMintPerDay} morsels. Already minted ${mintedToday} today. Requested ${amount} would exceed cap.`));
            return;
        }

        await storage.updateAgent(gaii, { morselBalance: agent.morselBalance + amount });
        await storage.addTransaction({
            id: `tx-${Date.now()}-${randomBytes(4).toString('hex')}`,
            gaii,
            type: 'mint',
            amount,
            counterpartyGaii: req.auth!.sub,
            timestamp: new Date().toISOString(),
        });

        res.json(success(config.nodeId, {
            gaii,
            minted: amount,
            new_balance: agent.morselBalance + amount,
            daily_minted: mintedToday + amount,
            daily_cap: config.maxOperatorMintPerDay,
        }));
    });

    return router;
}

// ── Admin Dashboard HTML ──
const ADMIN_DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>AIMEAT Admin Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#94a3b8;
--green:#22c55e;--yellow:#eab308;--red:#ef4444;--blue:#3b82f6;--purple:#a855f7;
--cyan:#06b6d4;--font:system-ui,-apple-system,sans-serif}
body{background:var(--bg);color:var(--text);font-family:var(--font);padding:20px;min-height:100vh}
h1{font-size:1.6rem;font-weight:700;margin-bottom:4px}
.subtitle{color:var(--muted);font-size:.85rem;margin-bottom:20px}
.grid{display:grid;gap:16px;margin-bottom:20px}
.grid-4{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.grid-2{grid-template-columns:repeat(auto-fit,minmax(380px,1fr))}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px}
.card h2{font-size:.85rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:10px}
.stat{font-size:2rem;font-weight:700;line-height:1.1}
.stat-label{color:var(--muted);font-size:.8rem;margin-top:2px}
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.75rem;font-weight:600;text-transform:uppercase}
.badge-healthy{background:#16a34a22;color:var(--green);border:1px solid #16a34a55}
.badge-watch{background:#ca8a0422;color:var(--yellow);border:1px solid #ca8a0455}
.badge-danger{background:#dc262622;color:var(--red);border:1px solid #dc262655}
.health-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)}
.health-row:last-child{border-bottom:none}
.health-metric{font-size:.85rem}
.health-value{font-family:'SF Mono',Consolas,monospace;font-size:.85rem;color:var(--cyan)}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{text-align:left;color:var(--muted);font-weight:600;padding:8px 10px;border-bottom:2px solid var(--border)}
td{padding:8px 10px;border-bottom:1px solid var(--border)}
tr:hover td{background:#ffffff08}
.econ-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)}
.econ-row:last-child{border-bottom:none}
.econ-label{color:var(--muted);font-size:.85rem}
.econ-val{font-family:'SF Mono',Consolas,monospace;font-size:.85rem;color:var(--text)}
.warn-card{border-left:3px solid var(--yellow);background:#ca8a0408}
.warn-danger{border-left-color:var(--red);background:#dc262608}
.warn-msg{font-size:.85rem;padding:6px 0}
.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px}
.refresh{background:var(--blue);color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600}
.refresh:hover{opacity:.85}
.refresh:disabled{opacity:.5;cursor:not-allowed}
.auto-label{color:var(--muted);font-size:.75rem}
#lastUpdate{color:var(--muted);font-size:.75rem}
.loading{text-align:center;padding:40px;color:var(--muted)}
.error-box{background:#dc262622;border:1px solid var(--red);border-radius:8px;padding:16px;color:var(--red);margin:20px 0}
.node-meta{display:flex;gap:20px;flex-wrap:wrap;margin-bottom:4px}
.node-meta span{font-size:.8rem;color:var(--muted)}
.node-meta strong{color:var(--cyan)}
.agents-list{max-height:400px;overflow-y:auto}
</style>
</head>
<body>
<div class="topbar">
  <div>
    <h1>&#x1F969; AIMEAT Node Dashboard</h1>
    <div id="nodeMeta" class="node-meta"></div>
  </div>
  <div style="text-align:right">
    <button class="refresh" id="btnRefresh" onclick="load()">Refresh</button>
    <label class="auto-label"><input type="checkbox" id="autoRefresh" checked /> Auto 30s</label>
    <div id="lastUpdate"></div>
  </div>
</div>
<div id="app"><div class="loading">Loading dashboard&#8230;</div></div>
<script>
const TOKEN=new URLSearchParams(location.search).get('token')||localStorage.getItem('aimeat_token')||'';
if(TOKEN)localStorage.setItem('aimeat_token',TOKEN);
let timer;

async function api(path){
  const h={};
  if(TOKEN)h['Authorization']='Bearer '+TOKEN;
  const r=await fetch(path,{headers:h});
  if(!r.ok)throw new Error(r.status+' '+r.statusText);
  return r.json();
}

function badge(zone){return '<span class="badge badge-'+zone+'">'+zone+'</span>'}
function num(n){return typeof n==='number'?n.toLocaleString():n}

async function load(){
  const btn=document.getElementById('btnRefresh');
  btn.disabled=true;btn.textContent='Loading...';
  try{
    const [dash,agents]= await Promise.all([api('/v1/admin/dashboard'),api('/v1/admin/agents')]);
    render(dash.data,agents.data);
    document.getElementById('lastUpdate').textContent='Updated '+new Date().toLocaleTimeString();
  }catch(e){
    document.getElementById('app').innerHTML='<div class="error-box"><strong>Failed to load</strong><br/>'+esc(e.message)
      +'<br/><br/>Pass your operator token: <code>/v1/admin/ui?token=YOUR_TOKEN</code></div>';
  }
  btn.disabled=false;btn.textContent='Refresh';
  clearInterval(timer);
  if(document.getElementById('autoRefresh').checked)timer=setInterval(load,30000);
}

function esc(s){const d=document.createElement('div');d.textContent=String(s);return d.innerHTML}

function render(d,ag){
  const h=d.health,c=d.counts,e=d.economy,w=d.warnings||[];
  const hColor=h.status==='healthy'?'green':h.status==='watch'?'yellow':'red';

  document.getElementById('nodeMeta').innerHTML=
    '<span>Node: <strong>'+esc(d.node_id)+'</strong></span>'+
    '<span>Storage: <strong>'+esc(d.storage_type)+'</strong></span>'+
    '<span>Uptime: <strong>'+fmtUp(d.uptime_seconds)+'</strong></span>';

  let o='';
  // Health
  o+='<div class="card" style="border-left:4px solid var(--'+hColor+');margin-bottom:20px">';
  o+='<div style="display:flex;justify-content:space-between;align-items:center">';
  o+='<div><h2>Node Health</h2><div class="stat" style="color:var(--'+hColor+')">'+h.status.toUpperCase()+'</div></div>';
  o+='<div>'+badge(h.status)+'</div></div>';
  o+='<div style="margin-top:14px">';
  o+=hRow('Burn/Mint Ratio',h.burn_mint_ratio);
  o+=hRow('Agent Churn (30d)',h.agent_churn_rate_30d);
  o+=hRow('Work Expiry (30d)',h.work_expiry_rate_30d);
  o+=hRow('Dispute Rate (30d)',h.dispute_rate_30d);
  o+='</div></div>';

  // Counts
  o+='<div class="grid grid-4">';
  o+=sc('Owners',c.owners,'','var(--blue)');
  o+=sc('Agents',c.agents,'('+c.active_agents_24h+' active 24h)','var(--purple)');
  o+=sc('Actions',c.actions,'','var(--cyan)');
  o+=sc('Boards',c.boards,'','var(--green)');
  o+='</div>';

  // Economy
  o+='<div class="grid grid-2">';
  o+='<div class="card"><h2>Morsel Economy</h2>';
  o+=er('In Circulation',num(e.total_morsels_in_circulation));
  o+=er('Total Minted',num(e.total_minted_all_time));
  o+=er('Total Burned',num(e.total_burned_all_time));
  o+=er('Inflation (30d)',e.inflation_rate_30d_percent+'%');
  o+=er('Burn/Mint Ratio',e.burn_mint_ratio);
  o+='</div>';
  o+='<div class="card"><h2>Today</h2>';
  o+=er('Transactions',num(e.transactions_today));
  o+=er('Morsels Moved',num(e.morsels_transacted_today));
  o+=er('Network Fees',num(e.network_fees_today));
  o+=er('Burned',num(e.burned_today));
  o+=er('Allowances',num(e.daily_allowances_issued_today));
  o+='</div></div>';

  // Policy + Config
  o+='<div class="grid grid-2">';
  o+='<div class="card"><h2>Morsel Policy</h2>';
  o+=er('Welcome Bonus',num(e.welcome_bonus));
  o+=er('Daily Allowance',num(e.daily_allowance));
  o+=er('Allowance Cap',num(e.daily_allowance_cap));
  o+=er('Burn Rate',e.burn_rate);
  o+=er('Max Mint/Day',num(e.max_operator_mint_per_day));
  o+='</div>';
  o+='<div class="card"><h2>Node Config</h2>';
  o+=er('Port',d.config.port);
  o+=er('JWT TTL',d.config.jwt_ttl_seconds+'s');
  o+=er('Keyed Browse',d.config.keyed_browse_enabled?'Enabled':'Disabled');
  o+='</div></div>';

  // Warnings
  if(w.length>0){
    o+='<div class="card '+(w.some(function(x){return x.zone==="danger"})?'warn-danger':'warn-card')+'" style="margin-bottom:20px"><h2>Warnings ('+w.length+')</h2>';
    o+='<table><thead><tr><th>Metric</th><th>Value</th><th>Zone</th><th>Threshold</th></tr></thead><tbody>';
    for(const x of w)o+='<tr><td>'+esc(x.metric)+'</td><td>'+x.value+'</td><td>'+badge(x.zone)+'</td><td style="color:var(--muted)">'+esc(x.threshold)+'</td></tr>';
    o+='</tbody></table></div>';
  }

  // Agents table
  if(ag&&ag.agents&&ag.agents.length>0){
    o+='<div class="card"><h2>Agents ('+ag.total+')</h2><div class="agents-list">';
    o+='<table><thead><tr><th>GAII</th><th>Owner</th><th>Trust</th><th>Morsels</th><th>Last Seen</th></tr></thead><tbody>';
    for(const a of ag.agents){
      const trust=typeof a.trust_score==='number'?a.trust_score.toFixed(1):'—';
      const tColor=a.trust_score>=70?'var(--green)':a.trust_score>=30?'var(--yellow)':'var(--red)';
      const seen=a.last_seen?new Date(a.last_seen).toLocaleString():'Never';
      o+='<tr><td style="font-family:monospace;font-size:.8rem">'+esc(a.gaii)+'</td><td>'+esc(a.owner)+'</td>';
      o+='<td style="color:'+tColor+'">'+trust+'</td><td>'+num(a.morsel_balance)+'</td><td style="color:var(--muted)">'+seen+'</td></tr>';
    }
    o+='</tbody></table></div></div>';
  }

  document.getElementById('app').innerHTML=o;
}

function sc(l,v,sub,col){return '<div class="card"><h2>'+l+'</h2><div class="stat" style="color:'+col+'">'+num(v)+'</div>'+(sub?'<div class="stat-label">'+sub+'</div>':'')+'</div>'}
function er(l,v){return '<div class="econ-row"><span class="econ-label">'+l+'</span><span class="econ-val">'+v+'</span></div>'}
function hRow(l,obj){return '<div class="health-row"><span class="health-metric">'+l+'</span><span>'+badge(obj.zone)+' <span class="health-value">'+obj.value+'</span></span></div>'}
function fmtUp(s){var d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);return (d?d+'d ':'')+(h?h+'h ':'')+(m?m+'m':'<1m')}

document.getElementById('autoRefresh').addEventListener('change',function(){
  clearInterval(timer);if(this.checked)timer=setInterval(load,30000);
});
load();
</script>
</body>
</html>`;

// ── Admin Login Page HTML ──
const ADMIN_LOGIN_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AIMEAT Admin Login</title>
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
.hint{color:#64748b;font-size:.75rem;margin-top:16px}
</style></head><body>
<div class="box">
<h1>&#x1F969; AIMEAT Admin</h1>
<p class="sub">Enter the admin password from the server console log</p>
<form onsubmit="go(event)">
<input type="password" id="pw" placeholder="Admin password" autofocus/>
<button type="submit">Enter Setup</button>
</form>
<p class="hint">Password is printed when the server starts, or set via MEAT_ADMIN_PASSWORD</p>
</div>
<script>
function go(e){e.preventDefault();var pw=document.getElementById('pw').value;if(pw)location.href='/v1/admin/setup?pw='+encodeURIComponent(pw);}
</script>
</body></html>`;

// ── Admin Setup Wizard HTML ──
const ADMIN_SETUP_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AIMEAT Admin Setup</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#94a3b8;
--green:#22c55e;--yellow:#eab308;--red:#ef4444;--blue:#3b82f6;--cyan:#06b6d4}
body{background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,sans-serif;padding:20px;min-height:100vh}
.container{max-width:640px;margin:0 auto}
h1{font-size:1.5rem;margin-bottom:4px}
.sub{color:var(--muted);font-size:.85rem;margin-bottom:24px}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:16px}
.card h2{font-size:.95rem;margin-bottom:12px;color:var(--cyan)}
label{display:block;color:var(--muted);font-size:.8rem;margin-bottom:4px;margin-top:12px}
label:first-child{margin-top:0}
input[type=text]{width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.9rem}
input:focus{outline:none;border-color:var(--blue)}
button{padding:10px 20px;border-radius:6px;border:none;font-size:.9rem;font-weight:600;cursor:pointer;margin-top:14px}
.btn-primary{background:var(--blue);color:#fff}
.btn-primary:hover{background:#2563eb}
.btn-primary:disabled{opacity:.5;cursor:not-allowed}
.btn-green{background:var(--green);color:#000}
.btn-green:hover{opacity:.85}
.result{margin-top:14px;padding:12px;border-radius:8px;font-size:.85rem;word-break:break-all}
.result-ok{background:#16a34a18;border:1px solid #16a34a55;color:var(--green)}
.result-err{background:#dc262618;border:1px solid #dc262655;color:var(--red)}
.result-info{background:#3b82f618;border:1px solid #3b82f655;color:var(--cyan)}
.key-box{font-family:'SF Mono',Consolas,monospace;font-size:.8rem;background:var(--bg);padding:8px;border-radius:6px;border:1px solid var(--border);margin-top:6px;word-break:break-all;user-select:all}
.step-num{display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:50%;background:var(--blue);color:#fff;font-size:.75rem;font-weight:700;margin-right:8px}
.step-done{background:var(--green)}
.hidden{display:none}
a{color:var(--cyan);text-decoration:none}
a:hover{text-decoration:underline}
.warn{color:var(--yellow);font-size:.8rem;margin-top:8px}
</style></head><body>
<div class="container">
<h1>&#x1F969; AIMEAT Node Setup</h1>
<p class="sub">Node: <strong>{{NODE_ID}}</strong></p>

<div class="card" id="step1card">
<h2><span class="step-num" id="s1n">1</span>Register Owner</h2>
<p style="font-size:.85rem;color:var(--muted);margin-bottom:8px">The first owner automatically gets the <strong>operator</strong> role.</p>
<label>Owner Name</label>
<input type="text" id="ownerName" placeholder="e.g. admin" autocomplete="off"/>
<label>Display Name (optional)</label>
<input type="text" id="displayName" placeholder="e.g. System Administrator"/>
<br/>
<button class="btn-primary" id="btnRegister" onclick="doRegister()">Register Owner</button>
<div id="regResult" class="hidden"></div>
</div>

<div class="card hidden" id="step2card">
<h2><span class="step-num" id="s2n">2</span>Get JWT Token</h2>
<p style="font-size:.85rem;color:var(--muted);margin-bottom:8px">Signing happens server-side. The private key is only used for this one call.</p>
<button class="btn-primary" id="btnToken" onclick="doToken()">Get Token</button>
<div id="tokenResult" class="hidden"></div>
</div>

<div class="card hidden" id="step3card">
<h2><span class="step-num step-done" id="s3n">3</span>Open Dashboard</h2>
<p style="font-size:.85rem;color:var(--muted);margin-bottom:8px">Your operator JWT is ready. Click below to open the dashboard.</p>
<a id="dashLink" href="#" class="btn-green" style="display:inline-block;text-decoration:none;text-align:center;padding:10px 24px;border-radius:6px">Open Dashboard &#x2192;</a>
<div style="margin-top:12px">
<label>JWT Token (for API use)</label>
<div class="key-box" id="jwtBox"></div>
</div>
</div>

</div>
<script>
const PW='{{PW}}';
let savedOwner='',savedKey='';

async function api(method,path,body){
  const h={'Content-Type':'application/json','X-Admin-Password':PW};
  const r=await fetch(path+'?pw='+encodeURIComponent(PW),{method,headers:h,body:body?JSON.stringify(body):undefined});
  return r.json();
}

function show(id,html,cls){const el=document.getElementById(id);el.className='result '+(cls||'');el.innerHTML=html;el.classList.remove('hidden');}

async function doRegister(){
  const name=document.getElementById('ownerName').value.trim();
  const dname=document.getElementById('displayName').value.trim();
  if(!name){show('regResult','Owner name is required','result-err');return;}
  document.getElementById('btnRegister').disabled=true;
  try{
    const r=await api('POST','/v1/admin/setup/register',{name,display_name:dname||undefined});
    if(!r.ok){show('regResult',esc(r.error),'result-err');document.getElementById('btnRegister').disabled=false;return;}
    savedOwner=r.owner.name;savedKey=r.private_key;
    const isOp=r.owner.roles.includes('operator');
    show('regResult',
      '<strong>Owner registered!</strong> Roles: '+r.owner.roles.join(', ')
      +(isOp?'<br/><span style="color:var(--green)">&#x2713; You are the operator</span>':'')
      +'<div class="warn">&#x26A0; Save your private key securely \u2014 it cannot be recovered.</div>'
      +'<label>Private Key</label><div class="key-box">'+esc(r.private_key)+'</div>'
      +'<label>Public Key</label><div class="key-box">'+esc(r.public_key)+'</div>'
    ,'result-ok');
    document.getElementById('s1n').classList.add('step-done');
    document.getElementById('step2card').classList.remove('hidden');
  }catch(e){show('regResult','Network error: '+esc(e.message),'result-err');document.getElementById('btnRegister').disabled=false;}
}

async function doToken(){
  if(!savedOwner||!savedKey){show('tokenResult','Register an owner first','result-err');return;}
  document.getElementById('btnToken').disabled=true;
  try{
    const r=await api('POST','/v1/admin/setup/token',{owner:savedOwner,private_key:savedKey});
    if(!r.ok){show('tokenResult',esc(r.error),'result-err');document.getElementById('btnToken').disabled=false;return;}
    document.getElementById('s2n').classList.add('step-done');
    document.getElementById('step3card').classList.remove('hidden');
    document.getElementById('dashLink').href=r.dashboard_url;
    document.getElementById('jwtBox').textContent=r.token;
    show('tokenResult','<strong>JWT issued!</strong> Roles: '+r.roles.join(', ')+' \u2014 expires: '+new Date(r.expires_at).toLocaleString(),'result-ok');
  }catch(e){show('tokenResult','Network error: '+esc(e.message),'result-err');document.getElementById('btnToken').disabled=false;}
}

function esc(s){const d=document.createElement('div');d.textContent=String(s??'');return d.innerHTML;}
</script>
</body></html>`;
