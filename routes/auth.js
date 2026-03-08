

import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import User from '../models/User.js'
import { authenticateToken } from '../middleware/auth.js'
import { getMaskedBankDetails } from '../utils/encryption.js'

const router = express.Router()



// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    // Find user
    const user = await User.findOne({ email, isDeleted: false })
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' })
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(400).json({ message: 'Account is disabled. Please contact support.' })
    }

    // Check if email is confirmed
    if (!user.isEmailConfirmed) {
      return res.status(400).json({ message: 'Please confirm your email address before logging in' })
    }

    // Check password
    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' })
    }

    // Update last login
    user.lastLogin = new Date()
    await user.save()

    // Generate token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        profileImage: user.profileImage,
        isEmailConfirmed: user.isEmailConfirmed,
        adminConfig: {
          isAdmin: user.adminConfig.isAdmin,
          defaultCurrency: user.adminConfig.defaultCurrency
        },
        preferredCurrency: user.preferredCurrency
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ message: 'Login failed', error: error.message })
  }
})

// Forgot password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body

    const user = await User.findOne({ email, isDeleted: false })
    if (!user) {
      return res.status(404).json({ message: 'User not found with this email address' })
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex')
    user.passwordResetToken = resetToken
    user.passwordResetExpires = Date.now() + 3600000 // 1 hour
    await user.save()

    // Send reset email
    await sendPasswordResetEmail(email, resetToken)

    res.json({ message: 'Password reset link sent to your email' })
  } catch (error) {
    console.error('Forgot password error:', error)
    res.status(500).json({ message: 'Error sending password reset email', error: error.message })
  }
})

// Reset password
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params
    const { password } = req.body

    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetExpires: { $gt: Date.now() },
      isDeleted: false
    })

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' })
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' })
    }

    user.password = password
    user.passwordResetToken = undefined
    user.passwordResetExpires = undefined
    await user.save()

    res.json({ message: 'Password reset successfully' })
  } catch (error) {
    console.error('Reset password error:', error)
    res.status(500).json({ message: 'Error resetting password', error: error.message })
  }
})

// Search users (public endpoint) - Enhanced with profile and billing info


// Smart user search (like Yelp/Google style)
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query

    if (!q || q.trim().length < 2) {
      return res.json({ users: [] })
    }

    const terms = q.trim().toLowerCase().split(/\s+/) // split into words
    const conditions = terms.map(term => {
      const regex = new RegExp(term, 'i') // case-insensitive partial match
      return {
        $or: [
          { firstName: regex },
          { lastName: regex },
          { email: regex },
          { 'businessInfo.businessName': regex },
          { 'businessInfo.description': regex },
          { 'businessInfo.address': regex },
          { 'businessInfo.phoneNumber': regex },
          { 'billingAddress.street': regex },
          { 'billingAddress.city': regex },
          { 'billingAddress.state': regex },
          { 'billingAddress.country': regex },
        ]
      }
    })

    const users = await User.find({
      isDeleted: false,
      isActive: true,
      isEmailConfirmed: true,
      $and: conditions // every word must match somewhere
    })
    .select('firstName lastName email businessInfo profileImage isRecommended billingAddress')
    .limit(20)
    .sort({ isRecommended: -1, firstName: 1 })

    res.json({ users })
  } catch (error) {
    console.error('Search error:', error)
    res.status(500).json({ message: 'Search failed', error: error.message })
  }
})


// router.get('/search', async (req, res) => {
//   try {
//     const { q } = req.query
    
//     if (!q || q.trim().length < 2) {
//       return res.json({ users: [] })
//     }

//     const searchRegex = new RegExp(q.trim(), 'i')
    
//     const users = await User.find({
//       isDeleted: false,
//       isActive: true,
//       isEmailConfirmed: true,
//       $or: [
//         { firstName: searchRegex },
//         { lastName: searchRegex },
//         { email: searchRegex },
//         { 'businessInfo.businessName': searchRegex }
//       ]
//     })
//     .select('firstName lastName email businessInfo profileImage isRecommended billingAddress')
//     .limit(20)
//     .sort({ isRecommended: -1, firstName: 1 })

//     res.json({ users })
//   } catch (error) {
//     console.error('Search error:', error)
//     res.status(500).json({ message: 'Search failed', error: error.message })


// Confirm email
router.post('/confirm-email/:token', async (req, res) => {
  try {
    const { token } = req.params

    const user = await User.findOne({ emailConfirmToken: token })
    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired confirmation token' })
    }

    user.isEmailConfirmed = true
    user.emailConfirmToken = null
    await user.save()

    res.json({ message: 'Email confirmed successfully! You can now log in.' })
  } catch (error) {
    console.error('Email confirmation error:', error)
    res.status(500).json({ message: 'Email confirmation failed', error: error.message })
  }
})

