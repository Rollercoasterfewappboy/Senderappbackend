import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  profileImage: {
    type: String,
    default: null
  },
  // Company logo URL (for invoices and professional branding)
  companyLogo: {
    type: String,
    default: null
  },
  isEmailConfirmed: {
    type: Boolean,
    default: false
  },
  emailConfirmToken: {
    type: String,
    default: null
  },
  passwordResetToken: {
    type: String,
    default: null
  },
  passwordResetExpires: {
    type: Date,
    default: null
  },
  bankDetails: {
    // All fields stored encrypted (base64 strings). Decryption only happens server-side when strictly necessary.
    bankName: String,
    accountName: String,
    accountNumber: String,
    country: String,
    currency: String,
    IBAN: String,
    SWIFT: String,
    routingNumber: String,
    sortCode: String,
    IFSC: String,
    BSB: String,
    transitNumber: String,
    bankCode: String,
    branchName: String,
    branchAddress: String,
    accountType: String,
    otherIdentifiers: String
  },
  billingAddress: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: String
  },
  businessInfo: {
    businessName: String,
    phoneNumber: String,
    address: String,
    description: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  },
  isRecommended: {
    type: Boolean,
    default: false
  },
  adminConfig: {
    isAdmin: {
      type: Boolean,
      default: false
    },
    adminPassword: {
      type: String,
      default: null
    },
    adminCreatedAt: {
      type: Date,
      default: null
    },
    // Notepad password (hashed, created/managed only by admins)
    notepadPassword: {
      type: String,
      default: null
    },
    notepadPasswordCreatedAt: {
      type: Date,
      default: null
    },
    // Whether the global admin has enabled the Notepad feature for this user
    notepadEnabled: {
      type: Boolean,
      default: false
    },
    // Default currency for this admin (ISO 4217 code)
    defaultCurrency: {
      type: String,
      default: 'NGN'
    }
  },
  // User's preferred currency (ISO 4217 code). Falls back to admin default when creating items if set.
  preferredCurrency: {
    type: String,
    default: null
  },
  // User's preferred timezone (IANA timezone identifier, e.g., "America/New_York", "Asia/Tokyo")
  // Used as default for scheduled notes and time displays
  preferredTimezone: {
    type: String,
    default: 'UTC'
  },
  // Premium access flag - controls access to premium features (e.g., User Admin Dashboard)
  // When app is in Premium Mode, only users with isPremium=true can access premium features
  // When app is in Free Mode, isPremium is ignored and all users can access premium features
  isPremium: {
    type: Boolean,
    default: false
  },
  lastLogin: {
    type: Date,
    default: null
  },
  // Website publishing limits for UserAdmins
  websitePublishingLimits: {
    maxPublishedWebsites: {
      type: Number,
      default: 1 // Default limit: 1 published website per UserAdmin
    },
    currentPublishedCount: {
      type: Number,
      default: 0
    }
  },
  authorizedIps: [{
    ip: { type: String, required: true },
    addedBy: { type: String, default: 'global-admin' },
    addedAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
})

// Hash user password (if modified)
userSchema.pre('save', async function (next) {
  try {
    if (this.isModified('password')) {
      const salt = await bcrypt.genSalt(10)
      this.password = await bcrypt.hash(this.password, salt)
    }

    // If admin password exists and is modified, hash it
    if (this.isModified('adminConfig.adminPassword') && this.adminConfig.adminPassword) {
      const salt = await bcrypt.genSalt(10)
      this.adminConfig.adminPassword = await bcrypt.hash(this.adminConfig.adminPassword, salt)
    }

    // If notepad password exists and is modified, hash it
    if (this.isModified('adminConfig.notepadPassword') && this.adminConfig.notepadPassword) {
      const salt = await bcrypt.genSalt(10)
      this.adminConfig.notepadPassword = await bcrypt.hash(this.adminConfig.notepadPassword, salt)
    }

    next()
  } catch (error) {
    next(error)
  }
})

// Method: Compare user login password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password)
}

// Method: Compare admin password
userSchema.methods.compareAdminPassword = async function (candidatePassword) {
  if (!this.adminConfig?.adminPassword) return false
  return bcrypt.compare(candidatePassword, this.adminConfig.adminPassword)
}

// Method: Compare notepad password
userSchema.methods.compareNotepadPassword = async function (candidatePassword) {
  if (!this.adminConfig?.notepadPassword) return false
  return bcrypt.compare(candidatePassword, this.adminConfig.notepadPassword)
}

