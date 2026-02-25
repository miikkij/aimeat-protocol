import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';

const VALID_VISIBILITY = ['private', 'public_read', 'shared_read', 'shared_write', 'public_write'] as const;
const MAX_SETS_PER_AGENT = 50;
const MAX_KEYS_PER_SET = 100;
const MAX_VALUE_SIZE = 1024; // 1KB

export function microMemoryRouter(config: MeatConfig, storage: Storage): Router {
    const router = Router();

    // GET /v1/mm — Micro-memory operations via OTK (Tier 0.5)
    // Supports op=add, del, mod, list, config
    router.get('/v1/mm', async (req, res) => {
        const otkKey = req.query.otk as string;
        if (!otkKey) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'otk query parameter is required'));
            return;
        }

        const otk = await storage.consumeOtk(otkKey);
        if (!otk) {
            res.status(401).json(error(config.nodeId, 'OTK_EXPIRED', 'One-time key not found, expired, or already used'));
            return;
        }

        const op = req.query.op as string;
        const set = req.query.set as string;
        const key = req.query.key as string;
        const value = req.query.value as string;
        const gaii = otk.ownerGaii;

        if (!op) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'op query parameter is required (add, del, mod, list, config)'));
            return;
        }

        switch (op) {
            case 'add': {
                if (!set || !key || value === undefined) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'set, key, and value are required for add'));
                    return;
                }
                if (value.length > MAX_VALUE_SIZE) {
                    res.status(400).json(error(config.nodeId, 'QUOTA_EXCEEDED', `Value exceeds ${MAX_VALUE_SIZE} byte limit`));
                    return;
                }
                let record = await storage.getMicroMemory(gaii, set);
                if (!record) {
                    // Check set limit
                    const sets = await storage.listMicroMemorySets(gaii);
                    if (sets.length >= MAX_SETS_PER_AGENT) {
                        res.status(400).json(error(config.nodeId, 'QUOTA_EXCEEDED', `Maximum ${MAX_SETS_PER_AGENT} sets per agent`));
                        return;
                    }
                    record = { gaii, set, entries: {}, visibility: 'private', updatedAt: new Date().toISOString() };
                }
                if (Object.keys(record.entries).length >= MAX_KEYS_PER_SET && !(key in record.entries)) {
                    res.status(400).json(error(config.nodeId, 'QUOTA_EXCEEDED', `Maximum ${MAX_KEYS_PER_SET} keys per set`));
                    return;
                }
                record.entries[key] = value;
                record.updatedAt = new Date().toISOString();
                await storage.setMicroMemory(record);
                res.json(success(config.nodeId, { op: 'add', set, key, value }));
                break;
            }
            case 'del': {
                if (!set || !key) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'set and key are required for del'));
                    return;
                }
                const deleted = await storage.deleteMicroMemoryEntry(gaii, set, key);
                res.json(success(config.nodeId, { op: 'del', set, key, deleted }));
                break;
            }
            case 'mod': {
                if (!set || !key || value === undefined) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'set, key, and value are required for mod'));
                    return;
                }
                if (value.length > MAX_VALUE_SIZE) {
                    res.status(400).json(error(config.nodeId, 'QUOTA_EXCEEDED', `Value exceeds ${MAX_VALUE_SIZE} byte limit`));
                    return;
                }
                const record2 = await storage.getMicroMemory(gaii, set);
                if (!record2 || !(key in record2.entries)) {
                    res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Key "${key}" not found in set "${set}"`));
                    return;
                }
                record2.entries[key] = value;
                record2.updatedAt = new Date().toISOString();
                await storage.setMicroMemory(record2);
                res.json(success(config.nodeId, { op: 'mod', set, key, value }));
                break;
            }
            case 'list': {
                if (set) {
                    const record3 = await storage.getMicroMemory(gaii, set);
                    res.json(success(config.nodeId, {
                        gaii,
                        set,
                        entries: record3?.entries ?? {},
                        visibility: record3?.visibility ?? 'private',
                    }));
                } else {
                    const sets = await storage.listMicroMemorySets(gaii);
                    res.json(success(config.nodeId, {
                        gaii,
                        sets: sets.map(s => ({ set: s.set, entry_count: Object.keys(s.entries).length, visibility: s.visibility })),
                    }));
                }
                break;
            }
            case 'config': {
                if (!set) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'set is required for config'));
                    return;
                }
                const access = (req.query.access as string) ?? (req.query.visibility as string);
                if (!access || !VALID_VISIBILITY.includes(access as any)) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `access must be one of: ${VALID_VISIBILITY.join(', ')}`));
                    return;
                }
                const accessCode = req.query.access_code as string | undefined;
                if ((access === 'shared_read' || access === 'shared_write') && !accessCode) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'access_code is required for shared_read and shared_write modes'));
                    return;
                }
                let record4 = await storage.getMicroMemory(gaii, set);
                if (!record4) {
                    record4 = { gaii, set, entries: {}, visibility: access as any, accessCode, updatedAt: new Date().toISOString() };
                } else {
                    record4.visibility = access as any;
                    record4.accessCode = accessCode;
                    record4.updatedAt = new Date().toISOString();
                }
                await storage.setMicroMemory(record4);
                res.json(success(config.nodeId, { op: 'config', set, visibility: access }));
                break;
            }
            default:
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Unknown op: ${op}. Must be add, del, mod, list, or config`));
        }
    });

    // GET /v1/mm/:gaii/:set — Read micro-memory set (Tier 0, access-controlled)
    router.get('/v1/mm/:gaii/:set', async (req, res) => {
        const gaii = decodeURIComponent(req.params.gaii as string);
        const set = req.params.set as string;

        const record = await storage.getMicroMemory(gaii, set);
        if (!record) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Micro-memory set not found: ${set}`));
            return;
        }

        // Access control based on visibility
        if (record.visibility === 'private') {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Micro-memory set not found: ${set}`));
            return;
        }

        if (record.visibility === 'shared_read' || record.visibility === 'shared_write') {
            const accessCode = req.query.access_code as string;
            if (accessCode !== record.accessCode) {
                res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Invalid or missing access_code'));
                return;
            }
        }

        // Handle writes for shared_write and public_write  
        const writeOp = req.query.op as string;
        if (writeOp === 'add' || writeOp === 'mod' || writeOp === 'del') {
            if (record.visibility !== 'shared_write' && record.visibility !== 'public_write') {
                res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Write operations not allowed for this visibility mode'));
                return;
            }
            const key = req.query.key as string;
            const value = req.query.value as string;
            if (writeOp === 'add' || writeOp === 'mod') {
                if (!key || value === undefined) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key and value required'));
                    return;
                }
                if (value.length > MAX_VALUE_SIZE) {
                    res.status(400).json(error(config.nodeId, 'QUOTA_EXCEEDED', `Value exceeds ${MAX_VALUE_SIZE} byte limit`));
                    return;
                }
                record.entries[key] = value;
            } else if (writeOp === 'del') {
                if (!key) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key is required for del'));
                    return;
                }
                delete record.entries[key];
            }
            record.updatedAt = new Date().toISOString();
            await storage.setMicroMemory(record);
            res.json(success(config.nodeId, { op: writeOp, set, key, gaii }));
            return;
        }

        // Default: read mode
        res.json(success(config.nodeId, {
            gaii: record.gaii,
            set: record.set,
            entries: record.entries,
            visibility: record.visibility,
        }));
    });

    return router;
}
