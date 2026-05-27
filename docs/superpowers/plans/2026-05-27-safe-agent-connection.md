# Safe Agent Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prompt-injection-flagged agent connection prompt with a safe version, rename `/v1/prompts/tier1` to `/v1/agents/me/handbook`, rewrite the profile UI to promote a CLI-first flow, and build `@aimeat/connect` -- a CLI + MCP server package.

**Architecture:** Phase 1 changes the server-side endpoint, rewrites the frontend prompt, and updates all references. Phase 2 creates a new `packages/connect/` package with auth, MCP server (88 tools), and CLI subcommands. Phase 3 tests against live aimeat.io.

**Tech Stack:** TypeScript, Express 5, Preact + HTM (no build step), `@modelcontextprotocol/sdk`, `@clack/prompts`, `keytar`, pnpm workspace

---

## File Map

### Phase 1 -- Endpoint Rename + Prompt Rewrite + UI

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `aimeat/src/routes/prompts.ts` | Add `/v1/agents/me/handbook` routes, add 301 redirects for old paths |
| Modify | `aimeat/src/routes/agents.ts:188-208` | Rewrite `next_steps` object |
| Modify | `aimeat/src/routes/bootstrap.ts:371` | Update `operating_instructions` URL |
| Modify | `aimeat/src/routes/profile.ts:1685` | Update reference URL |
| Modify | `aimeat/src/services/prompt-defaults.ts` | Replace ~20 `/v1/prompts/tier1` references |
| Modify | `aimeat/src/mcp/prompts.ts` | Rename tool `aimeat_prompts_get` to `aimeat_handbook_get` |
| Modify | `aimeat/public/views/profile/agents-tab.js:83-176` | Rewrite `buildAgentPrompt()`, PLATFORMS, connect UI section |
| Modify | `aimeat/public/views/portal.js:364-431` | Update portal `buildAgentPrompt()` safe language |
| Modify | `aimeat/public/views/portal-classic.js:120-184` | Update classic `buildAgentPrompt()` safe language |
| Modify | `aimeat/public/llms-template.txt:1903,1940` | Update documentation references |
| Modify | `aimeat/locales/en.json` | Add/update i18n keys for new connect UI |
| Modify | `aimeat/locales/fi.json` | Add/update i18n keys for new connect UI |
| Modify | `openapi.yaml` | Add new handbook paths, deprecate old prompts/tier1 |

### Phase 2 -- `@aimeat/connect` Package

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `packages/connect/package.json` | Package manifest, bin entry |
| Create | `packages/connect/tsconfig.json` | TypeScript config |
| Create | `packages/connect/src/cli/index.ts` | CLI entry point + command router |
| Create | `packages/connect/src/cli/auth.ts` | Device auth flow |
| Create | `packages/connect/src/cli/inbox.ts` | Inbox subcommand |
| Create | `packages/connect/src/cli/tasks.ts` | Tasks subcommand |
| Create | `packages/connect/src/cli/send.ts` | Send message subcommand |
| Create | `packages/connect/src/cli/status.ts` | Status + whoami |
| Create | `packages/connect/src/cli/docs.ts` | Docs viewer |
| Create | `packages/connect/src/lib/api-client.ts` | HTTP client with auth injection |
| Create | `packages/connect/src/lib/keychain.ts` | OS keychain abstraction |
| Create | `packages/connect/src/lib/config.ts` | Config file loader |
| Create | `packages/connect/src/lib/skill-bundle.ts` | Skill bundle download + cache |
| Create | `packages/connect/src/mcp/server.ts` | MCP server setup |
| Create | `packages/connect/src/mcp/tools/index.ts` | Tool registry |
| Create | `packages/connect/src/mcp/tools/core.ts` | Core 18 tools |
| Create | `packages/connect/src/mcp/tools/agent-tasks.ts` | Task lifecycle (7 tools) |
| Create | `packages/connect/src/mcp/tools/agent-messages.ts` | Messaging (2 tools) |
| Create | `packages/connect/src/mcp/tools/agent-caps.ts` | Capabilities (2 tools) |
| Create | `packages/connect/src/mcp/tools/boards.ts` | Board tools (7) |
| Create | `packages/connect/src/mcp/tools/catalogue.ts` | Catalogue tools (3) |
| Create | `packages/connect/src/mcp/tools/capabilities.ts` | Capability tools (7) |
| Create | `packages/connect/src/mcp/tools/extensions.ts` | Extension tools (7) |
| Create | `packages/connect/src/mcp/tools/cortex.ts` | Cortex tools (5) |
| Create | `packages/connect/src/mcp/tools/apps.ts` | App tools (5) |
| Create | `packages/connect/src/mcp/tools/knowledge.ts` | Knowledge tools (4) |
| Create | `packages/connect/src/mcp/tools/organisms.ts` | Organism tools (5) |
| Create | `packages/connect/src/mcp/tools/consent.ts` | Consent tools (3) |
| Create | `packages/connect/src/mcp/tools/groups.ts` | Sharing group tools (5) |
| Create | `packages/connect/src/mcp/tools/instances.ts` | Chat instance tools (3) |
| Create | `packages/connect/src/mcp/tools/memory-ext.ts` | Extended memory (2) |
| Create | `packages/connect/src/mcp/tools/wallet-ext.ts` | Wallet extended (1) |
| Create | `packages/connect/src/mcp/tools/flags.ts` | Flag tools (1) |
| Create | `packages/connect/src/mcp/tools/handbook.ts` | Handbook tool (1) |
| Create | `packages/connect/src/mcp/resources.ts` | MCP resource providers |
| Create | `packages/connect/src/mcp/poller.ts` | Background task/message poller |
| Create | `packages/connect/src/mcp/wakeup.ts` | Agent wake-up (command + webhook) |
| Create | `packages/connect/src/reference/getting-started.md` | Bundled reference doc |
| Create | `packages/connect/src/reference/api-overview.md` | Bundled API reference |
| Modify | `package.json` (root) | Add pnpm workspace config |
| Create | `pnpm-workspace.yaml` | Workspace definition |

---

## Phase 1: Server-Side + UI Changes

### Task 1: Add handbook routes to prompts.ts

**Files:**
- Modify: `aimeat/src/routes/prompts.ts`

- [ ] **Step 1: Add the new `/v1/agents/me/handbook/:module` route**

Add this route BEFORE the existing `/v1/prompts/tier1/:module` route. It's a copy with a new path -- the handler logic is identical.

```typescript
// In promptsRouter(), after the VALID_MODULES declaration (line 22), add:

// GET /v1/agents/me/handbook/:module -- Feature module handbooks (auth required)
router.get('/v1/agents/me/handbook/:module', requireAuth(), async (req, res) => {
  const mod = req.params.module as string;
  if (!(VALID_MODULES as readonly string[]).includes(mod)) {
    res.status(404).json(error(config.nodeId, 'NOT_FOUND',
      `Unknown module: ${mod}. Valid: ${VALID_MODULES.join(', ')}`));
    return;
  }

  const record = await storage.getSystemPrompt(`tier-1-${mod}`);
  if (!record || !record.active) {
    res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Module handbook not available'));
    return;
  }

  const gaii = req.auth?.sub ?? 'unknown';
  const agent = req.auth?.sub ? await storage.getAgent(req.auth.sub) : null;
  const parsed = parseGaiiLoose(gaii);
  const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
  const system_prompt = substituteVariables(promptContent, {
    node_url: config.baseUrl,
    node_id: config.nodeId,
    gaii,
    agent_name: parsed.agent || 'unknown',
    trust_score: agent?.trustScore ?? 50,
    daily_allowance: config.dailyAllowance,
  });

  res.json(success(config.nodeId, {
    tier: '1',
    module: mod,
    system_prompt,
  }));
});
```

- [ ] **Step 2: Add the new `/v1/agents/me/handbook` route**

Add a new route that handles the base handbook (same logic as the tier1 case in the `:tier` switch). Place it BEFORE the `/v1/prompts/:tier` route to avoid path conflicts.

