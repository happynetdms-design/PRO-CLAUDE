/*
 * API Routing Diagnostic
 * Validates that local API handlers are routed through Vite and return JSON
 * Usage: npm run verify:api-routing
 */

const endpoints = [
  { method: 'GET', path: '/api/me', desc: 'User info' },
  { method: 'POST', path: '/api/signup', desc: 'Signup endpoint' },
  { method: 'GET', path: '/api/branches', desc: 'Branches list' },
];
const apiPort = process.env.API_PORT || process.env.PORT || '4173';
const apiBaseUrl = `http://localhost:${apiPort}`;

async function testEndpoint(method, path) {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: { 'Accept': 'application/json' }
    });
    
    const text = await response.text();
    const isHtml = text.trim().startsWith('<');
    const isJson = text.trim().startsWith('{') || text.trim().startsWith('[');
    
    return {
      status: response.status,
      isJson,
      isHtml,
      contentType: response.headers.get('content-type') || 'unknown',
      error: isHtml ? 'Returns HTML instead of JSON (routing issue)' : !isJson ? 'Response is not valid JSON' : null,
      preview: text.substring(0, 100)
    };
  } catch (e) {
    return {
      status: 'error',
      error: e.message
    };
  }
}

(async () => {
  console.log('\n=== API Routing Diagnostic ===\n');
  console.log('Testing endpoints for proper JSON responses...\n');
  
  let issueCount = 0;
  
  for (const ep of endpoints) {
    const result = await testEndpoint(ep.method, ep.path);
    const status = result.isJson ? '✓' : result.isHtml ? '✗' : '?';
    
    console.log(`${status} ${ep.method} ${ep.path} (${ep.desc})`);
    
    if (result.status !== 'error') {
      console.log(`  Status: ${result.status}`);
      console.log(`  Content-Type: ${result.contentType}`);
      if (result.isJson) {
        console.log(`  ✓ Valid JSON response`);
      } else if (result.isHtml) {
        console.log(`  ✗ ERROR: Returns HTML! Check netlify.toml redirects.`);
        issueCount++;
      } else {
        console.log(`  ✗ ERROR: ${result.error}`);
        issueCount++;
      }
    } else {
      console.log(`  ✗ ERROR: ${result.error}`);
      issueCount++;
    }
    console.log();
  }
  
  if (issueCount === 0) {
    console.log('\n✓ All endpoints are properly configured and returning JSON!\n');
  } else {
    console.log(`\n✗ Found ${issueCount} issue(s). Check that:\n`);
    console.log('  1. Vite is running on the configured port');
    console.log('  2. vite.config.js can load the local API handlers');
    console.log('  3. Production deployment has the required server environment variables\n');
  }
})();
