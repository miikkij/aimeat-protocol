import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { listHooks } from '../services/hooks.js';
import type { HookName } from '../config.js';
import { RoleGrantSchema, validateBody } from '../models/schemas.js';
import { randomBytes } from 'node:crypto';

export function adminRouter(config: MeatConfig, storage: Storage): Router {
    const router = Router();

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
