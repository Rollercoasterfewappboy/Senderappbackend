import express from 'express'
import Note from '../models/Note.js'
import { authenticateToken, requireUser, requireUserAdmin } from '../middleware/auth.js'
import { sendSharedNoteEmail } from '../utils/email.js'
import { sendEmailWithProvider } from '../utils/emailSenders.js'
import EmailProvider from '../models/EmailProvider.js'
import { encryptText, decryptText } from '../utils/encryption.js'
import { DateTime } from 'luxon'
import { 
  uploadMulter, 
  uploadImagesToCloudinary, 
  uploadVideoToCloudinary,
  uploadVideosToCloudinary,
  uploadPDFsToCloudinary,
  deleteMediaFromCloudinary, 
  deleteMediaArrayFromCloudinary, 
  validateMediaLimits, 
  extractMediaFromRequest 
} from '../utils/mediaUpload.js'

import crypto from 'crypto'

// Helper: replace braced placeholders {PLACEHOLDER}
function replaceBracedPlaceholders(content, placeholders) {
  if (!content || typeof content !== 'string') return content
  let replaced = content
  for (const [k, v] of Object.entries(placeholders)) {
    const regex = new RegExp(`{${k}}`, 'g')
    replaced = replaced.replace(regex, String(v || ''))
  }
  return replaced
}

// Simple generators used by professional placeholder system
function generateRandom10DigitNumber() {
  return Math.floor(1000000000 + Math.random() * 9000000000).toString()
}

function generateRandomString() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const len = 7 + Math.floor(Math.random() * 4)
  let s = ''
  for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length))
  return s
}

function generateRandomMD5() {
  return crypto.createHash('md5').update(Math.random().toString()).digest('hex')
}

function generateRandomPath() {
  const segments = ['user', 'data', 'files', 'documents', 'assets', 'media', 'uploads']
  const parts = []
  const length = 2 + Math.floor(Math.random() * 3)
  for (let i = 0; i < length; i++) parts.push(segments[Math.floor(Math.random() * segments.length)] + Math.floor(Math.random() * 1000))
  return '/' + parts.join('/')
}

function generateRandomLink() {
  const base = 'https://example.com/track'
  const id = Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 8)
  return `${base}/${id}`
}

function generateFakeCompanyName() {
  const prefixes = ['Tech','Data','Digital','Smart','Cloud','Web','Cyber','Next','Prime','Ultra','Pro','Mega','Elite']
  const suffixes = ['Nova','Solutions','Systems','Labs','Hub','Works','Wave','Stream','Tech','Sync','Flow','Link','Direct']
  const p = prefixes[Math.floor(Math.random()*prefixes.length)]
  const s = suffixes[Math.floor(Math.random()*suffixes.length)]
  return `${p}${s}`
}

function generateFakeCompanyEmail() {
  const name = generateFakeCompanyName().toLowerCase()
  const domains = ['com','net','io','co','org','us']
  const tld = domains[Math.floor(Math.random()*domains.length)]
  return `contact@${name}.${tld}`
}

function generateFakeCompanyEmailAndFullName() {
  const first = ['John','Jane','Michael','Sarah','James','Emily','David','Lisa','Robert','Jennifer']
  const last = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez']
  const f = first[Math.floor(Math.random()*first.length)]
  const l = last[Math.floor(Math.random()*last.length)]
  return `${f} ${l} <${generateFakeCompanyEmail()}>`
}

function encodeBase64(s) {
  return Buffer.from(String(s)).toString('base64')
}

const router = express.Router()

// Middleware to check notepad password verification
const requireNotepadPasswordVerified = (req, res, next) => {
  // Skip if user is admin (has password management access)
  if (req.user?.adminConfig?.isAdmin) {
    return next()
  }

  // Check if user has notepad password set
  if (req.user?.adminConfig?.notepadPassword) {
    // Check if password was verified (frontend sends verification header)
    const passwordVerified = req.headers['x-notepad-password-verified'] === 'true'
    
    if (!passwordVerified) {
      return res.status(403).json({ 
        message: 'Notepad access requires password verification',
        requiresPassword: true
      })
    }
  }

  next()
}

// =====================
// HELPER: Decrypt note content
// =====================
// Safely decrypts note content, handling both encrypted and legacy plain text notes
const decryptNoteContent = (encryptedContent) => {
  if (!encryptedContent) return ''
  // decryptText now handles both encrypted and plain text gracefully
  // No need to catch errors - it returns the original content if decryption fails
  const decrypted = decryptText(encryptedContent)
  return decrypted || ''
}

// =====================
// HELPER: Decrypt note object or array of notes
// =====================
const decryptNotes = (notes) => {
  if (!notes) return notes
  
  // Handle single note object
  if (!Array.isArray(notes)) {
    const note = notes.toObject ? notes.toObject() : notes
    note.content = decryptNoteContent(note.content)
    return note
  }
  
  // Handle array of notes
  return notes.map(note => {
    const noteObj = note.toObject ? note.toObject() : note
    noteObj.content = decryptNoteContent(noteObj.content)
    return noteObj
  })
}

// =====================
// CREATE NOTE
// =====================
// Both users and admins can create notes
router.post('/', authenticateToken, requireUser, requireNotepadPasswordVerified, async (req, res) => {
  try {
    const { title, content, color } = req.body
    const userId = req.user._id

    // Validate required fields
    if (!title || title.trim() === '') {
      return res.status(400).json({ message: 'Note title is required' })
    }

    // ENCRYPT: Encrypt content before storing
    let encryptedContent = ''
    try {
      encryptedContent = encryptText(content || '')
    } catch (error) {
      console.error('Error encrypting note content:', error)
      return res.status(500).json({ message: 'Failed to encrypt note', error: error.message })
    }

    // create note without scheduling/timezone
    const note = new Note({
      userId,
      title: title.trim(),
      content: encryptedContent,  // ENCRYPTED content stored
      color: color || 'yellow'
    })

    // if attachments provided directly (API use), set them
    if (req.body.attachments && Array.isArray(req.body.attachments)) {
      note.attachments = req.body.attachments
    }

    await note.save()

    // DECRYPT: Return decrypted content to user for display
    const responseNote = note.toObject()
    try {
      responseNote.content = decryptText(responseNote.content)
    } catch (error) {
      console.error('Error decrypting note for response:', error)
      responseNote.content = ''
    }

    res.status(201).json({
      message: 'Note created successfully',
      note: responseNote
    })
  } catch (error) {
    console.error('Error creating note:', error)
    res.status(500).json({ message: 'Error creating note', error: error.message })
  }
})

// =====================
// GET ALL NOTES FOR USER
// =====================
// Both users and admins can view their own notes
router.get('/', authenticateToken, requireUser, requireNotepadPasswordVerified, async (req, res) => {
  try {
    const { page = 1, limit = 20, archived = false, search } = req.query
    const userId = req.user._id

    const query = {
      userId,
      isDeleted: false,
      isArchived: archived === 'true'
    }

    if (search) {
      // Note: We can still search on title (unencrypted)
      // Searching encrypted content is not supported for privacy reasons
      query.title = { $regex: search, $options: 'i' }
    }

    const notes = await Note.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)

    const total = await Note.countDocuments(query)

    // DECRYPT: Decrypt all notes before returning to user
    let decryptedNotes
    try {
      decryptedNotes = decryptNotes(notes)
    } catch (err) {
      console.error('[notes] Error during notes decryption:', err)
      // fallback to returning raw notes without decryption to avoid 500
      decryptedNotes = notes
    }

    res.json({
      notes: decryptedNotes,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    })
  } catch (error) {
    console.error('Error fetching notes:', error)
    res.status(500).json({ message: 'Error fetching notes', error: error.message })
  }
})

// =====================
// GET SINGLE NOTE
// =====================
// Users can get their own notes
// Admins can get any note
router.get('/:id', authenticateToken, requireUser, requireNotepadPasswordVerified, async (req, res) => {
  try {
    const note = await Note.findById(req.params.id)

    if (!note) {
      return res.status(404).json({ message: 'Note not found' })
    }

    // Regular users can only view their own notes
    const isAdmin = req.user.adminConfig && req.user.adminConfig.isAdmin === true
    if (!isAdmin && note.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You do not have permission to view this note' })
    }

    // DECRYPT: Decrypt content before returning
    const decryptedNote = decryptNotes(note)

    res.json(decryptedNote)
  } catch (error) {
    console.error('Error fetching note:', error)
    res.status(500).json({ message: 'Error fetching note', error: error.message })
  }
})

// =====================
// UPLOAD MEDIA TO NOTE (must be before /:id routes)
// =====================
// Upload images, videos, and/or PDFs to an existing note
router.post('/:id/media', authenticateToken, requireUser, requireNotepadPasswordVerified, uploadMulter.any(), async (req, res) => {
  try {
    const noteId = req.params.id
    const userId = req.user._id

    // Find note
    const note = await Note.findById(noteId)
    if (!note) {
      return res.status(404).json({ message: 'Note not found' })
    }

    // Check authorization (user owns note or is admin)
    if (note.userId.toString() !== userId.toString() && !req.user.adminConfig?.isAdmin) {
      return res.status(403).json({ message: 'Unauthorized to modify this note' })
    }

    // Extract media from request
    const { images: imageFiles, video: videoFiles, attachments: pdfFiles } = extractMediaFromRequest(req)

    if (imageFiles.length === 0 && videoFiles.length === 0 && pdfFiles.length === 0) {
      return res.status(400).json({ message: 'No valid media files provided' })
    }

    // Validate media limits
    const currentMedia = {
      images: note.images || [],
      video: note.video || [],
      attachments: note.attachments || []
    }
    const validation = validateMediaLimits(currentMedia, imageFiles, videoFiles.length > 0 ? videoFiles[0] : null)
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error })
    }

    // Upload images to Cloudinary
    let uploadedImages = []
    if (imageFiles.length > 0) {
      try {
        uploadedImages = await uploadImagesToCloudinary(imageFiles)
      } catch (error) {
        return res.status(400).json({ message: error.message })
      }
    }

    // Upload videos to Cloudinary
    let uploadedVideos = []
    if (videoFiles.length > 0) {
      try {
        uploadedVideos = await uploadVideosToCloudinary(videoFiles)
      } catch (error) {
        // Clean up uploaded images if video upload fails
        if (uploadedImages.length > 0) {
          await deleteMediaArrayFromCloudinary(uploadedImages)
        }
        return res.status(400).json({ message: error.message })
      }
    }

    // Upload PDFs to Cloudinary
    let uploadedPDFs = []
    if (pdfFiles.length > 0) {
      try {
        uploadedPDFs = await uploadPDFsToCloudinary(pdfFiles)
      } catch (error) {
        // Clean up uploaded images and videos if PDF upload fails
        if (uploadedImages.length > 0) {
          await deleteMediaArrayFromCloudinary(uploadedImages)
        }
        if (uploadedVideos.length > 0) {
          await deleteMediaArrayFromCloudinary(uploadedVideos)
        }
        return res.status(400).json({ message: error.message })
      }
    }

    // Update note with new media
    note.images = (note.images || []).concat(uploadedImages)
    
    // Support multiple videos (append to array)
    if (uploadedVideos.length > 0) {
      // Initialize video array if it doesn't exist
      if (!note.video) {
        note.video = []
      }
      // Ensure it's an array
      if (!Array.isArray(note.video)) {
        note.video = [note.video]
      }
      note.video = note.video.concat(uploadedVideos)
    }

    // Support multiple PDFs (append to array)
    if (uploadedPDFs.length > 0) {
      // Initialize attachments array if it doesn't exist
      if (!note.attachments) {
        note.attachments = []
      }
      // Ensure it's an array
      if (!Array.isArray(note.attachments)) {
        note.attachments = [note.attachments]
      }
      note.attachments = note.attachments.concat(uploadedPDFs)
    }

    await note.save()

    // DECRYPT: Return updated note
    const decryptedNote = decryptNotes(note)

    res.json({
      message: 'Media uploaded successfully',
      note: decryptedNote,
      uploadedMedia: {
        images: uploadedImages.length,
        videos: uploadedVideos.length,
        attachments: uploadedPDFs.length
      }
    })
  } catch (error) {
    console.error('Error uploading media:', error)
    res.status(500).json({ message: 'Error uploading media', error: error.message })
  }
})

