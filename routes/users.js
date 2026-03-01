import express from 'express'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import { v2 as cloudinary } from 'cloudinary'
import User from '../models/User.js'
import { authenticateToken, requireUser } from '../middleware/auth.js'

const router = express.Router()

// ---------------------
// Cloudinary config
// ---------------------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})

// ---------------------
// Multer config
// ---------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
})

// =====================
// UPDATE PROFILE
// =====================
router.put(
  '/profile',
  authenticateToken,
  requireUser,
  upload.single('profileImage'),
  async (req, res) => {
    try {
      const { firstName, lastName, profileImageUrl } = req.body
      const user = req.user
      let profileImageUploadUrl = user.profileImage

      if (req.file) {
        const result = await new Promise((resolve, reject) => {
          cloudinary.uploader
            .upload_stream(
              {
                resource_type: 'image',
                folder: 'marketbook-profiles',
                transformation: [
                  { width: 200, height: 200, crop: 'fill' },
                  { quality: 'auto' }
                ]
              },
              (error, result) => (error ? reject(error) : resolve(result))
            )
            .end(req.file.buffer)
        })
        profileImageUploadUrl = result.secure_url
      } else if (profileImageUrl) {
        profileImageUploadUrl = profileImageUrl
      }

      user.firstName = firstName || user.firstName
      user.lastName = lastName || user.lastName
      user.profileImage = profileImageUploadUrl
      await user.save()

      res.json({ message: 'Profile updated successfully', user: user.toObject() })
    } catch (error) {
      console.error('Profile update error:', error)
      res.status(500).json({ message: 'Error updating profile' })
    }
  }
)

// =====================
// CHANGE PASSWORD
// =====================
router.put('/change-password', authenticateToken, requireUser, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Missing required fields' })
    }

    const user = await User.findById(req.user._id).select('+password')
    if (!user) return res.status(404).json({ message: 'User not found' })

    const isMatch = await bcrypt.compare(currentPassword, user.password)
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password incorrect' })
    }

    user.password = newPassword
    await user.save()

    res.json({ message: 'Password changed successfully' })
  } catch (error) {
    console.error('Change password error:', error)
    res.status(500).json({ message: 'Error changing password' })
  }
})

export default router





















// import express from 'express'
// import multer from 'multer'
// import bcrypt from 'bcryptjs'
// import { v2 as cloudinary } from 'cloudinary'
// import User from '../models/User.js'
// import { authenticateToken, requireUser } from '../middleware/auth.js'
// import { encryptText, getMaskedBankDetails } from '../utils/encryption.js'

// const router = express.Router()

// // ---------------------
// // Cloudinary config
// // ---------------------
// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET
// })

// // ---------------------
// // Multer config
// // ---------------------
// const upload = multer({
//   storage: multer.memoryStorage(),
//   limits: { fileSize: 5 * 1024 * 1024 }
// })

// // =====================
// // UPDATE PROFILE
// // =====================
// router.put(
//   '/profile',
//   authenticateToken,
//   requireUser,
//   upload.single('profileImage'),
//   async (req, res) => {
//     try {
//       const { firstName, lastName, profileImageUrl } = req.body
//       const user = req.user
//       let profileImageUploadUrl = user.profileImage

//       if (req.file) {
//         const result = await new Promise((resolve, reject) => {
//           cloudinary.uploader
//             .upload_stream(
//               {
//                 resource_type: 'image',
//                 folder: 'marketbook-profiles',
//                 transformation: [
//                   { width: 200, height: 200, crop: 'fill' },
//                   { quality: 'auto' }
//                 ]
//               },
//               (error, result) => (error ? reject(error) : resolve(result))
//             )
//             .end(req.file.buffer)
//         })
//         profileImageUploadUrl = result.secure_url
//       } else if (profileImageUrl) {
//         profileImageUploadUrl = profileImageUrl
//       }

//       user.firstName = firstName || user.firstName
//       user.lastName = lastName || user.lastName
//       user.profileImage = profileImageUploadUrl
//       await user.save()

