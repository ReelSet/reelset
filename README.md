# Reelset

What developers are building, in 60-second reels.

Reelset ingests interesting developer projects, turns them into short vertical reels, and serves them in a reader app.

Try it at [reelset.app](https://reelset.app).

## Layout

| Path                                   | What it is                                                          |
| -------------------------------------- | ------------------------------------------------------------------- |
| `apps/web`                             | Next.js app (reader + admin), deployed on Vercel                    |
| `workers/ingest`                       | Cloudflare Worker that discovers and ingests projects               |
| `workers/render`                       | Cloudflare Worker + container that renders reels (Remotion, Python) |
| `packages/core`                        | Shared database schema, migrations and types                        |
| `scripts/smoke`, `scripts/maintenance` | Smoke tests and maintenance scripts                                 |
| `supabase`                             | Supabase config and auth email templates                            |
| `docs`                                 | Infra notes and contracts                                           |

## Local development

Requires Node 22.12+.

```bash
npm install
cp .env.example .env.local   # then fill in values
npm run dev -w @reelset/web  # start the web app
npm test                     # tests in every workspace
npm run typecheck            # typecheck every workspace
npm run format               # prettier
npm run db:generate          # generate DB client from the schema
npm run db:check             # check migrations
npm run db:deploy            # apply migrations
```

Secrets live in `.env.local` / `.dev.vars` and are never committed.

## Deploy

See [docs/infra.md](docs/infra.md) for domains, Cloudflare, Supabase and Vercel setup. The web app deploys from `main` via the Vercel Git integration (root directory `apps/web`).

## Community

- Ideas and feature requests: [Discussions → Ideas](https://github.com/reelset/reelset/discussions/categories/ideas)
- Questions: [Discussions → Q&A](https://github.com/reelset/reelset/discussions/categories/q-a)
- Bugs: [Issues](https://github.com/reelset/reelset/issues/new/choose)
- Security: see [SECURITY.md](SECURITY.md)

Want to help build it? Read [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
