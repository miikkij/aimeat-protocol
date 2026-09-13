---
type: llm
---

PASS if the commit message says why the change exists (the same webhook behaved differently depending on whether the MCP tool or the REST route sent it) AND says what it costs (a REST call to a receiver that is down can take up to about six seconds longer before failing).
FAIL if either the reason or the cost is missing, or if the message only lists what the code does.