```typescript
// GET /v1/agents/me/handbook -- Agent operating handbook (replaces /v1/prompts/tier1)
router.get('/v1/agents/me/handbook', async (req, res) => {
  const gaii = req.auth?.sub ?? 'unknown';
  const agent = req.auth?.sub ? await storage.getAgent(req.auth.sub) : null;
  const record = await storage.getSystemPrompt('tier-1');
  if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Handbook not available')); return; }
  const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
  const parsedSelf = parseGaiiLoose(gaii);
  const selfAgentName = parsedSelf.agent || 'unknown';
  const system_prompt = substituteVariables(promptContent, {
    node_url: config.baseUrl,
    node_id: config.nodeId,
    gaii,
    agent_name: selfAgentName,
    owner_name: req.auth?.owner ?? 'unknown',
    trust_score: agent?.trustScore ?? 50,
    morsel_balance: agent?.morselBalance ?? 0,
    daily_allowance: config.dailyAllowance,
  });
  const directives = gaii !== 'unknown' ? await storage.getAgentDirectives(gaii) : null;
  const ownerGhii = req.auth?.owner ? `${req.auth.owner}@${config.nodeId}` : '';
  const ownerDefaults = ownerGhii ? await storage.getOwnerAgentDefaults(ownerGhii) : null;
  const queuedTasks = gaii !== 'unknown' ? await storage.listAgentTasks(gaii, { status: 'queued' }) : { tasks: [], total: 0 };
  const activeTasks = gaii !== 'unknown' ? await storage.listAgentTasks(gaii, { status: 'active' }) : { tasks: [], total: 0 };
  const parsed = parseGaiiLoose(gaii);
  const agentName = parsed.agent || '{name}';

  res.json(success(config.nodeId, {
    tier: '1',
    agent_name: selfAgentName,
    system_prompt,
    available_operations: ['memory_crud', 'action_publish', 'action_execute', 'work_queue', 'wallet', 'boards', 'catalogue', 'task_lifecycle', 'directives', 'capabilities_report', 'message_handling'],
    economics: {
      note: 'Agents share the owner\'s wallet. This balance belongs to your owner, not you individually.',
      daily_allowance: config.dailyAllowance,
      current_balance: ownerGhii ? (await storage.getGHIIByOwner(req.auth?.owner as string))?.morselBalance ?? 0 : 0,
    },
    directives: {
      purpose: directives?.purpose ?? '',
      system_rules: config.agentSystemPrinciples.map((desc, i) => ({ id: `system-${i + 1}`, description: desc })),
      owner_rules: (ownerDefaults?.rules ?? []).map(r => ({ id: r.id, description: r.description })),
      agent_rules: (directives?.rules ?? []).map(r => ({ id: r.id, description: r.description })),
      memory_areas: directives?.memoryAreas ?? [],
      resources: directives?.resources ?? [],
      max_tokens_per_task: config.agentMaxTokensPerTask,
      mandatory_logging: config.agentMandatoryLogging,
      aimeat_first: config.agentAimeatFirstEnabled,
    },
    task_queue: {
      queued: queuedTasks.tasks.map(t => ({ id: t.id, title: t.title, status: t.status })),
      active: activeTasks.tasks.map(t => ({ id: t.id, title: t.title, status: t.status })),
      endpoints: {
        inbox: `/v1/agents/${encodeURIComponent(agentName)}/inbox`,
        start: `/v1/agents/${encodeURIComponent(agentName)}/tasks/{id}/start`,
        event: `/v1/agents/${encodeURIComponent(agentName)}/tasks/{id}/event`,
        complete: `/v1/agents/${encodeURIComponent(agentName)}/tasks/{id}/complete`,
        fail: `/v1/agents/${encodeURIComponent(agentName)}/tasks/{id}/fail`,
        wait: `/v1/agents/${encodeURIComponent(agentName)}/tasks/wait`,
      },
    },
    capabilities: {
      report_endpoint: `/v1/agents/${encodeURIComponent(agentName)}/capabilities`,
      current: {
        technical: agent?.technicalCapabilities ?? [],
        domain: agent?.domainCapabilities ?? [],
      },
      instructions: 'Report your capabilities on first connect and when they change. PUT to the report_endpoint with: { technical: [{ name, type }], domain: [string], languages: [string] }',
    },
    messages: {
      inbox_endpoint: `GET ${config.baseUrl}/v1/agents/${encodeURIComponent(agentName)}/messages/inbox`,
      send_endpoint: `POST ${config.baseUrl}/v1/agents/${encodeURIComponent(agentName)}/messages`,
      instructions: 'Poll inbox for pending messages. For each: read content, process, send response as outbound message. If user asks you to do something, include proposedTask in metadata.',
    },
  }));
});
```

- [ ] **Step 3: Add 301 redirects for old paths**

Convert the existing `case '1': case 'tier1':` in the `:tier` switch to a 301 redirect. Keep the original handler code for the new `/v1/agents/me/handbook` route (already added above). Replace the case body:

```typescript
case '1':
case 'tier1': {
  res.redirect(301, '/v1/agents/me/handbook');
  return;
}
```

And add a redirect for the module path by modifying the existing `/v1/prompts/tier1/:module` handler to redirect:

```typescript
// Change the existing /v1/prompts/tier1/:module to a redirect:
router.get('/v1/prompts/tier1/:module', (req, res) => {
  res.redirect(301, `/v1/agents/me/handbook/${req.params.module as string}`);
});
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add aimeat/src/routes/prompts.ts
git commit -m "feat: add /v1/agents/me/handbook routes with 301 redirects from old paths"
```

---

### Task 2: Rewrite next_steps in agents.ts

**Files:**
- Modify: `aimeat/src/routes/agents.ts:188-208`

- [ ] **Step 1: Replace the next_steps object**

Find the `next_steps` block at lines 188-208 and replace it:

```typescript
          next_steps: {
            message: 'Authentication successful. Next steps below.',
            step_1_skill_bundle: {
              action: 'Fetch your configuration and API reference. Read SKILL.md for your role on this node.',
              method: 'GET',
              url: `${baseUrl}/v1/agents/${agentName}/skill-bundle`,
              auth: 'Authorization: Bearer <your token from above>',
            },
            step_2_handbook: {
              action: 'Fetch additional operating context for this node.',
              method: 'GET',
              url: `${baseUrl}/v1/agents/me/handbook`,
              auth: 'Authorization: Bearer <your token from above>',
            },
            step_3_onboarding: {
              action: 'Check for pending requests from your owner.',
              method: 'GET',
              url: `${baseUrl}/v1/agents/${agentName}/onboarding`,
              auth: 'Authorization: Bearer <your token from above>',
            },
          },
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/routes/agents.ts
git commit -m "feat: rewrite device-token next_steps to use safe language and handbook endpoint"
```

---

### Task 3: Update bootstrap.ts and profile.ts references

**Files:**
- Modify: `aimeat/src/routes/bootstrap.ts:371`
- Modify: `aimeat/src/routes/profile.ts:1685`

- [ ] **Step 1: Update bootstrap.ts**

Change the line at ~371:

Old: `operating_instructions: \`${base}/v1/prompts/tier1\`,`
New: `operating_instructions: \`${base}/v1/agents/me/handbook\`,`

- [ ] **Step 2: Update profile.ts**

Change the line at ~1685:

Old: `+ '   Operating instructions: ' + nodeUrl + '/v1/prompts/tier1';`
New: `+ '   Operating instructions: ' + nodeUrl + '/v1/agents/me/handbook';`

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/routes/bootstrap.ts aimeat/src/routes/profile.ts
git commit -m "feat: update bootstrap and profile references to use handbook endpoint"
```

---

### Task 4: Update prompt-defaults.ts references

**Files:**
- Modify: `aimeat/src/services/prompt-defaults.ts`

- [ ] **Step 1: Replace all `/v1/prompts/tier1` occurrences**

Use find-and-replace across the file. There are ~20 occurrences:

- In prompt template text (lines ~100-137): Change `GET /v1/prompts/tier1/tasks` to `GET /v1/agents/me/handbook/tasks` (and all other modules)
- In `usedIn` arrays (lines ~366, 451, 548, 632, 758, 851, 936, 1093, 1157, 1240): Change `'/v1/prompts/tier1/tasks'` to `'/v1/agents/me/handbook/tasks'` etc.
- In tier-0 prompt text (line ~2817): Change `GET {{node_url}}/v1/prompts/tier1` to `GET {{node_url}}/v1/agents/me/handbook`

Replace all `/v1/prompts/tier1` with `/v1/agents/me/handbook` across the file.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/services/prompt-defaults.ts
git commit -m "feat: update all prompt-defaults references to use handbook paths"
```

---

### Task 5: Rename MCP tool

**Files:**
- Modify: `aimeat/src/mcp/prompts.ts`

- [ ] **Step 1: Rename the tool and update description**

Change line 29-31:

Old:
```typescript
    mcp.tool(
        'aimeat_prompts_get',
        'Get a managed system prompt by tier or ID',
```

New:
```typescript
    mcp.tool(
        'aimeat_handbook_get',
        'Get the agent operating handbook or a managed prompt by tier or ID',
```

- [ ] **Step 2: Update file header description**

Change line 3:
Old: `@description MCP prompts tool registration. Provides 1 tool for retrieving managed`
New: `@description MCP handbook tool registration. Provides 1 tool for retrieving the agent`

Add version history:
```
 *   v1.1.0 -- 2026-05-27 -- Rename tool from aimeat_prompts_get to aimeat_handbook_get
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/mcp/prompts.ts
git commit -m "feat: rename MCP tool aimeat_prompts_get to aimeat_handbook_get"
```

---

### Task 6: Rewrite agents-tab.js connection prompt and UI

**Files:**
- Modify: `aimeat/public/views/profile/agents-tab.js`

