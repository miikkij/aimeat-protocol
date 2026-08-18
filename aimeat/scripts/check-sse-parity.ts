/**
 * @file scripts/check-sse-parity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An MCP tool file that writes must say so on the change bus.
 *
 *   WHY. Every live view in this node subscribes to SSE change domains, and every REST route that
 *   writes emits the domain its view listens on. The tool surface mostly did not: on 2026-08-11,
 *   21 of the 31 tool files that write emitted nothing at all. The write landed, so nothing looked
 *   broken — and the person watching the screen saw the old state until they reloaded, which reads
 *   as "the agent did nothing" rather than "the page is stale". It is the quietest class of drift
 *   there is, which is exactly why it needs a machine to notice it.
 *
 *   WHAT IT ASSERTS. A file under src/mcp/ that calls a write-shaped storage method must either
 *   emit a change domain itself, or delegate to something that does — a shared service, or a route
 *   function it calls. Both count: the point is that the write announces itself, not where the line
 *   sits.
 *
 *   WHAT IT DOES NOT ASSERT. Which domain. A tool writing an app record could plausibly emit 'apps'
 *   or 'owners', and a check that guessed would be noise. Whether the domain is the RIGHT one is
 *   what test/e2e-mcp-sse-parity.ts measures, against a real open stream.
 *
 *   FALSE POSITIVES, and the shape of the exemption. Three kinds of file genuinely write and
 *   genuinely must not emit: the OAuth server (a token is protocol, not a view), the session and
 *   transport layer (it touches a chat instance on every request, and emitting there would be a
 *   firehose), and a tool whose REST twin emits nothing either — capabilities is the standing
 *   example. Each exemption below carries its reason, because "this one is fine" without a reason
 *   is how the list grows until it means nothing.
 * @structure EXEMPT (with reasons) · DELEGATES (files whose emit happens downstream) · main()
 * @usage pnpm check:sse-parity  ·  --strict fails the build
 * @version-history
 *   v1.1.0 — 2026-08-11 — The rule reads the tool ANNOTATIONS as well as storage calls. The first
 *     version looked only for storage.*, and four files walked past it — companies, skills,
 *     workflows and the email invitations all write through a service, and each was silently
 *     missing its emit. Found by an adversarial pass over this very check.
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit, the side-effect sweep).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MCP = join(ROOT, 'src/mcp');
const ANNOTATIONS = join(ROOT, 'src/mcp/annotations.ts');

/** Storage methods that change something. Everything else is a read, and a read announces nothing. */
const WRITEISH = /\bstorage\.(?:create|set|update|delete|add|remove|insert|upsert|write|debit|credit|transfer|enqueue|revoke|grant|mint|save|publish|archive|deactivate|activate|link|unlink)[A-Za-z]*\s*\(/;

/**
 * Every tool that declares itself as changing something (`readOnlyHint: false` in annotations.ts).
 *
 * The first version of this check looked only for `storage.*` calls, and four files walked straight
 * past it — companies, skills, workflows and the email invitations all write through a SERVICE, so
 * the regex above never saw them and each was silently missing its emit. A tool's own annotation is
 * the honest signal: it is what the tool tells its client about itself, and a mutating tool that
 * lies there has a bigger problem than a missing event.
 */
function mutatingTools(): Set<string> {
    const src = readFileSync(ANNOTATIONS, 'utf-8');
    const out = new Set<string>();
    for (const m of src.matchAll(/(\w+):\s*\{[^}]*readOnlyHint:\s*false/g)) out.add(m[1]);
    return out;
}

/** Files that write and must NOT emit, each with the reason it is not a gap. */
const EXEMPT: Record<string, string> = {
    'src/mcp/oauth.ts':
        'The OAuth server. A client registration, an approval and a refresh token are protocol state, '
        + 'not something a view renders, and no REST route emits for them either.',
    'src/mcp/index.ts':
        'The session and transport layer. It touches the chat instance on EVERY request to keep '
        + 'lastSeen current, so emitting here would be a frame per tool call rather than a change '
        + 'anyone asked about. The chat-instance tools emit for the acts a person cares about.',
    'src/mcp/apps-draft-edit.ts':
        'Every one of the four tools writes the DRAFT slot and nothing else, through stageAppDraft(). '
        + 'That write is silent on both doors: PUT /v1/apps/:owner/:filename/draft emits nothing '
        + 'either, because a draft is on no live surface — it is one owner\'s staging copy, and the '
        + '\'apps\' frame belongs to the promotion (publishAppDraft) where the catalogue actually '
        + 'changes. Emitting per chunk would also mean a frame per append while a 400 kB app is being '
        + 'built. Silence here is parity with the REST twin, not a gap.',
    'src/mcp/ai-image.ts':
        'The generated image is written to the caller\'s own storage, and POST /v1/ai/image emits '
        + 'nothing either. Storage has no SSE domain: a file appears in the owner\'s own list when '
        + 'that list is next read, and nothing on screen is showing a stale version of it meanwhile. '
        + 'Silence is parity with the REST twin.',
    'src/mcp/capabilities.ts':
        'routes/capabilities.ts emits nothing either — a published capability is read through the '
        + 'catalogue, which is not SSE-backed. Silence here is parity, not a gap.',
    'src/mcp/agent-onboarding.ts':
        'Emits agent-onboarding on its own; listed because the storage write sits in a helper the '
        + 'regex below does not associate with the emit.',
    'src/mcp/exchange.ts':
        'The EXCHANGE surface has no SSE domain at all — routes/exchange.ts and exchange-market.ts '
        + 'emit nothing either, and the market is read through the catalogue rather than a live view. '
        + 'Silence is parity. If the exchange ever gets a live surface, both doors need the domain.',
    'src/mcp/exchange-run.ts':
        'Same as exchange.ts: no SSE domain exists for the running half either.',
    'src/mcp/app-template-proposals.ts':
        'There is no REST route for template proposals — it is an MCP-only capability, so there is '
        + 'no twin to be out of step with. Emitting here would be a new behaviour, not a repair.',
};

/**
 * Files whose write announces itself DOWNSTREAM: they call a service or a route function that emits.
 * Named rather than inferred, because "somewhere below this there is an emit" is exactly the kind of
 * claim that rots — each entry says which function carries it.
 */
const DELEGATES: Record<string, string> = {
    // Step 8 (2026-08-11) moved each of these writes into the service its REST twin already called,
    // and the emit went with the write. Each was verified by reading the domain out of the service
    // rather than trusting the delegation: a tool that hands its write to a silent service is the
    // same defect as a tool that never emitted, and it hides better.
    'src/mcp/agent-capabilities.ts': "services/agent-profile-write.ts, which emits 'agent-capabilities'",
    'src/mcp/agent-management.ts': "services/agent-profile-write.ts, which emits 'agents'",
    'src/mcp/appdev-pitfalls.ts': "services/memory-write.ts and services/appdev-kb.ts, both emitting 'memory'",
    'src/mcp/appdev-proofs.ts': "services/contribution-proofs.ts, which writes through "
        + "services/memory-write.ts and emits 'memory' there. No REST twin exists for this one: the "
        + 'proof is attached from the appdev tool surface only.',
    'src/mcp/apps.ts': "services/app-publish.ts and services/app-lifecycle.ts, both emitting 'apps'",
    'src/mcp/apps-screenshot.ts': "services/screenshot-capture.ts, which emits 'apps' after the "
        + 'render — the catalogue card is what changes, and it changes for everyone who can see the '
        + 'app rather than only for the caller. Verified by reading the domain out of the service '
        + 'rather than trusting the delegation.',
    'src/mcp/boards.ts': "services/board-write.ts and services/board-post.ts, both emitting 'boards'",
    'src/mcp/chat-instances.ts': "services/chat-instance-write.ts, which emits 'chat'",
    'src/mcp/commerce.ts': "services/memory-write.ts ('memory') and services/agent-offers-write.ts ('agents')",
    'src/mcp/operator-config.ts': "services/memory-write.ts ('memory') and services/agent-profile-write.ts ('agents')",
    'src/mcp/cortex.ts': "services/cortex-lifecycle.ts, which emits 'cortex'",
    'src/mcp/extensions.ts': "services/extension-lifecycle.ts, which emits 'extensions'",
    'src/mcp/knowledge.ts': "services/knowledge-package-entry.ts, which emits 'knowledge'",
    'src/mcp/organisms-name-invites.ts': "services/invitations.ts, which emits 'organisms' and 'notifications'",
    'src/mcp/sharing-groups.ts': "services/sharing-group-members.ts, which emits 'groups'",

    'src/mcp/workspace-create.ts': 'writeRecord() from mcp/workspaces.ts, which emits organisms',
    'src/mcp/apps-fork.ts': 'emits apps itself',
    'src/mcp/consent.ts': "services/consent-write.ts, which emits 'consent'",
    'src/mcp/contacts.ts': "services/contacts.ts, which emits 'messages'",
    'src/mcp/dm-messages.ts': "services/message-send.ts, which emits 'messages'",
    'src/mcp/feedback.ts': "services/feedback.ts, which emits 'feedback'",
    'src/mcp/flags.ts': "services/moderation-flags.ts, which emits 'flags'",
    'src/mcp/agent-messages.ts': "services/agent-message-send.ts, which emits 'agent-messages' scoped to the owner",
    'src/mcp/agent-tasks.ts': "services/agent-task-write.ts (create, event, plan and todo) and "
        + "services/agent-task-fanout.ts (completion and failure), both emitting 'agent-tasks' scoped to the owner",
    'src/mcp/agent-telemetry.ts': "services/telemetry-buffer.ts ('agents') and usage-metering.ts ('agent-usage')",
    'src/mcp/core.ts': "services/work-lifecycle.ts ('work' on accept and deliver), routes/work.ts "
        + "createWorkItem ('work'), services/memory-write.ts ('memory') and services/board-post.ts ('boards')",
    'src/mcp/core-admin.ts': "services/morsel.ts mintMorsels, which emits 'config' and 'wallet'",
    'src/mcp/core-storage.ts': "services/storage-file-write.ts, which emits 'files' and 'memory'",
};

function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
}