// Get profile
import { encryptText, decryptText, isEncrypted } from '../utils/encryption.js'

router.get('/profile', authenticateToken, async (req, res) => {
  // Migrate any plaintext bank fields to encrypted form (run once per field) without logging plaintext
  let needsSave = false
  try {
    if (req.user && req.user.bankDetails) {
      for (const [k, v] of Object.entries(req.user.bankDetails)) {
        if (!v) continue
        // If the value doesn't look encrypted, encrypt it
        if (!isEncrypted(v)) {
          try {
            req.user.bankDetails[k] = encryptText(v)
            needsSave = true
          } catch (e) {
            // encryption failed - ignore but do not leak
          }
        }
      }
      if (needsSave) {
        await req.user.save()
      }
    }
  } catch (e) {
    // swallow migration errors silently
  }

  // Only return masked bank details (never raw decrypted values) and only to User Admins
  const maskedBankDetails = req.user.adminConfig?.isAdmin ? getMaskedBankDetails(req.user.bankDetails || {}) : {}

  res.json({
    user: {
      id: req.user._id,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      email: req.user.email,
      profileImage: req.user.profileImage,
      bankDetails: maskedBankDetails,
      billingAddress: req.user.billingAddress,
      businessInfo: req.user.businessInfo,
      isRecommended: req.user.isRecommended,
      adminConfig: {
        isAdmin: req.user.adminConfig.isAdmin,
        defaultCurrency: req.user.adminConfig.defaultCurrency,
        notepadEnabled: req.user.adminConfig.notepadEnabled || false
      },
      preferredCurrency: req.user.preferredCurrency,
      preferredTimezone: req.user.preferredTimezone || 'UTC',
      isPremium: req.user.isPremium
    }
  })
})

// Update user profile (timezone, currency preferences, etc.)
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { preferredTimezone, preferredCurrency } = req.body
    
    // Validate timezone if provided
    if (preferredTimezone) {
      // Basic validation: timezone should be a valid IANA timezone
      // A more complete validation would check against a list of valid timezones
      const validTimezonePattern = /^[A-Za-z_]+\/[A-Za-z_]+$|^UTC$|^Etc\/[A-Za-z_]+$/
      if (!validTimezonePattern.test(preferredTimezone)) {
        return res.status(400).json({ message: 'Invalid timezone format' })
      }
      req.user.preferredTimezone = preferredTimezone
    }
    
    // Update currency if provided
    if (preferredCurrency) {
      req.user.preferredCurrency = preferredCurrency
    }
    
    await req.user.save()
    
    res.json({
      user: {
        id: req.user._id,
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        email: req.user.email,
        profileImage: req.user.profileImage,
        bankDetails: req.user.adminConfig?.isAdmin ? getMaskedBankDetails(req.user.bankDetails || {}) : {},
        billingAddress: req.user.billingAddress,
        businessInfo: req.user.businessInfo,
        isRecommended: req.user.isRecommended,
        adminConfig: {
          isAdmin: req.user.adminConfig.isAdmin,
          defaultCurrency: req.user.adminConfig.defaultCurrency
        },
        preferredCurrency: req.user.preferredCurrency,
        preferredTimezone: req.user.preferredTimezone || 'UTC'
      }
    })
  } catch (error) {
    console.error('Error updating profile:', error)
    res.status(500).json({ message: 'Error updating profile' })
  }
})

export default router










// import express from 'express'
// import jwt from 'jsonwebtoken'
// import crypto from 'crypto'
// import User from '../models/User.js'
// import { authenticateToken } from '../middleware/auth.js'
// import { sendConfirmationEmail, sendPasswordResetEmail } from '../utils/email.js'
// import { getMaskedBankDetails } from '../utils/encryption.js'

// const router = express.Router()



// // Login
// router.post('/login', async (req, res) => {
//   try {
//     const { email, password } = req.body

//     // Find user
//     const user = await User.findOne({ email, isDeleted: false })
//     if (!user) {
//       return res.status(400).json({ message: 'Invalid credentials' })
//     }

//     // Check if account is active
//     if (!user.isActive) {
//       return res.status(400).json({ message: 'Account is disabled. Please contact support.' })
//     }

//     // Check if email is confirmed
//     if (!user.isEmailConfirmed) {
//       return res.status(400).json({ message: 'Please confirm your email address before logging in' })
//     }

//     // Check password
//     const isMatch = await user.comparePassword(password)
//     if (!isMatch) {
//       return res.status(400).json({ message: 'Invalid credentials' })
//     }

//     // Update last login
//     user.lastLogin = new Date()
//     await user.save()