// =====================
// DELETE MEDIA FROM NOTE (must be before /:id routes)
// =====================
// Delete image, video, or PDF from a note
router.delete('/:id/media/:mediaId', authenticateToken, requireUser, requireNotepadPasswordVerified, async (req, res) => {
  try {
    const { id: noteId, mediaId: encodedMediaId } = req.params
    // Decode mediaId in case it contains URL-encoded characters (e.g., slashes from Cloudinary folder paths)
    const mediaId = decodeURIComponent(encodedMediaId)
    const userId = req.user._id

    console.log(`📤 DELETE MEDIA: noteId=${noteId}, mediaId=${mediaId}`)

    // Find note
    const note = await Note.findById(noteId)
    if (!note) {
      return res.status(404).json({ message: 'Note not found' })
    }

    // Check authorization
    if (note.userId.toString() !== userId.toString() && !req.user.adminConfig?.isAdmin) {
      return res.status(403).json({ message: 'Unauthorized to modify this note' })
    }

    let found = false

    // Try to delete from images
    const imageIndex = (note.images || []).findIndex(img => img.publicId === mediaId)
    if (imageIndex !== -1) {
      const image = note.images[imageIndex]
      await deleteMediaFromCloudinary(image.publicId)
      note.images.splice(imageIndex, 1)
      found = true
    }

    // Try to delete from videos (now an array)
    if (!found) {
      if (Array.isArray(note.video)) {
        const videoIndex = note.video.findIndex(vid => vid.publicId === mediaId)
        if (videoIndex !== -1) {
          const video = note.video[videoIndex]
          await deleteMediaFromCloudinary(video.publicId)
          note.video.splice(videoIndex, 1)
          // Clean up empty array
          if (note.video.length === 0) {
            note.video = undefined
          }
          found = true
        }
      }
    }

    // Try to delete from attachments (PDFs)
    if (!found) {
      if (Array.isArray(note.attachments)) {
        const attachmentIndex = note.attachments.findIndex(att => att.publicId === mediaId)
        if (attachmentIndex !== -1) {
          const attachment = note.attachments[attachmentIndex]
          await deleteMediaFromCloudinary(attachment.publicId)
          note.attachments.splice(attachmentIndex, 1)
          // Clean up empty array
          if (note.attachments.length === 0) {
            note.attachments = undefined
          }
          found = true
        }
      }
    }

    if (!found) {
      return res.status(404).json({ message: 'Media not found' })
    }

    await note.save()

    // DECRYPT: Return updated note
    const decryptedNote = decryptNotes(note)

    res.json({
      message: 'Media deleted successfully',
      note: decryptedNote
    })
  } catch (error) {
    console.error('Error deleting media:', error)
    res.status(500).json({ message: 'Error deleting media', error: error.message })
  }
})

// =====================
// UPDATE NOTE
// =====================
// Only admins can edit notes (including their own and others')
// Regular users cannot edit any note
router.put('/:id', authenticateToken, requireUser, requireNotepadPasswordVerified, async (req, res) => {
  try {
    const { title, content, color, isArchived } = req.body

    const note = await Note.findById(req.params.id)
    if (!note) {
      return res.status(404).json({ message: 'Note not found' })
    }

    // Authorization: allow admins or the note owner
    const isAdminUser = req.user?.adminConfig?.isAdmin === true
    if (!isAdminUser && note.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You do not have permission to edit this note' })
    }

    // Apply updates
    if (title !== undefined) note.title = title.trim()
    
    // ENCRYPT: Encrypt content if being updated
    if (content !== undefined) {
      try {
        note.content = encryptText(content)
      } catch (error) {
        console.error('Error encrypting note content:', error)
        return res.status(500).json({ message: 'Failed to encrypt note', error: error.message })
      }
    }
    
    if (color !== undefined) note.color = color
    if (isArchived !== undefined) note.isArchived = isArchived

    // allow attachments metadata (filename changes) to be updated when provided
    if (req.body.attachments !== undefined) {
      const incoming = req.body.attachments
      if (Array.isArray(incoming) && note.attachments && Array.isArray(note.attachments)) {
        incoming.forEach((att) => {
          if (!att || !att.publicId) return
          const idx = note.attachments.findIndex(existing => existing.publicId === att.publicId)
          if (idx !== -1 && att.filename !== undefined) {
            note.attachments[idx].filename = att.filename
          }
        })
      }
    }

    // scheduling and timezone features have been removed; remaining fields ignored

    await note.save()

    // DECRYPT: Return decrypted content to user
    const decryptedNote = decryptNotes(note)

    res.json({
      message: 'Note updated successfully',
      note: decryptedNote
    })
  } catch (error) {
    console.error('Error updating note:', error)
    res.status(500).json({ message: 'Error updating note', error: error.message })
  }
})

// =====================
// GET TODAY'S SCHEDULED NOTES
// =====================
// Fetch notes scheduled for today in the user's timezone
// Used by the dashboard scheduled notes widget
// No password verification needed since it's just a summary on the main dashboard
router.get('/scheduled/today', authenticateToken, requireUser, async (req, res) => {
  try {
    const userId = req.user._id
    const userTimezone = req.query.timezone || 'UTC'

    // Get the current date range in UTC
    // We need to find notes where the scheduledUTC falls within today in the user's timezone
    
    // Get start and end of today in user's timezone
    const now = DateTime.now().setZone(userTimezone)
    const todayStart = now.startOf('day').toUTC()
    const todayEnd = now.endOf('day').toUTC()

    const notes = await Note.find({
      userId,
      isDeleted: false,
      isArchived: false,
      scheduledUTC: {
        $gte: todayStart.toJSDate(),
        $lte: todayEnd.toJSDate()
      }
    }).sort({ scheduledUTC: 1 })

    // DECRYPT: Decrypt notes before returning
    const decryptedNotes = decryptNotes(notes)

    res.json({
      notes: decryptedNotes,
      count: decryptedNotes.length,
      userTimezone
    })
  } catch (error) {
    console.error('Error fetching today\'s scheduled notes:', error)
    res.status(500).json({ message: 'Error fetching today\'s scheduled notes', error: error.message })
  }
})

// =====================
// GET NOTES WITH SENT REMINDERS
// =====================
// ⚠️ Reminder functionality has been removed
router.get('/sent-reminders/list', authenticateToken, requireUser, requireNotepadPasswordVerified, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query

    // Reminder feature removed - return empty array
    res.json({
      notes: [],
      totalPages: 0,
      currentPage: parseInt(page),
      total: 0
    })
  } catch (error) {
    console.error('Error fetching sent reminders:', error)
    res.status(500).json({ message: 'Error fetching sent reminders', error: error.message })
  }
})

