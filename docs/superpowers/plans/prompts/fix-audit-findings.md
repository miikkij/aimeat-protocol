# Fix Prompt: Agent Detail Tab-View Audit Findings

> Copy everything below the line into a new Claude Code session opened in the `aimeat-protocol` project root.

---

## Task

A UI Design Compliance Audit found **32 issues** across the Agent Detail Tab-View implementation (Plan 4 + Plan 5). The structural design decisions are correct -- all 9 key architecture decisions are properly implemented. The issues are detail-level: missing buttons, wrong locale keys, missing content within tabs, and leftover code that should have been removed.

**This is a FIX session.** Every item below has been verified by reading the actual code. File paths and line numbers are provided. Do not re-audit -- just fix.

**Rules from CLAUDE.md apply:**
- All text must use `t()` with keys in BOTH `locales/en.json` and `locales/fi.json`
- CSS classes use `pf-agd-` prefix (profile) or `adm-agi-` prefix (admin)
- No inline `style=""` for colors/spacing (dynamic widths for progress bars are OK)
- Use CSS variables from `theme.css`, never hardcode hex colors
- Update `@version-history` in file headers when modifying files

---

## CRITICAL FIXES (visibly broken in UI)

### Fix 1: Tasks and Services empty states use wrong locale keys

The correct locale keys exist but the subtabs use older, shorter keys.

**File:** `aimeat/public/views/profile/agents-tasks-subtab.js`
- **Line ~272:** Change `t('profile.agents.tasks.empty')` to `t('profile.agents.detail.empty.tasks')`
- The correct key at `en.json:651` has: "No tasks yet. Create a task to give this agent work."
- The old key at `en.json:375` only has: "No tasks yet"

**File:** `aimeat/public/views/profile/agents-services-subtab.js`
- **Line ~100-101:** Change `t('profile.agents.services.empty')` to `t('profile.agents.detail.empty.services')`
- The correct key at `en.json:656` has: "No services declared. The agent can declare services during Hello Integration Step 11."
- The old key at `en.json:490` only has: "No services published"

**File:** `aimeat/public/views/profile/agents-services-subtab.js`
- **Line ~97:** Change `t('profile.agents.services.info')` to use a new key `t('profile.agents.detail.services.info')` or update the existing key value.
- Current text: "Other agents can call these services via the work exchange"
- Design spec text: "Services are declared by the agent during Hello Integration Step 11 (optional). They define what the agent offers to other agents and the network."
- Add the new key to BOTH `en.json` and `fi.json` if creating a new one.

### Fix 2: Directives tab still contains memory areas and resources

The design spec moved memory areas to Data Access and config files to Agent Config. The Directives tab should show ONLY behavioral directives (purpose + rules).

**File:** `aimeat/public/views/profile/agents-directives-subtab.js`
- **Lines ~215-226:** Remove the Memory Areas section entirely (the `memoryAreas.length > 0` conditional block with `<h4>` header and area list).
- **Lines ~228-237:** Remove the Resources section entirely (the `resources.length > 0` conditional block with `<h4>` header and resource list).
- These are in the VIEW MODE section of the component. The data still loads (for Data Access tab), but should not render here.
- **Add footer note** after the rules section: "Directives are included in every skill bundle update. The agent receives these as behavioral constraints." Add i18n keys `profile.agents.detail.directives.footer` to both locale files.

### Fix 3: Agent Config tab is a read-only skeleton

The tab only has a file list + read-only preview. The design spec requires action buttons and upload capability.

**File:** `aimeat/public/views/profile/agents/tab-agent-config.js`
- **Lines ~81-88 (preview section):** Add three action buttons after the "Viewing: filename" header:
  - **[Copy]** button: copies `previewContent` to clipboard (use same pattern as skill bundle copy in `tab-integration.js`)
  - **[Download]** button: creates a Blob download link for the file content
  - **[Edit]** button: toggles a `<textarea>` replacing the read-only preview div. Save button calls `PUT /v1/memory/agents.{name}.config.{filename}` via `apiPut()`.
- **Lines ~70-79 (file list):** Add per-file metadata:
  - Show `updatedAt` as already done -- KEEP
  - Add platform tag badge if detectable from filename (e.g., `CLAUDE.md` -> "Claude Code", `hermes.yaml` -> "Hermes")
- **After file list:** Add `[+ Upload config file]` button:
  - Opens a file input accepting `.md`, `.yaml`, `.json`, `.txt`
  - On select, reads file content and calls `PUT /v1/memory/agents.{name}.config.{filename}`
  - Reloads file list after upload
- Add i18n keys for all new button labels to both locale files:
  - `profile.agents.detail.agentConfig.copy`
  - `profile.agents.detail.agentConfig.download`
  - `profile.agents.detail.agentConfig.edit`
  - `profile.agents.detail.agentConfig.save`
  - `profile.agents.detail.agentConfig.cancel`
  - `profile.agents.detail.agentConfig.upload`

---

## HIGH FIXES (functional gaps)

### Fix 4: Problem state Zone 2 has only 1 generic button (spec requires 3 contextual)

