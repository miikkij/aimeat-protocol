---
type: llm
---

PASS if, when the image capability is off (capabilities answer `on: false`) or the call is refused, the app shows the person a message (for example the `fix` from the capabilities answer, or the error's message) and keeps the control visible or explains why it is disabled, AND the app tells the price or asks for confirmation before making the picture (for example `confirm: true`, or showing the price from the capabilities answer).
FAIL if the app hides the button or does nothing visible when the capability is off, or if it makes the picture without any price or confirmation step.
