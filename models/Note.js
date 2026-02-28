import mongoose from 'mongoose'

const noteSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 255
  },
  // ENCRYPTED: AES-256-GCM encrypted note content
  // Stored as base64(iv|tag|encrypted) for security
  // Must be decrypted before display to user
  // Encrypted field ensures content is unreadable in database
  content: {
    type: String,
    default: '',
    // Allow large text content - encryption adds ~33% overhead
    // (base64 encoding of 12 byte IV + 16 byte tag + encrypted data)
    maxlength: 1500000
  },
  scheduleDate: {
    type: String,
    default: null
    // Stored as YYYY-MM-DD string (user's local date, not converted to UTC)
  },
  // Scheduled time in HH:MM format (e.g., "14:30")
  scheduledTime: {
    type: String,
    default: null
    // Format: "HH:MM" in 24-hour format
  },
  // User's IANA timezone identifier (e.g., "America/New_York", "Africa/Lagos", "Europe/London")
  timezone: {
    type: String,
    default: 'UTC'
  },
  // Combined scheduled timestamp in UTC for easy querying/cron jobs
  // This is the exact date/time in user's timezone, converted to UTC
  scheduledUTC: {
    type: Date,
    default: null,
    index: true
  },
  // Scheduled time in UTC (when user specifies both date AND time)
  // Used for time-specific reminders
  scheduledTimeUTC: {
    type: Date,
    default: null
  },
  // =====================
  // EMAIL REMINDER TRACKING
  // =====================
  // Email reminder at start of day (00:00 in user's timezone on scheduled date)
  emailReminderSentStartOfDay: {
    type: Boolean,
    default: false
  },
  emailReminderSentStartOfDayAt: {
    type: Date,
    default: null
  },
  // Track reminder status: pending, sent, expired
  reminderStatus: {
    type: String,
    enum: ['pending', 'sent', 'expired'],
    default: 'pending'
  },
  // Actual time the reminder was sent (for recovery & missed reminder detection)
  reminderSentActualTime: {
    type: Date,
    default: null
  },
  // Track if this reminder was a missed reminder recovery
  reminderWasMissedRecovery: {
    type: Boolean,
    default: false
  },
  // When the reminder expires (23:59:59 local time of scheduled date in UTC)
  reminderExpiresAt: {
    type: Date,
    default: null,
    index: true
  },
  // Legacy fields - kept for backward compatibility
  emailReminderSent: {
    type: Boolean,
    default: false
  },
  emailReminderSentAt: {
    type: Date,
    default: null
  },
  // =====================
  // SHARED NOTE TRACKING
  // =====================
  // List of recipients this note has been shared with (immediate send)
  sharedRecipients: [{
    email: String,
    sentAt: Date,
    customMessage: String
  }],
  // If true, this note should be sent to sharedRecipients again on scheduled date at start-of-day
  // This is set when a user sends a note with a scheduled date
  shouldSendOnScheduledDate: {
    type: Boolean,
    default: false
  },
  // Track when scheduled send to shared recipients has been completed
  scheduledSendToRecipientsCompleted: {
    type: Boolean,
    default: false
  },
  scheduledSendToRecipientsCompletedAt: {
    type: Date,
    default: null
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  },
  color: {
    // Optional: for visual distinction between notes (like real phone notes)
    type: String,
    default: 'yellow',
    enum: ['yellow', 'blue', 'red', 'green', 'purple', 'pink', 'orange']
  },
  // =====================
  // MEDIA STORAGE
  // =====================
  // Array of images attached to this note
  // Each image stored in Cloudinary with URL and metadata
  images: [{
    publicId: String,        // Cloudinary public ID for deletion
    url: String,             // Secure HTTPS URL to image
    format: String,          // Image format (jpg, png, webp)
    width: Number,           // Image width in pixels
    height: Number,          // Image height in pixels
    fileSize: Number,        // File size in bytes
    uploadedAt: { type: Date, default: Date.now }
  }],
  // Array of videos attached to this note (supports multiple videos)
  // Each video stored in Cloudinary with URL, metadata, and thumbnail
  video: [{
    publicId: String,        // Cloudinary public ID for deletion
    url: String,             // Secure HTTPS URL to video
    format: String,          // Video format (mp4, webm, quicktime)
    duration: Number,        // Video duration in seconds
    fileSize: Number,        // File size in bytes
    thumbnail: String,       // URL to auto-generated thumbnail
    uploadedAt: { type: Date, default: Date.now }
  }],
  // Array of PDF attachments to this note
  // Each PDF stored in Cloudinary with URL and metadata
  attachments: [{
    publicId: String,        // Cloudinary public ID for deletion
    url: String,             // Secure HTTPS URL to PDF
    filename: String,        // Original filename
    fileSize: Number,        // File size in bytes
    uploadedAt: { type: Date, default: Date.now }
  }],
  // Track media upload completion (for scheduled sends)
  mediaIncludedInScheduledSend: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
})

// Index for quick lookups
noteSchema.index({ userId: 1, isDeleted: 1, createdAt: -1 })
noteSchema.index({ userId: 1, isArchived: 1 })
noteSchema.index({ scheduledUTC: 1, emailReminderSent: 1 })
noteSchema.index({ userId: 1, scheduledUTC: 1 })

// Hide sensitive fields in JSON
noteSchema.set('toJSON', {
  transform: (doc, ret) => {
    return ret
  }
})

export default mongoose.model('Note', noteSchema)