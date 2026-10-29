# test-fixtures — Golden discovery fixtures

Each subdirectory is a **small, real, deterministic backend project** used as a
golden test fixture for source-code discovery. They are the TDD anchor of Phase 1
(see `IMPLEMENTATION-BRIEF.md`).

## Convention

- One project per directory, named `<framework>-app` (e.g. `express-app`,
  `nestjs-app`, `spring-app`, `fastapi-app`).
- Every project MUST be self-contained and deterministic:
  - fixed route set (5–8 endpoints, including at least one `:id` path param,
    one POST-with-body, one DELETE);
  - no dynamic route registration from config/DB; no timestamps/generated code;
  - committed with its own `package.json` (or `pom.xml`) so the framework
    fingerprint detection works.
- Each project ships an `expected.endpoints.golden.json` — the expected
  `DiscoveredApi[]` (plan §3.2) that the ported provider MUST produce after
  normalization.

## Golden normalization (conformance runner)

Before diffing, the conformance runner MUST:
1. Sort endpoints: method asc (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS),
   then resolved path asc, then source file asc, then line asc.
2. Strip volatile fields: `id`, `projectRoot`, `projectName`, and any
   timestamps. `source.filePath` is kept but compared RELATIVE to the fixture
   root (so absolute workspace paths don't leak).
3. Compare deep-equal against the golden file.

## Locking rule (TDD)

Golden files are LOCKED. They are authored once, then the provider is written to
match (red → green). Regenerate ONLY on a deliberate, reviewed change — and
record the reason in the commit message. NEVER weaken a golden assertion to make
a wrong output pass.

## Workspace-level fixtures (NOT golden)

Larger real projects in the workspace root (`UserController.java`, `bookmark-ms`,
`sq5-test-automation`, the two extension repos) are used for **recall-rate**
benchmarks and ad-hoc sanity, not as deterministic golden tests. Keep golden
fixtures small and committed under this directory.