//       const safeUser = user.toObject()
//       safeUser.bankDetails = user.adminConfig?.isAdmin
//         ? getMaskedBankDetails(user.bankDetails || {})
//         : {}

//       res.json({ message: 'Profile updated successfully', user: safeUser })
//     } catch (error) {
//       console.error('Profile update error:', error)
//       res.status(500).json({ message: 'Error updating profile' })
//     }
//   }
// )

// // =====================
// // BUSINESS INFO
// // =====================
// router.put('/business-info', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const user = req.user
//     user.businessInfo = { ...user.businessInfo, ...req.body }
//     await user.save()
//     res.json({ message: 'Business information updated successfully' })
//   } catch (error) {
//     res.status(500).json({ message: 'Error updating business information' })
//   }
// })

// // =====================
// // COMPANY LOGO UPLOAD
// // =====================
// router.post(
//   '/company-logo',
//   authenticateToken,
//   requireUser,
//   upload.single('companyLogo'),
//   async (req, res) => {
//     try {
//       const user = req.user

//       if (!user.adminConfig?.isAdmin) {
//         return res.status(403).json({ message: 'Admin access required' })
//       }

//       if (!req.file) {
//         return res.status(400).json({ message: 'No file provided' })
//       }

//       // Validate file is an image
//       if (!req.file.mimetype.startsWith('image/')) {
//         return res.status(400).json({ message: 'File must be an image' })
//       }

//       const result = await new Promise((resolve, reject) => {
//         cloudinary.uploader
//           .upload_stream(
//             {
//               resource_type: 'image',
//               folder: 'marketbook-logos',
//               transformation: [
//                 { width: 400, height: 200, crop: 'fit' },
//                 { quality: 'auto' }
//               ]
//             },
//             (error, result) => (error ? reject(error) : resolve(result))
//           )
//           .end(req.file.buffer)
//       })

//       user.companyLogo = result.secure_url
//       await user.save()

//       res.json({
//         message: 'Company logo uploaded successfully',
//         companyLogo: user.companyLogo
//       })
//     } catch (error) {
//       console.error('Logo upload error:', error)
//       res.status(500).json({ message: 'Error uploading company logo' })
//     }
//   }
// )

// // =====================
// // DELETE COMPANY LOGO
// // =====================
// router.delete('/company-logo', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const user = req.user

//     if (!user.adminConfig?.isAdmin) {
//       return res.status(403).json({ message: 'Admin access required' })
//     }

//     user.companyLogo = null
//     await user.save()

//     res.json({ message: 'Company logo deleted successfully' })
//   } catch (error) {
//     console.error('Logo delete error:', error)
//     res.status(500).json({ message: 'Error deleting company logo' })
//   }
// })

// // =====================
// // BANK DETAILS
// // =====================
// router.put('/bank-details', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const user = req.user
//     if (!user.adminConfig?.isAdmin) {
//       return res.status(403).json({ message: 'Admin access required' })
//     }

//     const bankFields = Object.keys(user.bankDetails || {})
//     const updates = {}

//     for (const field of bankFields) {
//       if (!(field in req.body)) continue
//       const val = req.body[field]
//       if (typeof val === 'string' && val.includes('*')) continue
//       updates[field] = val ? encryptText(val) : null
//     }

//     user.bankDetails = { ...user.bankDetails, ...updates }
//     await user.save()

//     res.json({ message: 'Bank details updated successfully' })
//   } catch (error) {
//     res.status(500).json({ message: 'Error updating bank details' })
//   }
// })

// // =====================
// // BILLING ADDRESS
// // =====================
// router.put('/billing-address', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const user = req.user
//     user.billingAddress = { ...user.billingAddress, ...req.body }
//     await user.save()

//     res.json({ message: 'Billing address updated successfully' })
//   } catch (error) {
//     res.status(500).json({ message: 'Error updating billing address' })
//   }
// })

// // =====================
// // PREFERRED CURRENCY
// // =====================
// router.put('/preferred-currency', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const { preferredCurrency } = req.body
//     const user = req.user
//     user.preferredCurrency = preferredCurrency || null
//     await user.save()

