# Init Wizard Maintenance (`aimeat init`)

The interactive setup wizard lives in `src/cli/init-wizard.ts` and uses `@clack/prompts` for the UI. When adding new config options, touch every layer below or the setting silently won't appear in the wizard, the summary, or `aimeat config`:

1. **Add the env var to `src/config.ts`** in the `AimeatConfig` interface and `loadConfig()`.
2. **Add translations** to both `locales/en.json` and `locales/fi.json` under the `"init"` section — field label, hint text, validation error message.
3. **Add the prompt** to the wizard in `src/cli/init-wizard.ts`:
   - Decide which use cases need it (public / personal / dev / custom).
   - Add to `askCoreSettings()` or `askEconomySettings()` or `askAllAdvancedSettings()`.
   - Add the env var key to `CONFIG_DEFAULTS` for summary comparison.
4. **Update `.env.example`** with the new variable, default, and comment.
5. **Update `src/utils/env-config.ts`** to display the setting in `aimeat config`.
6. **Update `src/utils/env-validator.ts`** if the setting needs validation rules.
7. Run `npx tsc --noEmit` and `pnpm build` to verify.