**File:** `aimeat/public/views/profile/agents/agent-card.js`
- **Lines ~238-241:** Currently renders a single "diagnose" button that navigates to Integration tab.
- Replace with 3 contextual buttons:
  1. **"Test webhook"** -- calls `POST /v1/agents/{name}/webhook/test` (already exists in the API). Use `testWebhook(agentName)` from `agent-integration.js`.
  2. **"Update URL"** -- opens a small inline form to update webhook URL. Calls `PUT /v1/agents/{name}/webhook`.
  3. **"Override readiness"** -- navigates to Integration tab (same as current button, but with clearer label).
- Add i18n keys to both locale files:
  - `profile.agents.detail.zone2.testWebhook`
  - `profile.agents.detail.zone2.updateUrl`
  - `profile.agents.detail.zone2.overrideReadiness`

### Fix 5: Data Access tab hides sections when empty + missing action buttons

**File:** `aimeat/public/views/profile/agents/tab-data-access.js`
- **Line ~138:** Remove the `${hasAreas &&` conditional. Memory Areas section should ALWAYS render.
- **Line ~141:** Add `[+ Add area]` button in the section header (same pattern as `[+ Add tag]` in tags section). On click, show an inline form with key prefix input + description input + permission select (read-only / read+write). Save adds to agent's memory area list.
- **Line ~156:** Remove the `${hasResources &&` conditional. Knowledge Packages section should ALWAYS render.
- **Line ~159:** Add `[+ Link package]` button in the section header. On click, show a dropdown of available knowledge packages (from `GET /v1/knowledge/packages`). Selected package gets linked to the agent.
- **Lines ~161-165:** Add document count per package: show `pkg.documentCount || pkg.documents?.length || 0` alongside name and description.
- **Add help text** below the tags section header explaining how tags work. Add i18n key `profile.agents.detail.dataAccess.tagsHelp` with value: "Tags create shared memory areas. All agents with the same tag can read and write to agents.tag.{name}.* -- they discover each other automatically."
- **Add skill bundle mention** to the scope summary section. Add i18n key `profile.agents.detail.dataAccess.scopeNote` with value: "This scope summary is included in the agent's skill bundle so it knows its data boundaries."
- Add all new keys to BOTH en.json and fi.json.

### Fix 6: Integration tab production view missing several elements

**File:** `aimeat/public/views/profile/agents/tab-integration.js`

**Connection section (lines ~187-216):**
- Add `[Edit webhook]` button next to the existing "Test webhook" button. On click, show inline form to update webhook URL. Use `updateAgentWebhook(agentName, { url })` from `agent-integration.js`.
- Add delivery method status indicator at the top of the section: a colored dot (green if webhook healthy, yellow if polling-only, red if webhook failing) + method label ("Webhook + MCP", "Polling only", etc.).

**Platform & Skill section (lines ~219-236):**
- Add platform version display: `onboarding?.platformVersion || '--'`
- Add detection method: `onboarding?.detectionMethod || 'auto-detected'`
- Add `[Update]` button alongside existing `[Re-install]`. Update button checks for newer bundle version and regenerates.

**Readiness section (lines ~239-258):**
- Add "Last validated" timestamp: `onboarding?.lastValidatedAt ? timeAgo(onboarding.lastValidatedAt) : '--'`
- Add strengths/gaps text summary if available from onboarding data.

**Identity section (lines ~262-278):**
- **Line ~277:** After created date row, add a roles badge row showing agent roles (e.g., `agent.roles?.join(', ') || 'agent'`).

**Add i18n keys for all new labels to both locale files.**

### Fix 7: Shared Board click should scroll to expanded card

**File:** `aimeat/public/views/profile/agents/shared-board.js`
- **Line ~46:** The `onClick` calls `onAgentClick?.(agent.name)` but there's no scroll behavior.

**File:** `aimeat/public/views/profile/agents-tab.js`
- In the `onAgentClick` handler (wherever `expandedAgent` is set), after setting the expanded agent, add a `requestAnimationFrame` + `scrollIntoView`:
```javascript
// After setting expandedAgent:
requestAnimationFrame(() => {
  const el = document.querySelector(`[data-agent-name="${name}"]`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
```
- Add `data-agent-name={agent.name}` attribute to each `<AgentCard>` wrapper div.

### Fix 8: Production collapsed card missing task stats

**File:** `aimeat/public/views/profile/agents/agent-card.js`
- **Lines ~184-187:** The `production` / `default` case in `renderCollapsedStats()` only shows `timeAgo(last_seen)`.
- Add today's task stats: `Today: ${agent.tasksCompletedToday || 0} done, ${agent.tasksActiveToday || 0} active`
- These values need to come from the agent data passed as props. If not available yet, show just "Last seen: Xm ago" (current behavior) and add a TODO comment noting the data dependency.

---

## MEDIUM FIXES (UX gaps)

### Fix 9: Activity tab uses relative timestamps instead of HH:MM

**File:** `aimeat/public/views/profile/agents/tab-activity.js`
- **Line ~197:** Change `timeAgo(ev.timestamp)` to a HH:MM formatter:
```javascript
new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
```

### Fix 10: Activity governance section missing details

