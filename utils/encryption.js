// Encryption support has been retired. All functions are now no-ops
// and the BANK_ENCRYPTION_KEY environment variable is no longer used.
// This keeps the API stable but entirely bypasses crypto.

export const encryptText = (plaintext) => {
  // preserve null/undefined semantics
  if (plaintext === null || typeof plaintext === 'undefined') return null
  return String(plaintext)
}

export const decryptText = (payload) => {
  // simply return whatever was passed (handles null/undefined too)
  return payload
}

export const isEncrypted = (_payload) => {
  // nothing is ever considered encrypted now
  return false
}

export const maskValue = (value) => {
  try {
    if (!value) return ''
    const s = String(value)
    const len = s.length
    if (len <= 4) return '*'.repeat(len)
    return '*'.repeat(Math.max(4, len - 4)) + s.slice(-4)
  } catch (err) {
    return '****'
  }
}

export const getMaskedBankDetails = (encryptedBankDetails = {}) => {
  if (!encryptedBankDetails) return {}
  const out = {}
  for (const [k, v] of Object.entries(encryptedBankDetails)) {
    if (!v) continue
    try {
      const dec = decryptText(v)
      out[k] = maskValue(dec)
    } catch (err) {
      out[k] = '****'
    }
  }
  return out
}

// =====================
// PAYSTACK CREDENTIAL ENCRYPTION
// =====================

export const encryptPaystackCredentials = (publicKey, secretKey) => {
  if (!publicKey || !secretKey) return null
  return {
    publicKey,
    secretKey,
    encrypted: false,
    encryptedAt: new Date().toISOString()
  }
}

export const decryptPaystackSecret = (encryptedSecret) => {
  if (!encryptedSecret) return null
  return encryptedSecret
}

// =====================
// TELEGRAM CREDENTIAL ENCRYPTION
// =====================

export const encryptTelegramCredentials = (botToken, chatId) => {
  if (!botToken || !chatId) return null
  return {
    botToken,
    chatId,
    encrypted: false,
    encryptedAt: new Date().toISOString()
  }
}

export const decryptTelegramCredentials = (encryptedBotToken, encryptedChatId) => {
  if (!encryptedBotToken || !encryptedChatId) return null
  return {
    botToken: encryptedBotToken,
    chatId: encryptedChatId
  }
}












// import crypto from 'crypto'

// const ALGO = 'aes-256-gcm'
// const IV_LENGTH = 12 // 96 bits for GCM
// const TAG_LENGTH = 16

// if (!process.env.BANK_ENCRYPTION_KEY) {
//   console.error('Missing BANK_ENCRYPTION_KEY environment variable')
// }

// // Accept base64 encoded 32-byte key
// const getKey = () => {
//   const k = process.env.BANK_ENCRYPTION_KEY || ''
//   try {
//     return Buffer.from(k, 'base64')
//   } catch (err) {
//     return Buffer.from(k)
//   }
// }

// export const encryptText = (plaintext) => {
//   if (plaintext === null || typeof plaintext === 'undefined') return null
//   const key = getKey()
//   if (!key || key.length !== 32) throw new Error('Invalid BANK_ENCRYPTION_KEY; must be 32 bytes (base64)')

//   const iv = crypto.randomBytes(IV_LENGTH)
//   const cipher = crypto.createCipheriv(ALGO, key, iv)
//   const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
//   const tag = cipher.getAuthTag()

//   // Store as base64(iv|tag|encrypted)
//   return Buffer.concat([iv, tag, encrypted]).toString('base64')
// }

// export const decryptText = (payload) => {
//   if (!payload) return null
//   const key = getKey()
//   if (!key || key.length !== 32) throw new Error('Invalid BANK_ENCRYPTION_KEY; must be 32 bytes (base64)')

//   try {
//     // Validate payload is a string or buffer
//     if (typeof payload !== 'string') {
//       return String(payload)
//     }

//     // Try to decode from base64
//     let data
//     try {
//       data = Buffer.from(payload, 'base64')
//     } catch (error) {
//       // If base64 decoding fails, return as plain text (legacy data)
//       return payload
//     }

//     // Validate that we have enough data for IV + TAG + some encrypted content
//     const minLength = IV_LENGTH + TAG_LENGTH + 1
//     if (data.length < minLength) {
//       // Data is too short to be validly encrypted, treat as plain text (legacy data)
//       return payload
//     }