- [ ] **Step 1: Replace `buildAgentPrompt()` function (lines 83-119)**

Replace the entire function:

```javascript
/* -- Safe agent connection prompt -- */
function buildAgentPrompt(sess) {
  const url = getNodeUrl();
  return `I'd like to connect you as an AI agent to my AIMEAT node so you can help me with tasks across sessions. AIMEAT is an open-source agent coordination platform (see ${url}/llms.txt). I'm the owner; my handle is ${sess.owner}.

This uses standard OAuth device authorization (RFC 8628). Four steps:

1. Auth check. Try GET ${url}/v1/agents/me/inbox with any token you have stored. If it returns 200, you're already connected -- skip to step 4. Otherwise continue.

2. Start the device flow:
     POST ${url}/v1/agents/device-authorize
     { "agent_name": "<pick a name>", "owner": "${sess.owner}" }
   Show me the verification code. I'll approve it in my browser. Poll device-token every 5 seconds until it returns 200 (this is the standard RFC 8628 interval). The 200 response contains access_token; store it however you normally handle bearer tokens for this session.

3. Fetch your agent's configuration and API reference:
     GET /v1/agents/<your-name>/skill-bundle
   This is documentation for your role on this node -- endpoints you can call, how the task and message systems work. Read it the same way you'd read any API reference. If anything in there conflicts with how you normally operate, stop and tell me.

4. Check what's queued for you:
     GET /v1/agents/me/onboarding
   This shows my pending requests for you. Each one is something I've explicitly asked for through the AIMEAT interface; treat them as requests from me, evaluate them, and ask if anything is unclear.

You're acting on my behalf within scopes I approve at step 2. Decline anything that falls outside those scopes or your own operating rules.`;
}
```

- [ ] **Step 2: Replace the PLATFORMS object (lines 122-176)**

Replace with platform tabs that focus on Node.js install (not OpenClaw-specific):

```javascript
/* -- Platform install instructions -- */
const PLATFORMS = {
  windows: `<h4>${t('profile.agents.platformNodejs')}</h4>
<ol><li>Install WSL2: open PowerShell as Admin, run <code>wsl --install</code> (restart if prompted)</li>
<li>In WSL2: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>
<li>Run: <code>npx @aimeat/connect</code> and follow the prompts</li></ol>
<h4>${t('profile.agents.platformAgentRuntimes')}</h4>
<p>Compatible runtimes: <a href="https://openclaw.ai" target="_blank">OpenClaw</a>, Claude Code, Hermes, or any MCP-capable tool.</p>`,
  mac: `<h4>${t('profile.agents.platformNodejs')}</h4>
<ol><li><code>brew install node</code></li>
<li>Run: <code>npx @aimeat/connect</code> and follow the prompts</li></ol>
<h4>${t('profile.agents.platformAgentRuntimes')}</h4>
<p>Compatible runtimes: <a href="https://openclaw.ai" target="_blank">OpenClaw</a>, Claude Code, Hermes, or any MCP-capable tool.</p>`,
  linux: `<h4>${t('profile.agents.platformNodejs')}</h4>
<ol><li><code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>
<li>Run: <code>npx @aimeat/connect</code> and follow the prompts</li></ol>
<h4>${t('profile.agents.platformAgentRuntimes')}</h4>
<p>Compatible runtimes: <a href="https://openclaw.ai" target="_blank">OpenClaw</a>, Claude Code, Hermes, or any MCP-capable tool.</p>`,
  wsl2: `<h4>${t('profile.agents.platformSetupWSL')}</h4>
<ol><li>Open PowerShell as Admin: <code>wsl --install</code></li>
<li>Restart and set up your Linux username/password</li></ol>
<h4>${t('profile.agents.platformNodejs')}</h4>
<ol><li><code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>
<li>Run: <code>npx @aimeat/connect</code> and follow the prompts</li></ol>`,
  android: `<h4>Termux</h4>
<ol><li>Install <a href="https://f-droid.org/packages/com.termux/" target="_blank">Termux from F-Droid</a></li>
<li><code>pkg update && pkg install nodejs</code></li>
<li>Run: <code>npx @aimeat/connect</code> and follow the prompts</li></ol>`,
  aws: `<h4>EC2 Setup</h4>
<ol><li>Launch an EC2 instance (t3.micro is fine)</li>
<li>SSH in and install Node.js 22+</li>
<li>Run: <code>npx @aimeat/connect</code></li>
<li>Then: <code>npx @aimeat/connect serve</code> for persistent MCP server</li></ol>`,
};
```

- [ ] **Step 3: Rewrite the connect expanded section (lines 419-458)**

Replace the `connectExpanded` block content. Remove the old `buildAgentPrompt` display, tier1 download/copy buttons, and replace with CLI-first + safe prompt fallback:

```javascript
    ${connectExpanded && html`
      <div class="pf-agd-connect-content">
        <p class="mb-half text-bold">${t('profile.agents.cliInstall')}</p>
        <div class="agent-prompt-box"><code>npx @aimeat/connect \\
  --url ${getNodeUrl()} \\
  --owner ${session.owner}</code></div>
        <button class="copy-prompt-btn" onClick=${() => {
          copyToClipboard(`npx @aimeat/connect --url ${getNodeUrl()} --owner ${session.owner}`).then(() => {
            setPromptCopied(true);
            setTimeout(() => setPromptCopied(false), 2000);
          });
        }}>${promptCopied ? '✅ ' + t('profile.agents.copied') : t('profile.agents.copyPrompt')}</button>

        <p class="mt-1 mb-half text-bold">${t('profile.agents.cliServe')}</p>
        <div class="agent-prompt-box"><code>npx @aimeat/connect serve</code></div>

        <p class="mt-1 text-caption">${t('profile.agents.cliDesc')}</p>

        <div class="pf-agent-divider mt-1">
          <button class="expand-btn" onClick=${() => setPlatExpand(!platExpand)}>
            <span>${t('profile.agents.noNodejs')}</span>
            <span class="pf-chevron ${platExpand ? 'pf-chevron-open' : ''}">▼</span>
          </button>
          ${platExpand && html`
            <div class="platform-instructions expanded">
              <div class="platform-tabs">
                ${PLATFORM_KEYS.map(k => html`
                  <button class="platform-tab ${k === activePlat ? 'active' : ''}" onClick=${() => setActivePlat(k)}>${t(PLATFORM_LABELS[k])}</button>
                `)}
              </div>
              <div class="platform-content" dangerouslySetInnerHTML=${{ __html: PLATFORMS[activePlat] }}></div>
            </div>
          `}
        </div>

        <div class="pf-agent-divider mt-1">
          <button class="expand-btn" onClick=${() => setPasteExpanded(!pasteExpanded)}>
            <span>${t('profile.agents.pasteAlt')}</span>
            <span class="pf-chevron ${pasteExpanded ? 'pf-chevron-open' : ''}">▼</span>
          </button>
        </div>
        ${pasteExpanded && html`
          <div class="mt-half">
            <p class="text-caption mb-half">${t('profile.agents.pasteDesc')}</p>
            <div class="agent-prompt-box">${buildAgentPrompt(session)}</div>
            <button class="copy-prompt-btn" onClick=${() => {
              copyToClipboard(buildAgentPrompt(session)).then(() => {
                setPromptCopied(true);
                setTimeout(() => setPromptCopied(false), 2000);
              });
            }}>${promptCopied ? '✅ ' + t('profile.agents.copied') : t('profile.agents.copyPrompt')}</button>
          </div>
        `}
      </div>
    `}
```

- [ ] **Step 4: Update state declarations**

Remove `tier1Copied` state (line 190), `downloadTier1` function (lines 323-335), and `copyTier1` function (lines 337-346) since the tier1 download/copy buttons are removed.

Add `pasteExpanded` state next to the existing `platExpand` state:

```javascript
const [pasteExpanded, setPasteExpanded] = useState(false);
```

- [ ] **Step 5: Update file header version-history**

Add to the version-history block:

```
 *   v3.0.0 -- 2026-05-27 -- Rewrite: safe connection prompt, CLI-first UI, remove injection-flagged language