// Virtual: fullName
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`
})

// Hide sensitive fields in JSON
userSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.password
    delete ret.emailConfirmToken
    delete ret.passwordResetToken
    if (ret.adminConfig?.adminPassword) {
      delete ret.adminConfig.adminPassword
    }
    if (ret.adminConfig?.notepadPassword) {
      delete ret.adminConfig.notepadPassword
    }
    return ret
  }
})

export default mongoose.model('User', userSchema)



// import mongoose from 'mongoose'
// import bcrypt from 'bcryptjs'

// const userSchema = new mongoose.Schema({
//   firstName: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   lastName: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   email: {
//     type: String,
//     required: true,
//     unique: true,
//     lowercase: true,
//     trim: true
//   },
//   password: {
//     type: String,
//     required: true,
//     minlength: 6
//   },
//   profileImage: {
//     type: String,
//     default: null
//   },
//   isEmailConfirmed: {
//     type: Boolean,
//     default: false
//   },
//   emailConfirmToken: {
//     type: String,
//     default: null
//   },
//   passwordResetToken: {
//     type: String,
//     default: null
//   },
//   passwordResetExpires: {
//     type: Date,
//     default: null
//   },
//   bankDetails: {
//     // All fields stored encrypted (base64 strings). Decryption only happens server-side when strictly necessary.
//     bankName: String,
//     accountName: String,
//     accountNumber: String,
//     country: String,
//     currency: String,
//     IBAN: String,
//     SWIFT: String,
//     routingNumber: String,
//     sortCode: String,
//     IFSC: String,
//     BSB: String,
//     transitNumber: String,
//     bankCode: String,
//     branchName: String,
//     branchAddress: String,
//     accountType: String,
//     otherIdentifiers: String
//   },
//   billingAddress: {
//     street: String,
//     city: String,
//     state: String,
//     zipCode: String,
//     country: String
//   },
//   businessInfo: {
//     businessName: String,
//     phoneNumber: String,
//     address: String,
//     description: String
//   },
//   isActive: {
//     type: Boolean,
//     default: true
//   },
//   isDeleted: {
//     type: Boolean,
//     default: false
//   },
//   deletedAt: {
//     type: Date,
//     default: null
//   },
//   isRecommended: {
//     type: Boolean,
//     default: false
//   },
//   adminConfig: {
//     isAdmin: {
//       type: Boolean,
//       default: false
//     },
//     adminPassword: {
//       type: String,
//       default: null
//     },
//     adminCreatedAt: {
//       type: Date,
//       default: null
//     },
//     // Notepad password (hashed, created/managed only by admins)
//     notepadPassword: {
//       type: String,
//       default: null
//     },
//     notepadPasswordCreatedAt: {
//       type: Date,
//       default: null
//     },
//     // Default currency for this admin (ISO 4217 code)
//     defaultCurrency: {
//       type: String,
//       default: 'NGN'
//     }
//   },
//   // User's preferred currency (ISO 4217 code). Falls back to admin default when creating items if set.
//   preferredCurrency: {
//     type: String,
//     default: null
//   },
//   // User's preferred timezone (IANA timezone identifier, e.g., "America/New_York", "Asia/Tokyo")
//   // Used as default for scheduled notes and time displays
//   preferredTimezone: {
//     type: String,
//     default: 'UTC'
//   },
//   lastLogin: {
//     type: Date,
//     default: null
//   }
// }, {
//   timestamps: true
// })

// // Hash user password (if modified)
// userSchema.pre('save', async function (next) {
//   try {
//     if (this.isModified('password')) {
//       const salt = await bcrypt.genSalt(10)
//       this.password = await bcrypt.hash(this.password, salt)
//     }

//     // If admin password exists and is modified, hash it
//     if (this.isModified('adminConfig.adminPassword') && this.adminConfig.adminPassword) {
//       const salt = await bcrypt.genSalt(10)
//       this.adminConfig.adminPassword = await bcrypt.hash(this.adminConfig.adminPassword, salt)
//     }

//     // If notepad password exists and is modified, hash it
//     if (this.isModified('adminConfig.notepadPassword') && this.adminConfig.notepadPassword) {
//       const salt = await bcrypt.genSalt(10)
//       this.adminConfig.notepadPassword = await bcrypt.hash(this.adminConfig.notepadPassword, salt)
//     }

//     next()
//   } catch (error) {
//     next(error)
//   }
// })

// // Method: Compare user login password
// userSchema.methods.comparePassword = async function (candidatePassword) {
//   return bcrypt.compare(candidatePassword, this.password)
// }

// // Method: Compare admin password
// userSchema.methods.compareAdminPassword = async function (candidatePassword) {
//   if (!this.adminConfig?.adminPassword) return false
//   return bcrypt.compare(candidatePassword, this.adminConfig.adminPassword)
// }

// // Method: Compare notepad password
// userSchema.methods.compareNotepadPassword = async function (candidatePassword) {
//   if (!this.adminConfig?.notepadPassword) return false
//   return bcrypt.compare(candidatePassword, this.adminConfig.notepadPassword)
// }

// // Virtual: fullName
// userSchema.virtual('fullName').get(function () {
//   return `${this.firstName} ${this.lastName}`
// })

// // Hide sensitive fields in JSON
// userSchema.set('toJSON', {
//   virtuals: true,
//   transform: (doc, ret) => {
//     delete ret.password
//     delete ret.emailConfirmToken
//     delete ret.passwordResetToken
//     if (ret.adminConfig?.adminPassword) {
//       delete ret.adminConfig.adminPassword
//     }
//     if (ret.adminConfig?.notepadPassword) {
//       delete ret.adminConfig.notepadPassword
//     }
//     return ret
//   }
// })

// export default mongoose.model('User', userSchema)
