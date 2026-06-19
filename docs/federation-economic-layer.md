# Federation Economic Layer — Future Design (Phase C)

**Status:** Design only — **no code in the current implementation.** Deferred by developer decision (2026‑06‑19). This document captures the intended path so the visiting‑node work (Phases A & B) has a clear "why it becomes attractive" follow‑on, without committing to the regulatory and custody surface a real value layer brings.

## Context

Phases A & B made joining the federation easy and trustworthy:

- **Phase A** — a lightweight **`visiting`** tier (signed self‑join via open‑join), restricted to browse/discover + requesting paid work, promoted to **`member`** only by a local operator's deliberate vouch. (`src/services/federation-tiers.ts`, `src/routes/federation-peer.ts`)
- **Phase B** — **uptime measurement** (`permanent`/`temporary` availability from heartbeat history, `src/services/federation-availability.ts`), a **genesis‑defined, signed network policy** with measurable promotion criteria (`src/services/network-policy.ts`), and **operator‑vouch promotion** with advisory‑driven demotion.

What's missing is the *incentive*: a reason for a node to stay online, behave well, and contribute — and eventually, real value flowing to good participants. That is this layer. It is intentionally **after** the trust model is proven, so value never flows to an unvetted‑then‑promoted node before the measurement/governance has been battle‑tested.

The existing economy is **morsels only** — minted via welcome bonus + daily allowance, spent/burned on work + board posts (`src/services/morsel.ts`, `src/routes/wallet.ts`). Cross‑node value already moves over a **signed, replay‑protected, operator‑initiated settlement rail** (`src/routes/federation-settlements.ts`). There is **no** stablecoin, treasury, or fiat anything today (fully greenfield).

---

## Phase C.1 — Morsel uptime/contribution reward (build‑later, off by default)

A thin reward emitter on top of the **existing** settlement rail — no new currency, no treasury, no autonomous minting.

**Mechanism (proposed):**
- A low‑frequency check (foldable into the genesis‑sync interval or a dedicated timer) that, **only when enabled**, finds **member‑tier** peers whose `availabilityLabel === 'permanent'` over the reward period and that have had no reward this period, and credits a fixed morsel amount — either:
  - **local credit** to the peer's designated representative agent (`storage.creditBalance` + `storage.addTransaction` with `type: 'uptime_reward'`, same shape as `federation-settlements.ts`), or
  - **cross‑node** via the existing signed `/v1/federation/settle/outbound` path.
- **Idempotent per period** via a tracking code (`uptime:{nodeId}:{period}`) reusing the settlement replay‑protection check.

**Config (proposed, all default off/zero):**
- `federationUptimeRewardEnabled` (default **false**)
- `federationUptimeRewardMorsels` (per‑period amount)
- `federationUptimeRewardMinAvailability` (default = permanent threshold, 90)
- `federationUptimeRewardPeriodDays`

**Gating / safety:**
- **Member tier only** — visiting nodes earn nothing (removes the sybil incentive: spinning up many visiting nodes yields no reward).
- Availability is **necessary but not sufficient** — rewards ride on the *member* status, which already required the operator vouch + measured criteria.
- Off by default; an operator opts in explicitly.

This is the smallest honest step: prove that "good uptime + vouched membership → a modest morsel reward" works and is abuse‑resistant before any real value is involved.

---

## Phase C.2 — Real value (morsel ↔ stablecoin) — OUT OF SCOPE (document only)

A peg from morsels to a stablecoin (and/or fiat) is what makes membership genuinely *attractive* and lets the network *support the project*. It is **deliberately not designed in detail here** because it is a separate, security‑reviewed workstream with obligations that dwarf this tier's scope:

- **Peg / reserve:** an on‑ or off‑chain reserve, price oracle, mint/redeem accounting.
- **Treasury:** custody of real assets, reserve audits, balance integrity.
- **Ramps & payouts:** fiat on/off‑ramp, bank/blockchain payout, KYC/AML.
- **Regulatory:** money‑transmission / e‑money / VASP considerations by jurisdiction.

**Why deferred:** shipping a peg before the visiting/member trust model is proven would let an unvetted‑then‑promoted node touch real value. The phased order is: (1) trust tiers + measurement + promotion (done), (2) off‑by‑default morsel rewards (C.1, when wanted), (3) only then design the value layer as its own reviewed project.

---

## Decision log

- **2026‑06‑19** — Developer chose to **defer all incentives** for the visiting‑node work. Phases A & B shipped; Phase C is this document only. Revisit when the visiting/member flow has real‑world usage and the team wants to add a participation incentive.

## Related

- Tier model & onboarding: `src/services/federation-tiers.ts`, `src/routes/federation-peer.ts`
- Uptime & policy: `src/services/federation-availability.ts`, `src/services/network-policy.ts`
- Settlement rail (reward transport): `src/routes/federation-settlements.ts`
- Morsel economy: `src/services/morsel.ts`, `src/routes/wallet.ts`
- Plan: `~/.claude/plans/sitten-seuraava-federointiin-liittyv-curried-horizon.md`