//     res.json({
//       message: 'Preferred currency updated',
//       preferredCurrency: user.preferredCurrency
//     })
//   } catch (error) {
//     res.status(500).json({ message: 'Error updating preferred currency' })
//   }
// })

// // =====================
// // ADMIN DEFAULT CURRENCY
// // =====================
// router.put('/admin/default-currency', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const { defaultCurrency } = req.body
//     const user = req.user

//     if (!user.adminConfig?.isAdmin) {
//       return res.status(403).json({ message: 'Admin access required' })
//     }

//     user.adminConfig.defaultCurrency =
//       defaultCurrency || user.adminConfig.defaultCurrency
//     await user.save()

//     res.json({
//       message: 'Admin default currency updated',
//       defaultCurrency: user.adminConfig.defaultCurrency
//     })
//   } catch (error) {
//     res.status(500).json({ message: 'Error updating admin default currency' })
//   }
// })

// // =====================
// // CHANGE PASSWORD (FIXED)
// // =====================
// router.put('/change-password', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const { currentPassword, newPassword } = req.body

//     if (!currentPassword || !newPassword) {
//       return res.status(400).json({ message: 'Missing required fields' })
//     }

//     const user = await User.findById(req.user._id).select('+password')
//     if (!user) return res.status(404).json({ message: 'User not found' })

//     const isMatch = await bcrypt.compare(currentPassword, user.password)
//     if (!isMatch) {
//       return res.status(400).json({ message: 'Current password incorrect' })
//     }

//     user.password = newPassword
//     await user.save()

//     res.json({ message: 'Password changed successfully' })
//   } catch (error) {
//     console.error('Change password error:', error)
//     res.status(500).json({ message: 'Error changing password' })
//   }
// })

// export default router

























// import express from 'express'
// import multer from 'multer'
// import bcrypt from 'bcryptjs'
// import { v2 as cloudinary } from 'cloudinary'
// import User from '../models/User.js'
// import { authenticateToken, requireUser } from '../middleware/auth.js'
// import { notifyUser } from '../utils/notifications.js'
// import { encryptText, getMaskedBankDetails } from '../utils/encryption.js'

// const router = express.Router()

// // ---------------------
// // Cloudinary config
// // ---------------------
// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET
// })

// // ---------------------
// // Multer config
// // ---------------------
// const upload = multer({
//   storage: multer.memoryStorage(),
//   limits: { fileSize: 5 * 1024 * 1024 }
// })

// // =====================
// // UPDATE PROFILE
// // =====================
// router.put(
//   '/profile',
//   authenticateToken,
//   requireUser,
//   upload.single('profileImage'),
//   async (req, res) => {
//     try {
//       const { firstName, lastName, profileImageUrl } = req.body
//       const user = req.user
//       let profileImageUploadUrl = user.profileImage

//       if (req.file) {
//         const result = await new Promise((resolve, reject) => {
//           cloudinary.uploader
//             .upload_stream(
//               {
//                 resource_type: 'image',
//                 folder: 'marketbook-profiles',
//                 transformation: [
//                   { width: 200, height: 200, crop: 'fill' },
//                   { quality: 'auto' }
//                 ]
//               },
//               (error, result) => (error ? reject(error) : resolve(result))
//             )
//             .end(req.file.buffer)
//         })
//         profileImageUploadUrl = result.secure_url
//       } else if (profileImageUrl) {
//         profileImageUploadUrl = profileImageUrl
//       }

//       user.firstName = firstName || user.firstName
//       user.lastName = lastName || user.lastName
//       user.profileImage = profileImageUploadUrl
//       await user.save()

//       const safeUser = user.toObject()
//       safeUser.bankDetails = user.adminConfig?.isAdmin
//         ? getMaskedBankDetails(user.bankDetails || {})
//         : {}

//       res.json({ message: 'Profile updated successfully', user: safeUser })
//     } catch (error) {
//       console.error('Profile update error:', error)
//       res.status(500).json({ message: 'Error updating profile' })
//     }
//   }
// )