**File:** `aimeat/public/views/profile/agents/tab-activity.js`
- **Lines ~143-148 (token budget):** Add percentage: `${tokensUsed} / ${tokenLimit} (${Math.round(tokensUsed/tokenLimit*100)}%)`
- **Lines ~149-152 (tasks today):** Break down into completed/active/failed counts instead of single number. If `governance.tasksToday` is a number, show the breakdown from separate fields or keep the number with a label.
- **Lines ~28-34 (eventCategory):** Add `'readiness'` and `'override'` to the governance keyword checks so those events classify correctly.

### Fix 11: Activity tab missing audit trail footer

**File:** `aimeat/public/views/profile/agents/tab-activity.js`
- After the event list, add a footer note: "Activity log is an append-only audit trail. Governance events feed into the agent's trust score."
- Add i18n key `profile.agents.detail.activity.auditTrail` to both locale files.

### Fix 12: Services tab missing status dots and Active/Inactive labels

**File:** `aimeat/public/views/profile/agents-services-subtab.js`
- In the `ServiceCard` component (~lines 19-46), add:
  - A status dot before the service name: green circle for active, gray for inactive. Use CSS class `pf-agd-status-dot--active` / `pf-agd-status-dot--inactive`.
  - An "Active" or "Inactive" label badge next to the visibility badge.
- Add CSS for status dots to `agents-detail.css`.

### Fix 13: Messages tab command palette minor issues

**File:** `aimeat/public/views/profile/agents/tab-messages.js`
- **Line ~22-34 (fallback):** Add explanatory text to the "No commands registered" message: "The agent can register commands by writing to its commands memory key."
- **Lines ~206-215 (chat area):** Add visual distinction for slash command messages (messages starting with "/"): slightly different background or a "command" badge on the message bubble.

### Fix 14: Board mini-card agent name not colored by state

**File:** `aimeat/public/views/profile/agents/shared-board.js`
- **Line ~48:** The `.pf-agd-board-card-name` span should have its text color set by state. Add `style="color: ${getStateColor(state)}"` to the name span, or better, add a CSS class `pf-agd-board-card-name--${state}` and define colors in CSS.

### Fix 15: Section header missing agent count badge

**File:** `aimeat/public/views/profile/agents-tab.js`
- **Line ~314:** After the `t('profile.agents.title')` text, add an agent count badge: `(${agents.length})` wrapped in a small badge span.

---

## LOW FIXES (minor deviations)

### Fix 16: Onboarding uses blue instead of yellow (deliberate?)

**File:** `aimeat/public/views/profile/agents/state-detector.js`
- **Line ~38:** Onboarding maps to `var(--info)` (blue). Design spec says yellow.
- This may be intentional (blue better distinguishes from "new" which is yellow). **Ask the developer** before changing. If changing, update to `var(--warning)`.

### Fix 17: State detection uses stale telemetry instead of readiness drop

**File:** `aimeat/public/views/profile/agents/state-detector.js`
- **Line ~19:** `noTelemetry = !agent.last_seen || isStale(agent.last_seen, 24*60)` checks for 24h stale.
- Design spec says problem should trigger on "readiness level dropped from previous." The current implementation is a reasonable substitute. **Ask the developer** if this should change.

### Fix 18: Governance namespace mismatch

**File:** `aimeat/public/views/profile/agents/tab-activity.js`
- Uses top-level `governance.*` keys (e.g., `governance.title`, `governance.tokenBudget`) instead of `profile.agents.detail.activity.governance.*`.
- These keys work (they exist in both locale files at lines ~5341-5358), but they don't follow the `profile.agents.detail.*` namespace convention.
- **Low priority** -- keys resolve correctly, just inconsistent naming.

### Fix 19: Admin tab minor gaps

**File:** `aimeat/public/views/admin/agent-integration-tab.js`
- Missing `[Add platform]` button in Platform Registry section.
- "Not started" count replaced by "Stuck" in Onboarding Overview.
- No stuck agent suggestions or action buttons.
- Missing "Current version" column in Skill Bundle table.
- These are future features -- implement if time allows.

---

## VERIFICATION AFTER FIXES

After completing all Critical and High fixes:

1. **Run lint:** `pnpm lint`
2. **Run typecheck:** `npx tsc --noEmit`
3. **Run Playwright tests:** `pnpm test:playwright:mongodb -- profile-agents`
4. **Visual check:** Start dev server (`pnpm dev`), log in as `buildertest`/`Test1234`, navigate to Profile > Agents tab. Verify:
   - All text renders as translated words (no raw key paths like `profile.agents.detail.xxx`)
   - Directives tab shows only purpose + rules (no memory areas or resources sections)
   - Agent Config tab has Copy/Download/Edit buttons on file preview
   - Data Access tab shows all 3 sections even when empty, with Add/Link buttons
   - Problem state expanded card has 3 action buttons
   - Clicking agent name in Shared Board scrolls to and expands the card
   - Activity tab timestamps show HH:MM format
   - Services tab shows status dots

5. **Run E2E tests:** `pnpm test:e2e:mongodb` and `pnpm test:e2e:sqlite`
