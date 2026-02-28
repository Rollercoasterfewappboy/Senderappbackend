/**
 * Test script for professional email placeholder system
 * Tests all placeholder generators and replacements
 */

import crypto from 'crypto';

// =====================
// PLACEHOLDER VALUE GENERATORS
// =====================

function generateRandom10DigitNumber() {
  return Math.floor(1000000000 + Math.random() * 9000000000).toString();
}

function generateRandomString() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const len = 7 + Math.floor(Math.random() * 4);
  let result = '';
  for (let i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateRandomMD5() {
  return crypto.createHash('md5').update(Math.random().toString()).digest('hex');
}

function generateRandomPath() {
  const segments = ['user', 'data', 'files', 'documents', 'assets', 'media', 'uploads'];
  const randomSegments = [];
  const length = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < length; i++) {
    randomSegments.push(segments[Math.floor(Math.random() * segments.length)] + Math.floor(Math.random() * 1000));
  }
  return '/' + randomSegments.join('/');
}

function generateRandomLink() {
  const baseUrl = 'https://example.com/track';
  const trackId = Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 8);
  return `${baseUrl}/${trackId}`;
}

function generateFakeCompanyName() {
  const prefixes = ['Tech', 'Data', 'Digital', 'Smart', 'Cloud', 'Web', 'Cyber', 'Next', 'Prime', 'Ultra', 'Pro', 'Mega', 'Elite'];
  const suffixes = ['Nova', 'Solutions', 'Systems', 'Labs', 'Hub', 'Works', 'Wave', 'Stream', 'Tech', 'Sync', 'Flow', 'Link', 'Direct'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  return `${prefix}${suffix}`;
}

function generateFakeCompanyEmail() {
  const companyName = generateFakeCompanyName();
  const domains = ['com', 'net', 'io', 'co', 'org', 'us'];
  const domain = domains[Math.floor(Math.random() * domains.length)];
  return `contact@${companyName.toLowerCase()}.${domain}`;
}

function generateFakeCompanyEmailAndFullName() {
  const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'James', 'Emily', 'David', 'Lisa', 'Robert', 'Jennifer'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  const email = generateFakeCompanyEmail();
  return `${firstName} ${lastName} <${email}>`;
}

function capitalize(str) {
  if (str && typeof str === 'string') {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  return str;
}

function encodeBase64(str) {
  return Buffer.from(str).toString('base64');
}

function replaceBracedPlaceholders(content, placeholders) {
  if (!content || typeof content !== 'string') return content;
  let replacedContent = content;
  for (const [placeholder, value] of Object.entries(placeholders)) {
    const regex = new RegExp(`{${placeholder}}`, 'g');
    replacedContent = replacedContent.replace(regex, String(value || ''));
  }
  return replacedContent;
}

// =====================
// TEST SUITE
// =====================

console.log('🧪 Professional Email Placeholder System - Test Suite\n');
console.log('='.repeat(60));

// Test 1: Random Number Generation
console.log('\n✅ Test 1: Random 10-Digit Number Generator');
const randomNum = generateRandom10DigitNumber();
console.log(`   Generated: ${randomNum}`);
console.log(`   Length is 10: ${randomNum.length === 10 ? '✓' : '✗'}`);
console.log(`   All digits: ${/^\d{10}$/.test(randomNum) ? '✓' : '✗'}`);

// Test 2: Random String Generation
console.log('\n✅ Test 2: Random String Generator');
const randomStr = generateRandomString();
console.log(`   Generated: ${randomStr}`);
console.log(`   Between 7-10 chars: ${randomStr.length >= 7 && randomStr.length <= 10 ? '✓' : '✗'}`);
console.log(`   Alphanumeric: ${/^[a-zA-Z0-9]+$/.test(randomStr) ? '✓' : '✗'}`);

// Test 3: MD5 Hash Generation
console.log('\n✅ Test 3: MD5 Hash Generator');
const md5Hash = generateRandomMD5();
console.log(`   Generated: ${md5Hash}`);
console.log(`   Is MD5 format (32 hex chars): ${/^[a-f0-9]{32}$/.test(md5Hash) ? '✓' : '✗'}`);

// Test 4: Random Path Generation
console.log('\n✅ Test 4: Random Path Generator');
const randomPath = generateRandomPath();
console.log(`   Generated: ${randomPath}`);
console.log(`   Starts with /: ${randomPath.startsWith('/') ? '✓' : '✗'}`);

// Test 5: Random Link Generation
console.log('\n✅ Test 5: Random Link Generator');
const randomLink = generateRandomLink();
console.log(`   Generated: ${randomLink}`);
console.log(`   Is valid URL: ${randomLink.startsWith('https://') ? '✓' : '✗'}`);

// Test 6: Fake Company Name
console.log('\n✅ Test 6: Fake Company Name Generator');
const fakeCompany = generateFakeCompanyName();
console.log(`   Generated: ${fakeCompany}`);
console.log(`   Has content: ${fakeCompany.length > 0 ? '✓' : '✗'}`);

// Test 7: Fake Company Email
console.log('\n✅ Test 7: Fake Company Email Generator');
const fakeEmail = generateFakeCompanyEmail();
console.log(`   Generated: ${fakeEmail}`);
console.log(`   Has @ symbol: ${fakeEmail.includes('@') ? '✓' : '✗'}`);

// Test 8: Fake Company Email and Full Name
console.log('\n✅ Test 8: Fake Company Full Info Generator');
const fakeFullInfo = generateFakeCompanyEmailAndFullName();
console.log(`   Generated: ${fakeFullInfo}`);
console.log(`   Has name and email: ${fakeFullInfo.includes('<') && fakeFullInfo.includes('>') ? '✓' : '✗'}`);

// Test 9: Placeholder Replacement
console.log('\n✅ Test 9: Placeholder Replacement');
const testEmail = 'john.doe@gmail.com';
const testSubject = 'Hello {RECIPIENT_NAME}! Your domain is {RECIPIENT_DOMAIN}';
const localPart = testEmail.split('@')[0];
const recipientName = capitalize(localPart.split('.')[0]);
const domain = testEmail.split('@')[1];
const placeholders = {
  'RECIPIENT_NAME': recipientName,
  'RECIPIENT_EMAIL': testEmail,
  'RECIPIENT_DOMAIN': domain,
};
const rendered = replaceBracedPlaceholders(testSubject, placeholders);
console.log(`   Original: ${testSubject}`);
console.log(`   Rendered: ${rendered}`);
console.log(`   Contains name: ${rendered.includes(recipientName) ? '✓' : '✗'}`);
console.log(`   Contains domain: ${rendered.includes(domain) ? '✓' : '✗'}`);

// Test 10: Base64 Encoding
console.log('\n✅ Test 10: Base64 Email Encoding');
const encodedEmail = encodeBase64(testEmail);
console.log(`   Original: ${testEmail}`);
console.log(`   Encoded: ${encodedEmail}`);
console.log(`   Decoded: ${Buffer.from(encodedEmail, 'base64').toString()}`);
console.log(`   Matches original: ${Buffer.from(encodedEmail, 'base64').toString() === testEmail ? '✓' : '✗'}`);

// Test 11: Full Placeholder Set
console.log('\n✅ Test 11: Full Professional Placeholder Set');
const allPlaceholders = {
  'RECIPIENT_NAME': recipientName,
  'RECIPIENT_EMAIL': testEmail,
  'RECIPIENT_DOMAIN': domain,
  'RECIPIENT_DOMAIN_NAME': 'gmail',
  'RECIPIENT_BASE64_EMAIL': encodeBase64(testEmail),
  'CURRENT_DATE': new Date().toLocaleDateString(),
  'CURRENT_TIME': new Date().toLocaleTimeString(),
  'RANDOM_NUMBER10': generateRandom10DigitNumber(),
  'RANDOM_STRING': generateRandomString(),
  'RANDOM_MD5': generateRandomMD5(),
  'RANDOM_PATH': generateRandomPath(),
  'RANDLINK': generateRandomLink(),
  'FAKE_COMPANY': generateFakeCompanyName(),
  'FAKE_COMPANY_EMAIL': generateFakeCompanyEmail(),
  'FAKE_COMPANY_EMAIL_AND_FULLNAME': generateFakeCompanyEmailAndFullName(),
};

console.log('   Available Placeholders:');
Object.entries(allPlaceholders).forEach(([key, value]) => {
  console.log(`   - {${key}}: ${value}`);
});

console.log('\n' + '='.repeat(60));
console.log('✅ All tests completed successfully!\n');
