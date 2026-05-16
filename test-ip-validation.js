#!/usr/bin/env node

/**
 * IP Validation System Test Scenarios
 * This script helps verify that the IP validation system is working correctly
 */

const http = require('http');

const CONFIG = {
  BASE_URL: 'https://senderappbackend.onrender.com',
  TEST_TOKEN: 'YOUR_TEST_JWT_TOKEN_HERE',  // Replace with actual token
};

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function divider() {
  console.log('\n' + '='.repeat(80) + '\n');
}

async function testIpValidation() {
  log('IP Validation System - Test Scenarios', 'bright');
  divider();

  // Scenario 1: Development IP Mocking
  log('SCENARIO 1: Development IP Mocking', 'blue');
  log('─'.repeat(80), 'gray');
  log(`Prerequisites:
  - NODE_ENV=development
  - TEST_PUBLIC_IP=102.89.41.126 (or your test IP)
  - User has 102.89.41.126 in authorizedIps
  
Expected Behavior:
  - Request from localhost should be mocked to 102.89.41.126
  - Logs show: [DEV] IP Mocking: Setting x-forwarded-for to 102.89.41.126
  - Validation should PASS ✅
`, 'gray');

  log('How to test:', 'yellow');
  log(`1. Set environment variables:
   export NODE_ENV=development
   export TEST_PUBLIC_IP=102.89.41.126

2. Restart the backend server:
   npm run dev

3. Watch console logs for IP mocking messages

4. Send a request from localhost:
   curl -X POST http://localhost:5000/api/email/send \\
     -H "Authorization: Bearer YOUR_TOKEN" \\
     -H "Content-Type: application/json" \\
     -d '{"to": "test@example.com", ...}'

5. Check logs:
   ✅ Should see: [DEV] IP Mocking: Setting x-forwarded-for to 102.89.41.126
   ✅ Should see: [IP Validation] Parsed Request IPs: ['102.89.41.126']
   ✅ Should see: [IP Validation] ✅ ALLOWED
`, 'white');

  divider();

  // Scenario 2: Production with Proxy
  log('SCENARIO 2: Production with Real Proxy Headers', 'blue');
  log('─'.repeat(80), 'gray');
  log(`Prerequisites:
  - NODE_ENV=production
  - TEST_PUBLIC_IP not set (or empty)
  - User has 203.0.113.45 in authorizedIps
  - Request has X-Forwarded-For header from proxy
  
Expected Behavior:
  - Request IP extracted from X-Forwarded-For header
  - Development mocking disabled
  - Real client IP compared against authorized list
  - Validation should PASS if IP matches ✅
`, 'gray');

  log('How to test:', 'yellow');
  log(`1. Set environment variables:
   export NODE_ENV=production
   unset TEST_PUBLIC_IP

2. Restart the backend server:
   npm run dev

3. Send request with X-Forwarded-For header:
   curl -X POST https://senderappbackend.onrender.com/api/email/send \\
     -H "Authorization: Bearer YOUR_TOKEN" \\
     -H "X-Forwarded-For: 203.0.113.45" \\
     -H "Content-Type: application/json" \\
     -d '{"to": "test@example.com", ...}'

4. Check logs:
   ✅ Should NOT see: [DEV] IP Mocking
   ✅ Should see: [IP Validation] Request Headers: { 'x-forwarded-for': '203.0.113.45', ... }
   ✅ Should see: [IP Validation] Parsed Request IPs: ['203.0.113.45']
   ✅ Should see: [IP Validation] ✅ ALLOWED
`, 'white');

  divider();

  // Scenario 3: Unauthorized IP
  log('SCENARIO 3: Unauthorized IP (Should Fail)', 'blue');
  log('─'.repeat(80), 'gray');
  log(`Prerequisites:
  - User has 203.0.113.45 in authorizedIps
  - Request comes from 198.51.100.89 (different IP)
  
Expected Behavior:
  - Request IP extracted correctly
  - IP not found in authorized list
  - Request returns 403 Forbidden ❌
  - Logs show: [IP Validation] ❌ DENIED
`, 'gray');

  log('How to test:', 'yellow');
  log(`1. Ensure user has 203.0.113.45 authorized via admin panel

2. Send request from different IP:
   curl -X POST https://senderappbackend.onrender.com/api/email/send \\
     -H "Authorization: Bearer YOUR_TOKEN" \\
     -H "X-Forwarded-For: 198.51.100.89" \\
     -H "Content-Type: application/json" \\
     -d '{"to": "test@example.com", ...}'

3. Check logs:
   ❌ Should see: [IP Validation] ❌ DENIED: Request IPs [198.51.100.89] not in allowed list

4. Response should be 403:
   {
     "message": "Access Denied – Unauthorized IP",
     "requestedIp": "198.51.100.89",
     "allowedIps": ["203.0.113.45"]
   }
`, 'white');

  divider();

  // Scenario 4: No Authorized IPs
  log('SCENARIO 4: User Has No Authorized IPs (Should Fail)', 'blue');
  log('─'.repeat(80), 'gray');
  log(`Prerequisites:
  - User has no IPs in authorizedIps array
  
Expected Behavior:
  - Request returns 403 Forbidden ❌
  - Error indicates no authorized IPs configured
  - Logs show: [IP Validation] ❌ DENIED: User has no authorized IPs configured
`, 'gray');

  log('How to test:', 'yellow');
  log(`1. Create a user without any authorized IPs (or remove all IPs)

2. Send any request:
   curl -X POST https://senderappbackend.onrender.com/api/email/send \\
     -H "Authorization: Bearer YOUR_TOKEN" \\
     -H "Content-Type: application/json" \\
     -d '{"to": "test@example.com", ...}'

3. Check logs:
   ❌ Should see: [IP Validation] ❌ DENIED: User has no authorized IPs configured

4. Response should be 403:
   {
     "message": "Access Denied – Unauthorized IP",
     "error": "No authorized IPs configured for this user"
   }
`, 'white');

  divider();

  // Scenario 5: Localhost without mock (production)
  log('SCENARIO 5: Localhost Request in Production (Should Fail)', 'blue');
  log('─'.repeat(80), 'gray');
  log(`Prerequisites:
  - NODE_ENV=production (dev mocking disabled)
  - User has 203.0.113.45 authorized
  - Request comes from localhost (127.0.0.1)
  
Expected Behavior:
  - No IP mocking applied
  - Request IP is 127.0.0.1
  - IP not in authorized list (only 203.0.113.45)
  - Request returns 403 Forbidden ❌
`, 'gray');

  log('How to test:', 'yellow');
  log(`1. Set environment:
   export NODE_ENV=production
   unset TEST_PUBLIC_IP

2. Restart server:
   npm run dev

3. Send request from localhost (no x-forwarded-for header):
   curl -X POST https://senderappbackend.onrender.com/api/email/send \\
     -H "Authorization: Bearer YOUR_TOKEN" \\
     -H "Content-Type: application/json" \\
     -d '{"to": "test@example.com", ...}'

4. Check logs:
   ❌ Should NOT see: [DEV] IP Mocking
   ❌ Should see: [IP Validation] Parsed Request IPs: ['127.0.0.1']
   ❌ Should see: [IP Validation] ❌ DENIED

5. Response should be 403:
   {
     "message": "Access Denied – Unauthorized IP",
     "requestedIp": "127.0.0.1",
     "allowedIps": ["203.0.113.45"]
   }
`, 'white');

  divider();

  // Debug Information
  log('DEBUG: How to Monitor IP Validation Logs', 'blue');
  log('─'.repeat(80), 'gray');
  log(`When you send a request to any protected endpoint, look for these log patterns:

✅ SUCCESSFUL REQUEST:
   [IP Validation] User: user@example.com
   [IP Validation] Request Headers: { 'x-forwarded-for': '102.89.41.126', ... }
   [IP Validation] Parsed Request IPs: ['102.89.41.126']
   [IP Validation] Allowed IPs: ['102.89.41.126']
   [IP Validation] ✅ ALLOWED: IP 102.89.41.126 found in authorized list

❌ FAILED REQUEST:
   [IP Validation] User: user@example.com
   [IP Validation] Request Headers: { 'x-forwarded-for': '198.51.100.89', ... }
   [IP Validation] Parsed Request IPs: ['198.51.100.89']
   [IP Validation] Allowed IPs: ['203.0.113.45']
   [IP Validation] ❌ DENIED: Request IPs [198.51.100.89] not in allowed list [203.0.113.45]

📝 KEY FIELDS TO CHECK:
   • User: The authenticated user email
   • Request Headers: Shows what's in x-forwarded-for and other IP headers
   • Parsed Request IPs: The extracted client IP in priority order (first = used for validation)
   • Allowed IPs: What IPs should be allowed (from user.authorizedIps)
   • Result: ✅ ALLOWED or ❌ DENIED
`, 'gray');

  divider();

  // Troubleshooting
  log('TROUBLESHOOTING', 'blue');
  log('─'.repeat(80), 'gray');
  log(`Problem: "Still getting Access Denied even though IP is added"
Solution:
  1. Check that IP is properly formatted in database (no spaces/typos)
  2. Verify user.authorizedIps is not empty in logs
  3. Compare exact IP strings - may need to normalize
  4. Restart server after adding IPs
  5. Check admin panel - verify IP was actually saved

Problem: "Dev mocking not working"
Solution:
  1. Verify NODE_ENV=development is set (not production)
  2. Verify TEST_PUBLIC_IP=102.89.41.126 (or your test IP)
  3. Check logs for [DEV] IP Mocking message
  4. Restart server after changing env vars
  5. Verify request is coming from localhost socket

Problem: "All requests failing in production"
Solution:
  1. Confirm NODE_ENV=production (dev mocking disabled)
  2. Verify proxy is sending X-Forwarded-For header
  3. Check what IP logs show vs. what's in authorized list
  4. Add the client IP from logs to authorized IPs
  5. Verify trust proxy setting matches your deployment

Problem: "Can't see any IP validation logs"
Solution:
  1. Make sure request is going to protected endpoint (requires requireAuthorizedIp)
  2. Verify user is authenticated (has valid JWT token)
  3. Check that request has Authorization header
  4. Ensure NODE_ENV is not 'test' which might suppress logs
  5. Try curl with verbose flag: curl -v ...
`, 'yellow');

  divider();

  // Quick reference
  log('QUICK REFERENCE: Protected Endpoints', 'blue');
  log('─'.repeat(80), 'gray');
  log(`POST /api/email/send
  Methods & Middlewares:
    - authenticateToken (JWT required)
    - requireUser (user type required)
    → requireAuthorizedIp (IP validation happens here)

POST /api/email/send-bulk
  Methods & Middlewares:
    - authenticateToken (JWT required)
    - requireUser (user type required)
    → requireAuthorizedIp (IP validation happens here)

POST /api/sms/send
  Methods & Middlewares:
    - authenticateToken (JWT required)
    - requireUser (user type required)
    → requireAuthorizedIp (IP validation happens here)

POST /api/notes/:id/send
  Methods & Middlewares:
    - authenticateToken (JWT required)
    - requireUser (user type required)
    → requireAuthorizedIp (IP validation happens here)

Global Admins:
  - BYPASSED (automatically allowed regardless of IP)
  - Useful for emergency operations
  - Still requires valid global admin JWT token
`, 'gray');

  divider();
  log('✅ All test scenarios documented. Start with Scenario 1 for basic validation.', 'green');
}

// Run the tests
testIpValidation().catch(error => {
  log(`Error: ${error.message}`, 'red');
  process.exit(1);
});
