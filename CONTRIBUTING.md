# Contributing to AIMEAT

Thank you for your interest in contributing to the AIMEAT Protocol!

## How to Contribute

1. **Fork** the repository
2. **Create a branch** from `main` for your change
3. **Make your changes** following the code standards below
4. **Run tests** to verify nothing is broken
5. **Open a Pull Request** with a clear description

## Code Standards

- Follow the conventions in [docs/coding-guidelines/code-style.md](docs/coding-guidelines/code-style.md)
- Every source file must have a file header comment (see [docs/coding-guidelines/file-headers.md](docs/coding-guidelines/file-headers.md))
- Use TypeScript strict mode
- Use `.js` extensions in all ESM imports

## Testing Requirements

Before submitting a PR, run:

```bash
cd aimeat
pnpm lint          # ESLint must pass
pnpm typecheck     # TypeScript must compile cleanly
pnpm test          # Unit tests must pass
pnpm test:e2e      # E2E tests must pass (memory backend)
```

For changes affecting persistent storage, also run:
```bash
pnpm test:e2e:sqlite
pnpm test:e2e:mongodb
```

See [docs/coding-guidelines/testing-requirements.md](docs/coding-guidelines/testing-requirements.md) for full details.

## Internationalization

AIMEAT supports English and Finnish. When adding user-visible text:

- Add keys to **both** `aimeat/locales/en.json` and `aimeat/locales/fi.json`
- Use the `t()` function for all user-facing strings in frontend code
- If unsure of the Finnish translation, use `[TODO:fi] English text` as placeholder

## Reporting Issues

Use [GitHub Issues](https://github.com/miikkij/aimeat-protocol/issues) to report bugs or request features. Include:

- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS
- Storage backend (memory/SQLite/MongoDB)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
