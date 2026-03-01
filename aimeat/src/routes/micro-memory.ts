import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { checkOtkSession } from './auth.js';
import { checkMicroMemoryQuota } from '../services/quota.js';

const VALID_VISIBILITY = ['private', 'public_read', 'shared_read', 'shared_write', 'public_write'] as const;
const MAX_SETS_PER_AGENT = 50;
const MAX_KEYS_PER_SET = 100;
const MAX_VALUE_SIZE = 1024; // 1KB
const MAX_BATCH_PAIRS = 100; // Max key-value pairs in a batch GET

/** Resolve value from query — supports plain `value` and base64-encoded `value64` */
function resolveValue(req: { query: Record<string, unknown> }): string | undefined {
    const v64 = req.query.value64 as string | undefined;
    if (v64 !== undefined) {
        return Buffer.from(v64, 'base64').toString('utf8');
    }
    return req.query.value as string | undefined;
}

/** Parse batch key-value pairs from query params (key0/value0, key1/value1, ...) */
function parseBatchPairs(query: Record<string, unknown>): { key: string; value: string }[] {
    const pairs: { key: string; value: string }[] = [];
    for (let i = 0; i < MAX_BATCH_PAIRS; i++) {
        const k = query[`key${i}`] as string | undefined;
        if (k === undefined) break;
        const v = query[`value${i}`] as string | undefined;
        const v64 = query[`value64_${i}`] as string | undefined;
        const val = v64 !== undefined ? Buffer.from(v64, 'base64').toString('utf8') : v;
        if (val === undefined) break;
        pairs.push({ key: k, value: val });
    }
    return pairs;
}

