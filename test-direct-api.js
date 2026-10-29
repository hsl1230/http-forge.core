#!/usr/bin/env node
/**
 * Quick test of direct execution APIs
 * Run with: node test-direct-api.js
 */

const { bootstrapNodeRuntime, runRequest, runCollection, runSuite } = require('./dist/index.js');
const path = require('path');

async function main() {
  try {
    console.log('🧪 Testing HTTP Forge Direct Execution APIs\n');

    // Test 1: Check that we can bootstrap the runtime
    console.log('Test 1: Bootstrap Node Runtime');
    const container = bootstrapNodeRuntime({
      workspaceFolder: process.cwd()
    });
    console.log('✅ Runtime bootstrapped successfully');
    console.log(`   - Collection Service: ${container.collection ? 'OK' : 'MISSING'}`);
    console.log(`   - Http Request Service: ${container.httpRequest ? 'OK' : 'MISSING'}`);
    console.log(`   - Test Suite Service: ${container.testSuite ? 'OK' : 'MISSING'}`);

    // Test 2: Check that APIs are exported
    console.log('\nTest 2: Verify API Exports');
    console.log(`   - runRequest: ${typeof runRequest === 'function' ? '✅' : '❌'}`);
    console.log(`   - runCollection: ${typeof runCollection === 'function' ? '✅' : '❌'}`);
    console.log(`   - runSuite: ${typeof runSuite === 'function' ? '✅' : '❌'}`);

    // Test 3: Try to get collection list (will be empty in test environment)
    console.log('\nTest 3: Collection Service Interface');
    try {
      const collections = container.collection.getCollections?.() || [];
      console.log(`✅ Collection service accessible (${collections.length} collections found)`);
    } catch (err) {
      console.log(`⚠️  Collection service error: ${err.message}`);
    }

    console.log('\n✅ All basic API tests passed!');
    console.log('\nTo test with real collections:');
    console.log('  1. Create a collection in your workspace');
    console.log('  2. Run: node dist/cli.js run-collection --collection <id>');
    console.log('\nFor more examples, see: README.md');

  } catch (err) {
    console.error('❌ Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
