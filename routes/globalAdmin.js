import express from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import path from 'path'
import User from '../models/User.js'
import GlobalAdmin from '../models/GlobalAdmin.js'
import Note from '../models/Note.js'
import EmailLog from '../models/EmailLog.js'
import SmsLog from '../models/SmsLog.js'
import { authenticateToken, requireGlobalAdmin } from '../middleware/auth.js'

const router = express.Router()

// Helper: generate random email/password
const generateCredentials = () => {
  const rand = crypto.randomBytes(6).toString('hex')
  const email = `user-${rand}@inboxguaranteed.com`
  const password = crypto.randomBytes(8).toString('hex')
  return { email, password }
}

// POST /login - Global admin login
router.post('/login', async (req, res) => {
  try {
    const { email, password, resetCode } = req.body

    // Validate inputs
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' })
    }
    // Only env-based global admin allowed (no DB lookup).
    const envEmail = process.env.GLOBAL_ADMIN_EMAIL && process.env.GLOBAL_ADMIN_EMAIL.toLowerCase()
    const envPassword = process.env.GLOBAL_ADMIN_PASSWORD

    if (!envEmail || !envPassword) {
      return res.status(500).json({ success: false, message: 'Global admin not configured on server' })
    }

    if (email.toLowerCase() !== envEmail || password !== envPassword) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' })
    }

    // Issue a JWT for env-based admin. Use a sentinel adminId and mark as original.
    const token = jwt.sign(
      { adminId: 'env-admin', email: envEmail, type: 'global-admin', isOriginal: true },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    return res.json({
      success: true,
      message: 'Global admin login successful',
      token,
      admin: {
        id: null,
        email: envEmail,
        isOriginal: true,
        appPremiumMode: false
      }
    })
  } catch (err) {
    console.error('Global admin login error:', err)
    return res.status(500).json({ success: false, message: 'Login failed', error: err.message })
  }
})

// POST /create-user
router.post('/create-user', authenticateToken, requireGlobalAdmin, async (req, res) => {
  try {
    const { firstName, lastName } = req.body
    if (!firstName || !lastName) return res.status(400).json({ success: false, message: 'First and last name required' })

    const { email, password } = generateCredentials()

    const user = new User({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase(),
      password: password,
      isEmailConfirmed: true,
      isActive: true
    })

    await user.save()

    return res.json({
      success: true,
      message: 'User created',
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        password // plain password returned once
      }
    })
  } catch (err) {
    console.error('create-user error:', err)
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'Email already exists' })
    return res.status(500).json({ success: false, message: err.message })
  }
})

// GET /users
router.get('/users', authenticateToken, requireGlobalAdmin, async (req, res) => {
  try {
    // include notepadEnabled and authorizedIps for admin IP control
    const users = await User.find({ isDeleted: false })
      .select('firstName lastName email isActive createdAt adminConfig.notepadEnabled authorizedIps')
      .sort({ createdAt: -1 })
    return res.json({ success: true, users })
  } catch (err) {
    console.error('fetch users error:', err)
    return res.status(500).json({ success: false, message: err.message })
  }
})

// GET /users/:id/authorized-ips
router.get('/users/:id/authorized-ips', authenticateToken, requireGlobalAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('authorizedIps')
    if (!user || user.isDeleted) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }
    return res.json({ success: true, authorizedIps: user.authorizedIps || [] })
  } catch (err) {
    console.error('get user authorized ips error:', err)
    return res.status(500).json({ success: false, message: err.message })
  }
})

const isValidIp = (ip) => {
  if (!ip || typeof ip !== 'string') return false
  const normalized = ip.trim().replace('::ffff:', '')
  const ipv4Regex = /^(25[0-5]|2[0-4]\d|[01]?\d\d?)(\.(25[0-5]|2[0-4]\d|[01]?\d\d?)){3}$/
  const ipv6Regex = /^[0-9a-fA-F:]+$/
  return ipv4Regex.test(normalized) || ipv6Regex.test(normalized)
}

