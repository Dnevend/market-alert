# Repository Guidelines

## Project Structure & Module Organization
Market Alert is a Cloudflare Worker built with Hono. Application code lives in `src/`, with the entry point `src/index.ts` exporting the worker. Add new route handlers in `src/routes/<feature>.ts` and compose them through the app instance to keep the entry file lean. Configuration files sit at the root: `wrangler.jsonc` for deployment, `tsconfig.json` for TypeScript options, and `package.json`/`pnpm-lock.yaml` for dependencies. Place shared utilities under `src/lib/`, and keep static assets in a future `public/` folder if ever needed. Tests should live alongside code under `src/__tests__/` with mirrored folder names.

## Build, Test, and Development Commands
- `pnpm install` (or `npm install`) installs dependencies and keeps `pnpm-lock.yaml` in sync.
- `pnpm dev` runs `wrangler dev`, serving the worker locally with live reload.
- `pnpm deploy` wraps `wrangler deploy --minify` and publishes the worker to the configured Cloudflare account.
- `pnpm cf-typegen` regenerates `CloudflareBindings` types; run whenever bindings change in `wrangler.jsonc`.
- `wrangler deploy --dry-run` validates the bundle without publishing; use before large releases.

## Coding Style & Naming Conventions
Write modern TypeScript using ES modules. Indent with two spaces, keep lines under 100 characters, and prefer `const` declarations. Name files and directories in kebab-case (`market-alert.ts`) and export the Hono app as the default module. Instantiate Hono with proper generics: `const app = new Hono<{ Bindings: CloudflareBindings }>()`. Handle requests with async functions that return Hono response helpers, and co-locate schema definitions beside their routes.

## Testing Guidelines
Automated tests are not yet configured; when adding them, use `vitest` plus `@cloudflare/workers-types` and organize specs as `*.test.ts` under `src/__tests__/`. Until then, exercise endpoints through `pnpm dev` and tools like `curl http://127.0.0.1:8787/`. Aim for high-level coverage of routing and bindings, and document any manual scenarios in the PR description. Prefer dependency-free mocks over hitting live Cloudflare services in unit tests.

## Commit & Pull Request Guidelines
Follow Conventional Commits (`feat:`, `fix:`, `chore:`) with concise, imperative summaries under 72 characters. Reference issue IDs in the message body when applicable. PRs should include: a clear summary, testing notes or screenshots of responses, links to related issues, and callouts for configuration changes (secrets, bindings, cron triggers). Request review from at least one maintainer and wait for CI or manual verification before merging.

## Deployment & Environment Notes
Manage secrets with `wrangler secret put <NAME>` rather than committing credentials. Keep environment-specific overrides in `wrangler.jsonc` using the `env` block, and update `CloudflareBindings` whenever bindings change. Document any new bindings or cron schedules directly in the PR description so operators can replicate them after merge.
