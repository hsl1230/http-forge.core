---
name: diagnose-failure
description: Diagnose and fix a failing API test with business context
triggers: ["diagnose", "debug failure", "fix test", "why is this failing", "explain failure"]
---

# Diagnose Failure Skill

Given a failed test run, diagnose the root cause and suggest fixes.

## Steps
1. Check the response status code (4xx/5xx indicates client/server error)
2. Examine the response body for error messages
3. Verify all environment variables are resolved (no {{var}} in final URL)
4. Check authentication headers (Authorization, API keys)
5. Verify Content-Type matches request body format
6. Compare expected vs actual response schema
7. Check for API contract changes (new/removed fields)

## Common Issues
- 401/403: Authentication failure — check token expiry, scopes, headers
- 404: Endpoint not found — check URL, path parameters, base URL
- 400: Bad request — check request body, query params, content type
- 500: Server error — check request payload, server logs
- Timeout: Network issue or slow endpoint — check URL, increase timeout

## Output Format
Provide a structured diagnosis:
1. Root cause (1-2 sentences)
2. Specific fix (code snippet or config change)
3. Prevention (how to avoid in the future)