// TEMPORARY: Auto-add current request IP to user (for testing IP detection)
// POST /users/:id/auto-add-current-ip
router.post('/users/:id/auto-add-current-ip', authenticateToken, requireGlobalAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user || user.isDeleted) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    // Get current request IP
    const { getRequestIp } = await import('../middleware/auth.js')
    const currentIp = getRequestIp(req)

    if (!currentIp) {
      return res.status(400).json({ success: false, message: 'Could not determine current IP' })
    }

    // Check if IP already exists
    const normalizedIp = currentIp.trim().replace('::ffff:', '')
    if (user.authorizedIps.some((entry) => entry.ip === normalizedIp)) {
      return res.status(400).json({ success: false, message: 'IP already authorized' })
    }

    // Add the IP
    user.authorizedIps.push({ ip: normalizedIp, addedBy: req.globalAdmin?.email || 'global-admin' })
    await user.save()

    return res.json({
      success: true,
      message: `Auto-added current IP: ${normalizedIp}`,
      authorizedIps: user.authorizedIps
    })
  } catch (err) {
    console.error('auto-add current ip error:', err)
    return res.status(500).json({ success: false, message: err.message })
  }
})

// POST /users/:id/authorized-ips
router.post('/users/:id/authorized-ips', authenticateToken, requireGlobalAdmin, async (req, res) => {
  try {
    const { ip } = req.body
    if (!ip || !isValidIp(ip)) {
      return res.status(400).json({ success: false, message: 'Valid IP address is required' })
    }

    const user = await User.findById(req.params.id)
    if (!user || user.isDeleted) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    const normalizedIp = ip.trim().replace('::ffff:', '')

    if (user.authorizedIps.some((entry) => entry.ip === normalizedIp)) {
      return res.status(400).json({ success: false, message: 'IP already authorized' })
    }

    user.authorizedIps.push({ ip: normalizedIp, addedBy: req.globalAdmin?.email || 'global-admin' })
    await user.save()

    return res.json({ success: true, message: 'IP authorized', authorizedIps: user.authorizedIps })
  } catch (err) {
    console.error('add authorized ip error:', err)
    return res.status(500).json({ success: false, message: err.message })
  }
})

// DELETE /users/:id/authorized-ips/:ip
router.delete('/users/:id/authorized-ips/:ip', authenticateToken, requireGlobalAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user || user.isDeleted) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    const targetIp = req.params.ip.trim().replace('::ffff:', '')
    const initialLen = user.authorizedIps.length
    user.authorizedIps = user.authorizedIps.filter((entry) => entry.ip !== targetIp)

    if (user.authorizedIps.length === initialLen) {
      return res.status(404).json({ success: false, message: 'IP not found' })
    }

    await user.save()
    return res.json({ success: true, message: 'IP removed', authorizedIps: user.authorizedIps })
  } catch (err) {
    console.error('remove authorized ip error:', err)
    return res.status(500).json({ success: false, message: err.message })
  }
})

// PUT /users/:id/disable
router.put('/users/:id/disable', authenticateToken, requireGlobalAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user || user.isDeleted) return res.status(404).json({ success: false, message: 'User not found' })
    user.isActive = false
    await user.save()
    return res.json({ success: true, message: 'User disabled', user: { id: user._id, isActive: user.isActive } })
  } catch (err) {
    console.error('disable user error:', err)
    return res.status(500).json({ success: false, message: err.message })
  }
})

// PUT /users/:id/enable
router.put('/users/:id/enable', authenticateToken, requireGlobalAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user || user.isDeleted) return res.status(404).json({ success: false, message: 'User not found' })
    user.isActive = true
    await user.save()
    return res.json({ success: true, message: 'User enabled', user: { id: user._id, isActive: user.isActive } })
  } catch (err) {
    console.error('enable user error:', err)
    return res.status(500).json({ success: false, message: err.message })
  }
})

// PUT /users/:id/notepad - toggle or set notepad feature
router.put('/users/:id/notepad', authenticateToken, requireGlobalAdmin, async (req, res) => {
  try {
    const { enabled } = req.body
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Enabled flag required and must be boolean' })
    }
    const user = await User.findById(req.params.id)
    if (!user || user.isDeleted) return res.status(404).json({ success: false, message: 'User not found' })
    user.adminConfig.notepadEnabled = enabled
    await user.save()
    return res.json({
      success: true,
      message: `Notepad feature ${enabled ? 'enabled' : 'disabled'} for user`,
      user: { id: user._id, notepadEnabled: user.adminConfig.notepadEnabled }
    })
  } catch (err) {
    console.error('toggle notepad error:', err)
    return res.status(500).json({ success: false, message: err.message })
  }
})

// PUT /users/:id/toggle
router.put('/users/:id/toggle', authenticateToken, requireGlobalAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user || user.isDeleted) return res.status(404).json({ success: false, message: 'User not found' })
    user.isActive = !user.isActive
    await user.save()
    return res.json({ success: true, message: `User ${user.isActive ? 'enabled' : 'disabled'}`, user: { id: user._id, isActive: user.isActive } })
  } catch (err) {
    console.error('toggle user error:', err)
    return res.status(500).json({ success: false, message: err.message })
  }
})

