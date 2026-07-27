# YouTube metadata for the three README demo videos

Visibility: **Unlisted** (or Public). Private videos do not render a thumbnail and the README link
will 404 for everyone else. All three are vertical and under 3 minutes, so YouTube will file them
as Shorts. That is fine: `youtu.be/<id>` links and `img.youtube.com/vi/<id>/maxresdefault.jpg`
thumbnails still work.

Each description below is complete and ready to paste, links included.

Tags for all three: `aimeat, ai agents, mcp, model context protocol, agent economy, open protocol,
self-hosted, ai infrastructure, agentic ai, no-code app building`

---

## 1. mcp-direct.mp4 (1:05) — uploaded, https://youtu.be/Af7prjgCf1s

**Title**

```
AIMEAT: an agent builds a working surface over MCP, nothing is clicked
```

**Description**

```
One sentence typed into a chat. Claude writes the plan onto an ORIGAMI board and ticks it off as it
goes: 23 days of the owner's own AI usage read out of the account, the same numbers drawn as a
chart, a whole CRM running live inside a frame, and an invitation published at its own address that
anyone can answer without an account. Then the replies, read back out of the CRM and filtered to
that event.

Nobody clicked anything in that window. Every step went over MCP against the live node, with the
agent's own scoped identity and the owner's consent behind it. 3 minutes 49 seconds from nothing to
all of it, shown here in 65 seconds.

Recorded in a real browser against the live node, with the account's real data. Waiting is cut and
long stretches are compressed. Every number on screen is the one the node actually returned.

AIMEAT is a digital agency where people, AI, agents and apps work under one roof, and everyone owns
their own data. Your identity, your memory, your agents, your apps, on your own node if you want.
Open protocol, MIT licensed, plain HTTP and JSON.

Try it: https://aimeat.io
Source and specification: https://github.com/miikkij/aimeat-protocol
```

---

## 2. origami-live.mp4 (1:34) — uploaded, https://youtu.be/U1ORESLh3dM

**Title**

```
AIMEAT ORIGAMI: a surface you build by saying what you want
```

**Description**

```
An empty board. One sentence that starts several pieces of work at once. An invitation where you
describe in plain language what its button should do, then publish it at its own address. A guest
answers with no account, the answer lands in the CRM, and all of it sits side by side on one surface.

The parts are AI-built and the plumbing is not improvised: the public form takes an unauthenticated
POST, and the node writes the record under the form owner's account, against an allow list and a
schema-locked namespace, with a honeypot and a rate limit. Nothing about the sender is trusted.

Recorded in a real browser against the live node, with the account's real data. Waiting is cut and
long stretches are compressed. Every number on screen is the one the node actually returned.

AIMEAT is a digital agency where people, AI, agents and apps work under one roof, and everyone owns
their own data. Your identity, your memory, your agents, your apps, on your own node if you want.
Open protocol, MIT licensed, plain HTTP and JSON.

Try it: https://aimeat.io
Source and specification: https://github.com/miikkij/aimeat-protocol
```

---

## 3. helvetinkone.mp4 (2:46) — uploaded, https://youtu.be/rh5pBmpnK_Q

**Title**

```
AIMEAT: an AI-built capability sells itself to other agents and earns real money
```

Shorter alternative if the above reads long in search results:
`AIMEAT: a capability agents can buy, and real money arriving per call`

**Description**

```
Capabilities on AIMEAT are built by talking to an AI, and they are sold to machines. This is one of
them going the whole way: a product that answers a real question, a listing that tells a buying
agent everything it needs to call it unattended, and money arriving call by call.

0:00 NUOTTA finds 22 open tenders matching "ilmanvaihto", including a 1.5 M EUR job in Kuhmo. The
same capability is one of 40 listings on EXCHANGE, and the listing carries what a machine needs
before it commits: the input schema, the invocation instructions, the terms, and the ODPS descriptor
that says who is behind the data and under which law.
1:07 A buying account starts calling the tool. Every call is metered and the seller's wallet moves
from 607 to 655 while the page sits open.
1:46 A till built on the ORIGAMI surface reads the seller's own public earnings figures every five
seconds. The euro figure rises on screen with no reload and no click.

The whole chain was built by describing it to an AI: NUOTTA as an app on the node, the EXCHANGE
listing out of the app's own tools, and the till as a frame on a board. The buyer side is machine
traffic, which is what the pricing, the metering and the consent trail are built for.

Recorded in a real browser against the live node, with the account's real data. Waiting is cut and
long stretches are compressed. Every number on screen is the one the node actually returned.

AIMEAT is a digital agency where people, AI, agents and apps work under one roof, and everyone owns
their own data. Your identity, your memory, your agents, your apps, on your own node if you want.
Open protocol, MIT licensed, plain HTTP and JSON.

Try it: https://aimeat.io
Source and specification: https://github.com/miikkij/aimeat-protocol
```

---

## README state

All four recordings in the "See it in action" section are YouTube thumbnail links now, in the same
form. The mp4 files stay in `assets/video/` and each paragraph still carries a direct link to them.

```markdown
[![<title>](https://img.youtube.com/vi/<ID>/maxresdefault.jpg)](https://youtu.be/<ID>)
```

| Video | ID | README |
|---|---|---|
| mcp-direct | `Af7prjgCf1s` | line 49 |
| origami-live | `U1ORESLh3dM` | line 55 |
| helvetinkone | `rh5pBmpnK_Q` | line 61 |
| Agent Hello Integration (older) | `ncBX9BaoAWM` | line 67 |

`README.md` and `aimeat/README.md` are byte-identical copies, so any edit goes to the root file and
gets copied over the other one. If `maxresdefault.jpg` ever 404s for a vertical upload, use
`hqdefault.jpg`.
