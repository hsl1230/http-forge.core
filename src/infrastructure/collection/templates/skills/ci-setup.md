---
name: ci-setup
description: Set up CI/CD pipeline for HTTP Forge tests
triggers: ["ci", "ci/cd", "pipeline", "github actions", "jenkins", "gitlab ci"]
---

# CI/CD Setup Skill

Set up HTTP Forge for continuous integration and deployment.

## Steps
1. Install @http-forge/cli: `npm install -g @http-forge/cli`
2. Configure environment: create `.http-forge/assets/environments/ci.json`
3. Run tests: `http-forge run suite --all-suites --env ci --exit-code --reporter junit:results.xml`
4. Add to CI pipeline (GitHub Actions, GitLab CI, Jenkins)

## GitHub Actions Example
```yaml
name: API Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install -g @http-forge/cli
      - run: http-forge run suite --all-suites --env ci --exit-code --reporter junit:results.xml
      - uses: dorny/test-reporter@v1
        if: always()
        with:
          name: API Tests
          path: results.xml
          reporter: jest-junit
```

## Tips
- Use `--exit-code` to fail the build on test failures
- Use `--reporter junit:file.xml` for CI-compatible reports
- Store secrets in CI environment variables, not in repo
- Use `--concurrency` to parallelize test execution