// DELETE /users/:id - Permanently remove a user and associated data
router.delete('/users/:id', authenticateToken, requireGlobalAdmin, async (req, res) => {
  try {
    const userId = req.params.id
    const user = await User.findById(userId)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })

    // Remove user-related collections that still exist after recent cleanup
    const deletions = []
    deletions.push(Note.deleteMany({ userId }))
    deletions.push(EmailLog.deleteMany({ userId }))
    deletions.push(SmsLog.deleteMany({ userId }))

    await Promise.all(deletions)

    // Remove any uploaded files for the user (uploads/users/<userId> and uploads/<userId>)
    try {
      const uploadsDir1 = path.join(process.cwd(), 'uploads', 'users', String(userId))
      const uploadsDir2 = path.join(process.cwd(), 'uploads', String(userId))
      if (fs.existsSync(uploadsDir1)) {
        await fs.promises.rm(uploadsDir1, { recursive: true, force: true })
      }
      if (fs.existsSync(uploadsDir2)) {
        await fs.promises.rm(uploadsDir2, { recursive: true, force: true })
      }
    } catch (fsErr) {
      console.warn('Error removing user uploads:', fsErr.message)
    }

    // Finally delete the user record
    await User.deleteOne({ _id: userId })

    return res.json({ success: true, message: 'User permanently deleted' })
  } catch (err) {
    console.error('permanent delete user error:', err)
    return res.status(500).json({ success: false, message: err.message })
  }
})

export default router















// import express from 'express'
// import crypto from 'crypto'
// import jwt from 'jsonwebtoken'
// import fs from 'fs'
// import path from 'path'
// import User from '../models/User.js'
// import GlobalAdmin from '../models/GlobalAdmin.js'
// import Note from '../models/Note.js'
// import EmailLog from '../models/EmailLog.js'
// import SmsLog from '../models/SmsLog.js'
// import { authenticateToken, requireGlobalAdmin } from '../middleware/auth.js'

// const router = express.Router()

// // Helper: generate random email/password
// const generateCredentials = () => {
//   const rand = crypto.randomBytes(6).toString('hex')
//   const email = `user-${rand}@inboxguaranteed.com`
//   const password = crypto.randomBytes(8).toString('hex')
//   return { email, password }
// }

// // POST /login - Global admin login
// router.post('/login', async (req, res) => {
//   try {
//     const { email, password, resetCode } = req.body

//     // Validate inputs
//     if (!email || !password) {
//       return res.status(400).json({ success: false, message: 'Email and password are required' })
//     }

//     // Find global admin by email
//     const admin = await GlobalAdmin.findOne({ email: email.toLowerCase() })
//     if (!admin) {
//       return res.status(401).json({ success: false, message: 'Invalid email or password' })
//     }

//     // Check if account is locked
//     if (admin.isLocked()) {
//       return res.status(429).json({ success: false, message: 'Account is locked. Try again later.' })
//     }

//     // Verify password
//     const isPasswordValid = await admin.comparePassword(password)
//     if (!isPasswordValid) {
//       // Increment login attempts
//       await admin.incLoginAttempts()
//       return res.status(401).json({ success: false, message: 'Invalid email or password' })
//     }

//     // Reset login attempts on successful login
//     if (admin.loginAttempts > 0) {
//       await admin.resetLoginAttempts()
//     }

//     // Update last login
//     admin.lastLogin = new Date()
//     await admin.save()

//     // Generate JWT token
//     const token = jwt.sign(
//       { adminId: admin._id, email: admin.email, type: 'global-admin' },
//       process.env.JWT_SECRET,
//       { expiresIn: '7d' }
//     )

//     return res.json({
//       success: true,
//       message: 'Global admin login successful',
//       token,
//       admin: {
//         id: admin._id,
//         email: admin.email,
//         isOriginal: admin.isOriginal,
//         appPremiumMode: admin.appPremiumMode
//       }
//     })
//   } catch (err) {
//     console.error('Global admin login error:', err)
//     return res.status(500).json({ success: false, message: 'Login failed', error: err.message })
//   }
// })

// // POST /create-user
// router.post('/create-user', authenticateToken, requireGlobalAdmin, async (req, res) => {
//   try {
//     const { firstName, lastName } = req.body
//     if (!firstName || !lastName) return res.status(400).json({ success: false, message: 'First and last name required' })

//     const { email, password } = generateCredentials()

