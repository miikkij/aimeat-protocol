import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { listHooks } from '../services/hooks.js';
import type { HookName } from '../config.js';

export function adminRouter(config: MeatConfig, storage: Storage): Router {
    const router = Router();

    // GET /v1/admin/dashboard — node overview (operator only)
    router.get('/v1/admin/dashboard', requireAuth(), requireRole('operator'), async (_req, res) => {
        const owners = await storage.listOwners();
        const agents = await storage.listAgents();
        const actions = await storage.listActions();
        const boards = await storage.listBoards();

        let totalMorsels = 0;
        let activeAgents = 0;
        const now = Date.now();
        for (const a of agents) {
            totalMorsels += a.morselBalance;
            if (a.lastSeen && now - new Date(a.lastSeen).getTime() < 86_400_000) {
                activeAgents++;
            }
        }

        res.json(success(config.nodeId, {
            node_id: config.nodeId,
            uptime_seconds: Math.floor(process.uptime()),
            storage_type: config.dbUrl ? 'mongodb' : 'in-memory',
            counts: {
                owners: owners.length,
                agents: agents.length,
                active_agents_24h: activeAgents,
                actions: actions.length,
                boards: boards.length,
            },
            economy: {
                total_morsels_in_circulation: totalMorsels,
                welcome_bonus: config.welcomeBonus,
                daily_allowance: config.dailyAllowance,
                daily_allowance_cap: config.dailyAllowanceCap,
                burn_rate: config.burnRate,
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

    // GET /v1/admin/config — view current config (operator only)
    router.get('/v1/admin/config', requireAuth(), requireRole('operator'), async (_req, res) => {
        res.json(success(config.nodeId, {
            node_id: config.nodeId,
            port: config.port,
            storage_type: config.dbUrl ? 'mongodb' : 'in-memory',
            welcome_bonus: config.welcomeBonus,
            daily_allowance: config.dailyAllowance,
            daily_allowance_cap: config.dailyAllowanceCap,
            burn_rate: config.burnRate,
            jwt_ttl_seconds: config.jwtTtlSeconds,
            keyed_browse_enabled: config.keyedBrowseEnabled,
        }));
    });

    // PUT /v1/admin/config — update runtime configuration (operator only)
    router.put('/v1/admin/config', requireAuth(), requireRole('operator'), async (req, res) => {
        const allowedKeys = ['welcomeBonus', 'dailyAllowance', 'dailyAllowanceCap', 'burnRate', 'jwtTtlSeconds', 'keyedBrowseEnabled'] as const;
        const updates: Record<string, unknown> = {};

        for (const key of allowedKeys) {
            if (req.body[key] !== undefined) {
                (config as any)[key] = req.body[key];
                updates[key] = req.body[key];
            }
        }

        if (Object.keys(updates).length === 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `No valid config keys. Allowed: ${allowedKeys.join(', ')}`));
            return;
        }

        res.json(success(config.nodeId, {
            updated: updates,
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
        let imported = { owners: 0, agents: 0, actions: 0, boards: 0, memories: 0 };

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
    router.post('/v1/admin/roles/grant', requireAuth(), requireRole('operator'), async (req, res) => {
        const { owner, role } = req.body ?? {};
        if (!owner || role !== 'operator') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'owner and role (must be "operator") are required'));
            return;
        }

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

    return router;
}