//     // Generate token
//     const token = jwt.sign(
//       { userId: user._id, email: user.email },
//       process.env.JWT_SECRET,
//       { expiresIn: '7d' }
//     )

//     res.json({
//       message: 'Login successful',
//       token,
//       user: {
//         id: user._id,
//         firstName: user.firstName,
//         lastName: user.lastName,
//         email: user.email,
//         profileImage: user.profileImage,
//         isEmailConfirmed: user.isEmailConfirmed,
//         adminConfig: {
//           isAdmin: user.adminConfig.isAdmin,
//           defaultCurrency: user.adminConfig.defaultCurrency
//         },
//         preferredCurrency: user.preferredCurrency
//       }
//     })
//   } catch (error) {
//     console.error('Login error:', error)
//     res.status(500).json({ message: 'Login failed', error: error.message })
//   }
// })

// // Forgot password
// router.post('/forgot-password', async (req, res) => {
//   try {
//     const { email } = req.body

//     const user = await User.findOne({ email, isDeleted: false })
//     if (!user) {
//       return res.status(404).json({ message: 'User not found with this email address' })
//     }

//     // Generate reset token
//     const resetToken = crypto.randomBytes(32).toString('hex')
//     user.passwordResetToken = resetToken
//     user.passwordResetExpires = Date.now() + 3600000 // 1 hour
//     await user.save()

//     // Send reset email
//     await sendPasswordResetEmail(email, resetToken)

//     res.json({ message: 'Password reset link sent to your email' })
//   } catch (error) {
//     console.error('Forgot password error:', error)
//     res.status(500).json({ message: 'Error sending password reset email', error: error.message })
//   }
// })

// // Reset password
// router.post('/reset-password/:token', async (req, res) => {
//   try {
//     const { token } = req.params
//     const { password } = req.body

//     const user = await User.findOne({
//       passwordResetToken: token,
//       passwordResetExpires: { $gt: Date.now() },
//       isDeleted: false
//     })

//     if (!user) {
//       return res.status(400).json({ message: 'Invalid or expired reset token' })
//     }

//     if (password.length < 6) {
//       return res.status(400).json({ message: 'Password must be at least 6 characters long' })
//     }

//     user.password = password
//     user.passwordResetToken = undefined
//     user.passwordResetExpires = undefined
//     await user.save()

//     res.json({ message: 'Password reset successfully' })
//   } catch (error) {
//     console.error('Reset password error:', error)
//     res.status(500).json({ message: 'Error resetting password', error: error.message })
//   }
// })

// // Search users (public endpoint) - Enhanced with profile and billing info


// // Smart user search (like Yelp/Google style)
// router.get('/search', async (req, res) => {
//   try {
//     const { q } = req.query

//     if (!q || q.trim().length < 2) {
//       return res.json({ users: [] })
//     }

//     const terms = q.trim().toLowerCase().split(/\s+/) // split into words
//     const conditions = terms.map(term => {
//       const regex = new RegExp(term, 'i') // case-insensitive partial match
//       return {
//         $or: [
//           { firstName: regex },
//           { lastName: regex },
//           { email: regex },
//           { 'businessInfo.businessName': regex },
//           { 'businessInfo.description': regex },
//           { 'businessInfo.address': regex },
//           { 'businessInfo.phoneNumber': regex },
//           { 'billingAddress.street': regex },
//           { 'billingAddress.city': regex },
//           { 'billingAddress.state': regex },
//           { 'billingAddress.country': regex },
//         ]
//       }
//     })

//     const users = await User.find({
//       isDeleted: false,
//       isActive: true,
//       isEmailConfirmed: true,
//       $and: conditions // every word must match somewhere
//     })
//     .select('firstName lastName email businessInfo profileImage isRecommended billingAddress')
//     .limit(20)
//     .sort({ isRecommended: -1, firstName: 1 })

//     res.json({ users })
//   } catch (error) {
//     console.error('Search error:', error)
//     res.status(500).json({ message: 'Search failed', error: error.message })
//   }
// })


// // router.get('/search', async (req, res) => {
// //   try {
// //     const { q } = req.query
    
// //     if (!q || q.trim().length < 2) {
// //       return res.json({ users: [] })
// //     }

// //     const searchRegex = new RegExp(q.trim(), 'i')
    
// //     const users = await User.find({
// //       isDeleted: false,
// //       isActive: true,
// //       isEmailConfirmed: true,
// //       $or: [
// //         { firstName: searchRegex },
// //         { lastName: searchRegex },
// //         { email: searchRegex },
// //         { 'businessInfo.businessName': searchRegex }
// //       ]
// //     })
// //     .select('firstName lastName email businessInfo profileImage isRecommended billingAddress')
// //     .limit(20)
// //     .sort({ isRecommended: -1, firstName: 1 })

