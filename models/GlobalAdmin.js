import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const globalAdminSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    default: process.env.GLOBAL_ADMIN_EMAIL || 'admin@marketbook.com'
  },
  password: {
    type: String,
    required: true
  },
  resetCode: {
    type: String,
    default: process.env.GLOBAL_ADMIN_RESET_CODE || '3237'
  },
  lastLogin: {
    type: Date,
    default: null
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date,
    default: null
  },
  isOriginal: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GlobalAdmin',
    default: null
  },
  // Global app mode control - when true, only premium users can access premium features
  // when false (Free Mode), all users can access premium features regardless of isPremium flag
  appPremiumMode: {
    type: Boolean,
    default: true // Premium mode is enabled by default
  }
}, {
  timestamps: true
})

// Hash password before saving
globalAdminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next()
  
  try {
    const salt = await bcrypt.genSalt(10)
    this.password = await bcrypt.hash(this.password, salt)
    next()
  } catch (error) {
    next(error)
  }
})

// Compare password method
globalAdminSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password)
}

// Check if account is locked
globalAdminSchema.methods.isLocked = function() {
  return !!(this.lockUntil && this.lockUntil > Date.now())
}

// Increment login attempts
globalAdminSchema.methods.incLoginAttempts = function() {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: {
        loginAttempts: 1
      },
      $unset: {
        lockUntil: 1
      }
    })
  }
  
  const updates = { $inc: { loginAttempts: 1 } }
  
  // If we're past max attempts and not locked yet, lock account
  if (this.loginAttempts + 1 >= 5 && !this.isLocked()) {
    updates.$set = { lockUntil: Date.now() + (2 * 60 * 60 * 1000) } // 2 hours
  }
  
  return this.updateOne(updates)
}

// Reset login attempts
globalAdminSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $unset: {
      loginAttempts: 1,
      lockUntil: 1
    }
  })
}

export default mongoose.model('GlobalAdmin', globalAdminSchema)