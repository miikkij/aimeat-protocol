---
type: llm
---

PASS if the recommended approach gives the notes to a text model in one prompt (whole, or after a word search or a date filter narrows them) and does not recommend computing embeddings or a vector index. Mentioning embeddings only to say they are not needed at this size, or only as something the person could decide on later if the collection grows far larger, is a PASS.
FAIL if the answer recommends embeddings or a vector index for these 800 notes, or proposes them as the main approach.
