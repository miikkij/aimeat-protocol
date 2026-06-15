# Ecosystem App Automation — operator how-to

This is a short, plain guide for setting up **automation** for an ecosystem app on your AIMEAT
node — the screen at **Profile → Ecosystem apps → (expand an app) → Automation**.

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