// // =====================
// // BUSINESS INFO
// // =====================
// router.put('/business-info', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const user = req.user
//     user.businessInfo = { ...user.businessInfo, ...req.body }
//     await user.save()
//     res.json({ message: 'Business information updated successfully' })
//   } catch (error) {
//     res.status(500).json({ message: 'Error updating business information' })
//   }
// })

// // =====================
// // BANK DETAILS
// // =====================
// router.put('/bank-details', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const user = req.user
//     if (!user.adminConfig?.isAdmin) {
//       return res.status(403).json({ message: 'Admin access required' })
//     }

//     const bankFields = Object.keys(user.bankDetails || {})
//     const updates = {}

//     for (const field of bankFields) {
//       if (!(field in req.body)) continue
//       const val = req.body[field]
//       if (typeof val === 'string' && val.includes('*')) continue
//       updates[field] = val ? encryptText(val) : null
//     }

//     user.bankDetails = { ...user.bankDetails, ...updates }
//     await user.save()

//     res.json({ message: 'Bank details updated successfully' })
//   } catch (error) {
//     res.status(500).json({ message: 'Error updating bank details' })
//   }
// })

// // =====================
// // BILLING ADDRESS
// // =====================
// router.put('/billing-address', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const user = req.user
//     user.billingAddress = { ...user.billingAddress, ...req.body }
//     await user.save()

//     res.json({ message: 'Billing address updated successfully' })
//   } catch (error) {
//     res.status(500).json({ message: 'Error updating billing address' })
//   }
// })

// // =====================
// // PREFERRED CURRENCY
// // =====================
// router.put('/preferred-currency', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const { preferredCurrency } = req.body
//     const user = req.user
//     user.preferredCurrency = preferredCurrency || null
//     await user.save()

//     res.json({
//       message: 'Preferred currency updated',
//       preferredCurrency: user.preferredCurrency
//     })
//   } catch (error) {
//     res.status(500).json({ message: 'Error updating preferred currency' })
//   }
// })

// // =====================
// // ADMIN DEFAULT CURRENCY
// // =====================
// router.put('/admin/default-currency', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const { defaultCurrency } = req.body
//     const user = req.user

//     if (!user.adminConfig?.isAdmin) {
//       return res.status(403).json({ message: 'Admin access required' })
//     }

//     user.adminConfig.defaultCurrency =
//       defaultCurrency || user.adminConfig.defaultCurrency
//     await user.save()

//     res.json({
//       message: 'Admin default currency updated',
//       defaultCurrency: user.adminConfig.defaultCurrency
//     })
//   } catch (error) {
//     res.status(500).json({ message: 'Error updating admin default currency' })
//   }
// })

// // =====================
// // CHANGE PASSWORD (FIXED)
// // =====================
// router.put('/change-password', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const { currentPassword, newPassword } = req.body

//     if (!currentPassword || !newPassword) {
//       return res.status(400).json({ message: 'Missing required fields' })
//     }

//     const user = await User.findById(req.user._id).select('+password')
//     if (!user) return res.status(404).json({ message: 'User not found' })

//     const isMatch = await bcrypt.compare(currentPassword, user.password)
//     if (!isMatch) {
//       return res.status(400).json({ message: 'Current password incorrect' })
//     }

//     user.password = newPassword
//     await user.save()

//     res.json({ message: 'Password changed successfully' })
//   } catch (error) {
//     console.error('Change password error:', error)
//     res.status(500).json({ message: 'Error changing password' })
//   }
// })

// export default router





// import express from 'express'
// import multer from 'multer'
// import { v2 as cloudinary } from 'cloudinary'
// import User from '../models/User.js'
// import { authenticateToken, requireUser } from '../middleware/auth.js'
// import { notifyUser } from '../utils/notifications.js'
// import { encryptText, decryptText, getMaskedBankDetails } from '../utils/encryption.js'

// const router = express.Router()

// // ---------------------
// // Cloudinary config
// // ---------------------
// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET
// })

