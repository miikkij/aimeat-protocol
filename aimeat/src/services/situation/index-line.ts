/**
 * @file src/services/situation/index-line.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One paragraph in the MCP instructions for a person who has a situation picture: a
 *   record `situation.now` under their own memory, kept by an outside engine that acts as one of
 *   their agents. The paragraph tells the connecting AI that the picture exists, when to read it
 *   and which skill says how.
 *
 *   WHY IN THE INSTRUCTIONS. An AI reads the instructions on every connection and opens the
 *   handbook only sometimes. Measured on a local node on 2026-11-27: asked where things stand, the
 *   person's AI read the context the instructions named and opened neither the handbook nor the
 *   skill list, so a picture named only in a skill was never read.
 *
 *   A person without the record gets no paragraph. NEVER FAILS A BUILD: any trouble reading the
 *   store answers null, and the instructions say what they said before.
 * @structure SITUATION_NOW_KEY · situationIndexLine()
 * @usage
 *   const line = await situationIndexLine(storage, config, ownerName);
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { presentMemories } from '../classification/present-memory.js';
import type { ContentReader } from '../classification/reader.js';

export const SITUATION_NOW_KEY = 'situation.now';

const LINE = 'This person has a situation picture: what is open for them, what they promised, what they wait for from others, and what their team knows about their work. It is one record under their memory key situation.now, kept up to date by an engine that acts as their own agent. Read it (aimeat_memory_read, owner_scope true) before you answer when they ask where things stand, and when they start work on a matter or name a person or a project; then bring up only the lines that concern it. Its lines are proposals, not the person\'s own words. When the person says a line is done, wrong or not theirs, record it as the skill situated-ai says (aimeat_skill_get), so the picture corrects itself. When a line names someone who knows the matter, or the person wants to ask a colleague, find and ask through aimeat_help_find and aimeat_help_ask when this node offers them, not through a direct message: that question reaches the colleague\'s own AI, and the answer can be kept for the next person.';

/** The paragraph for one person, or null when they have no picture or the store cannot be read. */
export async function situationIndexLine(storage: Storage, config: AimeatConfig, owner: string | undefined, agentSession = true, reader?: ContentReader): Promise<string | null> {
    if (!owner) return null;
    try {
        const row = await storage.getMemory(`${owner}@${config.nodeId}`, SITUATION_NOW_KEY);
        if (!row) return null;
        // An agent reads the record only when its visibility lets every agent of the owner read it.
        if (agentSession && row.visibility === 'private') return null;
        // The connecting AI's classification reader decides, as for any memory read: a picture the
        // person classified away from AI is not named to it. Only the record's presence is used.
        if (reader && (await presentMemories(reader, [row])).length === 0) return null;
        return LINE;
    } catch (err) {
        logger.warn('situation index: unread, instructions unchanged', { owner, error: String(err) });
        return null;
    }
}
