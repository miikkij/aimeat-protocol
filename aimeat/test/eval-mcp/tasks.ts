/**
 * @file tasks.ts
 * @description Realistic AIMEAT eval tasks (F2, Anthropic "writing tools for agents" methodology).
 *   These are the agent-ergonomics half of the Phase 5 measurement: a developer runs them through a
 *   live agentic loop (model + the MCP tool surface) BEFORE and AFTER a consolidation and compares
 *   tool-call count, token use, and task success. Tasks are deliberately multi-step ("strong" tasks)
 *   so they exercise tool discovery and chaining, not single-shot lookups.
 *
 *   Run with a live model — see README.md (needs ANTHROPIC_API_KEY). This file is intentionally just
 *   DATA so it carries no live dependency and can be reviewed/extended without spend.
 * @version-history
 *   v1.0.0 -- 2026-05-30 -- MCP audit Phase 5 (F2): initial eval task set
 */

export interface EvalTask {
    id: string;
    /** What the user asks the agent to accomplish. */
    prompt: string;
    /** Why this is a good eval task (exercises discovery/chaining across the tool surface). */
    rationale: string;
    /** Tools a competent run is expected to touch (hint for scoring; not a hard assertion). */
    expectedTools: string[];
    /** How to verify success (string match or "Claude as judge" rubric). */
    verify: string;
}

export const EVAL_TASKS: EvalTask[] = [
    {
        id: 'memory-roundtrip',
        prompt: 'Save a note under the key "project/acme/status" with the value "kickoff scheduled", then list my memory entries under the "project/" prefix and tell me what is there.',
        rationale: 'Exercises memory write → list discovery → read-back; checks the agent picks list (not read) for discovery.',
        expectedTools: ['aimeat_memory_write', 'aimeat_memory_list'],
        verify: 'Final answer mentions project/acme/status and "kickoff scheduled".',
    },
    {
        id: 'wallet-check',
        prompt: 'How many morsels do I have available to spend right now?',
        rationale: 'Single high-signal read; checks the agent uses wallet_balance and reads "available" not "balance".',
        expectedTools: ['aimeat_wallet_balance'],
        verify: 'Answer reports the "available" figure (balance minus escrow).',
    },
    {
        id: 'delegate-task',
        prompt: 'List my agents, then queue a task titled "summarise Q2 numbers" for whichever of my agents looks most suited to analysis work.',
        rationale: 'Exercises agents_list discovery → reasoning over capabilities → task_create with the right target_agent.',
        expectedTools: ['aimeat_agents_list', 'aimeat_task_create'],
        verify: 'A task is created with target_agent set to one of the listed agents and the given title.',
    },
    {
        id: 'board-discover-post',
        prompt: 'Find a public board to introduce myself on, then post a short hello with the title "New here".',
        rationale: 'Exercises board discovery (catalogue_boards / board_list) → board_post; tests discovery-then-act.',
        expectedTools: ['aimeat_catalogue_boards', 'aimeat_board_post'],
        verify: 'A post titled "New here" is created on an existing public board.',
    },
    {
        id: 'catalogue-find-action',
        prompt: 'Is there any service on this node that can translate text? If so, what does it cost?',
        rationale: 'Exercises catalogue_search and reading pricing; concise vs detailed response_format choice.',
        expectedTools: ['aimeat_catalogue_search'],
        verify: 'Answer states whether a translation action exists and its price, or that none was found.',
    },
    {
        id: 'find-people',
        prompt: 'Are there any people in the directory interested in "music"? Name them.',
        rationale: 'Exercises catalogue_directory with an interest filter; checks the agent does not confuse it with agent search.',
        expectedTools: ['aimeat_catalogue_directory'],
        verify: 'Answer lists directory profiles matching the music interest, or says none opted in.',
    },
    {
        id: 'work-provider-flow',
        prompt: 'Check whether anyone has requested work from me. If there is a pending item, accept it.',
        rationale: 'Exercises work_inbox → work_accept with the tracking_code threaded between calls.',
        expectedTools: ['aimeat_work_inbox', 'aimeat_work_accept'],
        verify: 'If a pending item exists it is accepted using its tracking_code; otherwise the agent reports an empty inbox.',
    },
    {
        id: 'store-and-share-file',
        prompt: 'I have a 4 MB screenshot. Upload it as "screens/dashboard.png", then give me a link I can open to view it — do not paste the image data.',
        rationale: 'Exercises storage_upload (presigned) → storage_download handle; verifies the agent returns a URL, not base64 (F11).',
        expectedTools: ['aimeat_storage_upload', 'aimeat_storage_download'],
        verify: 'Agent returns a download_url / handle and does NOT inline the binary into the conversation.',
    },
    {
        id: 'consent-grant',
        prompt: 'Grant my agent "analyst" read access to my memory keys under "project/acme/" for the purpose of reporting, then show my active consents.',
        rationale: 'Exercises consent_grant → consent_list; multi-field input (recipient, keys, purpose).',
        expectedTools: ['aimeat_consent_grant', 'aimeat_consent_list'],
        verify: 'A consent grant for the analyst covering project/acme/ appears in the active list.',
    },
    {
        id: 'onboarding-status',
        prompt: 'What do I still need to do to finish connecting to this AIMEAT node?',
        rationale: 'Exercises onboarding_status and following its next_step hint; tests the discovery/handbook surface.',
        expectedTools: ['aimeat_onboarding_status'],
        verify: 'Answer summarises remaining onboarding steps from the status response.',
    },
];
