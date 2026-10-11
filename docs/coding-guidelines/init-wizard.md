# Init Wizard Maintenance (`aimeat init`)

The interactive setup wizard starts in `src/cli/init-wizard.ts` (`runInitWizard`) and uses `@clack/prompts` for the UI. The prompts and helpers live in `src/cli/init-wizard/`:

| File | What it holds |
|------|---------------|
| `steps-core.ts` | `askCoreSettings()`: node identity, storage, admin password, modes, federation, SMTP, push, metrics, site and cookie-consent settings |
| `steps-advanced.ts` | `askEconomySettings()` and `askAllAdvancedSettings()` |
| `steps-operator.ts` | `askOperatorSettings()`: the operator fields the privacy page needs |
| `presets.ts` | the use-case presets (`public`, `personal`, `dev`, `custom`) and `CONFIG_DEFAULTS` |
| `generate.ts` | the `.env`, JSON and INI writers |
| `helpers.ts` | input validators and cancel handling |

When you add a config option, touch every layer below. A setting that misses one does not appear in the wizard, the written `.env`, `aimeat config`, or the admin Config tab, and two of the misses fail the gate.

1. **Read the env var in config.** Add the field to `AimeatConfig` in `src/config-types.ts` (or the `config-types-*.ts` mixin for its area) and read `process.env.AIMEAT_…` in `loadConfig()` (`src/config.ts`, or the `config-*.ts` loader for its area).
2. **Give it a `CONFIG_FIELDS` row** in `src/services/config-schema.ts` or the `config-schema-*.ts` group for its area. That row is what the admin Config tab shows and what the INI writer maps the variable through. `pnpm check:config-coverage` fails for an `AIMEAT_*` variable read in `src/config*.ts` that has no row. A variable that cannot have one gets an entry with the reason in `aimeat/security/config-coverage-exemptions.json`.
3. **Name it on the Config tab.** A visible row needs `dashboard.cfg_<dot path with dots as underscores>` in `locales/en.json`, and a new section needs `dashboard.cfgGroup_<section>` plus its place in `DOMAINS` in `public/views/admin/config-tab.js`. `pnpm check:config-tab` fails until they exist, and also when no code reads the setting.
4. **Add the wizard texts** to `locales/en.json` under `"init"`: field label, hint, validation error. `en.json` is the source of truth. Finnish and Spanish follow with `pnpm locale:extract fi --prefix init.` and `pnpm locale:merge fi <file>` (the same for `es`); a key not yet translated falls back to English, and a `[TODO:xx]` placeholder fails `pnpm check:locales`. See `.claude/rules/locales.md`.
5. **Add the prompt** to the wizard:
   - Decide which use cases need it (`public`, `personal`, `dev`, `custom`).
   - Add it to `askCoreSettings()`, `askEconomySettings()`, `askAllAdvancedSettings()` or `askOperatorSettings()`.
   - Add the env var to `CONFIG_DEFAULTS` in `presets.ts`, so the summary can tell a changed value from the default.
6. **Write it to the `.env`.** Add the variable to a section in `generateEnvContent()` (`init-wizard/generate.ts`). The writer emits only the variables its sections name, so a variable missing there is dropped from the file the wizard writes.
7. **Update `aimeat/.env.example`** with the new variable, its default, and a comment.
8. **Show it in `aimeat config`**: add it to the matching section in `src/utils/env-config/sections-*.ts`.
9. **Validate it in `aimeat validate`** (`src/utils/env-validator.ts`) if the setting has rules a bad value would break.
10. **Verify:** `pnpm typecheck`, `pnpm check:config-coverage`, `pnpm check:config-tab`, `pnpm check:locales`, then `pnpm gate` when the work is finished.
