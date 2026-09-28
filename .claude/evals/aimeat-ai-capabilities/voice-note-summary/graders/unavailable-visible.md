---
type: llm
---

PASS if the code checks that both transcription and text are on before calling them (or handles their refusal), and when either is off or the call is refused (for example err.code AI_CAPABILITY_UNAVAILABLE) it shows the person a message such as the capability's `fix` or the error message, rather than failing silently or showing an empty result.
FAIL if a capability that is off or a refused call leads to nothing visible, an empty transcript or summary, or only a console log.