/** Drop comments so a docblock naming emitChange does not read as a call. */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const mutating = mutatingTools();
    const silent: string[] = [];
    let writers = 0;
    let emitters = 0;

    for (const file of walk(MCP)) {
        const rel = relative(ROOT, file).replace(/\\/g, '/');
        const source = stripComments(readFileSync(file, 'utf-8'));
        // A file counts as writing if it touches storage directly OR REGISTERS a tool that declares
        // itself mutating. The second half is what catches a file writing through a service.
        //
        // src/mcp/catalog/ is excluded from that half: those files are the metadata tables — tool
        // descriptions, scope requirements, surface membership — so they NAME every tool without
        // being any tool's surface. Including them would make the check noise on its first run,
        // which is how a gate stops being read.
        const isCatalog = rel.startsWith('src/mcp/catalog/');
        const registersMutating = !isCatalog && [...mutating].some(t => source.includes(`mcp.tool(
        '${t}'`)
            || source.includes(`mcp.tool('${t}'`) || source.includes(`'${t}',
`) && source.includes('mcp.tool'));
        if (!WRITEISH.test(source) && !registersMutating) continue;
        writers++;
        if (rel in EXEMPT) continue;
        if (/emitChange\(/.test(source)) { emitters++; continue; }
        if (rel in DELEGATES) { emitters++; continue; }
        silent.push(rel);
    }

    console.log('');
    console.log('  An agent writes, and the open page hears about it (SSE parity)');
    console.log('  ' + '─'.repeat(62));
    console.log(`  tool-surface files that write            ${String(writers).padStart(4)}`);
    console.log(`  of those, exempt with a reason           ${String(Object.keys(EXEMPT).length).padStart(4)}`);
    console.log(`  announcing the change                    ${String(emitters).padStart(4)}`);
    console.log(`  SILENT                                   ${String(silent.length).padStart(4)}`);
    console.log('');

    if (silent.length) {
        for (const s of silent) console.error(`  ✖ ${s} changes something and emits no change domain`);
        console.error('');
        console.error('  Emit the domain the view for this capability listens on, right after the write —');
        console.error('  the same one its REST twin emits. If it genuinely should not, add it to EXEMPT in');
        console.error('  this file WITH THE REASON, or to DELEGATES naming the function that emits for it.');
        console.error('  Which domain is right is measured by test/e2e-mcp-sse-parity.ts against a real stream.');
        if (strict) process.exit(1);
        return;
    }

    console.log('  ✓ every writing tool surface announces its change');
}

main();