// =====================
// SEND NOTE
// =====================
// Any authenticated user can send their own notes
// If note has a scheduled date, send immediately AND schedule a second send for that date
router.post('/:id/send', authenticateToken, requireUser, async (req, res) => {
  try {
    const { recipientEmails, customMessage, fromName, fromEmail, callToActionText, callLink } = req.body
    const noteId = req.params.id

    // ============================================================
    // SEND BUTTON BEHAVIOR - DUAL SEND
    // ============================================================
    // When the user clicks the Send button:
    // 1. IMMEDIATE SEND: Note is sent instantly to all recipients
    // 2. SCHEDULED SEND: If note has a scheduled date, note will be
    //    sent again automatically at 00:00 local time on that date
    // ============================================================

    // Validate input
    if (!recipientEmails || (Array.isArray(recipientEmails) ? recipientEmails.length === 0 : !recipientEmails.trim())) {
      return res.status(400).json({ message: 'At least one recipient email is required' })
    }

    // Validate sender details
    if (!fromName || !fromName.trim()) {
      return res.status(400).json({ message: 'From name is required' })
    }
    if (!fromEmail || !fromEmail.trim()) {
      return res.status(400).json({ message: 'From email is required' })
    }

    // Validate from email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(fromEmail.trim())) {
      return res.status(400).json({ message: 'Invalid from email format' })
    }

    // Fetch the note
    const note = await Note.findById(noteId)
    if (!note) {
      return res.status(404).json({ message: 'Note not found' })
    }

    // Verify user has access to this note
    if (note.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You do not have permission to share this note' })
    }

    // Parse recipient emails
    let emails = []
    if (Array.isArray(recipientEmails)) {
      emails = recipientEmails.filter(email => email && email.trim())
    } else if (typeof recipientEmails === 'string') {
      // Split by comma or newline
      emails = recipientEmails
        .split(/[,\n]+/)
        .map(email => email.trim())
        .filter(email => email)
    }

    // Validate email format
    const invalidEmails = emails.filter(email => !emailRegex.test(email))
    if (invalidEmails.length > 0) {
      return res.status(400).json({ 
        message: 'Invalid email format',
        invalidEmails
      })
    }

    // Remove duplicates
    const uniqueEmails = [...new Set(emails)]

    // Use provided sender name (from frontend form)
    const senderName = fromName.trim()

    // ==================== FETCH EMAIL PROVIDER ====================
    // Get the user's configured email provider
    const providerDoc = await EmailProvider.findOne({ userId: req.user._id })
    if (!providerDoc) {
      return res.status(400).json({ message: 'Email settings not configured. Please configure email settings first.' })
    }

    console.log(`\n========== EMAIL PROVIDER VALIDATION ==========`)
    console.log(`Provider Type: ${providerDoc.provider}`)
    console.log(`Provider ID: ${providerDoc._id}`)

    // Validate that provider has configuration
    if (providerDoc.provider === 'smtp') {
      if (!providerDoc.smtp?.host) {
        console.error(`❌ SMTP host is missing`)
        return res.status(400).json({ message: 'SMTP host not configured. Please complete your email settings.' })
      }
      if (!providerDoc.smtp?.username) {
        console.error(`❌ SMTP username is missing`)
        return res.status(400).json({ message: 'SMTP username not configured. Please complete your email settings.' })
      }
      if (!providerDoc.smtp?.password) {
        console.error(`❌ SMTP password is missing`)
        return res.status(400).json({ message: 'SMTP password not configured. Please complete your email settings.' })
      }
      console.log(`✅ SMTP configured: ${providerDoc.smtp.host}:${providerDoc.smtp.port} (${providerDoc.smtp.encryption})`)
    } else if (providerDoc.provider === 'aws') {
      if (!providerDoc.aws?.username || !providerDoc.aws?.password) {
        console.error(`❌ AWS credentials are missing`)
        return res.status(400).json({ message: 'AWS provider not fully configured. Please complete your email settings.' })
      }
      console.log(`✅ AWS configured: region ${providerDoc.aws.region}`)
    } else if (providerDoc.provider === 'resend') {
      if (!providerDoc.resend?.apiKey) {
        console.error(`❌ Resend API key is missing`)
        return res.status(400).json({ message: 'Resend API key not configured. Please complete your email settings.' })
      }
      console.log(`✅ Resend configured: API key present`)
    } else {
      console.error(`❌ Unknown provider: ${providerDoc.provider}`)
      return res.status(400).json({ message: `Unknown email provider: ${providerDoc.provider}` })
    }
    console.log(`============================================\n`)

    // Decrypt the note content (keep original for scheduled sends)
    const decryptedContent = decryptNoteContent(note.content)
    console.log(`\n========== BUILDING EMAIL CONTENT (per-recipient rendering) ==========`)
    console.log(`Note Title: ${note.title}`)
    console.log(`Decrypted Content Length: ${decryptedContent.length} chars`)
    console.log(`Custom Message (raw): ${customMessage ? customMessage.substring(0, 50) + '...' : 'None'}`)
    console.log(`CTA (raw): ${callToActionText ? callToActionText : 'None'}`)

    // Helper to build rendered HTML for each recipient (applies placeholders)
    const buildEmailForRecipient = (recipientEmail) => {
      // Extract recipient info
      const emailLocalPart = recipientEmail.split('@')[0]
      const recipientName = (emailLocalPart.split('.')[0] || emailLocalPart)
      const recipientDomain = recipientEmail.split('@')[1] || ''
      const recipientDomainName = (recipientDomain.split('.')[0] || '')

      const currentDate = new Date().toLocaleDateString()
      const currentTime = new Date().toLocaleTimeString()

      const placeholderMap = {
        'RECIPIENT_NAME': recipientName.charAt(0).toUpperCase() + recipientName.slice(1),
        'RECIPIENT_EMAIL': recipientEmail,
        'RECIPIENT_DOMAIN': recipientDomain,
        'RECIPIENT_DOMAIN_NAME': recipientDomainName,
        'RECIPIENT_BASE64_EMAIL': encodeBase64(recipientEmail),
        'CURRENT_DATE': currentDate,
        'CURRENT_TIME': currentTime,
        'RANDOM_NUMBER10': generateRandom10DigitNumber(),
        'RANDOM_STRING': generateRandomString(),
        'RANDOM_MD5': generateRandomMD5(),
        'RANDOM_PATH': generateRandomPath(),
        'RANDLINK': generateRandomLink(),
        'FAKE_COMPANY': generateFakeCompanyName(),
        'FAKE_COMPANY_EMAIL': generateFakeCompanyEmail(),
        'FAKE_COMPANY_EMAIL_AND_FULLNAME': generateFakeCompanyEmailAndFullName(),
      }

      // Render title, content, custom message, CTA and sender name
      const renderedTitle = replaceBracedPlaceholders(note.title || '', placeholderMap)
      const renderedContent = replaceBracedPlaceholders(decryptedContent || '', placeholderMap)
      const renderedCustomMessage = customMessage ? replaceBracedPlaceholders(customMessage, placeholderMap) : null
      const renderedCallToActionText = callToActionText ? replaceBracedPlaceholders(callToActionText, placeholderMap) : null
      const renderedCallLink = callLink ? replaceBracedPlaceholders(callLink, placeholderMap) : null
      const renderedSenderName = replaceBracedPlaceholders(senderName, placeholderMap)

      // Build media HTML with placeholders applied to image/video URLs
      let mediaHTML = ''
      const mediaImages = note.images || []
      const mediaVideo = note.video || null
      const mediaAttachments = note.attachments || []

      if (mediaImages && mediaImages.length > 0) {
        mediaHTML += '<div style="margin: 20px 0;">'
        mediaHTML += '<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">📸 Images:</p>'
        mediaImages.forEach((image, index) => {
          const imageUrlRaw = typeof image === 'string' ? image : (image.url || image.publicId)
          if (imageUrlRaw) {
            const imageUrlReplaced = replaceBracedPlaceholders(String(imageUrlRaw), placeholderMap)
            const validUrl = imageUrlReplaced.startsWith('http') ? imageUrlReplaced : `https://${imageUrlReplaced}`
            mediaHTML += `<div style="margin-bottom: 15px;"><img src="${validUrl}" alt="Note image ${index + 1}" style="max-width: 100%; height: auto; border-radius: 8px; display: block; margin: 10px 0; max-height: 400px; border: 1px solid #ddd;" /></div>`
          }
        })
        mediaHTML += '</div>'
      }

      if (mediaVideo) {
        const videos = Array.isArray(mediaVideo) ? mediaVideo : (mediaVideo ? [mediaVideo] : [])
        if (videos.length > 0) {
          mediaHTML += '<div style="margin: 20px 0;">'
          mediaHTML += `<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">🎥 Video${videos.length > 1 ? 's' : ''}:</p>`
          videos.forEach((vid, index) => {
            const videoUrlRaw = typeof vid === 'string' ? vid : (vid.url || vid.publicId)
            if (videoUrlRaw) {
              const videoUrlReplaced = replaceBracedPlaceholders(String(videoUrlRaw), placeholderMap)
              const validVideoUrl = videoUrlReplaced.startsWith('http') ? videoUrlReplaced : `https://${videoUrlReplaced}`
              mediaHTML += `<div style="margin-bottom: 20px; background-color: #f5f5f5; padding: 15px; border-radius: 8px;"><p style="color: #555; font-weight: bold; font-size: 13px; margin: 0 0 10px 0;">Video ${index + 1}</p><a href="${validVideoUrl}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">▶️ Watch Video ${index + 1}</a></div>`
            }
          })
          mediaHTML += '</div>'
        }
      }

      if (mediaAttachments && mediaAttachments.length > 0) {
        mediaHTML += '<div style="margin: 20px 0;">'
        mediaHTML += '<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">📎 Attachments:</p>'
        mediaAttachments.forEach((attachment, index) => {
          let filename = typeof attachment === 'object' ? (attachment.filename || `Attachment ${index + 1}`) : `Attachment ${index + 1}`
          // allow placeholders in attachment names
          filename = replaceBracedPlaceholders(String(filename), placeholderMap)
          // if attachment has a URL we can make it clickable
          if (attachment && typeof attachment === 'object' && attachment.url) {
            let url = replaceBracedPlaceholders(String(attachment.url), placeholderMap)
            const validUrl = url.startsWith('http') ? url : `https://${url}`
            mediaHTML += `<p style="margin: 5px 0; color: #555; font-size: 13px;"><a href=\"${validUrl}\" style=\"color:#555;text-decoration:underline\">📄 ${filename}</a></p>`
          } else {
            mediaHTML += `<p style="margin: 5px 0; color: #555; font-size: 13px;">📄 ${filename}</p>`
          }
        })
        mediaHTML += '</div>'
      }

      // CTA Button
      let ctaHTML = ''
      if (renderedCallToActionText && renderedCallLink) {
        const validLink = renderedCallLink.startsWith('http') ? renderedCallLink : `https://${renderedCallLink}`
        ctaHTML = `
          <div style="text-align: center; margin: 30px 0;">
            <a href="${validLink}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; transition: transform 0.3s, box-shadow 0.3s;">
              ${renderedCallToActionText}
            </a>
          </div>
        `
      }

      const emailHTML = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; padding: 20px 0;">
          <div style="max-width: 600px; margin: 0 auto;">
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; border-radius: 16px 16px 0 0;">
              <div style="background-color: rgba(255,255,255,0.15); width: 56px; height: 56px; border-radius: 12px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
                <span style="font-size: 28px;">📝</span>
              </div>
              <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 600;">Note Shared with You</h1>
              <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px;">from <strong>${renderedSenderName}</strong></p>
            </div>
            
            <!-- Main Content -->
            <div style="background-color: #ffffff; padding: 40px 30px;">
              <!-- Greeting -->
              <p style="margin: 0 0 24px 0; font-size: 16px; color: #1e293b; line-height: 1.5;">Hi ${placeholderMap.RECIPIENT_NAME},</p>
              
              <!-- Note Content Card -->
              <div style="background-color: #f1f5f9; border-left: 4px solid #667eea; padding: 24px; border-radius: 8px; margin: 24px 0;">
                <h2 style="margin: 0 0 16px 0; color: #0f172a; font-size: 20px; font-weight: 600; word-break: break-word;">${renderedTitle}</h2>
                <div style="background-color: #ffffff; padding: 16px; border-radius: 6px; color: #334155; font-size: 15px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;">${renderedContent || '(No content)'}</div>
                ${mediaHTML}
              </div>
              
              <!-- Personal Message -->
              ${renderedCustomMessage ? `
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 24px 0;">
                <p style="margin: 0 0 8px 0; color: #92400e; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">💬 Message</p>
                <p style="margin: 0; color: #78350f; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${renderedCustomMessage}</p>
              </div>
              ` : ''}
              
              <!-- CTA Button -->
              ${ctaHTML}
            </div>
            
            <!-- Footer -->
            <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-radius: 0 0 16px 16px; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 1.5;">
                <strong style="color: #0f172a;">Note Received</strong><br>
                Your note management platform
              </p>
            </div>
          </div>
        </div>
      `

      const renderedSubject = `📝 ${renderedSenderName} shared a note with you: "${renderedTitle}"`

      return {
        renderedSubject,
        renderedBody: emailHTML,
        renderedSenderName,
        renderedTitle,
        renderedContent,
        renderedCustomMessage,
        renderedCallToActionText,
        renderedCallLink
      }
    }

    // ==================== SEND TO ALL RECIPIENTS ====================
    const sendResults = {
      successCount: 0,
      failureCount: 0,
      failures: []
    }

    for (const recipientEmail of uniqueEmails) {
      try {
        console.log(`\n📧 =========== SENDING NOTE TO: ${recipientEmail} ===========`)

        // Build per-recipient rendered subject/body and rendered sender
        const {
          renderedSubject,
          renderedBody,
          renderedSenderName,
          renderedTitle,
          renderedContent,
          renderedCustomMessage,
          renderedCallToActionText,
          renderedCallLink
        } = buildEmailForRecipient(recipientEmail)

        console.log(`📋 Provider: ${providerDoc.provider}`)
        console.log(`👤 From: ${renderedSenderName} <${fromEmail.trim()}>`)
        console.log(`📝 Subject: ${renderedSubject}`)

        // Try primary method: sendEmailWithProvider
        let result = await sendEmailWithProvider({
          providerDoc,
          to: [recipientEmail],
          subject: renderedSubject,
          body: renderedBody,
          fromName: renderedSenderName,
          fromEmail: fromEmail.trim(),
          format: 'html',
          attachments: []
        })

        console.log(`📬 Send Result:`, result)

        // If sendEmailWithProvider fails and provider is resend, try fallback with sendSharedNoteEmail using rendered content
        if (!result.success && providerDoc.provider === 'resend') {
          console.log(`⚠️  sendEmailWithProvider failed, attempting fallback with sendSharedNoteEmail...`)
          try {
            await sendSharedNoteEmail(
              recipientEmail,
              renderedSenderName,
              renderedTitle,
              renderedContent,
              renderedCustomMessage || '',
              req.user,
              note.timezone,
              renderedSubject,
              note.images || [],
              note.video || null,
              uniqueEmails,
              note.attachments || [],
              fromEmail.trim(),
              renderedCallToActionText ? renderedCallToActionText.trim() : null,
              renderedCallLink ? renderedCallLink.trim() : null
            )
            result = { success: true }
            console.log(`✅ Fallback method succeeded`)
          } catch (fallbackError) {
            console.error(`❌ Fallback method also failed: ${fallbackError.message}`)
          }
        }

        if (result.success) {
          sendResults.successCount++
          console.log(`✅ SUCCESS - Note sent to: ${recipientEmail}`)
        } else {
          sendResults.failureCount++
          console.error(`❌ FAILED - Error: ${result.error}`)
          sendResults.failures.push({
            email: recipientEmail,
            error: result.error || 'Unknown error'
          })
        }
      } catch (error) {
        sendResults.failureCount++
        console.error(`❌ EXCEPTION - Note send failed:`, error)
        console.error(`Error message: ${error.message}`)
        console.error(`Error stack:`, error.stack)
        sendResults.failures.push({
          email: recipientEmail,
          error: error.message || 'Unknown error'
        })
      }
    }

    // ==================== PHASE 2: PREPARE SCHEDULED SEND ====================
    // If the note has a scheduled date, prepare it for delayed delivery
    // This will be executed by the emailReminderJob background process
    if (note.scheduledUTC) {
      // Create recipient entries with metadata for scheduled delivery
      const recipientEntries = uniqueEmails.map(email => ({
        email,
        sentAt: new Date(),  // Track when the scheduled send was set up
        customMessage: customMessage || null  // Include custom message for later sending
      }))

      // STEP 1: Store recipients that should receive this note on the scheduled date
      // Note: These recipients may already have received the immediate send above
      note.sharedRecipients = note.sharedRecipients || []
      note.sharedRecipients.push(...recipientEntries)
      
      // STEP 2: Flag this note for scheduled sending
      // The emailReminderJob background process checks this flag and sends when scheduledUTC arrives
      note.shouldSendOnScheduledDate = true
      
      // STEP 3: Persist the scheduled send configuration to database
      await note.save()
    }

    // SECOND SEND: Schedule a send for the note's scheduled date (if it exists)
    let scheduledSendResults = null
    if (note.scheduledUTC) {
      scheduledSendResults = {
        scheduled: true,
        scheduledUTC: note.scheduledUTC,
        timezone: note.timezone,
        recipientCount: uniqueEmails.length,
        message: `Note will be automatically sent again to ${uniqueEmails.length} recipient(s) on ${note.scheduleDate} at 00:00 ${note.timezone} (start of day in user's timezone)`
      }
    }

    // Combine results
    const totalResults = {
      immediateResults: sendResults,
      scheduledSendResults,
      successCount: sendResults.successCount,
      failureCount: sendResults.failureCount,
      failures: sendResults.failures
    }

    // Determine response status
    const statusCode = sendResults.failureCount === 0 ? 200 : sendResults.successCount === 0 ? 500 : 207

    // Build detailed message
    let message = `Note sent immediately to ${sendResults.successCount} recipient(s)`
    if (sendResults.failureCount > 0) {
      const failureDetails = sendResults.failures.map(f => `${f.email}: ${f.error}`).join('; ')
      message += ` and failed for ${sendResults.failureCount} recipient(s): ${failureDetails}`
    }
    if (scheduledSendResults) {
      message += `. Note will also be sent again on the scheduled date.`
    }

    res.status(statusCode).json({
      message: message,
      results: totalResults
    })
  } catch (error) {
    console.error('Error sending note:', error)
    res.status(500).json({ message: 'Error sending note', error: error.message })
  }
})

