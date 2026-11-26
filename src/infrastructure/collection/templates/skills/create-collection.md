---
name: create-collection
description: Create a well-structured collection from an API description or OpenAPI spec
triggers: ["create collection", "new collection", "build collection", "import api"]
---

# Create Collection Skill

Given an API description, OpenAPI spec, or endpoint list, create a well-structured HTTP Forge collection.

## Steps
1. Analyze the API endpoints and group them by resource/domain
2. Create folders for each resource group
3. Create requests with proper method, URL, headers, and body
4. Use {{variable}} placeholders for base URL, auth tokens, and IDs
5. Add descriptions to each request
6. Set up authentication (inherit, bearer, OAuth2, etc.)
7. Create environment variables for reusable values

## Schema Reference

See `.http-forge/AGENTS.md` § JSON Schemas for the full schema reference. Key files:
- `collection.schema.json`, `folder.schema.json`, `request.schema.json`
- `environment.schema.json`, `global-environment.schema.json`, `suite.schema.json`

Schema base URL: `https://raw.githubusercontent.com/hsl1230/http-forge/main/resources/`

## Best Practices
- Use kebab-case for folder and request names
- Group related endpoints under folders
- Use environment variables for base_url, auth tokens, and IDs
- Add descriptions explaining what each request does
- Set appropriate Content-Type headers
- Include example request bodies for POST/PUT/PATCH
