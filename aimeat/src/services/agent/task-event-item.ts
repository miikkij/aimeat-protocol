/**
 * @file src/services/agent/task-event-item.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a memory_write or app_publish task event changed, named by the node. An agent
 *   reports such an event with its own words in `message`; when its `details` name the record
 *   (`key`) or the app (`app`, its filename or its name), recordTaskEvent stores `details.item`: the
 *   kind, the key or the filename, and the title the node reads from the record (its title field or
 *   first line) or gives the app (its name, appDisplayName), so the
 *   owner's activity log names the thing by its title and not by the agent's say-so. The read is
 *   the task's own principals only: the agent that holds the task and its owner. A key or an app
 *   found under neither gets no title, and nothing of another owner is read.
 * @structure titleOfValue(value) · taskEventItem(storage, task, type, details) → TaskEventItem | null
 * @usage const item = await taskEventItem(storage, task, input.type, input.details);
 * @version-history
 *   2026-11-27 -- Initial: the activity line names the record or app an agent wrote by its title.
 */
import type { Storage, AgentTaskRecord } from '../../storage/interface.js';
import { appDisplayName, htmlFilenameOf } from '../app/app-ref.js';

/** What the event changed: a memory record by its key, or an app by its filename, with its title when there is one. */
export interface TaskEventItem {
    kind: 'memory' | 'app';
    key?: string;
    app?: string;
    title?: string;
}

const TITLE_FIELDS = ['title', 'name', 'subject', 'label', 'heading', 'headline'];
const LONGEST = 120;
const MAX_REF = 512;

const clip = (s: string): string => {
    const one = s.replace(/\s+/g, ' ').trim();
    return one.length > LONGEST ? one.slice(0, LONGEST - 1) + '…' : one;
};

/**
 * The title a person would give a stored value: the first title-like field of a record, or the
 * first non-empty line of a text without its Markdown heading marks. The Memory page's cover names
 * a record the same way (public/views/profile/memory-tab/space-titles.js).
 */
export function titleOfValue(value: unknown): string | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const rec = value as Record<string, unknown>;
        for (const f of TITLE_FIELDS) {
            const v = rec[f];
            if (typeof v === 'string' && v.trim()) return clip(v);
        }
        return null;
    }
    if (typeof value === 'string') {
        const line = value.split('\n').map((s) => s.replace(/^#+\s*/, '').trim()).find(Boolean);
        return line ? clip(line) : null;
    }
    return null;
}

const refOf = (v: unknown): string | null => (typeof v === 'string' && v.trim() && v.length <= MAX_REF ? v.trim() : null);

/**
 * The item a memory_write or app_publish event changed, or null for any other event and for an
 * event whose details name nothing. The principals asked are the task's agent and its owner, in
 * that order; the first that holds the key or the app gives the title.
 */
export async function taskEventItem(
    storage: Storage,
    task: Pick<AgentTaskRecord, 'agentGaii' | 'ownerGaii'>,
    type: string,
    details: Record<string, unknown> | undefined,
): Promise<TaskEventItem | null> {
    const principals = [task.agentGaii, task.ownerGaii].filter((p, i, all) => !!p && all.indexOf(p) === i);
    if (type === 'memory_write') {
        const key = refOf(details?.key);
        if (!key) return null;
        for (const p of principals) {
            const rec = await storage.getMemory(p, key);
            if (rec) {
                const title = titleOfValue(rec.value);
                return { kind: 'memory', key, ...(title ? { title } : {}) };
            }
        }
        return { kind: 'memory', key };
    }
    if (type === 'app_publish') {
        const app = refOf(details?.app);
        if (!app) return null;
        // The name a person uses for an app is its filename without .html (appDisplayName); the
        // lookup reads names only, never the app's bytes, and accepts "notes" for notes.html.
        const candidates = [...new Set([app, htmlFilenameOf(app)])];
        for (const p of principals) {
            const [found] = await storage.appFilenamesAmong({ ownerGaii: p }, candidates);
            if (found) return { kind: 'app', app: found, title: clip(appDisplayName(found)) };
        }
        return { kind: 'app', app };
    }
    return null;
}