// // ---------------------
// // Multer config
// // ---------------------
// const upload = multer({
//   storage: multer.memoryStorage(),
//   limits: { fileSize: 5 * 1024 * 1024 } // 5MB
// })

// // =====================
// // UPDATE PROFILE
// // =====================
// router.put(
//   '/profile',
//   authenticateToken,
//   requireUser,
//   upload.single('profileImage'),
//   async (req, res) => {
//     try {
//       const { firstName, lastName, profileImageUrl } = req.body
//       const user = req.user
//       let profileImageUploadUrl = user.profileImage

//       if (req.file) {
//         const result = await new Promise((resolve, reject) => {
//           cloudinary.uploader
//             .upload_stream(
//               {
//                 resource_type: 'image',
//                 folder: 'marketbook-profiles',
//                 transformation: [
//                   { width: 200, height: 200, crop: 'fill' },
//                   { quality: 'auto' }
//                 ]
//               },
//               (error, result) => {
//                 if (error) reject(error)
//                 else resolve(result)
//               }
//             )
//             .end(req.file.buffer)
//         })

//         profileImageUploadUrl = result.secure_url
//       } else if (profileImageUrl) {
//         profileImageUploadUrl = profileImageUrl
//       }

//       user.firstName = firstName || user.firstName
//       user.lastName = lastName || user.lastName
//       user.profileImage = profileImageUploadUrl

//       await user.save()

//       const io = req.app.get('io')
//       await notifyUser(
//         io,
//         user._id,
//         'Profile Updated',
//         'Your profile has been updated successfully',
//         'success'
//       )

//       // Do not return raw encrypted bank details - return masked values only
//       const maskedBankDetails = user.adminConfig?.isAdmin ? getMaskedBankDetails(user.bankDetails || {}) : {}
//       const safeUser = user.toObject()
//       safeUser.bankDetails = maskedBankDetails

//       res.json({
//         message: 'Profile updated successfully',
//         user: safeUser
//       })
//     } catch (error) {
//       console.error('Profile update error:', error)
//       res.status(500).json({ message: 'Error updating profile' })
//     }
//   }
// )

// // =====================
// // BUSINESS INFO
// // =====================
// router.put(
//   '/business-info',
//   authenticateToken,
//   requireUser,
//   async (req, res) => {
//     try {
//       const { businessName, phoneNumber, address, description } = req.body
//       const user = req.user

//       user.businessInfo = {
//         businessName: businessName || user.businessInfo?.businessName,
//         phoneNumber: phoneNumber || user.businessInfo?.phoneNumber,
//         address: address || user.businessInfo?.address,
//         description: description || user.businessInfo?.description
//       }

//       await user.save()

//       const io = req.app.get('io')
//       await notifyUser(
//         io,
//         user._id,
//         'Business Information Updated',
//         'Your business information has been updated successfully',
//         'info'
//       )

//       res.json({
//         message: 'Business information updated successfully',
//         businessInfo: user.businessInfo
//       })
//     } catch (error) {
//       console.error('Business info error:', error)
//       res.status(500).json({ message: 'Error updating business information' })
//     }
//   }
// )

// // =====================
// // BANK DETAILS (encrypted storage)
// // =====================
// router.put(
//   '/bank-details',
//   authenticateToken,
//   requireUser,
//   async (req, res) => {
//     try {
//       const user = req.user

//       // Only User Admins should manage bank details
//       if (!user.adminConfig?.isAdmin) {
//         return res.status(403).json({ message: 'Admin access required to update bank details' })
//       }

//       // List of supported bank-related fields (all optional)
//       const bankFields = [
//         'bankName', 'accountName', 'accountNumber', 'country', 'currency', 'IBAN', 'SWIFT',
//         'routingNumber', 'sortCode', 'IFSC', 'BSB', 'transitNumber', 'bankCode', 'branchName',
//         'branchAddress', 'accountType', 'otherIdentifiers'
//       ]

//       const updates = {}

//       for (const field of bankFields) {
//         if (!(field in req.body)) continue // not provided => no change

//         const val = req.body[field]

