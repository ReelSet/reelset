# Contributing to reelset

Thanks for helping. Here's how to get from idea to merged.

## Where things go

- **Ideas and feature requests:** [Discussions → Ideas](https://github.com/reelset/reelset/discussions/categories/ideas). Upvote the ones you want.
- **Questions:** [Discussions → Q&A](https://github.com/reelset/reelset/discussions/categories/q-a).
- **Bugs:** [open an issue](https://github.com/reelset/reelset/issues/new/choose).
- **Security problems:** report privately, see [SECURITY.md](SECURITY.md).

For anything bigger than a small fix, open an issue or discussion first so we can agree on the
approach before you write code.

## Setup

Requires Node 22.12+.

```bash
npm install
npm run typecheck
npm test
```

Tests mock all external HTTP and don't need a database or API keys. To run the app itself, copy
`.env.example` to `.env.local` and fill in your own Supabase project and API keys. See
[docs/infra.md](docs/infra.md) for how the services fit together.

## Rules of the road

- TypeScript strict, no semicolons, single quotes, width 100. Run `npm run format`.
- Backend, API-route and pipeline code gets Vitest tests. Mock external HTTP. No frontend tests.
- Database changes go in `packages/core/prisma/schema.prisma` plus a new migration.
- Item status changes go through `transitionItem`.
- Never commit keys, connection strings or `.env.local`. Never log secrets.
- Keep comments for the non-obvious "why".

## Pull requests

1. Fork, branch from `main`, make your change.
2. `npm run typecheck && npm test` must pass (CI runs both).
3. Open a PR describing what changed and how you tested it.

By contributing you agree your work is released under the [MIT License](LICENSE) and that you'll
follow the [Code of Conduct](CODE_OF_CONDUCT.md).