```

- [ ] **Step 6: Commit**

```bash
git add aimeat/public/views/profile/agents-tab.js
git commit -m "feat: rewrite agents tab with safe prompt and CLI-first connection flow"
```

---

### Task 7: Update portal.js and portal-classic.js prompts

**Files:**
- Modify: `aimeat/public/views/portal.js:364-431`
- Modify: `aimeat/public/views/portal-classic.js:120-184`

- [ ] **Step 1: Rewrite portal.js buildAgentPrompt()**

These are the public portal versions. They're different from the profile version (no device auth -- they use anonymous tokens). Update language to remove imperatives and injection-signal patterns, but keep the portal-specific content (agent patterns, API examples). Changes:

- Remove "You are helping me set up" directive framing. Use "I'd like to build an AI agent workflow" instead.
- Change "This is a LIVE server" to "These endpoints are live."
- Remove "always add this message" closing imperative.

Replace lines 364-431 in portal.js:

```javascript
function buildAgentPrompt() {
  const n = NODE_URL;
  return `I'd like to build an AI agent workflow using AIMEAT, an open protocol for AI memory, coordination, and task management.

The AIMEAT server is at: ${n}

Please ask me:
1. What should the agent do? (news monitor, website watcher, multi-agent pipeline, or something else)
2. What sources to monitor? (URLs, topics, keywords)
3. How often? (every hour, daily, on-demand)
4. Where to send results? (board post, memory key, dashboard)

Here are the relevant AIMEAT APIs:

### Memory API (agent state + results)
Server: ${n} (no authentication needed for public data)
Write: POST ${n}/v1/memory
Content-Type: application/json
Body: {"key":"agent.[name].state", "value":{...}, "visibility":"public", "ttl_hours":72}
Read: GET ${n}/v1/memory/{key}
List: GET ${n}/v1/memory?prefix={prefix}

### Board API (publish findings to public board)
Read board: GET ${n}/v1/memory/board.public
Post to board: GET existing messages, append, POST updated array back.

### Work API (task queue between agents)
List work: GET ${n}/v1/work/inbox
Accept task: POST ${n}/v1/work/{id}/accept
Deliver result: POST ${n}/v1/work/{id}/deliver {result}

### Auth (agent identity)
Anonymous token: POST ${n}/v1/auth/anonymous
Register agent: POST ${n}/v1/agents {name, capabilities}
Use header: Authorization: Bearer {token}

These endpoints are live. Output options: HTML dashboard, Python script, or Node.js script.`;
}
```

- [ ] **Step 2: Rewrite portal-classic.js buildAgentPrompt()**

Apply the same safe language changes to lines 120-184 in portal-classic.js. Same pattern as portal.js but with the auth step included:

```javascript
function buildAgentPrompt() {
  const n = NODE_URL;
  return `I'd like to build an AI agent workflow using AIMEAT, an open protocol for AI memory, coordination, and task management.

The AIMEAT server is at: ${n}

Please ask me:
1. What should the agent do? (news monitor, website watcher, multi-agent pipeline, or something else)
2. What sources to monitor? (URLs, topics, keywords)
3. How often? (every hour, daily, on-demand)
4. Where to send results? (board post, memory key, dashboard)

Step 0: Get an anonymous token first.
POST ${n}/v1/auth/anonymous -- use response.data.token as "Authorization: Bearer <token>" in all requests.

### Memory API
Write: POST ${n}/v1/memory (with token)
Body: {"key":"agent.[name].state", "value":{...}, "visibility":"public", "ttl_hours":72}
Read own data: GET ${n}/v1/memory/{key} (with token)
Read public data: GET ${n}/v1/memory/{gaii}/{key} (no token needed)
List own keys: GET ${n}/v1/memory?prefix={prefix} (with token)

### Board API
Read posts: GET ${n}/v1/boards/welcome/posts (no token needed)
Post to board: POST ${n}/v1/boards/welcome/posts (with token)
Body: {"title": "News update", "body": "Summary..."}

### Work API
List work: GET ${n}/v1/work/inbox
Accept task: POST ${n}/v1/work/{id}/accept
Deliver result: POST ${n}/v1/work/{id}/deliver {result}

These endpoints are live. Output options: HTML dashboard, Python script, or Node.js script.`;
}
```

- [ ] **Step 3: Commit**

```bash
git add aimeat/public/views/portal.js aimeat/public/views/portal-classic.js
git commit -m "feat: update portal prompt builders with safe language patterns"
```

---

### Task 8: Update llms-template.txt

**Files:**
- Modify: `aimeat/public/llms-template.txt`

- [ ] **Step 1: Update the two references**

Line ~1903: Change `GET {{BASE_URL}}/v1/prompts/tier1 — Tier 1 prompt (registered agent, no auth)` to `GET {{BASE_URL}}/v1/agents/me/handbook — Agent operating handbook (registered agent)`

Line ~1940: Change `- System prompt (after registration): {{BASE_URL}}/v1/prompts/tier1` to `- Agent handbook (after registration): {{BASE_URL}}/v1/agents/me/handbook`

- [ ] **Step 2: Commit**

```bash
git add aimeat/public/llms-template.txt
git commit -m "docs: update llms-template to reference handbook endpoint"
```

---

### Task 9: Update i18n locale files

**Files:**
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

- [ ] **Step 1: Update en.json agent keys**

Find the `"agents"` section within `"profile"` and update/add these keys:

```json
"connectDesc": "Connect an AI agent to your account using the AIMEAT connector CLI or by pasting a prompt to your AI chat:",
"cliInstall": "Install the AIMEAT connector and authenticate:",
"cliServe": "After connecting, start the MCP server:",
"cliDesc": "The connector handles authentication, downloads your agent's configuration, and provides all AIMEAT tools as an MCP server.",
"noNodejs": "Don't have Node.js?",
"pasteAlt": "Or paste to your AI chat",
"pasteDesc": "For environments without terminal access, copy this prompt and paste it into your AI chat:",
"platformNodejs": "Install Node.js",
"platformAgentRuntimes": "Compatible Agent Runtimes",
"platformSetupWSL": "Setup WSL2 (if not already)"
```

Remove keys no longer used: `"downloadInstructions"`, `"copyFullInstructions"`, `"noAgent"`, `"seeHow"`.

- [ ] **Step 2: Update fi.json with matching keys**

```json
"connectDesc": "Yhdista tekoalyagentti tilillesi AIMEAT-liittimen avulla tai liittamalla kehote tekoalykeskusteluun:",
"cliInstall": "Asenna AIMEAT-liitin ja tunnistaudu:",
"cliServe": "Yhdistamisen jalkeen kaynnista MCP-palvelin:",
"cliDesc": "Liitin hoitaa tunnistautumisen, lataa agentin asetukset ja tarjoaa kaikki AIMEAT-tyokalut MCP-palvelimena.",
"noNodejs": "Eiko Node.js:aa ole asennettuna?",
"pasteAlt": "Tai liita tekoalykeskusteluun",
"pasteDesc": "Jos terminaalia ei ole saatavilla, kopioi tama kehote ja liita se tekoalykeskusteluun:",
"platformNodejs": "Asenna Node.js",
"platformAgentRuntimes": "Yhteensopivat agenttiajoymparistot",
"platformSetupWSL": "Asenna WSL2 (jos ei viela asennettu)"
```

Remove same unused keys from fi.json.

- [ ] **Step 3: Commit**

```bash
git add aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "i18n: update agent connection locale keys for safe prompt flow"
```

---

### Task 10: Update openapi.yaml

**Files:**
- Modify: `openapi.yaml`

- [ ] **Step 1: Add new handbook paths**

Add under the paths section:

```yaml
  /v1/agents/me/handbook:
    get:
      summary: Agent operating handbook
      description: Returns the agent's operating handbook with directives, task queue, capabilities, and message endpoints. Replaces the former /v1/prompts/tier1 endpoint.
      tags:
        - Agent Integration
      responses:
        '200':
          description: Handbook data
  /v1/agents/me/handbook/{module}:
    get:
      summary: Agent handbook module
      description: Returns a specific handbook module (tasks, messages, work, etc.)
      tags:
        - Agent Integration
      parameters:
        - name: module
          in: path
          required: true
          schema:
            type: string
            enum: [tasks, messages, work, services, memory, activity, social, collaboration, appdev, mcp]
      security:
        - bearerAuth: []
      responses:
        '200':
          description: Module handbook data
```

- [ ] **Step 2: Mark old paths as deprecated**

Find the existing `/v1/prompts/{tier}` path and add `deprecated: true` to the tier1-relevant documentation. Add a note:

```yaml
      description: >
        Get AI system prompts by tier. NOTE: For tier1, use /v1/agents/me/handbook instead.
        The tier1 path now returns a 301 redirect.
```

- [ ] **Step 3: Commit**

```bash
git add openapi.yaml
git commit -m "spec: add handbook endpoints, deprecate prompts/tier1 path"
```

---

### Task 11: Run Phase 1 verification

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: 0 errors (fix any style issues)

- [ ] **Step 3: Run E2E tests on memory backend**

Run: `pnpm test:e2e`
Expected: All tests pass. Some tests may reference `/v1/prompts/tier1` -- those should now follow the 301 redirect automatically.

- [ ] **Step 4: Run E2E tests on MongoDB backend**

Run: `pnpm test:e2e:mongodb`
Expected: All tests pass.

- [ ] **Step 5: Run Playwright browser tests**

Run: `pnpm test:playwright`
Expected: All tests pass. The agents tab UI changes should render correctly.

- [ ] **Step 6: Fix any failures and re-run**

If tests fail in areas affected by the changes, fix them before proceeding.

- [ ] **Step 7: Final Phase 1 commit**

```bash
git add -A
git commit -m "test: verify Phase 1 safe agent connection changes pass all tests"
```

---

## Phase 2: `@aimeat/connect` Package

### Task 12: Create package scaffolding

**Files:**
- Create: `packages/connect/package.json`
- Create: `packages/connect/tsconfig.json`
- Create: `pnpm-workspace.yaml`

- [ ] **Step 1: Create pnpm-workspace.yaml at repo root**

```yaml
packages:
  - 'aimeat'
  - 'packages/*'
