import express from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import User from '../models/User.js'
import GlobalAdmin from '../models/GlobalAdmin.js'
import { authenticateToken, requireGlobalAdmin } from '../middleware/auth.js'

const router = express.Router()

// Helper function to generate random email and password
const generateCredentials = () => {
  const randomString = crypto.randomBytes(8).toString('hex').substring(0, 8)
  const email = `user-${randomString}@inboxguaranteed.com`
  const password = crypto.randomBytes(12).toString('hex')
  return { email, password }
}

// Create new user
router.post('/create-user', authenticateToken, requireGlobalAdmin, async (req, res) => {
  try {
    const { firstName, lastName } = req.body

    if (!firstName || !lastName) {
      return res.status(400).json({ success: false, message: 'First name and last name are required' })
    }

    // Generate credentials
    const { email, password } = generateCredentials()

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    // Create new user
    const newUser = new User({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase(),
      password: hashedPassword,
      isEmailConfirmed: true, // Auto-confirm email for admin-created users
      isActive: true
    })

    await newUser.save()

    res.json({
      success: true,
      message: 'User created successfully',
      user: {
        _id: newUser._id,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        email: newUser.email,
        generatedPassword: password // Return password only once after creation
      }
    })
  } catch (error) {
    console.error('Error creating user:', error)
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Email already exists' })
    }
    res.status(500).json({ success: false, message: error.message })
  }
})

// Get all users (for enabling/disabling)
router.get('/users', authenticateToken, requireGlobalAdmin, async (req, res) => {
  try {
    const users = await User.find({}, 'firstName lastName email isActive createdAt').sort({ createdAt: -1 })
    res.json({ success: true, users })
  } catch (error) {
    console.error('Error fetching users:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// Toggle user status (enable/disable)
router.put('/toggle-user-status/:userId', authenticateToken, requireGlobalAdmin, async (req, res) => {
  try {
    const { userId } = req.params

    const user = await User.findById(userId)
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    // Toggle isActive status
    user.isActive = !user.isActive
    await user.save()

    const action = user.isActive ? 'enabled' : 'disabled'

    res.json({
      success: true,
      message: `User ${action} successfully`,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        isActive: user.isActive
      }
    })
  } catch (error) {
    console.error('Error toggling user status:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// Disable user specifically (for convenience)
router.put('/disable-user/:userId', authenticateToken, requireGlobalAdmin, async (req, res) => {
  try {
    const { userId } = req.params

    const user = await User.findById(userId)
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    user.isActive = false
    await user.save()

    res.json({
      success: true,
      message: 'User disabled successfully',
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        isActive: user.isActive
      }
    })
  } catch (error) {
    console.error('Error disabling user:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// Enable user specifically (for convenience)
router.put('/enable-user/:userId', authenticateToken, requireGlobalAdmin, async (req, res) => {
  try {
    const { userId } = req.params

    const user = await User.findById(userId)
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    user.isActive = true
    await user.save()

    res.json({
      success: true,
      message: 'User enabled successfully',
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        isActive: user.isActive
      }
    })
  } catch (error) {
    console.error('Error enabling user:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
