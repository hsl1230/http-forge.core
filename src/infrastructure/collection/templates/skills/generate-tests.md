---
name: generate-tests
description: Generate test assertions for an API request from its response
triggers: ["generate tests", "create tests", "test this endpoint", "suggest assertions"]
---

# Generate Tests Skill

Given a request and its response, generate comprehensive test assertions.

## Assertion Format Reference

See `.http-forge/AGENTS.md` for the full Postman-compatible assertion API. Key patterns below:

### Status Code
```javascript
pm.test("Status code is 200", () => {
    pm.response.to.have.status(200);
});
```

### Response Time
```javascript
pm.test("Response time is acceptable", () => {
    pm.expect(pm.response.responseTime).to.be.below(2000);
});
```

### Required Fields
```javascript
pm.test("Response has required fields", () => {
    const json = pm.response.json();
    pm.expect(json).to.have.property('id');
    pm.expect(json.id).to.be.a('string');
});
```

### Schema Validation (nested objects)
```javascript
pm.test("Response schema is valid", () => {
    const json = pm.response.json();
    pm.expect(json).to.have.property('data').that.is.an('object');
    pm.expect(json.data).to.have.property('items').that.is.an('array');
    pm.expect(json.data.items[0]).to.have.property('id');
});
```

### Error Cases
```javascript
pm.test("Invalid input returns 400", () => {
    pm.response.to.have.status(400);
    const json = pm.response.json();
    pm.expect(json).to.have.property('error');
});
```

### Header Checks
```javascript
pm.test("Content-Type is JSON", () => {
    pm.expect(pm.response.headers.get('Content-Type')).to.include('application/json');
});
```

## Steps
1. Analyze the response status code and body structure
2. Generate assertions for:
   - Status code check (e.g., 200, 201, 404)
   - Response time (under 2000ms)
   - Response schema validation (required fields, types)
   - Key field values (IDs, names, status)
   - Error cases (4xx, 5xx)
3. Use pm.test() and pm.expect() syntax
4. Include both positive and negative test cases

## Context
- Available globals: pm, ctx, hf, response, responseBody
- Assertion library: Chai (expect, should, assert)
- Response is available as: pm.response.json(), pm.response.text(), pm.response.status

## Example output
```javascript
pm.test("Status code is 200", () => {
    pm.response.to.have.status(200);
});

pm.test("Response has required fields", () => {
    const json = pm.response.json();
    pm.expect(json).to.have.property('id');
    pm.expect(json).to.have.property('name');
});

pm.test("Response time is acceptable", () => {
    pm.expect(pm.response.responseTime).to.be.below(2000);
});
```
