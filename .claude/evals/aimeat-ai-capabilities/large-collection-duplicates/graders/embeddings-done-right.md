---
type: llm
---

PASS if the answer uses embeddings for the duplicate search AND says at least two of these: the model that made the vectors is stored with them (or all vectors must come from one model); vectors are not kept in a single memory value, or are split across records, because of the size limit; only new or changed tickets are embedded each night; the capability is checked first.
FAIL if the answer does not use embeddings, or uses them without any of those points.
