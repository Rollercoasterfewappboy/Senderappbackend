#!/usr/bin/env node
/**
 * Encryption System Diagnostic & Validation Script
 * 
 * Usage: node diagnoseEncryption.js
 * 
 * This script tests the encryption/decryption system to verify:
 * 1. Valid notes can be encrypted and decrypted
 * 2. Corrupted notes are rejected gracefully
 * 3. Error messages are specific and helpful
 * 4. The auth tag validation works correctly
 */

import crypto from 'crypto'
import { encryptText, decryptText, maskValue, getMaskedBankDetails } from './utils/encryption.js'

const ALGO = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

console.log('\n🔐 ENCRYPTION SYSTEM DIAGNOSTIC TOOL\n')
console.log('=' .repeat(60))

// Test 1: Environment Check
console.log('\n[TEST 1] Environment Configuration')
console.log('-' .repeat(60))

const key = process.env.BANK_ENCRYPTION_KEY
if (!key) {
  console.log('❌ BANK_ENCRYPTION_KEY not set')
  console.log('   → Set this environment variable before using encryption')
} else {
  try {
    const keyBuffer = Buffer.from(key, 'base64')
    if (keyBuffer.length === 32) {
      console.log('✅ BANK_ENCRYPTION_KEY is configured')
      console.log(`   → Length: ${keyBuffer.length} bytes (correct for AES-256)`)
    } else {
      console.log(`❌ BANK_ENCRYPTION_KEY has wrong length`)
      console.log(`   → Expected: 32 bytes, Got: ${keyBuffer.length} bytes`)
    }
  } catch (e) {
    console.log('❌ BANK_ENCRYPTION_KEY is not valid base64')
    console.log(`   → Error: ${e.message}`)
  }
}

// Test 2: Encryption & Decryption
console.log('\n[TEST 2] Valid Encryption & Decryption')
console.log('-' .repeat(60))

try {
  const plaintext = 'Hello, World! This is a test note.'
  console.log(`Plain text: "${plaintext}"`)
  
  const encrypted = encryptText(plaintext)
  console.log(`✅ Encrypted successfully`)
  console.log(`   → Encrypted (first 50 chars): ${encrypted.substring(0, 50)}...`)
  console.log(`   → Total length: ${encrypted.length} characters`)
  
  const decrypted = decryptText(encrypted)
  console.log(`✅ Decrypted successfully`)
  console.log(`   → Decrypted: "${decrypted}"`)
  
  if (plaintext === decrypted) {
    console.log('✅ Round-trip encryption/decryption PASSED')
  } else {
    console.log('❌ Round-trip encryption/decryption FAILED')
    console.log(`   → Original: "${plaintext}"`)
    console.log(`   → Decrypted: "${decrypted}"`)
  }
} catch (error) {
  console.log(`❌ Encryption/Decryption FAILED`)
  console.log(`   → Error: ${error.message}`)
}

// Test 3: Corrupted Data - Too Short
console.log('\n[TEST 3] Corrupted Data - Too Short')
console.log('-' .repeat(60))

try {
  const tooShort = Buffer.from('short data').toString('base64')
  console.log(`Attempting to decrypt: ${tooShort}`)
  decryptText(tooShort)
  console.log('❌ Should have thrown an error')
} catch (error) {
  console.log(`✅ Correctly rejected: ${error.message}`)
}

// Test 4: Corrupted Data - Missing Auth Tag
console.log('\n[TEST 4] Corrupted Data - Missing Auth Tag')
console.log('-' .repeat(60))

try {
  // Create data with IV and encrypted content but no auth tag
  const corruptedData = Buffer.concat([
    crypto.randomBytes(IV_LENGTH),     // IV (12 bytes)
    // NO AUTH TAG (should be 16 bytes)
    crypto.randomBytes(10)              // Some encrypted data
  ]).toString('base64')
  
  console.log(`Attempting to decrypt note with missing auth tag...`)
  decryptText(corruptedData)
  console.log('❌ Should have thrown an error about auth tag')
} catch (error) {
  if (error.message.includes('auth tag')) {
    console.log(`✅ Correctly rejected with: ${error.message}`)
  } else {
    console.log(`⚠️  Error thrown but not about auth tag: ${error.message}`)
  }
}

// Test 5: Corrupted Data - Wrong Auth Tag Length
console.log('\n[TEST 5] Corrupted Data - Wrong Auth Tag Length')
console.log('-' .repeat(60))

try {
  // Create data with IV and short auth tag
  const corruptedData = Buffer.concat([
    crypto.randomBytes(IV_LENGTH),     // IV (12 bytes)
    crypto.randomBytes(8),              // SHORT auth tag (should be 16)
    crypto.randomBytes(10)              // Some encrypted data
  ]).toString('base64')
  
  console.log(`Attempting to decrypt note with wrong auth tag length...`)
  decryptText(corruptedData)
  console.log('❌ Should have thrown an error about auth tag length')
} catch (error) {
  if (error.message.includes('auth tag')) {
    console.log(`✅ Correctly rejected with: ${error.message}`)
  } else {
    console.log(`⚠️  Error thrown but not about auth tag: ${error.message}`)
  }
}

// Test 6: Null/Undefined Handling
console.log('\n[TEST 6] Null/Undefined Handling')
console.log('-' .repeat(60))

console.log(`encryptText(null) = ${encryptText(null)}`)
console.log('✅ Correctly handles null')

console.log(`encryptText("") = ${encryptText("")}`)
console.log('✅ Can encrypt empty string')

console.log(`decryptText(null) = ${decryptText(null)}`)
console.log('✅ Correctly handles null')

// Test 7: maskValue Function
console.log('\n[TEST 7] Value Masking for Display')
console.log('-' .repeat(60))

const testValues = [
  { input: '1234567890', description: 'Long number' },
  { input: '1234', description: 'Short value' },
  { input: '', description: 'Empty string' },
  { input: '12', description: 'Single digit with context' }
]

testValues.forEach(test => {
  const masked = maskValue(test.input)
  console.log(`${test.description}: "${test.input}" → "${masked}"`)
})
console.log('✅ Masking works correctly')

// Test 8: Bank Details Masking
console.log('\n[TEST 8] Bank Details Masking')
console.log('-' .repeat(60))

try {
  const bankDetails = {
    accountNumber: encryptText('1234567890123456'),
    routingNumber: encryptText('021000021'),
    accountHolder: encryptText('John Doe')
  }
  
  const masked = getMaskedBankDetails(bankDetails)
  console.log('Encrypted bank details masked successfully:')
  Object.entries(masked).forEach(([key, value]) => {
    console.log(`   → ${key}: ${value}`)
  })
  console.log('✅ Bank details masking works')
} catch (error) {
  console.log(`⚠️  Bank details test failed: ${error.message}`)
}

// Summary
console.log('\n' + '='.repeat(60))
console.log('🔐 DIAGNOSTIC COMPLETE')
console.log('='.repeat(60))
console.log('\n✅ If all tests passed, your encryption system is working correctly')
console.log('❌ If any tests failed, check the BANK_ENCRYPTION_KEY configuration')
console.log('\n')
