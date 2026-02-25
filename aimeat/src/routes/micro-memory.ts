import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';

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
                let record = await storage.getMicroMemory(gaii, set);
                if (!record) {
                    record = { gaii, set, entries: {}, visibility: 'private', updatedAt: new Date().toISOString() };
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
                const visibility = (req.query.visibility as string) ?? 'private';
                if (visibility !== 'private' && visibility !== 'public') {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'visibility must be private or public'));
                    return;
                }
                let record4 = await storage.getMicroMemory(gaii, set);
                if (!record4) {
                    record4 = { gaii, set, entries: {}, visibility, updatedAt: new Date().toISOString() };
                } else {
                    record4.visibility = visibility;
                    record4.updatedAt = new Date().toISOString();
                }
                await storage.setMicroMemory(record4);
                res.json(success(config.nodeId, { op: 'config', set, visibility }));
                break;
            }
            default:
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Unknown op: ${op}. Must be add, del, mod, list, or config`));
        }
    });

    // GET /v1/mm/:gaii/:set — Read public micro-memory set (Tier 0, no auth)
    router.get('/v1/mm/:gaii/:set', async (req, res) => {
        const gaii = decodeURIComponent(req.params.gaii as string);
        const set = req.params.set as string;

        const record = await storage.getMicroMemory(gaii, set);
        if (!record || record.visibility !== 'public') {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Public micro-memory set not found: ${set}`));
            return;
        }

        res.json(success(config.nodeId, {
            gaii: record.gaii,
            set: record.set,
            entries: record.entries,
            visibility: record.visibility,
        }));
    });

    return router;
}
