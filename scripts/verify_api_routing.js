/*
 * API Routing Diagnostic
 * Validates that the Netlify Functions are properly routed and return JSON
 * Usage: npm run verify:api-routing
 */

const endpoints = [
  { method: 'GET', path: '/api/me', desc: 'User info' },
  { method: 'POST', path: '/api/signup', desc: 'Signup endpoint' },
  { method: 'GET', path: '/api/branches', desc: 'Branches list' },
  { method: 'GET', path: '/api/google-oauth-start', desc: 'Google OAuth start' }
];

async function testEndpoint(method, path) {
  try {
    const response = await fetch(`http://localhost:3000${path}`, {
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
      error: isHtml ? 'Returns HTML instead of JSON (routing issue)' : null,
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
        console.log(`  ? Unknown response type`);
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
    console.log('  1. netlify.toml has /api/* redirect BEFORE /* redirect');
    console.log('  2. Netlify Functions are properly deployed');
    console.log('  3. The development server (if local) has functions enabled\n');
  }
})();
