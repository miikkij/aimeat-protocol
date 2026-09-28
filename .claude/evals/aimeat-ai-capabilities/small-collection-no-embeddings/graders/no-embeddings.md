---
type: llm
---

PASS if the answer recommends an approach without embeddings for this collection (word search, filters, or sending the recipe titles and short texts to a text model in one prompt, which fits 120 recipes), and does not recommend building an embedding index. Mentioning embeddings only to say they are not needed at this size is a PASS.
FAIL if the answer recommends computing embeddings or a vector index for the 120 recipes.
