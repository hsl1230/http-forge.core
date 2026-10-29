const esbuild = require('esbuild');

const production = process.argv.includes('--production');

// Dependencies that must stay as runtime require()/import() calls instead of
// being inlined into the bundle. They are only needed by the Postman script
// sandbox (module-loader shims, already lazy-loaded) and OpenAPI import/export,
// so bundling them bloat every consumer's startup for functionality they may
// never touch. All are real dependencies installed with the package.
const external = [
  'vm2',
  'lodash',
  'moment',
  'ajv',
  'tv4',
  'uuid',
  'yaml',
  '@apidevtools/json-schema-ref-parser',
  // TypeScript compiler — used by API discovery source analysis. Heavy
  // (~8 MB), kept out of the bundle (700 KB budget); loaded at runtime only
  // when a discovery provider actually parses TS sources.
  'typescript',
  // java-parser — used by Spring API discovery. Heavy (~4 MB), kept out of
  // the bundle; imported() lazily only when the Spring provider runs.
  'java-parser',
  // ws — WebSocket client. Loaded lazily only when a WebSocket request runs.
  'ws',
  // socket.io-client — Socket.IO transport. Loaded lazily only when a Socket.IO
  // request runs.
  'socket.io-client',
];

// Max allowed minified bundle size (bytes). Guards against silent bloat — the
// measured externalized baseline is ~545 KB, so 700 KB leaves ~28% headroom.
// Raised to 725 KB (2026-08) for the deliberate Phase 3 additions: deterministic
// review engine (Layer 7), auth/validation discovery backfill, release-notes
// docs byproduct, and the review_suite MCP tool (~16 KB minified).
// Raised to 735 KB (2026-08) for the deliberate Phase 4 / Layer 8 addition:
// the API Architect (intent → OpenAPI → collection + suite + flow + docs)
// service and its MCP design_api_from_intent tool (~4 KB minified).
// Raised to 740 KB (2026-10) for deliberate lazy collection loading:
// light startup (metadata-only loadAllLight), on-demand loadRequestDetail,
// save-path hydration guards, and execution/AI hydration call sites (~3 KB
// minified). Runtime memory/IO win outweighs the small bundle growth.
// Raised to 748 KB (2026-10) for the deliberate QA mode addition: the
// discover → generate → run → report orchestrator (qa-service), table
// renderer, and report types (~7 KB minified, all stage logic reused).
// Raised to 750 KB (2026-10) for the QA MCP surface + AI assertion pass:
// qa_api schema/handler, registry wiring, and suggestAssertions reuse.
// Raised to 755 KB (2026-10) for deliberate secret-provider hardening:
// SDK client reuse, transport timeouts, module-path refresh, opaque secret
// values, and exact-value redaction across history and result persistence.
// Raised to 756 KB (2026-10) for configurable AWS shared-config profile
// selection in the secrets resolver.
// Raised to 764 KB (2026-10) for Phase 1 WebSocket support: the Node ws
// adapter, WebSocket request config types, and persistence/guards (~4 KB
// minified; ws itself remains external and is imported lazily).
const SIZE_BUDGET_BYTES = 786 * 1024;

async function build() {
  const commonConfig = {
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    external,
    sourcemap: !production,
    minify: production,
    minifyWhitespace: production,
    minifyIdentifiers: production,
    minifySyntax: production,
    treeShaking: true,
    legalComments: 'none',
    logLevel: 'info',
  };

  try {
    // Build CommonJS
    await esbuild.build({
      ...commonConfig,
      format: 'cjs',
      outfile: 'dist/index.js',
    });

    // Build ESM
    await esbuild.build({
      ...commonConfig,
      format: 'esm',
      outfile: 'dist/index.mjs',
    });

    console.log('✓ Build complete');

    if (production) {
      const fs = require('fs');
      let overBudget = false;
      for (const file of ['dist/index.js', 'dist/index.mjs']) {
        const bytes = fs.statSync(file).size;
        const kb = (bytes / 1024).toFixed(1);
        const ok = bytes <= SIZE_BUDGET_BYTES;
        console.log(`  ${ok ? '✓' : '✗'} ${file}  ${kb} KB ${ok ? '' : `(budget ${(SIZE_BUDGET_BYTES / 1024).toFixed(0)} KB exceeded)`}`);
        if (!ok) overBudget = true;
      }
      if (overBudget) {
        throw new Error(`Bundle exceeds size budget of ${(SIZE_BUDGET_BYTES / 1024).toFixed(0)} KB`);
      }
    }

    // Generate TypeScript declarations using tsc
    const { execSync } = require('child_process');
    console.log('Generating TypeScript declarations...');
    execSync('tsc --emitDeclarationOnly --outDir dist', { stdio: 'inherit' });
    console.log('✓ TypeScript declarations generated');
    
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
