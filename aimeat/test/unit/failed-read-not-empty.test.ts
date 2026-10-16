/**
 * @file test/unit/failed-read-not-empty.test.ts
 * @description An error is not an empty result, in the browser. Runs the shared load-state helper,
 *   the workspace view's state decision and the browser services against a read that fails: the view
 *   tells a failed read apart from "no manifest yet", and no write that replaces a whole record
 *   (the workspace registry, the organism config, a colour map, the sources) is sent after a failed
 *   read. Pages themselves were not driven in a browser; this covers the logic they call.
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F6-01, F6-02, F6-04, F6-05).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn(), api: vi.fn(),
}));
vi.mock('/js/api.js', () => api);
vi.mock('/js/services/auth.js', () => ({
  getSession: () => ({ owner: 'alice', ghii: 'alice@node-test', jwt: 'x' }),
  getStoredGhii: () => 'alice@node-test',
  getNodeId: () => 'node-test',
  getNodeUrl: () => '',
  authHeaders: () => ({}),
}));

import { loadPhase, readForWrite, isNotLoaded } from '../../public/js/load-state.js';
import { WS_FAILED, nextWorkspaceState } from '../../public/views/profile/organisms/workspace-load.js';
import * as org from '../../public/js/services/organisms.js';
import { getAgentGroups, getAgentGroupsStrict } from '../../public/js/services/agents.js';
import { materializeDocument, getNotebookSettingsStrict, getNotebookSettings } from '../../public/js/services/notebook.js';

const refused = () => Object.assign(new Error('Service unavailable'), { status: 503, code: 'UNAVAILABLE' });
const registry = (ws: Array<{ id: string; name: string }>) => ({
  ok: true, data: { items: [{ key: 'organism.o1.meta.workspaces', value: { workspaces: ws } }] },
});

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.apiPost.mockResolvedValue({ ok: true });
  api.apiDelete.mockResolvedValue({ ok: true });
});

describe('the three outcomes of a load', () => {
  it('is loading, then failed or loaded, and a failed reload of loaded data stays loaded', () => {
    expect(loadPhase({ loaded: false, error: null })).toBe('loading');
    expect(loadPhase({ loaded: false, error: new Error('x') })).toBe('failed');
    expect(loadPhase({ loaded: true, error: null })).toBe('loaded');
    expect(loadPhase({ loaded: true, error: new Error('x') })).toBe('loaded');
  });
  it('readForWrite turns a failed read into NOT_LOADED and keeps the cause', async () => {
    const cause = refused();
    const err = await readForWrite(() => Promise.reject(cause)).catch((e: unknown) => e);
    expect(isNotLoaded(err)).toBe(true);
    expect((err as Error).cause).toBe(cause);
    await expect(readForWrite(() => Promise.resolve(7))).resolves.toBe(7);
  });
});

describe('the workspace view after a read (F6-02)', () => {
  it('a failed first read is its own state, never "no manifest yet"', () => {
    expect(nextWorkspaceState(undefined, { ok: false })).toBe(WS_FAILED);
    expect(nextWorkspaceState(undefined, { ok: false })).not.toBeNull();
  });
  it('a failed read after "no manifest yet" no longer offers the set-up state', () => {
    expect(nextWorkspaceState(null, { ok: false })).toBe(WS_FAILED);
  });
  it('a failed reload keeps a workspace already on the page', () => {
    const w = { manifest: { name: 'Plan' } };
    expect(nextWorkspaceState(w, { ok: false })).toBe(w);
  });
  it('a read that worked: null without a manifest, the workspace with one', () => {
    expect(nextWorkspaceState(undefined, { ok: true, workspace: { manifest: null } })).toBeNull();
    const w = { manifest: { name: 'Plan' } };
    expect(nextWorkspaceState(WS_FAILED, { ok: true, workspace: w })).toBe(w);
  });
});

describe('the workspace registry is never written from a failed read (F6-01)', () => {
  it('createWorkspace: the read fails, nothing is written and the action stops', async () => {
    api.apiGet.mockRejectedValue(refused());
    const err = await org.createWorkspace('o1', 'New').catch((e: unknown) => e);
    expect(isNotLoaded(err)).toBe(true);
    expect(api.apiPost).not.toHaveBeenCalled();
  });
  it('createWorkspace: a read that works keeps the other workspaces', async () => {
    api.apiGet.mockResolvedValue(registry([{ id: 'ws-a', name: 'A' }, { id: 'ws-b', name: 'B' }]));
    await org.createWorkspace('o1', 'C');
    const body = api.apiPost.mock.calls[0][1];
    expect(body.key).toBe('organism.o1.meta.workspaces');
    expect(body.value.workspaces.map((w: { id: string }) => w.id).slice(0, 2)).toEqual(['ws-a', 'ws-b']);
    expect(body.value.workspaces).toHaveLength(3);
  });
  it('deleteWorkspace: the read fails, neither the delete nor a registry write is sent', async () => {
    api.apiGet.mockRejectedValue(refused());
    const err = await org.deleteWorkspace('o1', 'ws-a').catch((e: unknown) => e);
    expect(isNotLoaded(err)).toBe(true);
    expect(api.apiDelete).not.toHaveBeenCalled();
    expect(api.apiPost).not.toHaveBeenCalled();
  });
  it('deleteWorkspace: the re-read after the delete fails, the registry is left as it was', async () => {
    api.apiGet.mockResolvedValueOnce(registry([{ id: 'ws-a', name: 'A' }, { id: 'ws-b', name: 'B' }]))
      .mockRejectedValueOnce(refused());
    await org.deleteWorkspace('o1', 'ws-a');
    expect(api.apiDelete).toHaveBeenCalledTimes(1);
    expect(api.apiPost).not.toHaveBeenCalled();
  });
  it('deleteWorkspace: reads that work remove only that workspace', async () => {
    api.apiGet.mockResolvedValue(registry([{ id: 'ws-a', name: 'A' }, { id: 'ws-b', name: 'B' }]));
    await org.deleteWorkspace('o1', 'ws-a');
    expect(api.apiPost.mock.calls[0][1].value.workspaces).toEqual([{ id: 'ws-b', name: 'B' }]);
  });
  it('the notebook new-workspace path: the read fails, nothing at all is written', async () => {
    api.apiGet.mockRejectedValue(refused());
    const err = await materializeDocument({ organismId: 'o1', workspaceId: null, workspaceName: 'Notes', space: null, title: 't', markdown: 'm' })
      .catch((e: unknown) => e);
    expect(isNotLoaded(err)).toBe(true);
    expect(api.apiPost).not.toHaveBeenCalled();
    expect(api.api).not.toHaveBeenCalled();
  });
  it('the forgiving read still answers [] for drawing', async () => {
    api.apiGet.mockRejectedValue(refused());
    await expect(org.listWorkspaces('o1')).resolves.toEqual([]);
    await expect(org.listWorkspacesStrict('o1')).rejects.toThrow('Service unavailable');
  });
});

describe('whole-record writes refuse a failed read (F6-04)', () => {
  it('the publish gate keeps the rest of the config, and writes nothing when the read fails', async () => {
    api.apiGet.mockRejectedValue(refused());
    await expect(org.setPublishGate('o1', true)).rejects.toMatchObject({ code: 'NOT_LOADED' });
    expect(api.apiPost).not.toHaveBeenCalled();
    api.apiGet.mockResolvedValue({ ok: true, data: { items: [{ key: 'organism.o1.meta.config', value: { other: 1 } }] } });
    await org.setPublishGate('o1', true);
    expect(api.apiPost.mock.calls[0][1].value).toEqual({ other: 1, gates: { publish: { enabled: true, approverRole: 'owner' } } });
  });
  it('a colour change writes nothing when the colour map cannot be read', async () => {
    api.apiGet.mockRejectedValue(refused());
    await expect(org.saveItemColor('o1', 'ws-a', 'goal', 'g1', 'red')).rejects.toMatchObject({ code: 'NOT_LOADED' });
    expect(api.apiPost).not.toHaveBeenCalled();
  });
  it('a colour change keeps the other items of the space', async () => {
    api.apiGet.mockResolvedValue({ ok: true, data: { items: [{ key: 'organism.o1.w.ws-a.meta.colors.goal', value: { colors: { g0: 'blue' } } }] } });
    const m = await org.saveItemColor('o1', 'ws-a', 'goal', 'g1', 'red');
    expect(m).toEqual({ g0: 'blue', g1: 'red' });
    expect(api.apiPost.mock.calls[0][1].value).toEqual({ colors: { g0: 'blue', g1: 'red' } });
  });
  it('adding or removing a source writes nothing when the sources cannot be read', async () => {
    api.apiGet.mockRejectedValue(refused());
    const keyOf = (s: { key: string }) => s.key;
    await expect(org.addWorkspaceSources('o1', 'ws-a', [{ id: 's1', key: 'k1' }], keyOf)).rejects.toMatchObject({ code: 'NOT_LOADED' });
    await expect(org.removeWorkspaceSource('o1', 'ws-a', 's0')).rejects.toMatchObject({ code: 'NOT_LOADED' });
    expect(api.apiPost).not.toHaveBeenCalled();
  });
  it('adding a source keeps the stored ones and skips one already there', async () => {
    api.apiGet.mockResolvedValue({ ok: true, data: { items: [{ key: 'organism.o1.w.ws-a.meta.sources', value: { sources: [{ id: 's0', key: 'k0' }] } }] } });
    const keyOf = (s: { key: string }) => s.key;
    const r = await org.addWorkspaceSources('o1', 'ws-a', [{ id: 's1', key: 'k1' }, { id: 's2', key: 'k0' }], keyOf);
    expect(r.added).toBe(1);
    expect(api.apiPost.mock.calls[0][1].value.sources.map((s: { id: string }) => s.id)).toEqual(['s0', 's1']);
  });
  it('agent groups and notebook settings: a strict read throws, the forgiving one answers empty', async () => {
    api.apiGet.mockRejectedValue(refused());
    await expect(getAgentGroupsStrict()).rejects.toThrow('Service unavailable');
    await expect(getAgentGroups()).resolves.toEqual([]);
    await expect(getNotebookSettingsStrict()).rejects.toThrow('Service unavailable');
    await expect(getNotebookSettings()).resolves.toEqual({});
  });
});
