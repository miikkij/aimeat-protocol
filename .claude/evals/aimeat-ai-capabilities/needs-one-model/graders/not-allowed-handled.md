---
type: llm
---

PASS if the code handles a refusal of the model (err.code AI_MODEL_NOT_ALLOWED, or any refused call) by showing the person the message, and does not silently switch to another model.
FAIL if a refusal is ignored, swallowed, or answered by quietly calling a different model.
