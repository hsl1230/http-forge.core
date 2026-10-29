import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
    minify: false,
    external: [
        'vm2',
        'lodash',
        'moment',
        'ajv',
        'tv4',
        'uuid',
        'yaml',
        '@apidevtools/json-schema-ref-parser',
    ],
});