//         // If front-end submitted a masked placeholder (contains '*'), ignore it to avoid storing masks
//         if (typeof val === 'string' && val.includes('*')) continue

//         if (val === null || val === '') {
//           // explicit clear request
//           updates[field] = null
//         } else {
//           // Encrypt value before storing
//           updates[field] = encryptText(val)
//         }
//       }

//       user.bankDetails = { ...user.bankDetails, ...updates }
//       await user.save()

//       const io = req.app.get('io')
//       await notifyUser(
//         io,
//         user._id,
//         'Bank Details Updated',
//         'Your bank details have been updated successfully',
//         'info'
//       )

//       res.json({ message: 'Bank details updated successfully' })
//     } catch (error) {
//       console.error('Bank details update error:', error)
//       res.status(500).json({ message: 'Error updating bank details' })
//     }
//   }
// )

// // =====================
// // BILLING ADDRESS
// // =====================
// router.put(
//   '/billing-address',
//   authenticateToken,
//   requireUser,
//   async (req, res) => {
//     try {
//       const user = req.user
//       user.billingAddress = { ...user.billingAddress, ...req.body }
//       await user.save()

//       const io = req.app.get('io')
//       await notifyUser(
//         io,
//         user._id,
//         'Billing Address Updated',
//         'Your billing address has been updated successfully',
//         'info'
//       )

//       res.json({ message: 'Billing address updated successfully' })
//     } catch (error) {
//       res.status(500).json({ message: 'Error updating billing address' })
//     }
//   }
// )

// // =====================
// // PREFERRED CURRENCY
// // =====================
// router.put(
//   '/preferred-currency',
//   authenticateToken,
//   requireUser,
//   async (req, res) => {
//     try {
//       const { preferredCurrency } = req.body
//       const user = req.user
//       user.preferredCurrency = preferredCurrency || null
//       await user.save()

//       const io = req.app.get('io')
//       await notifyUser(
//         io,
//         user._id,
//         'Preferred Currency Updated',
//         `Your preferred currency has been set to ${preferredCurrency}`,
//         'info'
//       )

//       res.json({ message: 'Preferred currency updated', preferredCurrency: user.preferredCurrency })
//     } catch (error) {
//       res.status(500).json({ message: 'Error updating preferred currency' })
//     }
//   }
// )

// // =====================
// // ADMIN DEFAULT CURRENCY
// // =====================
// router.put(
//   '/admin/default-currency',
//   authenticateToken,
//   requireUser,
//   async (req, res) => {
//     try {
//       const { defaultCurrency } = req.body
//       const user = req.user
//       if (!user.adminConfig?.isAdmin) {
//         return res.status(403).json({ message: 'Admin access required' })
//       }

//       user.adminConfig.defaultCurrency = defaultCurrency || user.adminConfig.defaultCurrency
//       await user.save()

//       const io = req.app.get('io')
//       await notifyUser(
//         io,
//         user._id,
//         'Admin Default Currency Updated',
//         `Default currency updated to ${defaultCurrency}`,
//         'info'
//       )

//       res.json({ message: 'Admin default currency updated', defaultCurrency: user.adminConfig.defaultCurrency })
//     } catch (error) {
//       res.status(500).json({ message: 'Error updating admin default currency' })
//     }
//   }
// )

// // =====================
// // CHANGE PASSWORD
// // =====================
// router.put(
//   '/change-password',
//   authenticateToken,
//   requireUser,
//   async (req, res) => {
//     try {
//       const { currentPassword, newPassword } = req.body

//       if (!currentPassword || !newPassword) {
//         return res.status(400).json({ message: 'Missing required fields' })
//       }

//       // 🔥 Re-fetch user with password
//       const user = await User.findById(req.user._id).select('+password')
//       if (!user) {
//         return res.status(404).json({ message: 'User not found' })
//       }

//       const isMatch = await bcrypt.compare(currentPassword, user.password)
//       if (!isMatch) {
//         return res.status(400).json({ message: 'Current password incorrect' })
//       }

//       user.password = newPassword
//       await user.save()