//     const user = new User({
//       firstName: firstName.trim(),
//       lastName: lastName.trim(),
//       email: email.toLowerCase(),
//       password: password,
//       isEmailConfirmed: true,
//       isActive: true
//     })

//     await user.save()

//     return res.json({
//       success: true,
//       message: 'User created',
//       user: {
//         id: user._id,
//         firstName: user.firstName,
//         lastName: user.lastName,
//         email: user.email,
//         password // plain password returned once
//       }
//     })
//   } catch (err) {
//     console.error('create-user error:', err)
//     if (err.code === 11000) return res.status(400).json({ success: false, message: 'Email already exists' })
//     return res.status(500).json({ success: false, message: err.message })
//   }
// })

// // GET /users
// router.get('/users', authenticateToken, requireGlobalAdmin, async (req, res) => {
//   try {
//     const users = await User.find({ isDeleted: false }).select('firstName lastName email isActive createdAt').sort({ createdAt: -1 })
//     return res.json({ success: true, users })
//   } catch (err) {
//     console.error('fetch users error:', err)
//     return res.status(500).json({ success: false, message: err.message })
//   }
// })

// // PUT /users/:id/disable
// router.put('/users/:id/disable', authenticateToken, requireGlobalAdmin, async (req, res) => {
//   try {
//     const user = await User.findById(req.params.id)
//     if (!user || user.isDeleted) return res.status(404).json({ success: false, message: 'User not found' })
//     user.isActive = false
//     await user.save()
//     return res.json({ success: true, message: 'User disabled', user: { id: user._id, isActive: user.isActive } })
//   } catch (err) {
//     console.error('disable user error:', err)
//     return res.status(500).json({ success: false, message: err.message })
//   }
// })

// // PUT /users/:id/enable
// router.put('/users/:id/enable', authenticateToken, requireGlobalAdmin, async (req, res) => {
//   try {
//     const user = await User.findById(req.params.id)
//     if (!user || user.isDeleted) return res.status(404).json({ success: false, message: 'User not found' })
//     user.isActive = true
//     await user.save()
//     return res.json({ success: true, message: 'User enabled', user: { id: user._id, isActive: user.isActive } })
//   } catch (err) {
//     console.error('enable user error:', err)
//     return res.status(500).json({ success: false, message: err.message })
//   }
// })

// // PUT /users/:id/toggle
// router.put('/users/:id/toggle', authenticateToken, requireGlobalAdmin, async (req, res) => {
//   try {
//     const user = await User.findById(req.params.id)
//     if (!user || user.isDeleted) return res.status(404).json({ success: false, message: 'User not found' })
//     user.isActive = !user.isActive
//     await user.save()
//     return res.json({ success: true, message: `User ${user.isActive ? 'enabled' : 'disabled'}`, user: { id: user._id, isActive: user.isActive } })
//   } catch (err) {
//     console.error('toggle user error:', err)
//     return res.status(500).json({ success: false, message: err.message })
//   }
// })

// // DELETE /users/:id - Permanently remove a user and associated data
// router.delete('/users/:id', authenticateToken, requireGlobalAdmin, async (req, res) => {
//   try {
//     const userId = req.params.id
//     const user = await User.findById(userId)
//     if (!user) return res.status(404).json({ success: false, message: 'User not found' })

//     // Remove user-related collections that still exist after recent cleanup
//     const deletions = []
//     deletions.push(Note.deleteMany({ userId }))
//     deletions.push(EmailLog.deleteMany({ userId }))
//     deletions.push(SmsLog.deleteMany({ userId }))

//     await Promise.all(deletions)

//     // Remove any uploaded files for the user (uploads/users/<userId> and uploads/<userId>)
//     try {
//       const uploadsDir1 = path.join(process.cwd(), 'uploads', 'users', String(userId))
//       const uploadsDir2 = path.join(process.cwd(), 'uploads', String(userId))
//       if (fs.existsSync(uploadsDir1)) {
//         await fs.promises.rm(uploadsDir1, { recursive: true, force: true })
//       }
//       if (fs.existsSync(uploadsDir2)) {
//         await fs.promises.rm(uploadsDir2, { recursive: true, force: true })
//       }
//     } catch (fsErr) {
//       console.warn('Error removing user uploads:', fsErr.message)
//     }

//     // Finally delete the user record
//     await User.deleteOne({ _id: userId })

//     return res.json({ success: true, message: 'User permanently deleted' })
//   } catch (err) {
//     console.error('permanent delete user error:', err)
//     return res.status(500).json({ success: false, message: err.message })
//   }
// })

// export default router
