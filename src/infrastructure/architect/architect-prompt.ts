/**
 * API Architect — intent prompt builder (L8).
 *
 * Turns a natural-language API intent into a bounded instruction for the AI
 * provider to design a complete OpenAPI 3.0 document (endpoints + DTOs + auth).
 * The returned spec is parsed and imported by ApiArchitectService, so the
 * prompt is strict about shape: a single JSON object, `openapi: "3.0.x"`,
 * `paths`, and `components.schemas` for every request/response DTO.
 */

export interface ArchitectPromptOptions {
  /** Target collection name (used to name the API in info.title when not given). */
  collectionName?: string;
  /** Base URL for `servers[0].url`. Defaults to `http://localhost:3000`. */
  baseUrl?: string;
  /** Optional workspace knowledge (gathered by the service) to ground the design. */
  workspaceKnowledge?: string;
}

/**
 * Build the AI prompt for designing an API from a natural-language intent.
 * The model is expected to reply with ONLY a JSON OpenAPI document.
 */
export function buildArchitectPrompt(
  intent: string,
  options: ArchitectPromptOptions = {}
): string {
  const baseUrl = options.baseUrl || 'http://localhost:3000';
  const title = options.collectionName || 'Designed API';
  const knowledge = options.workspaceKnowledge
    ? `

=== Workspace context ===
${options.workspaceKnowledge}
`
    : '';

  return `You are an expert API architect. Design a REST API for the following intent and
return a complete OpenAPI 3.0 document as a SINGLE JSON object.

Intent: ${intent}

Requirements:
- Reply with ONLY the JSON document (no markdown fences, no prose before/after).
- Top-level keys: "openapi" (must be "3.0.0" or higher 3.0.x), "info"
  (title "${title}", version "1.0.0", description matching the intent), "servers"
  (single entry with url "${baseUrl}"), "paths", and "components" containing
  "schemas" for every request and response DTO.
- Design a coherent REST resource model: plural resource names, proper HTTP
  verbs (GET/POST/PUT/PATCH/DELETE), and standard response codes (200/201/204,
  400, 401 when auth applies, 404, 422).
- Every operation must have: a unique "operationId", a short "summary",
  optional "description", "tags" (resource name), declared "parameters" for path
  and query variables (with name, in, required, schema), a "requestBody" when
  the method sends data (application/json schema), and "responses" with
  application/json content schemas.
- Define DTO schemas in components.schemas with meaningful property names,
  types, "required" arrays, and nested object/array shapes where appropriate.
- Use OpenAPI path parameters in {param} form, e.g. "/users/{id}".
- If the API requires authentication, declare a components.securitySchemes
  entry (e.g. bearerAuth, http/bearer) and apply a global "security" array.
- Do not invent unrelated endpoints; keep the surface focused on the intent.${knowledge}

Now output the OpenAPI JSON document for the intent.`;
}
