# phaser smoke test set

Minimal single-page game component proving a mid-tier model produces a WORKING Phaser 3 scene.
Model builds one-shot, fetches `GET /v1/library-packs/phaser` ai_doc, loads ONLY from the node.

Task: a minimal Phaser 3 arcade scene that boots and runs — a player rect/sprite moved with the arrow
keys (arcade physics), plus a few balls bouncing off world bounds, all using GENERATED textures
(graphics.generateTexture), no external image files. NO login. Zero console errors.

Pass = the game canvas appears and the scene renders (player + balls visible) + 0 console errors,
verified in a real browser (screenshot).