//     const iv = data.slice(0, IV_LENGTH)
//     const tag = data.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
//     const encrypted = data.slice(IV_LENGTH + TAG_LENGTH)

//     // Validate IV
//     if (!iv || iv.length !== IV_LENGTH) {
//       return payload
//     }

//     // Validate tag - must have exactly TAG_LENGTH bytes
//     if (!tag || tag.length !== TAG_LENGTH) {
//       return payload
//     }

//     // Validate encrypted content exists
//     if (!encrypted || encrypted.length === 0) {
//       return payload
//     }

//     const decipher = crypto.createDecipheriv(ALGO, key, iv)
//     decipher.setAuthTag(tag)
//     const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
//     return decrypted
//   } catch (error) {
//     // Catch all decryption errors and return original payload as fallback
//     // This handles auth tag failures, corrupted data, and other crypto errors
//     return payload
//   }
// }

// // Helper: Check if a string appears to be valid encrypted data (base64, correct length)
// export const isEncrypted = (payload) => {
//   if (!payload || typeof payload !== 'string') return false
//   try {
//     const data = Buffer.from(payload, 'base64')
//     const minLength = IV_LENGTH + TAG_LENGTH + 1
//     return data.length >= minLength
//   } catch (err) {
//     return false
//   }
// }

// // Mask value for display: keep last 4 characters if possible
// export const maskValue = (value) => {
//   try {
//     if (!value) return ''
//     const s = String(value)
//     const len = s.length
//     if (len <= 4) return '*'.repeat(len)
//     return '*'.repeat(Math.max(4, len - 4)) + s.slice(-4)
//   } catch (err) {
//     return '****'
//   }
// }

// // Decrypt object fields and return masked object
// export const getMaskedBankDetails = (encryptedBankDetails = {}) => {
//   if (!encryptedBankDetails) return {}
//   const out = {}
//   for (const [k, v] of Object.entries(encryptedBankDetails)) {
//     if (!v) continue
//     try {
//       const dec = decryptText(v)
//       out[k] = maskValue(dec)
//     } catch (err) {
//       // If decryption fails, fallback to a generic mask to avoid leaking info
//       out[k] = '****'
//     }
//   }
//   return out
// }
// // =====================
// // PAYSTACK CREDENTIAL ENCRYPTION
// // =====================

// export const encryptPaystackCredentials = (publicKey, secretKey) => {
//   if (!publicKey || !secretKey) return null
//   try {
//     return {
//       publicKey: encryptText(publicKey),
//       secretKey: encryptText(secretKey),
//       encrypted: true,
//       encryptedAt: new Date().toISOString()
//     }
//   } catch (error) {
//     console.error('Error encrypting Paystack credentials:', error)
//     throw new Error('Failed to encrypt payment credentials')
//   }
// }

// export const decryptPaystackSecret = (encryptedSecret) => {
//   if (!encryptedSecret) return null
//   try {
//     return decryptText(encryptedSecret)
//   } catch (error) {
//     console.error('Error decrypting Paystack secret:', error)
//     throw new Error('Failed to decrypt payment credentials')
//   }
// }

// // =====================
// // TELEGRAM CREDENTIAL ENCRYPTION
// // =====================

// export const encryptTelegramCredentials = (botToken, chatId) => {
//   if (!botToken || !chatId) return null
//   try {
//     return {
//       botToken: encryptText(botToken),
//       chatId: encryptText(chatId),
//       encrypted: true,
//       encryptedAt: new Date().toISOString()
//     }
//   } catch (error) {
//     console.error('Error encrypting Telegram credentials:', error)
//     throw new Error('Failed to encrypt notification credentials')
//   }
// }

// export const decryptTelegramCredentials = (encryptedBotToken, encryptedChatId) => {
//   if (!encryptedBotToken || !encryptedChatId) return null
//   try {
//     return {
//       botToken: decryptText(encryptedBotToken),
//       chatId: decryptText(encryptedChatId)
//     }
//   } catch (error) {
//     console.error('Error decrypting Telegram credentials:', error)
//     throw new Error('Failed to decrypt notification credentials')
//   }
// }