export function microMemoryRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    // GET /v1/mm/test-url-length — Probe endpoint for measuring max accepted URL length
    router.get('/v1/mm/test-url-length', (req, res) => {
        const paramlength = req.query.paramlength as string ?? '';
        const receivedLength = req.originalUrl.length;
        const last20 = paramlength.slice(-20);
        res.json(success(config.nodeId, {
            received_url_length: receivedLength,
            param_length: paramlength.length,
            last_20_chars: last20,
            max_url_length: config.maxUrlLength,
        }));
    });

    // GET /v1/mm/help — Guide for agents on how to use micro-memory
    router.get('/v1/mm/help', (_req, res) => {
        res.json(success(config.nodeId, {
            title: 'Micro-Memory Quick Reference',
            description: 'Lightweight key-value storage accessible via GET requests. No registration needed in anonymous mode.',
            quick_start: {
                step_1: {
                    action: 'Store data with password protection',
                    url: '/v1/mm?op=add&set=MY_SET&key=MY_KEY&value=MY_VALUE&access_code=MY_SECRET',
                    explanation: 'Creates a set named MY_SET with a key MY_KEY. The access_code acts as a password. Set is auto-configured as shared_read.',
                },
                step_2: {
                    action: 'Read data back using password',
                    url: '/v1/mm?op=list&set=MY_SET&access_code=MY_SECRET',
                    explanation: 'No OTK or authentication needed — the access_code is all you need to read.',
                },
                step_3: {
                    action: 'Store data WITHOUT password (anonymous, private)',
                    url: '/v1/mm?op=add&set=MY_SET&key=MY_KEY&value=MY_VALUE',
                    explanation: 'Set defaults to private. Only accessible via the same anonymous session or OTK.',
                },
            },
            operations: {
                add: { url: '/v1/mm?op=add&set=NAME&key=KEY&value=VALUE', description: 'Add or overwrite a key in a set' },
                mod: { url: '/v1/mm?op=mod&set=NAME&key=KEY&value=NEW_VALUE', description: 'Modify an existing key (fails if key does not exist)' },
                del: { url: '/v1/mm?op=del&set=NAME&key=KEY', description: 'Delete a key from a set' },
                list_set: { url: '/v1/mm?op=list&set=NAME', description: 'List all entries in a set' },
                list_all: { url: '/v1/mm?op=list', description: 'List all sets (names + entry counts)' },
                config: { url: '/v1/mm?op=config&set=NAME&access=VISIBILITY', description: 'Change visibility mode of a set' },
                batch: { url: '/v1/mm?op=batch&set=NAME&key0=K&value0=V&key1=K&value1=V', description: 'Add/update multiple keys at once' },
            },
            visibility_modes: {
                private: 'Only the owner can read/write. Default when no access_code is provided.',
                public_read: 'Anyone can read (no password), only owner can write.',
                shared_read: 'Anyone with access_code can read, only owner can write. Auto-set when access_code is given during op=add.',
                shared_write: 'Anyone with access_code can read AND write.',
                public_write: 'Fully open — anyone can read and write without any authentication.',
            },
            password_protection: {
                how_it_works: 'Pass access_code with op=add to auto-create a password-protected set (shared_read). Then use the same access_code with op=list to read without OTK.',
                write_with_password: '/v1/mm?op=add&set=mydata&key=hello&value=world&access_code=mypassword',
                read_with_password: '/v1/mm?op=list&set=mydata&access_code=mypassword',
                change_visibility: '/v1/mm?op=config&set=mydata&access=shared_write&access_code=mypassword',
            },
            tips: [
                'You do NOT need to register or authenticate to use micro-memory in anonymous mode',
                'access_code on op=add auto-creates the set as shared_read (password-protected)',
                'access_code on op=list works as authentication — no OTK needed',
                'For fully public data, set visibility to public_read or public_write via op=config',
                'Maximum 50 sets per agent, 100 keys per set, 1KB per value',
                'Use value64 instead of value to pass base64-encoded content (for special characters)',
            ],
        }));
    });

    // GET /v1/mm — Micro-memory operations via OTK (Tier 0.5)
    // Supports op=add, del, mod, list, config, batch
    router.get('/v1/mm', async (req, res) => {
        // Include max URL length header on all micro-memory responses
        res.setHeader('X-Max-URL-Length', config.maxUrlLength);

        const otkKey = req.query.otk as string;

        // Access-code mode: allow read-only access with access_code (no OTK needed) — checked FIRST
        // Anonymous mode: allow requests without OTK using the anonymous shared agent
        // Dev mode: allow requests without OTK using first registered agent/owner
        let gaii: string;
        let isAnonymous = false;
        let isAccessCodeOnly = false;
        if (!otkKey && req.query.access_code && req.query.op === 'list' && req.query.set) {
            // Access-code-only mode: find the set across all agents by searching for matching access_code
            const setName = req.query.set as string;
            const accessCode = req.query.access_code as string;
            const found = await storage.findMicroMemoryByAccessCode(setName, accessCode);
            if (!found) {
                res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Invalid access_code or set not found'));
                return;
            }
            gaii = found.gaii;
            isAnonymous = true;
            isAccessCodeOnly = true;
        } else if (!otkKey && config.anonymousMode) {
            const ANON_GAII = `shared#anonymous@${config.nodeId}`;
            gaii = ANON_GAII;
            isAnonymous = true;
        } else if (!otkKey && config.devMode) {
            const agents = await storage.listAgents();
            if (agents.length > 0) {
                gaii = agents[0].gaii;
            } else {
                const owners = await storage.listOwners();
                if (owners.length > 0) {
                    gaii = owners[0].name;
                } else {
                    res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Dev mode: no owners or agents registered yet'));
                    return;
                }
            }
        } else if (!otkKey) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'otk query parameter is required. For shared sets, provide access_code with op=list&set=name'));
            return;
        } else {
            const otk = await storage.consumeOtk(otkKey, config.otkGraceMs);
            if (!otk) {
                res.status(401).json(error(config.nodeId, 'OTK_EXPIRED', 'One-time key not found, expired, or already used', undefined, {
                    initial_otk_hint: 'If this was an Initial OTK, its grace period may have expired. Request a new one via POST /v1/auth/initial-otk',
                }));
                return;
            }
            if (!await checkOtkSession(otk, storage)) {
                res.status(401).json(error(config.nodeId, 'SESSION_EXPIRED', 'Session expired due to inactivity'));
                return;
            }
            gaii = otk.ownerGaii;
        }

        // Auto-identification: check if GAII is a registered agent, add hints if not
        const resolvedAgent = await storage.getAgent(gaii);
        const identityHints = resolvedAgent ? undefined : {
            identity_status: 'owner_only',
            message: 'You are using an owner identity. Register an agent for proper GAII-based memory scoping.',
            register_url: '/v1/agents',
            register_method: 'POST',
            register_body_example: { name: 'my-agent', owner: gaii, display_name: 'My AI Agent' },
        };

        const op = req.query.op as string;
        const set = req.query.set as string;
        const key = req.query.key as string;
        const value = resolveValue(req as any);

        if (!op) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'op query parameter is required (add, del, mod, list, config, batch)'));
            return;
        }

        switch (op) {
            case 'add': {
                if (!set || !key || value === undefined) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'set, key, and value (or value64) are required for add'));
                    return;
                }
                if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_SIZE) {
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
                    // If access_code is provided on first add, auto-set visibility to shared_read
                    const initCode = req.query.access_code as string | undefined;
                    const initVis = initCode ? 'shared_read' as const : 'private' as const;
                    record = { gaii, set, entries: {}, visibility: initVis, ...(initCode ? { accessCode: initCode } : {}), updatedAt: new Date().toISOString() };
                } else if (req.query.access_code && record.visibility === 'private') {
                    // Upgrade existing private set to shared_read when access_code is provided
                    const upgradeCode = req.query.access_code as string;
                    record.visibility = 'shared_read';
                    record.accessCode = upgradeCode;
                }
                if (Object.keys(record.entries).length >= MAX_KEYS_PER_SET && !(key in record.entries)) {
                    res.status(400).json(error(config.nodeId, 'QUOTA_EXCEEDED', `Maximum ${MAX_KEYS_PER_SET} keys per set`));
                    return;
                }
                // M-5: Total micro-memory quota check (§5.7.4, default 500KB)
                const addBytes = Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8');
                const existingAddBytes = record.entries[key]
                    ? Buffer.byteLength(key, 'utf8') + Buffer.byteLength(record.entries[key], 'utf8')
                    : 0;
                const mmQuota = await checkMicroMemoryQuota(config, storage, gaii, addBytes - existingAddBytes);
                if (!mmQuota.allowed) {
                    res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', mmQuota.reason!));
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
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'set, key, and value (or value64) are required for mod'));
                    return;
                }
                if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_SIZE) {
                    res.status(400).json(error(config.nodeId, 'QUOTA_EXCEEDED', `Value exceeds ${MAX_VALUE_SIZE} byte limit`));
                    return;
                }
                const record2 = await storage.getMicroMemory(gaii, set);
                if (!record2 || !(key in record2.entries)) {
                    res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Key "${key}" not found in set "${set}"`));
                    return;
                }
                // M-5: Total micro-memory quota check on mod
                const modNewBytes = Buffer.byteLength(value, 'utf8');
                const modOldBytes = Buffer.byteLength(record2.entries[key], 'utf8');
                if (modNewBytes > modOldBytes) {
                    const modQuota = await checkMicroMemoryQuota(config, storage, gaii, modNewBytes - modOldBytes);
                    if (!modQuota.allowed) {
                        res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', modQuota.reason!));
                        return;
                    }
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
                    const vis = record3?.visibility ?? 'private';
                    const reqCode = req.query.access_code as string | undefined;

                    // Determine if entries should be shown to anonymous users
                    let showEntries = true;
                    let notice: string | undefined;
                    if (isAnonymous) {
                        if (vis === 'private') {
                            showEntries = false;
                            notice = 'Private set — authenticate with OTK to access entries';
                        } else if ((vis === 'shared_read' || vis === 'shared_write') && reqCode !== record3?.accessCode) {
                            showEntries = false;
                            notice = 'Shared set — provide access_code to view entries';
                        }
                    }

                    res.json(success(config.nodeId, {
                        gaii,
                        set,
                        entries: showEntries ? (record3?.entries ?? {}) : {},
                        visibility: vis,
                        ...(notice ? { notice } : {}),
                        ...(identityHints ? { identity: identityHints } : {}),
                    }));
                } else {
                    const sets = await storage.listMicroMemorySets(gaii);
                    const filteredSets = isAnonymous
                        ? sets.filter(s => s.visibility !== 'private')
                        : sets;
                    res.json(success(config.nodeId, {
                        gaii,
                        sets: filteredSets.map(s => ({ set: s.set, entry_count: Object.keys(s.entries).length, visibility: s.visibility })),
                        ...(identityHints ? { identity: identityHints } : {}),
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
            case 'batch': {
                // Batch add/mod multiple key-value pairs in one request
                // Uses key0/value0, key1/value1, ... or key0/value64_0, key1/value64_1, ... params
                if (!set) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'set is required for batch'));
                    return;
                }
                const pairs = parseBatchPairs(req.query as Record<string, unknown>);
                if (pairs.length === 0) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'No key-value pairs found. Use key0=...&value0=... (or value64_0=...)'));
                    return;
                }
                // Validate individual value sizes
                for (const pair of pairs) {
                    if (Buffer.byteLength(pair.value, 'utf8') > MAX_VALUE_SIZE) {
                        res.status(400).json(error(config.nodeId, 'QUOTA_EXCEEDED', `Value for key "${pair.key}" exceeds ${MAX_VALUE_SIZE} byte limit`));
                        return;
                    }
                }
                let batchRecord = await storage.getMicroMemory(gaii, set);
                if (!batchRecord) {
                    const sets = await storage.listMicroMemorySets(gaii);
                    if (sets.length >= MAX_SETS_PER_AGENT) {
                        res.status(400).json(error(config.nodeId, 'QUOTA_EXCEEDED', `Maximum ${MAX_SETS_PER_AGENT} sets per agent`));
                        return;
                    }
                    batchRecord = { gaii, set, entries: {}, visibility: 'private', updatedAt: new Date().toISOString() };
                }
                // Check key count limit
                const newKeyCount = pairs.filter(p => !(p.key in batchRecord!.entries)).length;
                if (Object.keys(batchRecord.entries).length + newKeyCount > MAX_KEYS_PER_SET) {
                    res.status(400).json(error(config.nodeId, 'QUOTA_EXCEEDED', `Would exceed ${MAX_KEYS_PER_SET} keys per set`));
                    return;
                }
                // Calculate total quota delta
                let totalDelta = 0;
                for (const pair of pairs) {
                    const newBytes = Buffer.byteLength(pair.key, 'utf8') + Buffer.byteLength(pair.value, 'utf8');
                    const oldBytes = batchRecord.entries[pair.key]
                        ? Buffer.byteLength(pair.key, 'utf8') + Buffer.byteLength(batchRecord.entries[pair.key], 'utf8')
                        : 0;
                    totalDelta += newBytes - oldBytes;
                }
                if (totalDelta > 0) {
                    const batchQuota = await checkMicroMemoryQuota(config, storage, gaii, totalDelta);
                    if (!batchQuota.allowed) {
                        res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', batchQuota.reason!));
                        return;
                    }
                }
                // Apply all pairs
                for (const pair of pairs) {
                    batchRecord.entries[pair.key] = pair.value;
                }
                batchRecord.updatedAt = new Date().toISOString();
                await storage.setMicroMemory(batchRecord);
                res.json(success(config.nodeId, {
                    op: 'batch',
                    set,
                    count: pairs.length,
                    keys: pairs.map(p => p.key),
                }));
                break;
            }
            default:
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Unknown op: ${op}. Must be add, del, mod, list, config, or batch`));
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
            const value = resolveValue(req as any);
            if (writeOp === 'add' || writeOp === 'mod') {
                if (!key || value === undefined) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key and value (or value64) required'));
                    return;
                }
                if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_SIZE) {
                    res.status(400).json(error(config.nodeId, 'QUOTA_EXCEEDED', `Value exceeds ${MAX_VALUE_SIZE} byte limit`));
                    return;
                }
                // M-5: Total micro-memory quota check for public/shared writes
                const pubAddBytes = Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8');
                const pubExistingBytes = record.entries[key]
                    ? Buffer.byteLength(key, 'utf8') + Buffer.byteLength(record.entries[key], 'utf8')
                    : 0;
                const pubDelta = pubAddBytes - pubExistingBytes;
                if (pubDelta > 0) {
                    const pubQuota = await checkMicroMemoryQuota(config, storage, record.gaii, pubDelta);
                    if (!pubQuota.allowed) {
                        res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', pubQuota.reason!));
                        return;
                    }
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