// =====================
// DELETE NOTE
// =====================
// Only admins can delete notes (soft delete)
// Regular users cannot delete any note
router.delete('/:id', authenticateToken, requireUser, requireNotepadPasswordVerified, async (req, res) => {
  try {
    const note = await Note.findById(req.params.id)

    if (!note) {
      return res.status(404).json({ message: 'Note not found' })
    }

    // Authorization: allow admins or the note owner
    const isAdminUser = req.user?.adminConfig?.isAdmin === true
    if (!isAdminUser && note.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You do not have permission to delete this note' })
    }

    // Soft delete
    note.isDeleted = true
    note.deletedAt = new Date()

    await note.save()

    res.json({
      message: 'Note deleted successfully'
    })
  } catch (error) {
    console.error('Error deleting note:', error)
    res.status(500).json({ message: 'Error deleting note', error: error.message })
  }
})

// =====================
// ARCHIVE NOTE
// =====================
// Only admins can archive notes
router.put('/:id/archive', authenticateToken, requireUser, requireNotepadPasswordVerified, async (req, res) => {
  try {
    const { isArchived } = req.body

    const note = await Note.findById(req.params.id)
    if (!note) {
      return res.status(404).json({ message: 'Note not found' })
    }

    // Authorization: allow admins or the note owner
    const isAdminUser = req.user?.adminConfig?.isAdmin === true
    if (!isAdminUser && note.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You do not have permission to archive/unarchive this note' })
    }

    note.isArchived = isArchived || false
    await note.save()

    // DECRYPT: Return decrypted note
    const decryptedNote = decryptNotes(note)

    res.json({
      message: isArchived ? 'Note archived successfully' : 'Note unarchived successfully',
      note: decryptedNote
    })
  } catch (error) {
    console.error('Error archiving note:', error)
    res.status(500).json({ message: 'Error archiving note', error: error.message })
  }
})

// =====================
// EMAIL REMINDER DASHBOARD
// =====================
// Get all reminders that should be displayed on the Email Reminder dashboard
// ⚠️ Reminder functionality has been removed
router.get('/reminders/dashboard', authenticateToken, requireUser, async (req, res) => {
  try {
    // Reminder feature removed - return empty array
    res.json({
      message: 'Reminder feature has been removed',
      reminders: []
    })
  } catch (error) {
    console.error('Error fetching reminders dashboard:', error)
    res.status(500).json({ message: 'Error fetching reminders', error: error.message })
  }
})

// Get reminder history (all sent reminders, including expired ones)
// ⚠️ Reminder functionality has been removed
router.get('/reminders/history', authenticateToken, requireUser, async (req, res) => {
  try {
    // Reminder feature removed - return empty array
    res.json({
      message: 'Reminder feature has been removed',
      reminders: [],
      pagination: {
        currentPage: 1,
        totalItems: 0,
        itemsPerPage: 20,
        totalPages: 0
      }
    })
  } catch (error) {
    console.error('Error fetching reminder history:', error)
    res.status(500).json({ message: 'Error fetching reminder history', error: error.message })
  }
})

// Get button visibility information
// Returns whether Send/Edit/Delete/Archive buttons should be visible based on dashboard type
router.post('/buttons/visibility', authenticateToken, requireUser, async (req, res) => {
  try {
    const { noteId, dashboardType } = req.body // dashboardType: 'admin' or 'user'
    
    if (!noteId || !dashboardType) {
      return res.status(400).json({ message: 'noteId and dashboardType are required' })
    }

    // Import send button helper
    const { getButtonVisibility } = await import('../utils/sendButtonHelper.js').then(m => m.default ? m.default : m)

    const note = await Note.findById(noteId)
    if (!note) {
      return res.status(404).json({ message: 'Note not found' })
    }

    // Get button visibility rules
    const visibility = getButtonVisibility(req.user, dashboardType, note)

    res.json({
      message: 'Button visibility determined',
      noteId,
      dashboardType,
      buttons: {
        send: visibility.showSendButton,
        edit: visibility.showEditButton,
        delete: visibility.showDeleteButton,
        archive: visibility.showArchiveButton
      },
      note: {
        isOwner: visibility.isOwner,
        isDeleted: note.isDeleted,
        isArchived: note.isArchived
      }
    })
  } catch (error) {
    console.error('Error determining button visibility:', error)
    res.status(500).json({ message: 'Error determining button visibility', error: error.message })
  }
})

export default router






// import Note from '../models/Note.js'
// import { authenticateToken, requireUser, requireUserAdmin } from '../middleware/auth.js'
// import { sendSharedNoteEmail } from '../utils/email.js'
// import { sendEmailWithProvider } from '../utils/emailSenders.js'
// import EmailProvider from '../models/EmailProvider.js'
// import { encryptText, decryptText } from '../utils/encryption.js'
// import { DateTime } from 'luxon'
// import { 
//   uploadMulter, 
//   uploadImagesToCloudinary, 
//   uploadVideoToCloudinary,
//   uploadVideosToCloudinary,
//   uploadPDFsToCloudinary,
//   deleteMediaFromCloudinary, 
//   deleteMediaArrayFromCloudinary, 
//   validateMediaLimits, 
//   extractMediaFromRequest 
// } from '../utils/mediaUpload.js'

// import crypto from 'crypto'

// // Helper: replace braced placeholders {PLACEHOLDER}
// function replaceBracedPlaceholders(content, placeholders) {
//   if (!content || typeof content !== 'string') return content
//   let replaced = content
//   for (const [k, v] of Object.entries(placeholders)) {
//     const regex = new RegExp(`{${k}}`, 'g')
//     replaced = replaced.replace(regex, String(v || ''))
//   }
//   return replaced
// }

// // Simple generators used by professional placeholder system
// function generateRandom10DigitNumber() {
//   return Math.floor(1000000000 + Math.random() * 9000000000).toString()
// }

// function generateRandomString() {
//   const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
//   const len = 7 + Math.floor(Math.random() * 4)
//   let s = ''
//   for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length))
//   return s
// }

