/**
 * @file projections-come-from-the-exporter.test.ts
 * @description Criterion 12, made checkable: every standard-format view of an agent is what the
 *   exporter produced for that agent, and not something a route wrote out by hand.
 *
 *   WHY NOT A CHECKER THAT READS THE SOURCE. The obvious gate greps the routes for a hand-built
 *   object literal, and a gate that recognises a string is a gate that a different string walks
 *   past — a projection assembled through a helper, a spread, or a second file is invisible to it,
 *   and the day somebody writes one is the day it matters. So this compares OUTPUT instead: one
 *   fixture agent goes into real storage, the real routers serve it, and each response must deep
 *   equal what the exporter returns for the same inputs. A hand-written projection fails because it
 *   DIFFERS, which is the property criterion 12 actually names.
 *
 *   AND IF A HAND-WRITTEN ONE HAPPENED TO MATCH BYTE FOR BYTE, nothing is wrong: the reader of the
 *   route got exactly what the exporter would have given them. This test cannot tell the two apart
 *   and does not need to.
 *
 *   THE FIXTURE IS DELIBERATELY AWKWARD — a display name unlike the name, tags, several declared
 *   capabilities, a description with characters that survive JSON badly — because a projection
 *   written by hand is most likely to agree with the exporter on the boring fields and disagree on
 *   exactly these.
 *
 * @structure
 *   - seedAgent(): one owner, one GHII, one enrolled v2 agent with a card
 *   - the A2A card · the OASF record · the A2A Task, each served vs each exported
 * @usage cd aimeat && pnpm exec vitest run test/unit/projections-come-from-the-exporter.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, criterion 12).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { a2aRouter } from '../../src/routes/a2a.js';
import { a2aCardFor } from '../../src/services/a2a-card.js';
import { oasfRecordFor } from '../../src/services/oasf-projection.js';
import { offeringsForAgent } from '../../src/services/a2a-offering.js';
import { toA2ATask } from '../../src/services/a2a-projection.js';
import { Task as A2ATask } from '@a2a-js/sdk';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, issueJWT, generateSessionId } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';

const NODE_ID = 'aimeat-local-001-dev';
const OWNER = 'projfixture';
const AGENT = 'proj-worker';
const GAII = `${AGENT}#${OWNER}@${NODE_ID}`;

describe('a projection is the exporter\'s output, or it is a second source of truth', () => {
    let storage: SqliteStorage;
    let server: http.Server;
    let base: string;
    let config: AimeatConfig;

    async function seedAgent(): Promise<void> {
        const now = new Date().toISOString();
        const kp = await generateKeyPair();
        await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: kp.publicKey, roles: ['owner'], createdAt: now });
        await storage.createGHII({
            username: OWNER, nodeId: NODE_ID, ghii: `${OWNER}@${NODE_ID}`, displayName: OWNER,
            ownerName: OWNER, totpEnabled: false, verificationLevel: 0, createdAt: now, updatedAt: now,
        });
        const agentKp = await generateKeyPair();
        await storage.createAgent({
            gaii: GAII, name: AGENT, owner: OWNER, nodeId: NODE_ID,
            // Everything a hand-written projection is most likely to get subtly wrong.
            displayName: 'Proj Worker — the awkward one',
            description: 'Summarises "documents", handles <angle brackets> & ampersands.',
            publicKey: agentKp.publicKey,
            capabilities: ['summarize', 'translate', 'extract'],
            tags: ['fixture', 'projection'],
            trustScore: 0, morselBalance: 0, status: 'active',
            createdAt: now, lastSeen: now,
        } as never);
    }

    beforeAll(async () => {
        storage = new SqliteStorage(':memory:');
        config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://proj.aimeat.test' };
        const kp = await generateKeyPair();
        await initNodeKeys(kp.publicKey, kp.privateKey);
        initSessionAuth(storage, config);
        await seedAgent();

        const app = express();
        app.use(express.json());
        app.use(a2aRouter(config, storage));
        server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });

    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
        storage.close?.();
    });

    /** The address the exporter is told to publish. Both sides must derive it the same way. */
    const interfaceUrl = () => `${config.baseUrl}/v1/a2a/${encodeURIComponent(OWNER)}/${encodeURIComponent(AGENT)}`;

    it('the A2A card the route serves is the card the exporter builds', async () => {
        const res = await fetch(`${base}/v1/a2a/${OWNER}/${AGENT}/agent-card.json`);
        expect(res.status).toBe(200);
        const served = await res.json();

        const agent = await storage.getAgent(GAII);
        const offerings = await offeringsForAgent(storage, agent!);
        const exported = a2aCardFor(config, agent!, interfaceUrl(), { offerings });

        // Round-tripped through JSON because the route serialises: undefined fields and class
        // instances are what a naive deep-equal against a live object would trip on, and they are
        // not the difference this test is looking for.
        expect(served).toEqual(JSON.parse(JSON.stringify(exported)));
    });

    it('the OASF record the route serves is the record the exporter builds', async () => {
        const res = await fetch(`${base}/v1/oasf/${OWNER}/${AGENT}`);
        expect(res.status).toBe(200);
        const served = await res.json();

        const agent = await storage.getAgent(GAII);
        const a2a = interfaceUrl();
        const exported = oasfRecordFor(config, agent!, {
            a2a,
            a2aCard: `${a2a}/agent-card.json`,
            card: `${config.baseUrl}/v1/agents/${encodeURIComponent(GAII)}/card`,
        });

        expect(served).toEqual(JSON.parse(JSON.stringify(exported)));
    });

    it('the A2A Task the route serves is the task the exporter builds', async () => {
        // The third projection, and the only one behind a credential. Same comparison: the JSON-RPC
        // answer must be `toA2ATask` of the record, not a shape the handler assembled.
        const now = new Date().toISOString();
        const taskId = 'proj-task-0001';
        await storage.createAgentV2Task({
            taskId, status: 'working', statusMessage: 'Halfway — "quoted" & <escaped>.',
            contextId: 'proj-ctx-0001', owner: OWNER,
            createdBy: `${OWNER}@${NODE_ID}`, assignedTo: GAII,
            input: [{ kind: 'text', text: 'Summarise it.' }],
            result: null, error: null,
            createdAt: now, lastUpdatedAt: now, startedAt: now, completedAt: null,
            ttlMs: null, pollIntervalMs: null, metadata: null,
        });

        const token = await issueJWT(
            { sub: `${OWNER}@${NODE_ID}`, owner: OWNER, node: NODE_ID, roles: ['owner'], scopes: ['*'] },
            3600, generateSessionId(),
        );
        const res = await fetch(`${base}/v1/a2a/${OWNER}/${AGENT}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'A2A-Version': '1.0', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'GetTask', params: { id: taskId } }),
        });
        const body = await res.json() as { result?: unknown; error?: unknown };
        expect(body.error, JSON.stringify(body.error)).toBeUndefined();

        const record = await storage.getAgentV2Task(OWNER, taskId);
        // Through the SDK's own serialiser, because the wire is protobuf-shaped: enums travel as
        // their names and empty repeated fields are dropped. That is the TRANSPORT, and comparing
        // past it would only ever prove that JSON.stringify is not protobuf. The projection is the
        // content, and a hand-written Task still differs after serialisation.
        const exported = A2ATask.toJSON(toA2ATask(record!, []));
        expect(body.result).toEqual(exported);
    });

    it('and the fixture is awkward enough for a difference to show', async () => {
        // A test that compared two empty objects would pass forever. This asserts the material the
        // comparison actually ran over.
        const served = await (await fetch(`${base}/v1/a2a/${OWNER}/${AGENT}/agent-card.json`)).json() as {
            name: string; description: string; skills: unknown[];
        };
        expect(served.name).toContain('—');
        expect(served.description).toContain('<angle brackets>');
        expect(served.skills.length).toBeGreaterThanOrEqual(3);
    });

    it('a hand-written projection would fail this, which is the point', async () => {
        // The negative control: the comparison is not vacuous. A projection that differs from the
        // exporter's output by one field is caught, and this proves the assertion can fail.
        const agent = await storage.getAgent(GAII);
        const offerings = await offeringsForAgent(storage, agent!);
        const exported = a2aCardFor(config, agent!, interfaceUrl(), { offerings });
        const handWritten = { ...JSON.parse(JSON.stringify(exported)), description: 'A summarising agent.' };

        const served = await (await fetch(`${base}/v1/a2a/${OWNER}/${AGENT}/agent-card.json`)).json();
        expect(served).not.toEqual(handWritten);
    });
});
