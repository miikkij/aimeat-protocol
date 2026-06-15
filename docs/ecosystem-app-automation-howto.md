# Ecosystem App Automation — operator how-to

This is a short, plain guide for setting up an ecosystem app on your AIMEAT node — the
**Setup playbook** ("Käyttöönotto") and the **Automation** section at
**Profile → Ecosystem apps → (expand an app)**.

## The four roles

There are exactly four roles, and they map cleanly onto what you see on the card:

| Role | Who | Job |
|------|-----|-----|
| **App** | the external ecosystem app (`eco:{app}#…`) | produces refined data (e.g. feedback stats) |
| **AIMEAT** | your node — MCP-reachable, under your control | the broker / hub; everything routes through it |
| **Agent** | YOUR agent (e.g. Claude with your own key) | analyses the app's data into recommendations |
| **Organism** | a group/space you own | where results live so they're reusable everywhere |

## The model: AIMEAT is the broker

The app and your agents **never talk to each other directly**. AIMEAT sits in the middle and
brokers the whole exchange. Nothing crosses unless you have configured it and (optionally)
approved it.

The chain runs top to bottom:

1. **The app publishes data** into AIMEAT — on a schedule you set (e.g. a feedback app deposits
   its latest stats every Monday).
2. **An AIMEAT recipe sees that data** (it matches a trigger key pattern) and **hands it to your
   agent(s)**.
3. **The agent does the work** — reads the data, produces guidance/advisories — and **writes the
   result back to AIMEAT**.
4. **AIMEAT delivers** the guidance to the app (either automatically, or after you approve it),
   where it shows up in the app's Guidance.

So: `app → AIMEAT → agent → AIMEAT → app`. You configure the two AIMEAT hops; the app and the
agent only ever touch AIMEAT.

## Why route through AIMEAT?

It would be simpler for an app to bundle its own AI agent and answer your questions inside the
app. The reason **not** to is everything that costs you the moment you do:

- **It's your data, in one place.** The app deposits its refined data into *your* AIMEAT, not into
  a vendor silo. You can read it, export it, and point other apps and agents at it.
- **The agent is YOURS.** AIMEAT runs *your* agent (e.g. Claude with your own key) over the app's
  data. The app only **recommends a prompt template** — it never owns the agent, the key, or the
  output. The same agent works across all your apps.
- **Reachable from any AI chat (MCP).** Because the data and the results live in AIMEAT, you can
  query them from Claude, Grok, or ChatGPT by connecting aimeat.io as an MCP server — no per-app
  integration, no export dance.
- **Results outlast the app.** When the agent saves its analysis to an **organism**, those insights
  are reusable for marketing copy, reports, and other apps, and shareable with your team. They don't
  evaporate when you stop using the feedback tool.

The bundled-agent alternative gives you a silo and lock-in: the insights are trapped in one tool,
the agent is the vendor's, and you can't reach any of it from your own AI chat.

## Use your insights from any AI chat (MCP)

Once data flows through AIMEAT, the payoff is that you can **ask your insights in plain language
from your AI chat** — Claude, Grok, or ChatGPT — instead of logging into the app.

1. **Connect aimeat.io as an MCP server.** In your AI chat's settings, add aimeat.io as an MCP
   connector and authenticate. (The exact steps depend on your AI chat; follow its "add MCP
   connector / custom connector" flow.)
2. **Read what the app produced.** For an app that deposits under `feedback.stats`, try:
   > *Read my AIMEAT memory key `feedback.stats.<org>.latest` and summarise the top issues and
   > trends.*
3. **Save your research to an organism** so it's reusable later:
   > *Save your analysis to my `<organism>` organism so I can track whether these issues improve.*
4. **Follow up later** and close the loop:
   > *Compare last month's `feedback.stats.<org>.latest` with this month's and tell me whether the
   > issues we flagged actually improved.*

The loop: **get info → explore → save to an organism → check later whether it happened as
expected.** The card's MCP block builds the exact sample key for your app and gives you a copyable
prompt.

## Set it up (once)

1. **Connect the app.** Run the connector in ecosystem mode on the machine hosting the app
   (`aimeat connect serve --ecosystem`), then approve the pending "hello integration" request in
   the Ecosystem apps tab.
2. **Connect an agent.** In Profile → Agents, connect the agent that will process the data (the
   "wisdom" agent). The automation needs at least one connected agent to process anything.
3. **Open Ecosystem apps**, expand the app's card, and find the **Automation** section.
4. **Fill in the one config card** — it reads top to bottom:
   - **① What this app produces** — read-only; shows the schedulable capability, what it produces,
     and the key it deposits under.
   - **② Run on a schedule** — pick a cadence (daily / weekly / monthly) and turn on "Run
     automatically on this schedule".
   - **③ Process with agent(s)** — tick the agent(s) that should handle the published data.
   - **④ Store results in organism** — optionally route the results into one of your organisms.
   - **⑤ Deliver guidance** — choose **Approve first** (you review before the app sees it) or
     **Push to the app** (delivered automatically). Optionally email yourself the report.
   - **Advanced — trigger key** — leave this alone unless the recipe isn't firing; it is the
     memory-key pattern that triggers processing (prefilled from the app's deposit key).
5. **Hit "Save automation".** That single button does both writes: it creates/updates the publish
   **schedule** (step ②) and saves the processing/delivery **recipe** (steps ③–⑤). You see one
   save; AIMEAT keeps two objects in sync behind it.

## The Setup playbook on the card

At the **top** of the expanded card there's a guided **Setup** ("Käyttöönotto") checklist that
tracks your progress and tells you *why* each step matters. It mirrors the steps above:

1. **App connected** — ✅ as soon as the app is connected (the card only exists for connected apps).
   *AIMEAT now holds this app's link under your account.*
2. **Connect your processing agent** — ✅ once your recipe has at least one agent. *Your agent —
   e.g. Claude with your own key — analyses the data; it's YOUR agent, the app just recommends a
   prompt template.* CTA: jumps to the Agents tab.
3. **Set up automation** — ✅ once a publish schedule is enabled and the recipe is enabled with
   agents. *When the app publishes data, AIMEAT runs your agent automatically.* CTA: scrolls to the
   Automation section.
4. **Choose an organism (recommended)** — ✅ once the recipe has an organism. *Results land in an
   organism, so they're MCP-reachable, reusable, and shareable — not locked in the app.*

Below the checklist, the **"Ask your insights in Claude, Grok, or ChatGPT"** block gives you a
copyable sample prompt built from this app's real deposit key (see the MCP section above).

## Watch the chain

The **Status — latest run** timeline below the config shows the whole chain in one place:

- **Published** — the publish schedule's last run + result and the next run, with an honest
  **Run now** button and a run-history log. "Run now" tells you the truth: it reports a *skip* if
  the app is offline rather than a fake success.
- **Processed** — the agents you selected. They run automatically whenever the app publishes
  matching data. (AIMEAT shows which agents are wired in; the per-run task detail lives in the
  agent's Tasks view.)
- **Delivered** — guidance awaiting your approval, with inline **Approve** / **Reject**. Approved
  guidance is delivered to the app and appears in its Guidance.

## The one gotcha

**The wisdom agent must be connected, and capability invocation needs the app online.** If the
agent isn't connected there's nothing to process; if the app's connector tunnel isn't running
(`aimeat connect serve`), the schedule's "Run now" and the delivery step will **skip** (you'll see
an honest "app isn't reachable" message) rather than fail silently. Start the connector for the
app and try again.