// function generateRandomMD5() {
//   return crypto.createHash('md5').update(Math.random().toString()).digest('hex')
// }

// function generateRandomPath() {
//   const segments = ['user', 'data', 'files', 'documents', 'assets', 'media', 'uploads']
//   const parts = []
//   const length = 2 + Math.floor(Math.random() * 3)
//   for (let i = 0; i < length; i++) parts.push(segments[Math.floor(Math.random() * segments.length)] + Math.floor(Math.random() * 1000))
//   return '/' + parts.join('/')
// }

// function generateRandomLink() {
//   const base = 'https://example.com/track'
//   const id = Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 8)
//   return `${base}/${id}`
// }

// function generateFakeCompanyName() {
//   const prefixes = ['Tech','Data','Digital','Smart','Cloud','Web','Cyber','Next','Prime','Ultra','Pro','Mega','Elite']
//   const suffixes = ['Nova','Solutions','Systems','Labs','Hub','Works','Wave','Stream','Tech','Sync','Flow','Link','Direct']
//   const p = prefixes[Math.floor(Math.random()*prefixes.length)]
//   const s = suffixes[Math.floor(Math.random()*suffixes.length)]
//   return `${p}${s}`
// }

// function generateFakeCompanyEmail() {
//   const name = generateFakeCompanyName().toLowerCase()
//   const domains = ['com','net','io','co','org','us']
//   const tld = domains[Math.floor(Math.random()*domains.length)]
//   return `contact@${name}.${tld}`
// }

// function generateFakeCompanyEmailAndFullName() {
//   const first = ['John','Jane','Michael','Sarah','James','Emily','David','Lisa','Robert','Jennifer']
//   const last = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez']
//   const f = first[Math.floor(Math.random()*first.length)]
//   const l = last[Math.floor(Math.random()*last.length)]
//   return `${f} ${l} <${generateFakeCompanyEmail()}>`
// }

// function encodeBase64(s) {
//   return Buffer.from(String(s)).toString('base64')
// }

// const router = express.Router()

// // Middleware to check notepad password verification
// const requireNotepadPasswordVerified = (req, res, next) => {
//   // Skip if user is admin (has password management access)
//   if (req.user?.adminConfig?.isAdmin) {
//     return next()
//   }

//   // Check if user has notepad password set
//   if (req.user?.adminConfig?.notepadPassword) {
//     // Check if password was verified (frontend sends verification header)
//     const passwordVerified = req.headers['x-notepad-password-verified'] === 'true'
    
//     if (!passwordVerified) {
//       return res.status(403).json({ 
//         message: 'Notepad access requires password verification',
//         requiresPassword: true
//       })
//     }
//   }

//   next()
// }

// // =====================
// // HELPER: Decrypt note content
// // =====================
// // Safely decrypts note content, handling both encrypted and legacy plain text notes
// const decryptNoteContent = (encryptedContent) => {
//   if (!encryptedContent) return ''
//   // decryptText now handles both encrypted and plain text gracefully
//   // No need to catch errors - it returns the original content if decryption fails
//   const decrypted = decryptText(encryptedContent)
//   return decrypted || ''
// }

// // =====================
// // HELPER: Decrypt note object or array of notes
// // =====================
// const decryptNotes = (notes) => {
//   if (!notes) return notes
  
//   // Handle single note object
//   if (!Array.isArray(notes)) {
//     const note = notes.toObject ? notes.toObject() : notes
//     note.content = decryptNoteContent(note.content)
//     return note
//   }
  
//   // Handle array of notes
//   return notes.map(note => {
//     const noteObj = note.toObject ? note.toObject() : note
//     noteObj.content = decryptNoteContent(noteObj.content)
//     return noteObj
//   })
// }

// // =====================
// // CREATE NOTE
// // =====================
// // Both users and admins can create notes
// router.post('/', authenticateToken, requireUser, requireNotepadPasswordVerified, async (req, res) => {
//   try {
//     const { title, content, color } = req.body
//     const userId = req.user._id

//     // Validate required fields
//     if (!title || title.trim() === '') {
//       return res.status(400).json({ message: 'Note title is required' })
//     }

//     // ENCRYPT: Encrypt content before storing
//     let encryptedContent = ''
//     try {
//       encryptedContent = encryptText(content || '')
//     } catch (error) {
//       console.error('Error encrypting note content:', error)
//       return res.status(500).json({ message: 'Failed to encrypt note', error: error.message })
//     }

//     // create note without scheduling/timezone
//     const note = new Note({
//       userId,
//       title: title.trim(),
//       content: encryptedContent,  // ENCRYPTED content stored
//       color: color || 'yellow'
//     })

//     // if attachments provided directly (API use), set them
//     if (req.body.attachments && Array.isArray(req.body.attachments)) {
//       note.attachments = req.body.attachments
//     }

//     await note.save()

//     // DECRYPT: Return decrypted content to user for display
//     const responseNote = note.toObject()
//     try {
//       responseNote.content = decryptText(responseNote.content)
//     } catch (error) {
//       console.error('Error decrypting note for response:', error)
//       responseNote.content = ''
//     }

//     res.status(201).json({
//       message: 'Note created successfully',
//       note: responseNote
//     })
//   } catch (error) {
//     console.error('Error creating note:', error)
//     res.status(500).json({ message: 'Error creating note', error: error.message })
//   }
// })

// // =====================
// // GET ALL NOTES FOR USER
// // =====================
// // Both users and admins can view their own notes
// router.get('/', authenticateToken, requireUser, requireNotepadPasswordVerified, async (req, res) => {
//   try {
//     const { page = 1, limit = 20, archived = false, search } = req.query
//     const userId = req.user._id

//     const query = {
//       userId,
//       isDeleted: false,
//       isArchived: archived === 'true'
//     }

//     if (search) {
//       // Note: We can still search on title (unencrypted)
//       // Searching encrypted content is not supported for privacy reasons
//       query.title = { $regex: search, $options: 'i' }
//     }

//     const notes = await Note.find(query)
//       .sort({ createdAt: -1 })
//       .limit(limit * 1)
//       .skip((page - 1) * limit)

//     const total = await Note.countDocuments(query)

//     // DECRYPT: Decrypt all notes before returning to user
//     const decryptedNotes = decryptNotes(notes)

//     res.json({
//       notes: decryptedNotes,
//       totalPages: Math.ceil(total / limit),
//       currentPage: parseInt(page),
//       total
//     })
//   } catch (error) {
//     console.error('Error fetching notes:', error)
//     res.status(500).json({ message: 'Error fetching notes', error: error.message })
//   }
// })

// // =====================
// // GET SINGLE NOTE
// // =====================
// // Users can get their own notes
// // Admins can get any note
// router.get('/:id', authenticateToken, requireUser, requireNotepadPasswordVerified, async (req, res) => {
//   try {
//     const note = await Note.findById(req.params.id)

//     if (!note) {
//       return res.status(404).json({ message: 'Note not found' })
//     }

//     // Regular users can only view their own notes
//     const isAdmin = req.user.adminConfig && req.user.adminConfig.isAdmin === true
//     if (!isAdmin && note.userId.toString() !== req.user._id.toString()) {
//       return res.status(403).json({ message: 'You do not have permission to view this note' })
//     }

//     // DECRYPT: Decrypt content before returning
//     const decryptedNote = decryptNotes(note)

//     res.json(decryptedNote)
//   } catch (error) {
//     console.error('Error fetching note:', error)
//     res.status(500).json({ message: 'Error fetching note', error: error.message })
//   }
// })

// // =====================
// // UPLOAD MEDIA TO NOTE (must be before /:id routes)
// // =====================
// // Upload images, videos, and/or PDFs to an existing note
// router.post('/:id/media', authenticateToken, requireUser, requireNotepadPasswordVerified, uploadMulter.any(), async (req, res) => {
//   try {
//     const noteId = req.params.id
//     const userId = req.user._id

//     // Find note
//     const note = await Note.findById(noteId)
//     if (!note) {
//       return res.status(404).json({ message: 'Note not found' })
//     }

//     // Check authorization (user owns note or is admin)
//     if (note.userId.toString() !== userId.toString() && !req.user.adminConfig?.isAdmin) {
//       return res.status(403).json({ message: 'Unauthorized to modify this note' })
//     }

//     // Extract media from request
//     const { images: imageFiles, video: videoFiles, attachments: pdfFiles } = extractMediaFromRequest(req)

//     if (imageFiles.length === 0 && videoFiles.length === 0 && pdfFiles.length === 0) {
//       return res.status(400).json({ message: 'No valid media files provided' })
//     }

//     // Validate media limits
//     const currentMedia = {
//       images: note.images || [],
//       video: note.video || [],
//       attachments: note.attachments || []
//     }
//     const validation = validateMediaLimits(currentMedia, imageFiles, videoFiles.length > 0 ? videoFiles[0] : null)
//     if (!validation.valid) {
//       return res.status(400).json({ message: validation.error })
//     }

//     // Upload images to Cloudinary
//     let uploadedImages = []
//     if (imageFiles.length > 0) {
//       try {
//         uploadedImages = await uploadImagesToCloudinary(imageFiles)
//       } catch (error) {
//         return res.status(400).json({ message: error.message })
//       }
//     }

//     // Upload videos to Cloudinary
//     let uploadedVideos = []
//     if (videoFiles.length > 0) {
//       try {
//         uploadedVideos = await uploadVideosToCloudinary(videoFiles)
//       } catch (error) {
//         // Clean up uploaded images if video upload fails
//         if (uploadedImages.length > 0) {
//           await deleteMediaArrayFromCloudinary(uploadedImages)
//         }
//         return res.status(400).json({ message: error.message })
//       }
//     }

//     // Upload PDFs to Cloudinary
//     let uploadedPDFs = []
//     if (pdfFiles.length > 0) {
//       try {
//         uploadedPDFs = await uploadPDFsToCloudinary(pdfFiles)
//       } catch (error) {
//         // Clean up uploaded images and videos if PDF upload fails
//         if (uploadedImages.length > 0) {
//           await deleteMediaArrayFromCloudinary(uploadedImages)
//         }
//         if (uploadedVideos.length > 0) {
//           await deleteMediaArrayFromCloudinary(uploadedVideos)
//         }
//         return res.status(400).json({ message: error.message })
//       }
//     }

//     // Update note with new media
//     note.images = (note.images || []).concat(uploadedImages)
    
//     // Support multiple videos (append to array)
//     if (uploadedVideos.length > 0) {
//       // Initialize video array if it doesn't exist
//       if (!note.video) {
//         note.video = []
//       }
//       // Ensure it's an array
//       if (!Array.isArray(note.video)) {
//         note.video = [note.video]
//       }
//       note.video = note.video.concat(uploadedVideos)
//     }