//       const io = req.app.get('io')
//       await notifyUser(
//         io,
//         user._id,
//         'Password Changed',
//         'Your password has been changed successfully',
//         'success'
//       )

//       res.json({ message: 'Password changed successfully' })
//     } catch (error) {
//       console.error('Change password error:', error)
//       res.status(500).json({ message: 'Error changing password' })
//     }
//   }
// )

// export default router






























// import express from 'express'
// import multer from 'multer'
// import { v2 as cloudinary } from 'cloudinary'
// import bcrypt from 'bcryptjs'
// import crypto from 'crypto'
// import User from '../models/User.js'
// import { requireUser } from '../middleware/auth.js'
// import { notifyUser } from '../utils/notifications.js'

// const router = express.Router()

// // Configure Cloudinary
// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET
// })

// // Configure multer for file uploads
// const upload = multer({
//   storage: multer.memoryStorage(),
//   limits: {
//     fileSize: 5 * 1024 * 1024 // 5MB limit
//   }
// })

// // Update profile
// router.put('/profile', requireUser, upload.single('profileImage'), async (req, res) => {
//   try {
//     const { firstName, lastName, profileImageUrl } = req.body
//     const user = req.user
//     let profileImageUploadUrl = user.profileImage

//     // Handle profile image upload
//     if (req.file) {
//       const result = await new Promise((resolve, reject) => {
//         cloudinary.uploader.upload_stream(
//           { 
//             resource_type: 'image', 
//             folder: 'marketbook-profiles',
//             transformation: [
//               { width: 200, height: 200, crop: 'fill' },
//               { quality: 'auto' }
//             ]
//           },
//           (error, result) => {
//             if (error) reject(error)
//             else resolve(result)
//           }
//         ).end(req.file.buffer)
//       })
//       profileImageUploadUrl = result.secure_url
//     } else if (profileImageUrl && profileImageUrl !== user.profileImage) {
//       profileImageUploadUrl = profileImageUrl
//     }

//     // Update user fields
//     user.firstName = firstName || user.firstName
//     user.lastName = lastName || user.lastName
//     user.profileImage = profileImageUploadUrl

//     await user.save()

//     // Send notification
//     const io = req.app.get('io')
//     await notifyUser(
//       io,
//       user._id,
//       'Profile Updated',
//       'Your profile has been updated successfully',
//       'success'
//     )

//     res.json({
//       message: 'Profile updated successfully',
//       user: {
//         id: user._id,
//         firstName: user.firstName,
//         lastName: user.lastName,
//         email: user.email,
//         profileImage: user.profileImage,
//         bankDetails: user.bankDetails,
//         billingAddress: user.billingAddress,
//         businessInfo: user.businessInfo,
//         adminConfig: {
//           isAdmin: user.adminConfig.isAdmin
//         }
//       }
//     })
//   } catch (error) {
//     console.error('Error updating profile:', error)
//     res.status(500).json({ message: 'Error updating profile', error: error.message })
//   }
// })

// // Update business information
// router.put('/business-info', requireUser, async (req, res) => {
//   try {
//     const { businessName, phoneNumber, address, description } = req.body
//     const user = req.user

//     user.businessInfo = {
//       businessName: businessName || user.businessInfo?.businessName,
//       phoneNumber: phoneNumber || user.businessInfo?.phoneNumber,
//       address: address || user.businessInfo?.address,
//       description: description || user.businessInfo?.description
//     }

//     await user.save()

//     // Send notification
//     const io = req.app.get('io')
//     await notifyUser(
//       io,
//       user._id,
//       'Business Information Updated',
//       'Your business information has been updated successfully',
//       'info'
//     )

//     res.json({
//       message: 'Business information updated successfully',
//       businessInfo: user.businessInfo
//     })
//   } catch (error) {
//     console.error('Error updating business information:', error)
//     res.status(500).json({ message: 'Error updating business information', error: error.message })
//   }
// })

// // Update bank details
// router.put('/bank-details', requireUser, async (req, res) => {
//   try {
//     const { bankName, accountName, accountNumber, routingNumber, swiftCode } = req.body
//     const user = req.user

