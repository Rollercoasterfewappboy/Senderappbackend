import { DateTime } from 'luxon'
import Note from '../models/Note.js'
import { sendSharedNoteEmail } from './email.js'
import { decryptText } from './encryption.js'

/**
 * Send Button Helper
 * Implements dual-send behavior:
 * 1. Immediate send - when user clicks Send button
 * 2. Scheduled send - automatically sent at 00:00 on scheduled date (if set)
 */

/**
 * Execute a complete send action with both immediate and scheduled sends
 * @param {Object} note - Note document
 * @param {string} userId - User ID performing the send
 * @param {Array<string>} recipientEmails - Email addresses to send to
 * @param {string} customMessage - Custom message to include
 * @param {Object} senderUser - User object with firstName, lastName, email
 * @returns {Promise<Object>} - Results of send operation
 */
export const executeSendAction = async (note, userId, recipientEmails, customMessage, senderUser) => {
  const results = {
    immediate: {
      sent: false,
      count: 0,
      failures: []
    },
    scheduled: {
      enabled: false,
      scheduledDate: null,
      scheduledTime: '00:00',
      timezone: note.timezone || 'UTC',
      recipientCount: 0
    }
  }

  try {
    // Verify ownership
    if (note.userId.toString() !== userId.toString()) {
      throw new Error('You do not have permission to send this note')
    }

    // Validate recipients
    if (!recipientEmails || recipientEmails.length === 0) {
      throw new Error('At least one recipient email is required')
    }

    const uniqueEmails = [...new Set(recipientEmails)]
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const invalidEmails = uniqueEmails.filter(email => !emailRegex.test(email))
    if (invalidEmails.length > 0) {
      throw new Error(`Invalid email format: ${invalidEmails.join(', ')}`)
    }

    // ======================================
    // STEP 1: IMMEDIATE SEND
    // ======================================
    const decryptedContent = decryptText(note.content)
    const senderName = `${senderUser.firstName} ${senderUser.lastName}`.trim() || senderUser.email

    for (const recipientEmail of uniqueEmails) {
      try {
        await sendSharedNoteEmail(
          recipientEmail,
          senderName,
          note.title,
          decryptedContent,
          customMessage || '',
          senderUser,
          note.timezone,
          'Shared Note',
          note.images || [],
          note.video || null,
          uniqueEmails
        )
        results.immediate.count++
      } catch (error) {
        results.immediate.failures.push({
          email: recipientEmail,
          error: error.message
        })
        console.error(`Failed to send note to ${recipientEmail}:`, error)
      }
    }

    results.immediate.sent = results.immediate.count > 0

    // ======================================
    // STEP 2: SCHEDULE SEND (if note has scheduled date)
    // ======================================
    if (note.scheduledUTC) {
      // Store recipient information for scheduled send
      const recipientEntries = uniqueEmails.map(email => ({
        email,
        sentAt: new Date(),
        customMessage: customMessage || null
      }))

      // Update note with shared recipient tracking
      note.sharedRecipients = note.sharedRecipients || []
      note.sharedRecipients.push(...recipientEntries)
      
      // Mark that note should be sent on scheduled date
      note.shouldSendOnScheduledDate = true
      
      // Save the note
      await note.save()

      results.scheduled.enabled = true
      results.scheduled.scheduledDate = note.scheduleDate
      results.scheduled.scheduledTime = note.scheduledTime || '00:00'
      results.scheduled.recipientCount = uniqueEmails.length
    }

    return results
  } catch (error) {
    throw error
  }
}

/**
 * Check if a note should display Send/Delete/Edit/Archive buttons
 * These buttons are ONLY shown on User Admin Dashboard, not on regular User Dashboard
 * @param {Object} user - User object
 * @param {string} dashboardType - Type of dashboard ('admin' or 'user')
 * @param {Object} note - Note object
 * @returns {Object} - Button visibility flags
 */
export const getButtonVisibility = (user, dashboardType, note) => {
  // Buttons only visible on Admin Dashboard
  const isAdminDashboard = dashboardType === 'admin'
  const isOwner = note.userId.toString() === user._id.toString()

  return {
    showSendButton: isAdminDashboard && isOwner,
    showEditButton: isAdminDashboard && isOwner,
    showDeleteButton: isAdminDashboard && isOwner,
    showArchiveButton: isAdminDashboard && isOwner,
    isDashboardAdmin: isAdminDashboard,
    isOwner: isOwner
  }
}

/**
 * Validate send request parameters
 * @param {Object} note - Note document
 * @param {Object} user - User document
 * @param {Array<string>} recipientEmails - Emails to validate
 * @param {string} customMessage - Custom message
 * @returns {Object} - Validation result { valid: boolean, error: string | null }
 */
export const validateSendRequest = (note, user, recipientEmails, customMessage) => {
  // Check note exists
  if (!note) {
    return { valid: false, error: 'Note not found' }
  }

  // Check ownership
  if (note.userId.toString() !== user._id.toString()) {
    return { valid: false, error: 'You do not have permission to send this note' }
  }

  // Check recipients
  if (!recipientEmails || recipientEmails.length === 0) {
    return { valid: false, error: 'At least one recipient email is required' }
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const invalidEmails = recipientEmails.filter(email => !emailRegex.test(email))
  if (invalidEmails.length > 0) {
    return { valid: false, error: `Invalid email format: ${invalidEmails.join(', ')}` }
  }

  // Check not deleted
  if (note.isDeleted) {
    return { valid: false, error: 'Cannot send a deleted note' }
  }

  return { valid: true, error: null }
}

/**
 * Format send response for API
 * @param {Object} sendResults - Results from executeSendAction
 * @returns {Object} - Formatted response
 */
export const formatSendResponse = (sendResults) => {
  const immediateMessage = sendResults.immediate.sent
    ? `Note sent immediately to ${sendResults.immediate.count} recipient(s)`
    : `Failed to send note immediately`

  const scheduledMessage = sendResults.scheduled.enabled
    ? ` and will be automatically sent again to ${sendResults.scheduled.recipientCount} recipient(s) on ${sendResults.scheduled.scheduledDate} at ${sendResults.scheduled.scheduledTime} (${sendResults.scheduled.timezone})`
    : ''

  return {
    message: `${immediateMessage}${scheduledMessage}`,
    success: sendResults.immediate.sent,
    immediate: {
      sent: sendResults.immediate.sent,
      count: sendResults.immediate.count,
      failures: sendResults.immediate.failures
    },
    scheduled: sendResults.scheduled.enabled ? {
      enabled: true,
      date: sendResults.scheduled.scheduledDate,
      time: sendResults.scheduled.scheduledTime,
      timezone: sendResults.scheduled.timezone,
      recipients: sendResults.scheduled.recipientCount
    } : {
      enabled: false
    }
  }
}

export default {
  executeSendAction,
  getButtonVisibility,
  validateSendRequest,
  formatSendResponse
}
