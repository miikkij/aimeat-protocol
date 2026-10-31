/**
 * @file chat-turn-guard.test.ts
 * @description The chat turn's ceiling counts what costs time: tool calls, rounds of them (one
 *   model response each), and the time between steps. Measured 2026-10-02 on a real model: a
 *   request for a new agent took six rounds and 149 s with no word before 141.8 s. These hold the
 *   counting the ceiling depends on; e2e-chat-agent holds the turn around it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/chat-turn-guard.test.ts
 * @version-history
 *   v1.3.0 — 2026-10-31 — The publish ends the turn, and the node knows the published app's address
 *     only from a publish (crew34 K35).
 *   v1.2.1 — 2026-10-31 — The turn note's plain-words line (v27 P7).
 *   v1.2.0 — 2026-10-31 — Every genre the turn note names ships and comes in one part.
 *   v1.1.0 — 2026-10-31 — The app path in the turn note and the answer phase, the sign-in sentence,
 *     and the grace after a published app (v31 K35, K38).
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { TurnWatch, stepForTool, turnNote, wrapUpPrompt, withTicks, progressText, stoppedText, appReadyText, publishedAppUrl, TURN_LIMITS } from '../../src/services/chat-turn-guard.js';
import { nodeTemplateAnswer } from '../../src/services/node-templates.js';

const call = (id: string, title: string, status = 'pending') => ({ kind: 'tool_call', id, title, status });
const thought = { kind: 'thought' };

describe('stepForTool', () => {
    it('names the step by the kind of tool, from the title goose gives it', () => {
        expect(stepForTool('aimeat: aimeat organism list')).toBe('reading');
        expect(stepForTool('aimeat: aimeat workspace read')).toBe('reading');
        expect(stepForTool('aimeat: aimeat agent propose · crm-aamu')).toBe('proposing');
        expect(stepForTool('aimeat: aimeat memory write')).toBe('writing');
        expect(stepForTool('aimeat: aimeat app publish')).toBe('writing');
        expect(stepForTool('aimeat: aimeat refinery run')).toBe('working');
    });
    it("leaves goose's own todo tool out", () => {
        expect(stepForTool('todo: todo write')).toBeNull();
    });
});

describe('TurnWatch', () => {
    it('counts calls between thoughts as one round, and the todo tool as neither', () => {
        const w = new TurnWatch({ toolCalls: 12, rounds: 3, ms: 100_000 }, 0);
        for (const u of [thought, call('t1', 'todo: todo write'), call('a', 'aimeat: aimeat organism list'), call('b', 'aimeat: aimeat handbook get')]) w.observe(u, 1);
        expect(w.toolCalls).toBe(2);
        expect(w.reached(2)).toBeNull();
        // Three more rounds: the fourth opens past the limit of three.
        for (const id of ['c', 'd', 'e']) { w.observe(thought, 3); w.observe(call(id, 'aimeat: aimeat discover'), 3); }
        expect(w.reached(4)).toBe('rounds');
    });

    it('counts a call once though it arrives twice, and stops past the call limit', () => {
        const w = new TurnWatch({ toolCalls: 2, rounds: 9, ms: 100_000 }, 0);
        w.observe(call('a', 'aimeat: aimeat memory list'), 1);
        w.observe({ kind: 'tool_call', id: 'a', status: 'completed' }, 1);
        w.observe(call('b', 'aimeat: aimeat memory list'), 1);
        expect(w.reached(2)).toBeNull();
        w.observe(call('c', 'aimeat: aimeat memory list'), 2);
        expect(w.reached(2)).toBe('tool_calls');
    });

    it('never cuts on time while a call runs or words are being written', () => {
        const w = new TurnWatch({ toolCalls: 12, rounds: 3, ms: 10 }, 0);
        // A plain write: a published app earns the answer's grace since 2026-10-31 (the case below).
        w.observe(call('a', 'aimeat: aimeat memory write'), 5);
        expect(w.inFlight).toBe(true);
        expect(w.reached(1_000)).toBeNull();
        w.observe({ kind: 'tool_call', id: 'a', status: 'completed' }, 1_000);
        w.observe({ kind: 'text' }, 1_000);
        expect(w.reached(2_000)).toBeNull();
        expect(w.reached(5_000)).toBe('time');
    });

    it('gives a turn whose proposal went through the time to write its answer', () => {
        const w = new TurnWatch({ toolCalls: 12, rounds: 3, ms: 10 }, 0);
        w.observe(call('p', 'aimeat: aimeat agent propose · crm'), 5);
        w.observe({ kind: 'tool_call', id: 'p', status: 'completed' }, 6);
        expect(w.reached(TURN_LIMITS.wrapUpMs)).toBeNull();
        expect(w.reached(TURN_LIMITS.wrapUpMs + 20)).toBe('time');
    });

    it('gives a turn whose app was published the same time (v31 K35)', () => {
        const w = new TurnWatch({ toolCalls: 12, rounds: 3, ms: 10 }, 0);
        w.observe(call('a', 'aimeat: aimeat app publish'), 5);
        w.observe({ kind: 'tool_call', id: 'a', status: 'completed' }, 6);
        expect(w.reached(TURN_LIMITS.wrapUpMs)).toBeNull();
    });
});

describe('what the node tells the model', () => {
    it('the turn note asks for words between steps and names the proposal and its shape', () => {
        const note = turnNote();
        expect(note).toMatch(/not from the person/);
        expect(note).toMatch(/one short sentence to the person before your first tool call/);
        expect(note).toMatch(/aimeat_agent_propose/);
        expect(note).toMatch(/aimeat_workspace_list, which takes that organism's id/);
        // A store buyer read "organismeja" and their own name@node-id in the first answer (v27 P7).
        expect(note).toMatch(/say "shared place" for an organism/);
        expect(note).toMatch(/never write an identity such as name@node-id/);
    });
    it('the turn note builds an app in one turn and never asks the person to sign in (v31 K35, K38)', () => {
        const note = turnNote();
        expect(note).toMatch(/finish it in this turn/);
        expect(note).toMatch(/no interview/);
        expect(note).toMatch(/tier "build-app-atelier"/);
        expect(note).toMatch(/one that comes whole in one answer: id "genre-receipt"/);
        expect(note).not.toMatch(/genre-workbench/);
        expect(note).toMatch(/do not fetch them: build on the first part/);
        // Each genre the note names ships and comes whole: a two-part one cost the crew33 check turn.
        const named = [...note.matchAll(/"(genre-[a-z-]+)"/g)].map(m => m[1]);
        expect(named.length).toBeGreaterThan(0);
        for (const id of named) {
            const answer = nodeTemplateAnswer(id) as Record<string, unknown> | null;
            expect(answer, id).not.toBeNull();
            expect(answer?.parts ?? 1, id).toBe(1);
        }
        expect(note).toMatch(/never a reason to stop: write the page yourself/);
        expect(note).toMatch(/aimeat_app_publish/);
        expect(note).toMatch(/Give them `url`/);
        expect(note).toMatch(/never ask them to sign in/);
        expect(note).toMatch(/When aimeat_app_publish has answered, the app is done/);
        expect(note).toMatch(/do not read it after the publish/);
        expect(wrapUpPrompt('rounds')).toMatch(/publish it now with aimeat_app_publish/);
    });
    it('the node knows the address of an app the turn published, and only from a publish (crew34 K35)', () => {
        const card = { kind: 'app', url: 'https://ostoslista.example.io/' };
        expect(publishedAppUrl('aimeat: aimeat app publish', card)).toBe(card.url);
        expect(publishedAppUrl('aimeat: aimeat_app_draft_publish', card)).toBe(card.url);
        // A list of apps answers with an app card too, and that app was not made in this turn.
        expect(publishedAppUrl('aimeat: aimeat app list', card)).toBeUndefined();
        expect(publishedAppUrl('aimeat: aimeat app publish', { kind: 'page', url: card.url })).toBeUndefined();
        expect(publishedAppUrl('aimeat: aimeat app publish', null)).toBeUndefined();
    });
    it('the line for a published app gives its address in the person\'s language', () => {
        expect(appReadyText('fi', 'https://x.example/')).toBe('Sovelluksesi on valmis. Avaa se tästä: https://x.example/');
        expect(appReadyText('en', 'https://x.example/')).toMatch(/^Your app is ready\. .*https:\/\/x\.example\/$/);
        expect(appReadyText('es', 'https://x.example/')).toMatch(/^Tu aplicación está lista\. .*https:\/\/x\.example\/$/);
    });
    it('the turn note gives a news agent its web tools, its clock and email delivery (v31 K45-K47)', () => {
        const note = turnNote();
        expect(note).toMatch(/\["news", "article_fetch", "notify"\]/);
        expect(note).toMatch(/\["web", "article_fetch", "notify"\]/);
        expect(note).toMatch(/send `schedule` with the proposal/);
        expect(note).toMatch(/sends the result with the notify tool, and the proposal's scopes include notifications:send/);
    });
    it('the request for an answer says why, and asks for the proposal once', () => {
        expect(wrapUpPrompt('rounds')).toMatch(/the rounds of tool calls/);
        expect(wrapUpPrompt('time')).toMatch(/call aimeat_agent_propose once now/);
    });
});

describe('the lines the person reads', () => {
    it('are in their language, with English when one is missing', () => {
        expect(progressText('fi', 'start')).toBe('Selvä. Katson ensin, mitä sinulla on täällä.');
        expect(progressText('es', 'proposing')).toBe('Estoy escribiendo la propuesta del nuevo agente.');
        expect(stoppedText('en')).toMatch(/^I stopped here/);
        for (const loc of ['en', 'fi', 'es'] as const) {
            for (const step of ['start', 'reading', 'proposing', 'writing', 'working', 'thinking', 'wrappingUp'] as const) {
                expect(progressText(loc, step)).not.toMatch(/^chatTurn\./);
            }
        }
    });
});

describe('withTicks', () => {
    it('ticks while the stream is silent, and passes every update through in order', async () => {
        async function* slow() { await new Promise((r) => { setTimeout(r, 120); }); yield 1; yield 2; }
        const seen: unknown[] = [];
        for await (const u of withTicks(slow(), 30)) seen.push(typeof u === 'object' ? 'tick' : u);
        expect(seen.filter((s) => s === 'tick').length).toBeGreaterThanOrEqual(2);
        expect(seen.filter((s) => s !== 'tick')).toEqual([1, 2]);
    });
});