//     user.bankDetails = {
//       bankName: bankName || user.bankDetails?.bankName,
//       accountName: accountName || user.bankDetails?.accountName,
//       accountNumber: accountNumber || user.bankDetails?.accountNumber,
//       routingNumber: routingNumber || user.bankDetails?.routingNumber,
//       swiftCode: swiftCode || user.bankDetails?.swiftCode
//     }

//     await user.save()

//     // Send notification
//     const io = req.app.get('io')
//     await notifyUser(
//       io,
//       user._id,
//       'Bank Details Updated',
//       'Your bank details have been updated successfully',
//       'info'
//     )

//     res.json({
//       message: 'Bank details updated successfully',
//       bankDetails: user.bankDetails
//     })
//   } catch (error) {
//     console.error('Error updating bank details:', error)
//     res.status(500).json({ message: 'Error updating bank details', error: error.message })
//   }
// })

// // Update billing address
// router.put('/billing-address', requireUser, async (req, res) => {
//   try {
//     const { street, city, state, zipCode, country } = req.body
//     const user = req.user

//     user.billingAddress = {
//       street: street || user.billingAddress?.street,
//       city: city || user.billingAddress?.city,
//       state: state || user.billingAddress?.state,
//       zipCode: zipCode || user.billingAddress?.zipCode,
//       country: country || user.billingAddress?.country
//     }

//     await user.save()

//     // Send notification
//     const io = req.app.get('io')
//   await notifyUser(
//     io,
//     user._id,
//     'Billing Address Updated',
//     'Your billing address has been updated successfully',
//     'info'
//   )

//   res.json({
//     message: 'Billing address updated successfully',
//     billingAddress: user.billingAddress
//   })
// } catch (error) {
//   console.error('Error updating billing address:', error)
//   res.status(500).json({ message: 'Error updating billing address', error: error.message })
// }
// })

// // Update billing address
// router.put('/billing-address', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const { street, city, state, zipCode, country } = req.body
//     const user = req.user

//     user.billingAddress = {
//       street: typeof street !== 'undefined' ? street : user.billingAddress?.street,
//       city: typeof city !== 'undefined' ? city : user.billingAddress?.city,
//       state: typeof state !== 'undefined' ? state : user.billingAddress?.state,
//       zipCode: typeof zipCode !== 'undefined' ? zipCode : user.billingAddress?.zipCode,
//       country: typeof country !== 'undefined' ? country : user.billingAddress?.country
//     }

//     await user.save()

//     // Send notification
//     const io = req.app.get('io')
//     await notifyUser(
//       io,
//       user._id,
//       'Billing Address Updated',
//       'Your billing address has been updated successfully',
//       'info'
//     )

//     res.json({
//       message: 'Billing address updated successfully',
//       billingAddress: user.billingAddress
//     })
//   } catch (error) {
//     console.error('Error updating billing address:', error)
//     res.status(500).json({ message: 'Error updating billing address', error: error.message })
//   }
// })

// // Change password
// router.put('/change-password', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const { currentPassword, newPassword } = req.body

//     // Fetch fresh user instance with password included (req.user may have password excluded)
//     const user = await User.findById(req.user._id)
//     if (!user) return res.status(404).json({ message: 'User not found' })

//     // Verify current password
//     const isMatch = await user.comparePassword(currentPassword)
//     if (!isMatch) {
//       return res.status(400).json({ message: 'Current password is incorrect' })
//     }

//     if (newPassword.length < 6) {
//       return res.status(400).json({ message: 'New password must be at least 6 characters long' })
//     }

//     user.password = newPassword
//     await user.save()

//     // Send notification
//     const io = req.app.get('io')
//     await notifyUser(
//       io,
//       user._id,
//       'Password Changed',
//       'Your password has been changed successfully',
//       'success'
//     )

//     res.json({ message: 'Password changed successfully' })
//   } catch (error) {
//     console.error('Error changing password:', error)
//     res.status(500).json({ message: 'Error changing password', error: error.message })
//   }
// })

// export default router
