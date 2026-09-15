# Node configuration

The maintained configuration reference is
[docs/b-config.md](../../docs/b-config.md). It explains source precedence, immutable
settings, host-sealed settings and the admin API.

For an installed npm package, use `aimeat config`, `aimeat validate` and the
package's `.env.example`. These describe the version you installed.

```bash
aimeat init
aimeat validate
aimeat start --db sqlite --db-path ./data/aimeat.db
```

Use PostgreSQL with Kysely or SQLite for persistent storage.
The SQLite environment variable is `AIMEAT_SQLITE_PATH`.
The welcome morsel balance belongs to the human owner.

This file is a package-local entry point. Keep configuration details in the maintained
reference and the implementation's configuration schema.