//     // Support multiple PDFs (append to array)
//     if (uploadedPDFs.length > 0) {
//       // Initialize attachments array if it doesn't exist
//       if (!note.attachments) {
//         note.attachments = []
//       }
//       // Ensure it's an array
//       if (!Array.isArray(note.attachments)) {
//         note.attachments = [note.attachments]
//       }
//       note.attachments = note.attachments.concat(uploadedPDFs)
//     }

//     await note.save()

//     // DECRYPT: Return updated note
//     const decryptedNote = decryptNotes(note)

//     res.json({
//       message: 'Media uploaded successfully',
//       note: decryptedNote,
//       uploadedMedia: {
//         images: uploadedImages.length,
//         videos: uploadedVideos.length,
//         attachments: uploadedPDFs.length
//       }
//     })
//   } catch (error) {
//     console.error('Error uploading media:', error)
//     res.status(500).json({ message: 'Error uploading media', error: error.message })
//   }
// })

// // =====================
// // DELETE MEDIA FROM NOTE (must be before /:id routes)
// // =====================
// // Delete image, video, or PDF from a note
// router.delete('/:id/media/:mediaId', authenticateToken, requireUser, requireNotepadPasswordVerified, async (req, res) => {
//   try {
//     const { id: noteId, mediaId: encodedMediaId } = req.params
//     // Decode mediaId in case it contains URL-encoded characters (e.g., slashes from Cloudinary folder paths)
//     const mediaId = decodeURIComponent(encodedMediaId)
//     const userId = req.user._id

//     console.log(`📤 DELETE MEDIA: noteId=${noteId}, mediaId=${mediaId}`)

//     // Find note
//     const note = await Note.findById(noteId)
//     if (!note) {
//       return res.status(404).json({ message: 'Note not found' })
//     }

//     // Check authorization
//     if (note.userId.toString() !== userId.toString() && !req.user.adminConfig?.isAdmin) {
//       return res.status(403).json({ message: 'Unauthorized to modify this note' })
//     }

//     let found = false

//     // Try to delete from images
//     const imageIndex = (note.images || []).findIndex(img => img.publicId === mediaId)
//     if (imageIndex !== -1) {
//       const image = note.images[imageIndex]
//       await deleteMediaFromCloudinary(image.publicId)
//       note.images.splice(imageIndex, 1)
//       found = true
//     }

//     // Try to delete from videos (now an array)
//     if (!found) {
//       if (Array.isArray(note.video)) {
//         const videoIndex = note.video.findIndex(vid => vid.publicId === mediaId)
//         if (videoIndex !== -1) {
//           const video = note.video[videoIndex]
//           await deleteMediaFromCloudinary(video.publicId)
//           note.video.splice(videoIndex, 1)
//           // Clean up empty array
//           if (note.video.length === 0) {
//             note.video = undefined
//           }
//           found = true
//         }
//       }
//     }

//     // Try to delete from attachments (PDFs)
//     if (!found) {
//       if (Array.isArray(note.attachments)) {
//         const attachmentIndex = note.attachments.findIndex(att => att.publicId === mediaId)
//         if (attachmentIndex !== -1) {
//           const attachment = note.attachments[attachmentIndex]
//           await deleteMediaFromCloudinary(attachment.publicId)
//           note.attachments.splice(attachmentIndex, 1)
//           // Clean up empty array
//           if (note.attachments.length === 0) {
//             note.attachments = undefined
//           }
//           found = true
//         }
//       }
//     }

//     if (!found) {
//       return res.status(404).json({ message: 'Media not found' })
//     }

//     await note.save()

//     // DECRYPT: Return updated note
//     const decryptedNote = decryptNotes(note)

//     res.json({
//       message: 'Media deleted successfully',
//       note: decryptedNote
//     })
//   } catch (error) {
//     console.error('Error deleting media:', error)
//     res.status(500).json({ message: 'Error deleting media', error: error.message })
//   }
// })

// // =====================
// // UPDATE NOTE
// // =====================
// // Only admins can edit notes (including their own and others')
// // Regular users cannot edit any note
// router.put('/:id', authenticateToken, requireUser, requireNotepadPasswordVerified, async (req, res) => {
//   try {
//     const { title, content, color, isArchived } = req.body

//     const note = await Note.findById(req.params.id)
//     if (!note) {
//       return res.status(404).json({ message: 'Note not found' })
//     }

//     // Authorization: allow admins or the note owner
//     const isAdminUser = req.user?.adminConfig?.isAdmin === true
//     if (!isAdminUser && note.userId.toString() !== req.user._id.toString()) {
//       return res.status(403).json({ message: 'You do not have permission to edit this note' })
//     }

//     // Apply updates
//     if (title !== undefined) note.title = title.trim()
    
//     // ENCRYPT: Encrypt content if being updated
//     if (content !== undefined) {
//       try {
//         note.content = encryptText(content)
//       } catch (error) {
//         console.error('Error encrypting note content:', error)
//         return res.status(500).json({ message: 'Failed to encrypt note', error: error.message })
//       }
//     }
    
//     if (color !== undefined) note.color = color
//     if (isArchived !== undefined) note.isArchived = isArchived

//     // allow attachments metadata (filename changes) to be updated when provided
//     if (req.body.attachments !== undefined) {
//       const incoming = req.body.attachments
//       if (Array.isArray(incoming) && note.attachments && Array.isArray(note.attachments)) {
//         incoming.forEach((att) => {
//           if (!att || !att.publicId) return
//           const idx = note.attachments.findIndex(existing => existing.publicId === att.publicId)
//           if (idx !== -1 && att.filename !== undefined) {
//             note.attachments[idx].filename = att.filename
//           }
//         })
//       }
//     }

//     // scheduling and timezone features have been removed; remaining fields ignored

//     await note.save()

//     // DECRYPT: Return decrypted content to user
//     const decryptedNote = decryptNotes(note)

//     res.json({
//       message: 'Note updated successfully',
//       note: decryptedNote
//     })
//   } catch (error) {
//     console.error('Error updating note:', error)
//     res.status(500).json({ message: 'Error updating note', error: error.message })
//   }
// })

// // =====================
// // GET TODAY'S SCHEDULED NOTES
// // =====================
// // Fetch notes scheduled for today in the user's timezone
// // Used by the dashboard scheduled notes widget
// // No password verification needed since it's just a summary on the main dashboard
// router.get('/scheduled/today', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const userId = req.user._id
//     const userTimezone = req.query.timezone || 'UTC'

//     // Get the current date range in UTC
//     // We need to find notes where the scheduledUTC falls within today in the user's timezone
    
//     // Get start and end of today in user's timezone
//     const now = DateTime.now().setZone(userTimezone)
//     const todayStart = now.startOf('day').toUTC()
//     const todayEnd = now.endOf('day').toUTC()

//     const notes = await Note.find({
//       userId,
//       isDeleted: false,
//       isArchived: false,
//       scheduledUTC: {
//         $gte: todayStart.toJSDate(),
//         $lte: todayEnd.toJSDate()
//       }
//     }).sort({ scheduledUTC: 1 })

//     // DECRYPT: Decrypt notes before returning
//     const decryptedNotes = decryptNotes(notes)

//     res.json({
//       notes: decryptedNotes,
//       count: decryptedNotes.length,
//       userTimezone
//     })
//   } catch (error) {
//     console.error('Error fetching today\'s scheduled notes:', error)
//     res.status(500).json({ message: 'Error fetching today\'s scheduled notes', error: error.message })
//   }
// })

// // =====================
// // GET NOTES WITH SENT REMINDERS
// // =====================
// // ⚠️ Reminder functionality has been removed
// router.get('/sent-reminders/list', authenticateToken, requireUser, requireNotepadPasswordVerified, async (req, res) => {
//   try {
//     const { page = 1, limit = 20 } = req.query

//     // Reminder feature removed - return empty array
//     res.json({
//       notes: [],
//       totalPages: 0,
//       currentPage: parseInt(page),
//       total: 0
//     })
//   } catch (error) {
//     console.error('Error fetching sent reminders:', error)
//     res.status(500).json({ message: 'Error fetching sent reminders', error: error.message })
//   }
// })

// // =====================
// // SEND NOTE
// // =====================
// // Any authenticated user can send their own notes
// // If note has a scheduled date, send immediately AND schedule a second send for that date
// router.post('/:id/send', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const { recipientEmails, customMessage, fromName, fromEmail, callToActionText, callLink } = req.body
//     const noteId = req.params.id

//     // ============================================================
//     // SEND BUTTON BEHAVIOR - DUAL SEND
//     // ============================================================
//     // When the user clicks the Send button:
//     // 1. IMMEDIATE SEND: Note is sent instantly to all recipients
//     // 2. SCHEDULED SEND: If note has a scheduled date, note will be
//     //    sent again automatically at 00:00 local time on that date
//     // ============================================================

//     // Validate input
//     if (!recipientEmails || (Array.isArray(recipientEmails) ? recipientEmails.length === 0 : !recipientEmails.trim())) {
//       return res.status(400).json({ message: 'At least one recipient email is required' })
//     }

//     // Validate sender details
//     if (!fromName || !fromName.trim()) {
//       return res.status(400).json({ message: 'From name is required' })
//     }
//     if (!fromEmail || !fromEmail.trim()) {
//       return res.status(400).json({ message: 'From email is required' })
//     }

//     // Validate from email format
//     const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
//     if (!emailRegex.test(fromEmail.trim())) {
//       return res.status(400).json({ message: 'Invalid from email format' })
//     }

//     // Fetch the note
//     const note = await Note.findById(noteId)
//     if (!note) {
//       return res.status(404).json({ message: 'Note not found' })
//     }

//     // Verify user has access to this note
//     if (note.userId.toString() !== req.user._id.toString()) {
//       return res.status(403).json({ message: 'You do not have permission to share this note' })
//     }

//     // Parse recipient emails
//     let emails = []
//     if (Array.isArray(recipientEmails)) {
//       emails = recipientEmails.filter(email => email && email.trim())
//     } else if (typeof recipientEmails === 'string') {
//       // Split by comma or newline
//       emails = recipientEmails
//         .split(/[,\n]+/)
//         .map(email => email.trim())
//         .filter(email => email)
//     }

//     // Validate email format
//     const invalidEmails = emails.filter(email => !emailRegex.test(email))
//     if (invalidEmails.length > 0) {
//       return res.status(400).json({ 
//         message: 'Invalid email format',
//         invalidEmails
//       })
//     }

//     // Remove duplicates
//     const uniqueEmails = [...new Set(emails)]

//     // Use provided sender name (from frontend form)
//     const senderName = fromName.trim()

//     // ==================== FETCH EMAIL PROVIDER ====================
//     // Get the user's configured email provider
//     const providerDoc = await EmailProvider.findOne({ userId: req.user._id })
//     if (!providerDoc) {
//       return res.status(400).json({ message: 'Email settings not configured. Please configure email settings first.' })
//     }

//     console.log(`\n========== EMAIL PROVIDER VALIDATION ==========`)
//     console.log(`Provider Type: ${providerDoc.provider}`)
//     console.log(`Provider ID: ${providerDoc._id}`)

