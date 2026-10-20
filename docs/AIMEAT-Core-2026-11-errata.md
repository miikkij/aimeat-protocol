# AIMEAT Core 2026-11: errata

**Applies to:** [AIMEAT Core 2026-11](AIMEAT-Core-2026-11.md)

An erratum corrects the text where it contradicts the edition's own intent, and it does not change what a conforming implementation does (Core §0.2, rule 4). Each erratum below is applied in the edition's text, marked with its number where it applies.

| # | Requirement | Was | Is | Why it is an erratum | Date |
|---|---|---|---|---|---|
| E1 | MCP-03 (§11.4) | An MCP session MUST belong to the principal that opened it. A request on that session by any other principal MUST be refused. | Where the negotiated MCP revision has sessions, an MCP session MUST belong to the principal that opened it, and a request on that session by any other principal MUST be refused. On MCP 2026-07-28, which has no sessions, every request is authenticated on its own. | The requirement was written for the 2025-era revisions, where a session outlives the request that opened it. MCP 2026-07-28 removed sessions and the `initialize` handshake, so the original text has nothing to apply to there. A node that serves only sessions conforms exactly as before; the erratum states the scope the text always had. | 2026-10-20 |
