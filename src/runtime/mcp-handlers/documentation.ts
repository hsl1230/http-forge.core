/**
 * Documentation tool handlers — list and fetch HTTP Forge documentation.
 *
 * Lets MCP-connected AI agents discover and read the user-guide docs on demand.
 */

import type { McpToolHandler } from './types';

interface DocTopic {
  topic: string;
  title: string;
  summary: string;
  url?: string;
}

const DOC_TOPICS: DocTopic[] = [
  { topic: 'scripts-assertions', title: 'Scripts & Assertions', summary: 'pm.test, expect chain, pre/post-response scripts, assertion patterns' },
  { topic: 'postman-compatibility', title: 'Postman Compatibility', summary: 'API mapping, sandbox globals, shims vs full libraries, migration guide' },
  { topic: 'postman-compatibility-matrix', title: 'Postman Compatibility Matrix', summary: 'Detailed feature-by-feature comparison with Postman' },
  { topic: 'environments-variables', title: 'Environments & Variables', summary: 'Variable scopes, resolution pipeline, iteration data, template syntax' },
  { topic: 'collections-requests', title: 'Collections & Requests', summary: 'Collection structure, request definition, folders, auth, body types' },
  { topic: 'test-suites', title: 'Test Suites', summary: 'Suite nodes, control flow, integration/E2E/acceptance patterns' },
  { topic: 'template-syntax', title: 'Template Syntax', summary: '{{variable}}, filters, dynamic variables, filter chains' },
  { topic: 'mcp-server', title: 'MCP Server', summary: 'MCP tools, prompts, resources, server setup' },
  { topic: 'custom-modules', title: 'Custom Modules', summary: 'Loading npm modules, pm.require, module paths' },
  { topic: 'troubleshooting', title: 'Troubleshooting', summary: 'Common issues and solutions' },
  { topic: 'getting-started', title: 'Getting Started', summary: 'Installation, first collection, first request' },
  { topic: 'configuration', title: 'Configuration', summary: 'Settings, http-forge.config.json, environment config' },
];

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/hsl1230/http-forge/main/docs/user-guide';

export const documentationHandlers: McpToolHandler[] = [
  {
    toolNames: ['list_documentation'],
    async handle({ services }) {
      return {
        topics: DOC_TOPICS.map(({ topic, title, summary }) => ({ topic, title, summary })),
        count: DOC_TOPICS.length,
        hint: 'Use get_documentation(topic) to read the full content of any topic.',
      };
    },
  },
  {
    toolNames: ['get_documentation'],
    async handle({ args, services }) {
      const topic = typeof args.topic === 'string' ? args.topic.trim() : '';
      if (!topic) {
        throw new Error('The "topic" argument is required. Use list_documentation to see available topics.');
      }

      const valid = DOC_TOPICS.find((t) => t.topic === topic);
      if (!valid) {
        const available = DOC_TOPICS.map((t) => t.topic).join(', ');
        throw new Error(`Unknown topic "${topic}". Available: ${available}`);
      }

      // Try bundled docs first (extension environment)
      if (services.docsPath) {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const bundledPath = path.join(services.docsPath, 'user-guide', `${topic}.md`);
        try {
          const content = await fs.readFile(bundledPath, 'utf-8');
          return { topic, title: valid.title, content, source: 'bundled' };
        } catch {
          // Fall through to workspace docs
        }
      }

      // Try workspace docs
      if (services.workspaceFolder) {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const localPath = path.join(services.workspaceFolder, 'docs', 'user-guide', `${topic}.md`);
        try {
          const content = await fs.readFile(localPath, 'utf-8');
          return { topic, title: valid.title, content, source: 'local' };
        } catch {
          // Fall through to GitHub fetch
        }
      }

      // Fall back to GitHub raw URL
      const url = `${GITHUB_RAW_BASE}/${topic}.md`;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const content = await res.text();
        return { topic, title: valid.title, content, source: 'github', url };
      } catch (err) {
        return {
          topic,
          title: valid.title,
          error: `Could not fetch documentation: ${err instanceof Error ? err.message : String(err)}`,
          url,
          hint: `Read the doc manually at: ${url}`,
        };
      }
    },
  },
];
