# Contributing to @http-forge/core

Thank you for your interest in contributing! `@http-forge/core` is the runtime engine behind HTTP Forge.

## Prerequisites

- **Node.js 20+** (Node 24 recommended — Node 18.x breaks Vitest)
  ```bash
  export PATH=/home/henry/.nvm/versions/node/v24.19.0/bin:$PATH
  ```

## Development workflow

1. Clone the repo and install dependencies:
   ```bash
   git clone git@github.com:hsl1230/http-forge.core.git
   cd http-forge.core
   npm install --legacy-peer-deps  # optional peer deps (AWS/Azure/GCP/Vault/1Password) may fail on some npm versions
   ```

2. Make your changes in `src/`.

3. Typecheck:
   ```bash
   npx tsc --noEmit
   npx tsc -p tsconfig.test.json   # test typing
   ```

4. Run tests:
   ```bash
   npx vitest run
   ```

5. Build (has a 786 KB bundle budget check):
   ```bash
   npm run build:prod
   ```

6. Copy dist to consumers (if you have them checked out):
   ```bash
   cp -r dist/* ../http-forge/node_modules/@http-forge/core/dist/
   cp -r dist/* ../http-forge.cli/node_modules/@http-forge/core/dist/
   ```

7. Typecheck consumers:
   ```bash
   cd ../http-forge && npx tsc --noEmit
   cd ../http-forge.cli && npx tsc --noEmit
   ```

## Coding conventions

- **Core is VS Code-free.** Never import `vscode` in `src/`. Grep guard: `rg "from 'vscode'" src/` must be clean.
- **Use ports and dependency injection.** Services are registered in `core-bootstrap.ts`.
- **No `as any` casts.** Use proper types or `unknown` with narrowing.
- **Follow SOLID principles.** See `http-forge/docs/developer/SOLID-ARCHITECTURE.md`.
- **Golden fixture files are locked.** Regenerate only on deliberate, recorded changes.

## Commit conventions

Follow conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.

## Pull request process

1. Create a feature branch from `main`.
2. Make your changes following the conventions above.
3. Run the full verification workflow.
4. Ensure all tests pass and typechecks are clean.
5. Open a PR with a clear description.

## What NOT to do

- Do not commit generated `dist/` output (it's gitignored).
- Do not use destructive Git commands.
- Do not commit secrets or internal endpoints.

## Getting help

- Read `AGENTS.md` (workspace root) for full developer context.
- Read `DECISIONS.md` and `IMPLEMENTATION-BRIEF.md` for API discovery conventions.