// //     res.json({ users })
// //   } catch (error) {
// //     console.error('Search error:', error)
// //     res.status(500).json({ message: 'Search failed', error: error.message })


// // Confirm email
// router.post('/confirm-email/:token', async (req, res) => {
//   try {
//     const { token } = req.params

//     const user = await User.findOne({ emailConfirmToken: token })
//     if (!user) {
//       return res.status(400).json({ message: 'Invalid or expired confirmation token' })
//     }

//     user.isEmailConfirmed = true
//     user.emailConfirmToken = null
//     await user.save()

//     res.json({ message: 'Email confirmed successfully! You can now log in.' })
//   } catch (error) {
//     console.error('Email confirmation error:', error)
//     res.status(500).json({ message: 'Email confirmation failed', error: error.message })
//   }
// })

// // Get profile
// import { encryptText, decryptText, isEncrypted } from '../utils/encryption.js'

// router.get('/profile', authenticateToken, async (req, res) => {
//   // Migrate any plaintext bank fields to encrypted form (run once per field) without logging plaintext
//   let needsSave = false
//   try {
//     if (req.user && req.user.bankDetails) {
//       for (const [k, v] of Object.entries(req.user.bankDetails)) {
//         if (!v) continue
//         // If the value doesn't look encrypted, encrypt it
//         if (!isEncrypted(v)) {
//           try {
//             req.user.bankDetails[k] = encryptText(v)
//             needsSave = true
//           } catch (e) {
//             // encryption failed - ignore but do not leak
//           }
//         }
//       }
//       if (needsSave) {
//         await req.user.save()
//       }
//     }
//   } catch (e) {
//     // swallow migration errors silently
//   }

//   // Only return masked bank details (never raw decrypted values) and only to User Admins
//   const maskedBankDetails = req.user.adminConfig?.isAdmin ? getMaskedBankDetails(req.user.bankDetails || {}) : {}

//   res.json({
//     user: {
//       id: req.user._id,
//       firstName: req.user.firstName,
//       lastName: req.user.lastName,
//       email: req.user.email,
//       profileImage: req.user.profileImage,
//       bankDetails: maskedBankDetails,
//       billingAddress: req.user.billingAddress,
//       businessInfo: req.user.businessInfo,
//       isRecommended: req.user.isRecommended,
//       adminConfig: {
//         isAdmin: req.user.adminConfig.isAdmin,
//         defaultCurrency: req.user.adminConfig.defaultCurrency
//       },
//       preferredCurrency: req.user.preferredCurrency,
//       preferredTimezone: req.user.preferredTimezone || 'UTC',
//       isPremium: req.user.isPremium
//     }
//   })
// })

// // Update user profile (timezone, currency preferences, etc.)
// router.put('/profile', authenticateToken, async (req, res) => {
//   try {
//     const { preferredTimezone, preferredCurrency } = req.body
    
//     // Validate timezone if provided
//     if (preferredTimezone) {
//       // Basic validation: timezone should be a valid IANA timezone
//       // A more complete validation would check against a list of valid timezones
//       const validTimezonePattern = /^[A-Za-z_]+\/[A-Za-z_]+$|^UTC$|^Etc\/[A-Za-z_]+$/
//       if (!validTimezonePattern.test(preferredTimezone)) {
//         return res.status(400).json({ message: 'Invalid timezone format' })
//       }
//       req.user.preferredTimezone = preferredTimezone
//     }
    
//     // Update currency if provided
//     if (preferredCurrency) {
//       req.user.preferredCurrency = preferredCurrency
//     }
    
//     await req.user.save()
    
//     res.json({
//       user: {
//         id: req.user._id,
//         firstName: req.user.firstName,
//         lastName: req.user.lastName,
//         email: req.user.email,
//         profileImage: req.user.profileImage,
//         bankDetails: req.user.adminConfig?.isAdmin ? getMaskedBankDetails(req.user.bankDetails || {}) : {},
//         billingAddress: req.user.billingAddress,
//         businessInfo: req.user.businessInfo,
//         isRecommended: req.user.isRecommended,
//         adminConfig: {
//           isAdmin: req.user.adminConfig.isAdmin,
//           defaultCurrency: req.user.adminConfig.defaultCurrency
//         },
//         preferredCurrency: req.user.preferredCurrency,
//         preferredTimezone: req.user.preferredTimezone || 'UTC'
//       }
//     })
//   } catch (error) {
//     console.error('Error updating profile:', error)
//     res.status(500).json({ message: 'Error updating profile' })
//   }
// })

// export default router