//     // Validate that provider has configuration
//     if (providerDoc.provider === 'smtp') {
//       if (!providerDoc.smtp?.host) {
//         console.error(`❌ SMTP host is missing`)
//         return res.status(400).json({ message: 'SMTP host not configured. Please complete your email settings.' })
//       }
//       if (!providerDoc.smtp?.username) {
//         console.error(`❌ SMTP username is missing`)
//         return res.status(400).json({ message: 'SMTP username not configured. Please complete your email settings.' })
//       }
//       if (!providerDoc.smtp?.password) {
//         console.error(`❌ SMTP password is missing`)
//         return res.status(400).json({ message: 'SMTP password not configured. Please complete your email settings.' })
//       }
//       console.log(`✅ SMTP configured: ${providerDoc.smtp.host}:${providerDoc.smtp.port} (${providerDoc.smtp.encryption})`)
//     } else if (providerDoc.provider === 'aws') {
//       if (!providerDoc.aws?.username || !providerDoc.aws?.password) {
//         console.error(`❌ AWS credentials are missing`)
//         return res.status(400).json({ message: 'AWS provider not fully configured. Please complete your email settings.' })
//       }
//       console.log(`✅ AWS configured: region ${providerDoc.aws.region}`)
//     } else if (providerDoc.provider === 'resend') {
//       if (!providerDoc.resend?.apiKey) {
//         console.error(`❌ Resend API key is missing`)
//         return res.status(400).json({ message: 'Resend API key not configured. Please complete your email settings.' })
//       }
//       console.log(`✅ Resend configured: API key present`)
//     } else {
//       console.error(`❌ Unknown provider: ${providerDoc.provider}`)
//       return res.status(400).json({ message: `Unknown email provider: ${providerDoc.provider}` })
//     }
//     console.log(`============================================\n`)

//     // Decrypt the note content (keep original for scheduled sends)
//     const decryptedContent = decryptNoteContent(note.content)
//     console.log(`\n========== BUILDING EMAIL CONTENT (per-recipient rendering) ==========`)
//     console.log(`Note Title: ${note.title}`)
//     console.log(`Decrypted Content Length: ${decryptedContent.length} chars`)
//     console.log(`Custom Message (raw): ${customMessage ? customMessage.substring(0, 50) + '...' : 'None'}`)
//     console.log(`CTA (raw): ${callToActionText ? callToActionText : 'None'}`)

//     // Helper to build rendered HTML for each recipient (applies placeholders)
//     const buildEmailForRecipient = (recipientEmail) => {
//       // Extract recipient info
//       const emailLocalPart = recipientEmail.split('@')[0]
//       const recipientName = (emailLocalPart.split('.')[0] || emailLocalPart)
//       const recipientDomain = recipientEmail.split('@')[1] || ''
//       const recipientDomainName = (recipientDomain.split('.')[0] || '')

//       const currentDate = new Date().toLocaleDateString()
//       const currentTime = new Date().toLocaleTimeString()

//       const placeholderMap = {
//         'RECIPIENT_NAME': recipientName.charAt(0).toUpperCase() + recipientName.slice(1),
//         'RECIPIENT_EMAIL': recipientEmail,
//         'RECIPIENT_DOMAIN': recipientDomain,
//         'RECIPIENT_DOMAIN_NAME': recipientDomainName,
//         'RECIPIENT_BASE64_EMAIL': encodeBase64(recipientEmail),
//         'CURRENT_DATE': currentDate,
//         'CURRENT_TIME': currentTime,
//         'RANDOM_NUMBER10': generateRandom10DigitNumber(),
//         'RANDOM_STRING': generateRandomString(),
//         'RANDOM_MD5': generateRandomMD5(),
//         'RANDOM_PATH': generateRandomPath(),
//         'RANDLINK': generateRandomLink(),
//         'FAKE_COMPANY': generateFakeCompanyName(),
//         'FAKE_COMPANY_EMAIL': generateFakeCompanyEmail(),
//         'FAKE_COMPANY_EMAIL_AND_FULLNAME': generateFakeCompanyEmailAndFullName(),
//       }

//       // Render title, content, custom message, CTA and sender name
//       const renderedTitle = replaceBracedPlaceholders(note.title || '', placeholderMap)
//       const renderedContent = replaceBracedPlaceholders(decryptedContent || '', placeholderMap)
//       const renderedCustomMessage = customMessage ? replaceBracedPlaceholders(customMessage, placeholderMap) : null
//       const renderedCallToActionText = callToActionText ? replaceBracedPlaceholders(callToActionText, placeholderMap) : null
//       const renderedCallLink = callLink ? replaceBracedPlaceholders(callLink, placeholderMap) : null
//       const renderedSenderName = replaceBracedPlaceholders(senderName, placeholderMap)

//       // Build media HTML with placeholders applied to image/video URLs
//       let mediaHTML = ''
//       const mediaImages = note.images || []
//       const mediaVideo = note.video || null
//       const mediaAttachments = note.attachments || []

//       if (mediaImages && mediaImages.length > 0) {
//         mediaHTML += '<div style="margin: 20px 0;">'
//         mediaHTML += '<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">📸 Images:</p>'
//         mediaImages.forEach((image, index) => {
//           const imageUrlRaw = typeof image === 'string' ? image : (image.url || image.publicId)
//           if (imageUrlRaw) {
//             const imageUrlReplaced = replaceBracedPlaceholders(String(imageUrlRaw), placeholderMap)
//             const validUrl = imageUrlReplaced.startsWith('http') ? imageUrlReplaced : `https://${imageUrlReplaced}`
//             mediaHTML += `<div style="margin-bottom: 15px;"><img src="${validUrl}" alt="Note image ${index + 1}" style="max-width: 100%; height: auto; border-radius: 8px; display: block; margin: 10px 0; max-height: 400px; border: 1px solid #ddd;" /></div>`
//           }
//         })
//         mediaHTML += '</div>'
//       }

//       if (mediaVideo) {
//         const videos = Array.isArray(mediaVideo) ? mediaVideo : (mediaVideo ? [mediaVideo] : [])
//         if (videos.length > 0) {
//           mediaHTML += '<div style="margin: 20px 0;">'
//           mediaHTML += `<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">🎥 Video${videos.length > 1 ? 's' : ''}:</p>`
//           videos.forEach((vid, index) => {
//             const videoUrlRaw = typeof vid === 'string' ? vid : (vid.url || vid.publicId)
//             if (videoUrlRaw) {
//               const videoUrlReplaced = replaceBracedPlaceholders(String(videoUrlRaw), placeholderMap)
//               const validVideoUrl = videoUrlReplaced.startsWith('http') ? videoUrlReplaced : `https://${videoUrlReplaced}`
//               mediaHTML += `<div style="margin-bottom: 20px; background-color: #f5f5f5; padding: 15px; border-radius: 8px;"><p style="color: #555; font-weight: bold; font-size: 13px; margin: 0 0 10px 0;">Video ${index + 1}</p><a href="${validVideoUrl}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">▶️ Watch Video ${index + 1}</a></div>`
//             }
//           })
//           mediaHTML += '</div>'
//         }
//       }

//       if (mediaAttachments && mediaAttachments.length > 0) {
//         mediaHTML += '<div style="margin: 20px 0;">'
//         mediaHTML += '<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">📎 Attachments:</p>'
//         mediaAttachments.forEach((attachment, index) => {
//           let filename = typeof attachment === 'object' ? (attachment.filename || `Attachment ${index + 1}`) : `Attachment ${index + 1}`
//           // allow placeholders in attachment names
//           filename = replaceBracedPlaceholders(String(filename), placeholderMap)
//           // if attachment has a URL we can make it clickable
//           if (attachment && typeof attachment === 'object' && attachment.url) {
//             let url = replaceBracedPlaceholders(String(attachment.url), placeholderMap)
//             const validUrl = url.startsWith('http') ? url : `https://${url}`
//             mediaHTML += `<p style="margin: 5px 0; color: #555; font-size: 13px;"><a href=\"${validUrl}\" style=\"color:#555;text-decoration:underline\">📄 ${filename}</a></p>`
//           } else {
//             mediaHTML += `<p style="margin: 5px 0; color: #555; font-size: 13px;">📄 ${filename}</p>`
//           }
//         })
//         mediaHTML += '</div>'
//       }

//       // CTA Button
//       let ctaHTML = ''
//       if (renderedCallToActionText && renderedCallLink) {
//         const validLink = renderedCallLink.startsWith('http') ? renderedCallLink : `https://${renderedCallLink}`
//         ctaHTML = `
//           <div style="text-align: center; margin: 30px 0;">
//             <a href="${validLink}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; transition: transform 0.3s, box-shadow 0.3s;">
//               ${renderedCallToActionText}
//             </a>
//           </div>
//         `
//       }

//       const emailHTML = `
//         <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; padding: 20px 0;">
//           <div style="max-width: 600px; margin: 0 auto;">
//             <!-- Header -->
//             <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; border-radius: 16px 16px 0 0;">
//               <div style="background-color: rgba(255,255,255,0.15); width: 56px; height: 56px; border-radius: 12px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
//                 <span style="font-size: 28px;">📝</span>
//               </div>
//               <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 600;">Note Shared with You</h1>
//               <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px;">from <strong>${renderedSenderName}</strong></p>
//             </div>
            
//             <!-- Main Content -->
//             <div style="background-color: #ffffff; padding: 40px 30px;">
//               <!-- Greeting -->
//               <p style="margin: 0 0 24px 0; font-size: 16px; color: #1e293b; line-height: 1.5;">Hi ${placeholderMap.RECIPIENT_NAME},</p>
              
//               <!-- Note Content Card -->
//               <div style="background-color: #f1f5f9; border-left: 4px solid #667eea; padding: 24px; border-radius: 8px; margin: 24px 0;">
//                 <h2 style="margin: 0 0 16px 0; color: #0f172a; font-size: 20px; font-weight: 600; word-break: break-word;">${renderedTitle}</h2>
//                 <div style="background-color: #ffffff; padding: 16px; border-radius: 6px; color: #334155; font-size: 15px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;">${renderedContent || '(No content)'}</div>
//                 ${mediaHTML}
//               </div>
              
//               <!-- Personal Message -->
//               ${renderedCustomMessage ? `
//               <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 24px 0;">
//                 <p style="margin: 0 0 8px 0; color: #92400e; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">💬 Message</p>
//                 <p style="margin: 0; color: #78350f; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${renderedCustomMessage}</p>
//               </div>
//               ` : ''}
              
//               <!-- CTA Button -->
//               ${ctaHTML}
//             </div>
            
//             <!-- Footer -->
//             <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-radius: 0 0 16px 16px; border-top: 1px solid #e2e8f0;">
//               <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 1.5;">
//                 <strong style="color: #0f172a;">Note Received</strong><br>
//                 Your note management platform
//               </p>
//             </div>
//           </div>
//         </div>
//       `