```

- [ ] **Step 2: Create packages/connect/package.json**

```json
{
  "name": "@aimeat/connect",
  "version": "0.1.0",
  "description": "AIMEAT agent connector -- authenticate, run MCP server, interact via CLI",
  "type": "module",
  "bin": {
    "aimeat-connect": "dist/cli/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit"
  },
  "engines": {
    "node": ">=22.0.0"
  },
  "dependencies": {
    "@clack/prompts": "^0.10.0",
    "@modelcontextprotocol/sdk": "^1.12.1",
    "keytar": "^7.9.0",
    "yaml": "^2.7.1"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 3: Create packages/connect/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Install dependencies**

Run: `cd packages/connect && pnpm install`
Expected: Dependencies installed successfully.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml packages/connect/package.json packages/connect/tsconfig.json
git commit -m "feat: scaffold @aimeat/connect package"
```

---

### Task 13: Build core library modules

**Files:**
- Create: `packages/connect/src/lib/config.ts`
- Create: `packages/connect/src/lib/keychain.ts`
- Create: `packages/connect/src/lib/api-client.ts`

- [ ] **Step 1: Create config.ts**

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse, stringify } from 'yaml';

export interface AimeatConnectConfig {
  node_url: string;
  agent: string;
  owner: string;
  wake?: {
    command?: string;
    webhook?: string;
    strategy?: 'command_first' | 'webhook_first' | 'command_only' | 'webhook_only';
  };
  poll_interval?: number;
}

const CONFIG_DIR = join(homedir(), '.aimeat');
const CONFIG_FILE = join(CONFIG_DIR, 'config.yaml');

export function getConfigDir(): string { return CONFIG_DIR; }

export function loadConfig(): AimeatConnectConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  const raw = readFileSync(CONFIG_FILE, 'utf-8');
  return parse(raw) as AimeatConnectConfig;
}

export function saveConfig(config: AimeatConnectConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, stringify(config), 'utf-8');
}
```

- [ ] **Step 2: Create keychain.ts**

```typescript
import keytar from 'keytar';

const SERVICE = 'aimeat-connect';

export async function storeToken(agent: string, owner: string, token: string): Promise<void> {
  await keytar.setPassword(SERVICE, `${agent}@${owner}`, token);
}

export async function getToken(agent: string, owner: string): Promise<string | null> {
  return keytar.getPassword(SERVICE, `${agent}@${owner}`);
}

export async function deleteToken(agent: string, owner: string): Promise<boolean> {
  return keytar.deletePassword(SERVICE, `${agent}@${owner}`);
}
```

- [ ] **Step 3: Create api-client.ts**

```typescript
import { getToken } from './keychain.js';
import { loadConfig } from './config.js';

export interface ApiResponse {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export class AimeatClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string, token?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token ?? null;
  }

  static async fromConfig(): Promise<AimeatClient> {
    const config = loadConfig();
    if (!config) throw new Error('Not configured. Run: npx @aimeat/connect');
    const token = await getToken(config.agent, config.owner);
    if (!token) throw new Error('No stored token. Run: npx @aimeat/connect');
    return new AimeatClient(config.node_url, token);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  async get(path: string): Promise<ApiResponse> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, { headers: this.headers() });
    return res.json() as Promise<ApiResponse>;
  }

  async post(path: string, body?: unknown): Promise<ApiResponse> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json() as Promise<ApiResponse>;
  }

  async put(path: string, body?: unknown): Promise<ApiResponse> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json() as Promise<ApiResponse>;
  }

  async patch(path: string, body?: unknown): Promise<ApiResponse> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json() as Promise<ApiResponse>;
  }

  async delete(path: string): Promise<ApiResponse> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, { method: 'DELETE', headers: this.headers() });
    return res.json() as Promise<ApiResponse>;
  }

  getBaseUrl(): string { return this.baseUrl; }
  setToken(t: string): void { this.token = t; }
}
```

- [ ] **Step 4: Run typecheck**

Run: `cd packages/connect && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add packages/connect/src/lib/
git commit -m "feat: add core library modules (config, keychain, api-client)"
```

---

### Task 14: Build auth CLI

**Files:**
- Create: `packages/connect/src/cli/auth.ts`
- Create: `packages/connect/src/cli/index.ts`

- [ ] **Step 1: Create auth.ts**

```typescript
import * as p from '@clack/prompts';
import { AimeatClient } from '../lib/api-client.js';
import { storeToken, getToken } from '../lib/keychain.js';
import { saveConfig, getConfigDir } from '../lib/config.js';
import { downloadSkillBundle } from '../lib/skill-bundle.js';

interface AuthArgs {
  url?: string;
  owner?: string;
  agent?: string;
}

export async function runAuth(args: AuthArgs): Promise<void> {
  p.intro('AIMEAT Agent Connector');

  const nodeUrl = args.url ?? await p.text({ message: 'AIMEAT node URL:', placeholder: 'https://aimeat.io' }) as string;
  if (p.isCancel(nodeUrl)) { p.cancel('Cancelled.'); process.exit(0); }

  const owner = args.owner ?? await p.text({ message: 'Your owner handle:' }) as string;
  if (p.isCancel(owner)) { p.cancel('Cancelled.'); process.exit(0); }

  const agentName = args.agent ?? await p.text({ message: 'Agent name:', placeholder: 'claude' }) as string;
  if (p.isCancel(agentName)) { p.cancel('Cancelled.'); process.exit(0); }

  const client = new AimeatClient(nodeUrl);

  // Check if already connected
  const existingToken = await getToken(agentName, owner);
  if (existingToken) {
    client.setToken(existingToken);
    const check = await client.get('/v1/agents/me/inbox');
    if (check.ok) {
      p.log.success('Already connected! Token is valid.');
      p.outro('Done.');
      return;
    }
    p.log.warn('Stored token is expired or invalid. Starting fresh auth.');
  }

  // Start device auth
  const s = p.spinner();
  s.start('Requesting device authorization...');

  const authResp = await client.post('/v1/agents/device-authorize', {
    agent_name: agentName,
    owner,
  });

  if (!authResp.ok) {
    s.stop('Authorization request failed.');
    p.log.error((authResp.error as { message: string })?.message ?? 'Unknown error');
    process.exit(1);
  }

  const authData = authResp.data as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    interval: number;
  };

  s.stop(`Verification code: ${authData.user_code}`);
  p.log.info(`Open ${authData.verification_uri} to approve.`);
  p.log.info('Waiting for approval...');

  // Poll for approval
  s.start('Polling for approval (every 5s)...');
  const interval = (authData.interval ?? 5) * 1000;
  let approved = false;
  let tokenData: { access_token: string; gaii: string; name: string } | null = null;

  for (let i = 0; i < 360; i++) {
    await new Promise(r => setTimeout(r, interval));
    const pollResp = await client.post('/v1/agents/device-token', {
      device_code: authData.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (pollResp.ok) {
      tokenData = pollResp.data as typeof tokenData;
      approved = true;
      break;
    }
    const errCode = (pollResp as { error?: string }).error;
    if (errCode === 'access_denied') {
      s.stop('Authorization denied.');
      p.log.error('The owner denied the authorization request.');
      process.exit(1);
    }
    if (errCode !== 'authorization_pending' && errCode !== 'slow_down') {
      s.stop('Unexpected error.');
      p.log.error(JSON.stringify(pollResp));
      process.exit(1);
    }
  }

  if (!approved || !tokenData) {
    s.stop('Timed out waiting for approval.');
    process.exit(1);
  }

  s.stop('Approved!');

  // Store token
  await storeToken(agentName, owner, tokenData.access_token);
  p.log.success(`Token stored in system keychain (aimeat:${agentName}@${owner})`);

  // Save config
  saveConfig({ node_url: nodeUrl, agent: agentName, owner });

  // Download skill bundle
  client.setToken(tokenData.access_token);
  try {
    await downloadSkillBundle(client, agentName);
    p.log.success(`Skill bundle downloaded to ${getConfigDir()}/${agentName}/SKILL.md`);
  } catch {
    p.log.warn('Could not download skill bundle. Run: npx @aimeat/connect refresh');
  }

  p.outro('Done. Your agent is connected.');
}
```

- [ ] **Step 2: Create skill-bundle.ts**

```typescript
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from './config.js';
import type { AimeatClient } from './api-client.js';

export async function downloadSkillBundle(client: AimeatClient, agentName: string): Promise<void> {
  const bundleDir = join(getConfigDir(), agentName);
  if (!existsSync(bundleDir)) mkdirSync(bundleDir, { recursive: true });

  const url = `${client.getBaseUrl()}/v1/agents/${encodeURIComponent(agentName)}/skill-bundle`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${(client as unknown as { token: string }).token}` },
  });

  if (!res.ok) throw new Error(`Skill bundle download failed: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const zipPath = join(bundleDir, 'skill-bundle.zip');
  writeFileSync(zipPath, buffer);

  // Extract SKILL.md if present (basic ZIP extraction for the entry point)
  // For now, save the ZIP -- the agent runtime handles extraction
  writeFileSync(join(bundleDir, 'SKILL.md'), `# Skill Bundle\n\nDownloaded from ${client.getBaseUrl()}\nExtract skill-bundle.zip for full reference.\n`);
}
```

- [ ] **Step 3: Create index.ts (CLI entry point)**

```typescript
#!/usr/bin/env node
import { runAuth } from './auth.js';
import { runInbox } from './inbox.js';
import { runTasks } from './tasks.js';
import { runSend } from './send.js';
import { runStatus } from './status.js';
import { runDocs } from './docs.js';
import { runServe } from '../mcp/server.js';