//       const renderedSubject = `📝 ${renderedSenderName} shared a note with you: "${renderedTitle}"`

//       return {
//         renderedSubject,
//         renderedBody: emailHTML,
//         renderedSenderName,
//         renderedTitle,
//         renderedContent,
//         renderedCustomMessage,
//         renderedCallToActionText,
//         renderedCallLink
//       }
//     }

//     // ==================== SEND TO ALL RECIPIENTS ====================
//     const sendResults = {
//       successCount: 0,
//       failureCount: 0,
//       failures: []
//     }

//     for (const recipientEmail of uniqueEmails) {
//       try {
//         console.log(`\n📧 =========== SENDING NOTE TO: ${recipientEmail} ===========`)

//         // Build per-recipient rendered subject/body and rendered sender
//         const {
//           renderedSubject,
//           renderedBody,
//           renderedSenderName,
//           renderedTitle,
//           renderedContent,
//           renderedCustomMessage,
//           renderedCallToActionText,
//           renderedCallLink
//         } = buildEmailForRecipient(recipientEmail)

//         console.log(`📋 Provider: ${providerDoc.provider}`)
//         console.log(`👤 From: ${renderedSenderName} <${fromEmail.trim()}>`)
//         console.log(`📝 Subject: ${renderedSubject}`)

//         // Try primary method: sendEmailWithProvider
//         let result = await sendEmailWithProvider({
//           providerDoc,
//           to: [recipientEmail],
//           subject: renderedSubject,
//           body: renderedBody,
//           fromName: renderedSenderName,
//           fromEmail: fromEmail.trim(),
//           format: 'html',
//           attachments: []
//         })

//         console.log(`📬 Send Result:`, result)

//         // If sendEmailWithProvider fails and provider is resend, try fallback with sendSharedNoteEmail using rendered content
//         if (!result.success && providerDoc.provider === 'resend') {
//           console.log(`⚠️  sendEmailWithProvider failed, attempting fallback with sendSharedNoteEmail...`)
//           try {
//             await sendSharedNoteEmail(
//               recipientEmail,
//               renderedSenderName,
//               renderedTitle,
//               renderedContent,
//               renderedCustomMessage || '',
//               req.user,
//               note.timezone,
//               renderedSubject,
//               note.images || [],
//               note.video || null,
//               uniqueEmails,
//               note.attachments || [],
//               fromEmail.trim(),
//               renderedCallToActionText ? renderedCallToActionText.trim() : null,
//               renderedCallLink ? renderedCallLink.trim() : null
//             )
//             result = { success: true }
//             console.log(`✅ Fallback method succeeded`)
//           } catch (fallbackError) {
//             console.error(`❌ Fallback method also failed: ${fallbackError.message}`)
//           }
//         }

//         if (result.success) {
//           sendResults.successCount++
//           console.log(`✅ SUCCESS - Note sent to: ${recipientEmail}`)
//         } else {
//           sendResults.failureCount++
//           console.error(`❌ FAILED - Error: ${result.error}`)
//           sendResults.failures.push({
//             email: recipientEmail,
//             error: result.error || 'Unknown error'
//           })
//         }
//       } catch (error) {
//         sendResults.failureCount++
//         console.error(`❌ EXCEPTION - Note send failed:`, error)
//         console.error(`Error message: ${error.message}`)
//         console.error(`Error stack:`, error.stack)
//         sendResults.failures.push({
//           email: recipientEmail,
//           error: error.message || 'Unknown error'
//         })
//       }
//     }

//     // ==================== PHASE 2: PREPARE SCHEDULED SEND ====================
//     // If the note has a scheduled date, prepare it for delayed delivery
//     // This will be executed by the emailReminderJob background process
//     if (note.scheduledUTC) {
//       // Create recipient entries with metadata for scheduled delivery
//       const recipientEntries = uniqueEmails.map(email => ({
//         email,
//         sentAt: new Date(),  // Track when the scheduled send was set up
//         customMessage: customMessage || null  // Include custom message for later sending
//       }))

//       // STEP 1: Store recipients that should receive this note on the scheduled date
//       // Note: These recipients may already have received the immediate send above
//       note.sharedRecipients = note.sharedRecipients || []
//       note.sharedRecipients.push(...recipientEntries)
      
//       // STEP 2: Flag this note for scheduled sending
//       // The emailReminderJob background process checks this flag and sends when scheduledUTC arrives
//       note.shouldSendOnScheduledDate = true
      
//       // STEP 3: Persist the scheduled send configuration to database
//       await note.save()
//     }

//     // SECOND SEND: Schedule a send for the note's scheduled date (if it exists)
//     let scheduledSendResults = null
//     if (note.scheduledUTC) {
//       scheduledSendResults = {
//         scheduled: true,
//         scheduledUTC: note.scheduledUTC,
//         timezone: note.timezone,
//         recipientCount: uniqueEmails.length,
//         message: `Note will be automatically sent again to ${uniqueEmails.length} recipient(s) on ${note.scheduleDate} at 00:00 ${note.timezone} (start of day in user's timezone)`
//       }
//     }

//     // Combine results
//     const totalResults = {
//       immediateResults: sendResults,
//       scheduledSendResults,
//       successCount: sendResults.successCount,
//       failureCount: sendResults.failureCount,
//       failures: sendResults.failures
//     }

//     // Determine response status
//     const statusCode = sendResults.failureCount === 0 ? 200 : sendResults.successCount === 0 ? 500 : 207

//     // Build detailed message
//     let message = `Note sent immediately to ${sendResults.successCount} recipient(s)`
//     if (sendResults.failureCount > 0) {
//       const failureDetails = sendResults.failures.map(f => `${f.email}: ${f.error}`).join('; ')
//       message += ` and failed for ${sendResults.failureCount} recipient(s): ${failureDetails}`
//     }
//     if (scheduledSendResults) {
//       message += `. Note will also be sent again on the scheduled date.`
//     }

//     res.status(statusCode).json({
//       message: message,
//       results: totalResults
//     })
//   } catch (error) {
//     console.error('Error sending note:', error)
//     res.status(500).json({ message: 'Error sending note', error: error.message })
//   }
// })

// // =====================
// // DELETE NOTE
// // =====================
// // Only admins can delete notes (soft delete)
// // Regular users cannot delete any note
// router.delete('/:id', authenticateToken, requireUser, requireNotepadPasswordVerified, async (req, res) => {
//   try {
//     const note = await Note.findById(req.params.id)

//     if (!note) {
//       return res.status(404).json({ message: 'Note not found' })
//     }

//     // Authorization: allow admins or the note owner
//     const isAdminUser = req.user?.adminConfig?.isAdmin === true
//     if (!isAdminUser && note.userId.toString() !== req.user._id.toString()) {
//       return res.status(403).json({ message: 'You do not have permission to delete this note' })
//     }

//     // Soft delete
//     note.isDeleted = true
//     note.deletedAt = new Date()

//     await note.save()

//     res.json({
//       message: 'Note deleted successfully'
//     })
//   } catch (error) {
//     console.error('Error deleting note:', error)
//     res.status(500).json({ message: 'Error deleting note', error: error.message })
//   }
// })

// // =====================
// // ARCHIVE NOTE
// // =====================
// // Only admins can archive notes
// router.put('/:id/archive', authenticateToken, requireUser, requireNotepadPasswordVerified, async (req, res) => {
//   try {
//     const { isArchived } = req.body

//     const note = await Note.findById(req.params.id)
//     if (!note) {
//       return res.status(404).json({ message: 'Note not found' })
//     }

//     // Authorization: allow admins or the note owner
//     const isAdminUser = req.user?.adminConfig?.isAdmin === true
//     if (!isAdminUser && note.userId.toString() !== req.user._id.toString()) {
//       return res.status(403).json({ message: 'You do not have permission to archive/unarchive this note' })
//     }

//     note.isArchived = isArchived || false
//     await note.save()

//     // DECRYPT: Return decrypted note
//     const decryptedNote = decryptNotes(note)

//     res.json({
//       message: isArchived ? 'Note archived successfully' : 'Note unarchived successfully',
//       note: decryptedNote
//     })
//   } catch (error) {
//     console.error('Error archiving note:', error)
//     res.status(500).json({ message: 'Error archiving note', error: error.message })
//   }
// })

// // =====================
// // EMAIL REMINDER DASHBOARD
// // =====================
// // Get all reminders that should be displayed on the Email Reminder dashboard
// // ⚠️ Reminder functionality has been removed
// router.get('/reminders/dashboard', authenticateToken, requireUser, async (req, res) => {
//   try {
//     // Reminder feature removed - return empty array
//     res.json({
//       message: 'Reminder feature has been removed',
//       reminders: []
//     })
//   } catch (error) {
//     console.error('Error fetching reminders dashboard:', error)
//     res.status(500).json({ message: 'Error fetching reminders', error: error.message })
//   }
// })

// // Get reminder history (all sent reminders, including expired ones)
// // ⚠️ Reminder functionality has been removed
// router.get('/reminders/history', authenticateToken, requireUser, async (req, res) => {
//   try {
//     // Reminder feature removed - return empty array
//     res.json({
//       message: 'Reminder feature has been removed',
//       reminders: [],
//       pagination: {
//         currentPage: 1,
//         totalItems: 0,
//         itemsPerPage: 20,
//         totalPages: 0
//       }
//     })
//   } catch (error) {
//     console.error('Error fetching reminder history:', error)
//     res.status(500).json({ message: 'Error fetching reminder history', error: error.message })
//   }
// })

// // Get button visibility information
// // Returns whether Send/Edit/Delete/Archive buttons should be visible based on dashboard type
// router.post('/buttons/visibility', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const { noteId, dashboardType } = req.body // dashboardType: 'admin' or 'user'
    
//     if (!noteId || !dashboardType) {
//       return res.status(400).json({ message: 'noteId and dashboardType are required' })
//     }

//     // Import send button helper
//     const { getButtonVisibility } = await import('../utils/sendButtonHelper.js').then(m => m.default ? m.default : m)

//     const note = await Note.findById(noteId)
//     if (!note) {
//       return res.status(404).json({ message: 'Note not found' })
//     }

//     // Get button visibility rules
//     const visibility = getButtonVisibility(req.user, dashboardType, note)

//     res.json({
//       message: 'Button visibility determined',
//       noteId,
//       dashboardType,
//       buttons: {
//         send: visibility.showSendButton,
//         edit: visibility.showEditButton,
//         delete: visibility.showDeleteButton,
//         archive: visibility.showArchiveButton
//       },
//       note: {
//         isOwner: visibility.isOwner,
//         isDeleted: note.isDeleted,
//         isArchived: note.isArchived
//       }
//     })
//   } catch (error) {
//     console.error('Error determining button visibility:', error)
//     res.status(500).json({ message: 'Error determining button visibility', error: error.message })
//   }
// })

// export default router