const args = process.argv.slice(2);
const command = args[0];

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      flags[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return flags;
}

const flags = parseFlags(args);

async function main() {
  switch (command) {
    case 'serve':
      await runServe(flags);
      break;
    case 'inbox':
      await runInbox();
      break;
    case 'tasks':
      await runTasks();
      break;
    case 'send':
      await runSend(flags);
      break;
    case 'status':
    case 'whoami':
      await runStatus();
      break;
    case 'docs':
      await runDocs(args[1]);
      break;
    case 'refresh':
      // Re-download skill bundle
      const { AimeatClient: C } = await import('../lib/api-client.js');
      const { downloadSkillBundle: dl } = await import('../lib/skill-bundle.js');
      const { loadConfig: lc, getConfigDir: gcd } = await import('../lib/config.js');
      const cfg = lc();
      if (!cfg) { console.error('Not configured. Run: npx @aimeat/connect'); process.exit(1); }
      const cl = await C.fromConfig();
      await dl(cl, cfg.agent);
      console.log(`Skill bundle refreshed at ${gcd()}/${cfg.agent}/`);
      break;
    case 'logout': {
      const { deleteToken } = await import('../lib/keychain.js');
      const { loadConfig: lc2 } = await import('../lib/config.js');
      const cfg2 = lc2();
      if (cfg2) { await deleteToken(cfg2.agent, cfg2.owner); console.log('Credentials removed.'); }
      else console.log('Not configured.');
      break;
    }
    case 'config':
      const { loadConfig: lc3, getConfigDir: gcd3 } = await import('../lib/config.js');
      const c = lc3();
      if (c) { console.log(JSON.stringify(c, null, 2)); }
      else { console.log(`No config found. Expected at: ${gcd3()}/config.yaml`); }
      break;
    default:
      // No command = run auth
      await runAuth({ url: flags.url, owner: flags.owner, agent: flags.agent });
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 4: Create stub CLI subcommands**

Create `inbox.ts`, `tasks.ts`, `send.ts`, `status.ts`, `docs.ts` with basic implementations:

**inbox.ts:**
```typescript
import { AimeatClient } from '../lib/api-client.js';

export async function runInbox(): Promise<void> {
  const client = await AimeatClient.fromConfig();
  const resp = await client.get('/v1/agents/me/messages/inbox');
  if (!resp.ok) { console.error('Failed to fetch inbox:', resp.error); return; }
  const messages = (resp.data as { messages?: unknown[] })?.messages ?? [];
  if (messages.length === 0) { console.log('Inbox empty.'); return; }
  console.log(JSON.stringify(messages, null, 2));
}
```

**tasks.ts:**
```typescript
import { AimeatClient } from '../lib/api-client.js';
import { loadConfig } from '../lib/config.js';

export async function runTasks(): Promise<void> {
  const client = await AimeatClient.fromConfig();
  const config = loadConfig()!;
  const resp = await client.get(`/v1/agents/${encodeURIComponent(config.agent)}/tasks`);
  if (!resp.ok) { console.error('Failed to fetch tasks:', resp.error); return; }
  const tasks = (resp.data as { tasks?: unknown[] })?.tasks ?? [];
  if (tasks.length === 0) { console.log('No tasks.'); return; }
  console.log(JSON.stringify(tasks, null, 2));
}
```

**send.ts:**
```typescript
import { AimeatClient } from '../lib/api-client.js';
import { loadConfig } from '../lib/config.js';

export async function runSend(flags: Record<string, string>): Promise<void> {
  if (!flags.to || !flags.body) { console.error('Usage: npx @aimeat/connect send --to GAII --body "message"'); return; }
  const client = await AimeatClient.fromConfig();
  const config = loadConfig()!;
  const resp = await client.post(`/v1/agents/${encodeURIComponent(config.agent)}/messages`, {
    to: flags.to,
    body: flags.body,
  });
  if (!resp.ok) { console.error('Failed to send:', resp.error); return; }
  console.log('Message sent.');
}
```

**status.ts:**
```typescript
import { AimeatClient } from '../lib/api-client.js';
import { loadConfig } from '../lib/config.js';

export async function runStatus(): Promise<void> {
  const config = loadConfig();
  if (!config) { console.log('Not configured. Run: npx @aimeat/connect'); return; }
  console.log(`Agent: ${config.agent}`);
  console.log(`Owner: ${config.owner}`);
  console.log(`Node:  ${config.node_url}`);

  try {
    const client = await AimeatClient.fromConfig();
    const resp = await client.get('/v1/wallet');
    if (resp.ok) {
      const wallet = resp.data as { balance?: number };
      console.log(`Balance: ${wallet.balance ?? 'unknown'} morsels`);
    }
    const me = await client.get('/v1/agents/me/inbox');
    console.log(`Status: ${me.ok ? 'Connected' : 'Token invalid'}`);
  } catch { console.log('Status: Not connected'); }
}
```

**docs.ts:**
```typescript
import { AimeatClient } from '../lib/api-client.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir, loadConfig } from '../lib/config.js';

export async function runDocs(module?: string): Promise<void> {
  if (!module) {
    // Show bundled overview
    const config = loadConfig();
    const skillPath = config ? join(getConfigDir(), config.agent, 'SKILL.md') : null;
    if (skillPath && existsSync(skillPath)) {
      console.log(readFileSync(skillPath, 'utf-8'));
    } else {
      console.log('No local docs found. Run: npx @aimeat/connect refresh');
      console.log('Or specify a module: npx @aimeat/connect docs tasks');
    }
    return;
  }

  // Fetch module handbook from server
  try {
    const client = await AimeatClient.fromConfig();
    const resp = await client.get(`/v1/agents/me/handbook/${encodeURIComponent(module)}`);
    if (!resp.ok) { console.error(`Module "${module}" not found.`); return; }
    const data = resp.data as { system_prompt?: string };
    console.log(data.system_prompt ?? JSON.stringify(data, null, 2));
  } catch (e) { console.error((e as Error).message); }
}
```

- [ ] **Step 5: Run typecheck**

Run: `cd packages/connect && npx tsc --noEmit`
Expected: 0 errors (some stubs may need the server.ts import -- create a placeholder first)

- [ ] **Step 6: Commit**

```bash
git add packages/connect/src/cli/ packages/connect/src/lib/
git commit -m "feat: add CLI auth flow, subcommands, and core libraries"
```

---

### Task 15: Build MCP server with all tools

**Files:**
- Create: `packages/connect/src/mcp/server.ts`
- Create: `packages/connect/src/mcp/tools/index.ts`
- Create: `packages/connect/src/mcp/tools/*.ts` (19 tool modules)
- Create: `packages/connect/src/mcp/resources.ts`

- [ ] **Step 1: Create the tool registry pattern**

Each tool module exports a `register` function that takes the MCP server and API client. Create `tools/index.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatClient } from '../../lib/api-client.js';

import { registerCoreTools } from './core.js';
import { registerAgentTasksTools } from './agent-tasks.js';
import { registerAgentMessagesTools } from './agent-messages.js';
import { registerAgentCapsTools } from './agent-caps.js';
import { registerBoardsTools } from './boards.js';
import { registerCatalogueTools } from './catalogue.js';
import { registerCapabilitiesTools } from './capabilities.js';
import { registerExtensionsTools } from './extensions.js';
import { registerCortexTools } from './cortex.js';
import { registerAppsTools } from './apps.js';
import { registerKnowledgeTools } from './knowledge.js';
import { registerOrganismsTools } from './organisms.js';
import { registerConsentTools } from './consent.js';
import { registerGroupsTools } from './groups.js';
import { registerInstancesTools } from './instances.js';
import { registerMemoryExtTools } from './memory-ext.js';
import { registerWalletExtTools } from './wallet-ext.js';
import { registerFlagsTools } from './flags.js';
import { registerHandbookTools } from './handbook.js';

export function registerAllTools(mcp: McpServer, client: AimeatClient, agentName: string): void {
  registerCoreTools(mcp, client, agentName);
  registerAgentTasksTools(mcp, client, agentName);
  registerAgentMessagesTools(mcp, client, agentName);
  registerAgentCapsTools(mcp, client, agentName);
  registerBoardsTools(mcp, client);
  registerCatalogueTools(mcp, client);
  registerCapabilitiesTools(mcp, client);
  registerExtensionsTools(mcp, client);
  registerCortexTools(mcp, client);
  registerAppsTools(mcp, client);
  registerKnowledgeTools(mcp, client);
  registerOrganismsTools(mcp, client);
  registerConsentTools(mcp, client);
  registerGroupsTools(mcp, client);
  registerInstancesTools(mcp, client);
  registerMemoryExtTools(mcp, client);
  registerWalletExtTools(mcp, client);
  registerFlagsTools(mcp, client);
  registerHandbookTools(mcp, client);
}
```

- [ ] **Step 2: Create one representative tool module as the pattern**

Create `tools/agent-tasks.ts` as the reference pattern. All other tool modules follow this structure -- a thin proxy that calls the AIMEAT API via the client:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../lib/api-client.js';

export function registerAgentTasksTools(mcp: McpServer, client: AimeatClient, agentName: string): void {
  const enc = encodeURIComponent(agentName);

  mcp.tool('aimeat_task_list', 'List tasks assigned to this agent', {
    status: z.string().optional().describe('Filter by status: queued, active, done, failed'),
  }, async ({ status }) => {
    const q = status ? `?status=${status}` : '';
    const resp = await client.get(`/v1/agents/${enc}/tasks${q}`);
    return { content: [{ type: 'text', text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_get', 'Get full details of a specific task', {
    task_id: z.string().describe('Task ID'),
  }, async ({ task_id }) => {
    const resp = await client.get(`/v1/agents/${enc}/tasks/${task_id}`);
    return { content: [{ type: 'text', text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_start', 'Start a queued task', {
    task_id: z.string().describe('Task ID to start'),
  }, async ({ task_id }) => {
    const resp = await client.post(`/v1/agents/${enc}/tasks/${task_id}/start`);
    return { content: [{ type: 'text', text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_event', 'Append a progress event to an active task', {
    task_id: z.string().describe('Task ID'),
    type: z.string().describe('Event type: progress, note, blocker'),
    message: z.string().describe('Event message'),
  }, async ({ task_id, type, message }) => {
    const resp = await client.post(`/v1/agents/${enc}/tasks/${task_id}/event`, { type, message });
    return { content: [{ type: 'text', text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_todo', 'Update the status of a TODO item in a task', {
    task_id: z.string().describe('Task ID'),
    todo_id: z.string().describe('TODO item ID'),
    status: z.string().describe('New status: pending, in_progress, done'),
  }, async ({ task_id, todo_id, status }) => {
    const resp = await client.patch(`/v1/agents/${enc}/tasks/${task_id}/todos/${todo_id}`, { status });
    return { content: [{ type: 'text', text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_complete', 'Complete an active task', {
    task_id: z.string().describe('Task ID'),
    summary: z.string().optional().describe('Completion summary'),
  }, async ({ task_id, summary }) => {
    const resp = await client.post(`/v1/agents/${enc}/tasks/${task_id}/complete`, { summary });
    return { content: [{ type: 'text', text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_fail', 'Fail an active task', {
    task_id: z.string().describe('Task ID'),
    reason: z.string().describe('Failure reason'),
  }, async ({ task_id, reason }) => {
    const resp = await client.post(`/v1/agents/${enc}/tasks/${task_id}/fail`, { reason });
    return { content: [{ type: 'text', text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
```

- [ ] **Step 3: Create all remaining tool modules**

Each module follows the same pattern. Create these files, each exporting a `register*Tools` function with the tools listed in the spec:

- `tools/core.ts` -- 18 tools (memory CRUD, catalogue search, action execute, work queue, wallet, board, storage, admin)
- `tools/agent-messages.ts` -- 2 tools (inbox, send)
- `tools/agent-caps.ts` -- 2 tools (capabilities report, activity)
- `tools/boards.ts` -- 7 tools
- `tools/catalogue.ts` -- 3 tools
- `tools/capabilities.ts` -- 7 tools
- `tools/extensions.ts` -- 7 tools
- `tools/cortex.ts` -- 5 tools
- `tools/apps.ts` -- 5 tools
- `tools/knowledge.ts` -- 4 tools
- `tools/organisms.ts` -- 5 tools
- `tools/consent.ts` -- 3 tools
- `tools/groups.ts` -- 5 tools
- `tools/instances.ts` -- 3 tools
- `tools/memory-ext.ts` -- 2 tools
- `tools/wallet-ext.ts` -- 1 tool
- `tools/flags.ts` -- 1 tool
- `tools/handbook.ts` -- 1 tool

Reference the server-side MCP tool definitions in `aimeat/src/mcp/*.ts` for exact tool names, parameter schemas, and descriptions. Each tool is a thin HTTP proxy: validate input with zod, call `client.get/post/put/patch/delete`, return `{ content: [{ type: 'text', text: JSON.stringify(resp) }] }`.

- [ ] **Step 4: Create resources.ts**

```typescript
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatClient } from '../lib/api-client.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir, loadConfig } from '../lib/config.js';

export function registerResources(mcp: McpServer, client: AimeatClient): void {
  // Handbook resource
  mcp.registerResource(
    'handbook',
    new ResourceTemplate('aimeat://handbook', { list: undefined }),
    { mimeType: 'application/json', description: 'Agent operating handbook' },
    async (uri) => {
      const resp = await client.get('/v1/agents/me/handbook');
      return { contents: [{ uri: uri.toString(), text: JSON.stringify(resp.data, null, 2), mimeType: 'application/json' }] };
    },
  );

  // Handbook modules
  const MODULES = ['tasks', 'messages', 'work', 'services', 'memory', 'activity', 'social', 'collaboration', 'appdev', 'mcp'];
  mcp.registerResource(
    'handbook-module',
    new ResourceTemplate('aimeat://handbook/{module}', {
      list: async () => ({
        resources: MODULES.map(m => ({
          uri: `aimeat://handbook/${m}`,
          name: `Handbook: ${m}`,
          mimeType: 'application/json',
        })),
      }),
    }),
    { mimeType: 'application/json', description: 'Handbook module' },
    async (uri, vars) => {
      const mod = vars.module as string;
      const resp = await client.get(`/v1/agents/me/handbook/${mod}`);
      return { contents: [{ uri: uri.toString(), text: JSON.stringify(resp.data, null, 2), mimeType: 'application/json' }] };
    },
  );

  // Cached skill bundle
  mcp.registerResource(
    'skill-bundle',
    new ResourceTemplate('aimeat://skill-bundle', { list: undefined }),
    { mimeType: 'text/markdown', description: 'Cached SKILL.md from last download' },
    async (uri) => {
      const config = loadConfig();
      if (!config) return { contents: [{ uri: uri.toString(), text: 'Not configured.' }] };
      const path = join(getConfigDir(), config.agent, 'SKILL.md');
      const text = existsSync(path) ? readFileSync(path, 'utf-8') : 'No skill bundle cached. Run: npx @aimeat/connect refresh';
      return { contents: [{ uri: uri.toString(), text, mimeType: 'text/markdown' }] };
    },
  );
}
```

- [ ] **Step 5: Create server.ts**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AimeatClient } from '../lib/api-client.js';
import { loadConfig } from '../lib/config.js';
import { registerAllTools } from './tools/index.js';
import { registerResources } from './resources.js';
import { startPoller } from './poller.js';

export async function runServe(flags: Record<string, string>): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error('Not configured. Run: npx @aimeat/connect');
    process.exit(1);
  }

  const client = await AimeatClient.fromConfig();

  const mcp = new McpServer({
    name: 'aimeat-connect',
    version: '0.1.0',
  });

  registerAllTools(mcp, client, config.agent);
  registerResources(mcp, client);

  // Start background poller
  startPoller(client, config);

  // Start transport
  const transport = flags.transport === 'http'
    ? (() => { console.error('HTTP transport not yet implemented. Using stdio.'); return new StdioServerTransport(); })()
    : new StdioServerTransport();

  await mcp.connect(transport);
  console.error(`AIMEAT MCP server running (agent: ${config.agent}, node: ${config.node_url})`);
}
```

- [ ] **Step 6: Run typecheck**

Run: `cd packages/connect && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add packages/connect/src/mcp/
git commit -m "feat: add MCP server with 88 tools and resource providers"
```

---

### Task 16: Build background poller and wake-up

**Files:**
- Create: `packages/connect/src/mcp/poller.ts`
- Create: `packages/connect/src/mcp/wakeup.ts`

- [ ] **Step 1: Create wakeup.ts**

```typescript
import { exec } from 'node:child_process';
import type { AimeatConnectConfig } from '../lib/config.js';

export async function wakeAgent(config: AimeatConnectConfig, event: string, detail: string): Promise<void> {
  const wake = config.wake;
  if (!wake) return;

  const strategy = wake.strategy ?? 'command_first';
  const command = wake.command?.replace('{{agent}}', config.agent);
  const webhook = wake.webhook;

  if (strategy === 'command_only' || strategy === 'command_first') {
    if (command) {
      try {
        await execCommand(command);
        console.error(`[wake] Command succeeded: ${command}`);
        return;
      } catch (err) {
        console.error(`[wake] Command failed: ${(err as Error).message}`);
        if (strategy === 'command_only') return;
      }
    }
  }

  if (strategy === 'webhook_only' || strategy === 'webhook_first' || strategy === 'command_first') {
    if (webhook) {
      try {
        await fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event, agent: config.agent, detail }),
        });
        console.error(`[wake] Webhook POST succeeded: ${webhook}`);
        return;
      } catch (err) {
        console.error(`[wake] Webhook failed: ${(err as Error).message}`);
      }
    }
  }

  if (strategy === 'webhook_first' && command) {
    try {
      await execCommand(command);
      console.error(`[wake] Command fallback succeeded: ${command}`);
    } catch (err) {
      console.error(`[wake] Command fallback failed: ${(err as Error).message}`);
    }
  }
}

function execCommand(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 10_000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
```

- [ ] **Step 2: Create poller.ts**

```typescript
import type { AimeatClient } from '../lib/api-client.js';
import type { AimeatConnectConfig } from '../lib/config.js';
import { wakeAgent } from './wakeup.js';

let lastTaskCount = -1;
let lastMessageCount = -1;

export function startPoller(client: AimeatClient, config: AimeatConnectConfig): void {
  const interval = (config.poll_interval ?? 30) * 1000;
  const enc = encodeURIComponent(config.agent);

  async function poll() {
    try {
      // Check for new tasks
      const tasksResp = await client.get(`/v1/agents/${enc}/tasks?status=queued`);
      if (tasksResp.ok) {
        const tasks = (tasksResp.data as { tasks?: unknown[] })?.tasks ?? [];
        if (lastTaskCount >= 0 && tasks.length > lastTaskCount) {
          await wakeAgent(config, 'task_new', `${tasks.length - lastTaskCount} new task(s) queued`);
        }
        lastTaskCount = tasks.length;
      }

      // Check for new messages
      const msgResp = await client.get('/v1/agents/me/messages/inbox');
      if (msgResp.ok) {
        const messages = (msgResp.data as { messages?: unknown[] })?.messages ?? [];
        if (lastMessageCount >= 0 && messages.length > lastMessageCount) {
          await wakeAgent(config, 'message_new', `${messages.length - lastMessageCount} new message(s)`);
        }
        lastMessageCount = messages.length;
      }
    } catch (err) {
      console.error(`[poller] Error: ${(err as Error).message}`);
    }
  }

  // Initial poll to set baselines
  poll();
  setInterval(poll, interval);
  console.error(`[poller] Polling every ${config.poll_interval ?? 30}s for tasks and messages`);
}
```

- [ ] **Step 3: Run typecheck and build**

Run: `cd packages/connect && npx tsc --noEmit && npx tsc`
Expected: 0 errors, `dist/` directory created

- [ ] **Step 4: Commit**

```bash
git add packages/connect/src/mcp/poller.ts packages/connect/src/mcp/wakeup.ts
git commit -m "feat: add background poller and agent wake-up (command + webhook)"
```

---

### Task 17: Add bundled reference docs

**Files:**
- Create: `packages/connect/src/reference/getting-started.md`
- Create: `packages/connect/src/reference/api-overview.md`

- [ ] **Step 1: Create getting-started.md**

```markdown
# Getting Started with AIMEAT Connect

## Quick Start

1. Authenticate: `npx @aimeat/connect --url https://your-node.io --owner your-handle`
2. Start MCP server: `npx @aimeat/connect serve`
3. Check status: `npx @aimeat/connect status`

## CLI Commands

| Command | Description |
|---------|-------------|
| `npx @aimeat/connect` | Interactive authentication |
| `npx @aimeat/connect serve` | Start MCP server |
| `npx @aimeat/connect inbox` | Check message inbox |
| `npx @aimeat/connect tasks` | List assigned tasks |
| `npx @aimeat/connect send --to GAII --body "text"` | Send a message |
| `npx @aimeat/connect status` | Show agent status |
| `npx @aimeat/connect docs [module]` | View documentation |
| `npx @aimeat/connect refresh` | Re-download skill bundle |
| `npx @aimeat/connect logout` | Remove stored credentials |

## Configuration

Config file: `~/.aimeat/config.yaml`

```yaml
node_url: https://your-node.io
agent: your-agent-name
owner: your-handle
poll_interval: 30
wake:
  command: "openclaw resume {{agent}}"
  webhook: "http://localhost:3001/wake"
  strategy: command_first
```
```

- [ ] **Step 2: Create api-overview.md**

```markdown
# AIMEAT API Overview

Base URL: Your configured node URL (see `npx @aimeat/connect status`)

## Core Operations

| Operation | Endpoint |
|-----------|----------|
| Read memory | GET /v1/memory/{key} |
| Write memory | POST /v1/memory |
| List memory | GET /v1/memory |
| Search memory | GET /v1/memory/search?q={query} |
| Check inbox | GET /v1/agents/me/messages/inbox |
| Send message | POST /v1/agents/{name}/messages |
| List tasks | GET /v1/agents/{name}/tasks |
| Start task | POST /v1/agents/{name}/tasks/{id}/start |
| Complete task | POST /v1/agents/{name}/tasks/{id}/complete |
| Check balance | GET /v1/wallet |
| Browse catalogue | GET /v1/catalogue |

## Handbook Modules

Fetch detailed docs: GET /v1/agents/me/handbook/{module}

Modules: tasks, messages, work, services, memory, activity, social, collaboration, appdev, mcp
```

- [ ] **Step 3: Commit**

```bash
git add packages/connect/src/reference/
git commit -m "docs: add bundled reference docs for @aimeat/connect"
```

---

### Task 18: Build and verify package

- [ ] **Step 1: Build the package**

Run: `cd packages/connect && pnpm build`
Expected: Clean build, `dist/` directory created with compiled JS

- [ ] **Step 2: Test the CLI entry point**

Run: `cd packages/connect && node dist/cli/index.js --help 2>&1 || node dist/cli/index.js config`
Expected: Shows config status (not configured) or prints help

- [ ] **Step 3: Commit**

```bash
git add packages/connect/
git commit -m "feat: @aimeat/connect v0.1.0 -- CLI + MCP server package complete"
```

---

## Phase 3: Integration Test Against aimeat.io

### Task 19: End-to-end test against live node

- [ ] **Step 1: Verify the handbook endpoint works**

Run (from project root, after starting dev server with `pnpm dev`):

```bash
curl -s http://localhost:40050/v1/agents/me/handbook | jq .ok
```
Expected: `true`

- [ ] **Step 2: Verify the 301 redirect works**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:40050/v1/prompts/tier1
```
Expected: `301`

```bash
curl -sL http://localhost:40050/v1/prompts/tier1 | jq .ok
```
Expected: `true` (follows redirect)

- [ ] **Step 3: Verify the handbook module redirect**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:40050/v1/prompts/tier1/tasks
```
Expected: `301`

- [ ] **Step 4: Test against aimeat.io**

```bash
curl -s https://aimeat.io/v1/agents/me/handbook | jq .ok
```
Expected: `true` (after deploying Phase 1 changes)

- [ ] **Step 5: Test the MCP tool rename**

Connect via MCP and verify `aimeat_handbook_get` tool is available and `aimeat_prompts_get` is gone.

- [ ] **Step 6: Test the UI**

Open `http://localhost:40050/v1/profile#agents` (logged in as test user), click "+ Connect", verify:
- CLI command is shown with correct URL and owner
- Copy button works
- "Or paste to your AI chat" collapsible shows the safe prompt
- Platform tabs show Node.js-focused instructions
- No reference to "system prompt", "IMMEDIATELY", "personalized directives", or `~/.aimeat_token.txt`

- [ ] **Step 7: Run full E2E test suite**

Run: `pnpm test:e2e:mongodb && pnpm test:e2e:sqlite`
Expected: All tests pass

- [ ] **Step 8: Run Playwright browser tests**

Run: `pnpm test:playwright:mongodb`
Expected: All tests pass

- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "test: verify safe agent connection against live node and all test suites"
```
