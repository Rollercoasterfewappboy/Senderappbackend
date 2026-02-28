import { Resend } from 'resend'
import 'dotenv/config'
import axios from 'axios'

// ✅ Validate required environment variables
;['RESEND_API_KEY', 'EMAIL_FROM', 'FRONTEND_URL'].forEach((key) => {
  if (!process.env[key]) throw new Error(`❌ Missing ${key} in environment`)
})

// ✅ Create Resend client
const resend = new Resend(process.env.RESEND_API_KEY)

// ✅ Helper: Convert attachment URLs to Resend attachment format
const convertAttachmentsToResend = async (attachments = []) => {
  const resendAttachments = []
  
  for (const attachment of attachments) {
    try {
      const url = typeof attachment === 'string' ? attachment : (attachment.url || attachment.publicId)
      const filename = typeof attachment === 'object' ? (attachment.filename || 'attachment.pdf') : 'attachment.pdf'
      
      if (url) {
        // Fetch the PDF from the URL
        const validUrl = url.startsWith('http') ? url : `https://${url}`
        const response = await axios.get(validUrl, { responseType: 'arraybuffer' })
        const buffer = Buffer.from(response.data)
        
        resendAttachments.push({
          filename: filename,
          content: buffer.toString('base64'),
        })
      }
    } catch (error) {
      console.error(`⚠️ Failed to fetch attachment: ${error.message}`)
      // Continue with other attachments if one fails
    }
  }
  
  return resendAttachments
}

// ✅ Get sender info dynamically
const getFromAddress = (user = {}) => {
  const senderEmail = process.env.EMAIL_FROM
  if (user.businessInfo?.businessName?.trim()) {
    return `${user.businessInfo.businessName} <${senderEmail}>`
  }
  return `InboxGuaranteed <${senderEmail}>`
}

// ✅ Send confirmation email
export const sendConfirmationEmail = async (email, token, user = {}) => {
  const confirmUrl = `${process.env.FRONTEND_URL}/confirm-email/${token}`

  try {
    await resend.emails.send({
      from: getFromAddress(user),
      to: email,
      subject: 'Confirm Your Email Address',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #3b82f6;">Welcome to InboxGuaranteed!</h2>
          <p>Click below to confirm your email address:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${confirmUrl}" style="background-color: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">
              Confirm Email Address
            </a>
          </div>
          <p>If that doesn't work, copy and paste this URL:</p>
          <p style="word-break: break-all; color: #666;">${confirmUrl}</p>
        </div>
      `,
    })

    console.log('📧 Confirmation email sent to:', email)
  } catch (error) {
    console.error('❌ Error sending confirmation email:', error)
    throw new Error('Failed to send confirmation email')
  }
}

// ✅ Send password reset email
export const sendPasswordResetEmail = async (email, token, user = {}) => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${token}`

  try {
    await resend.emails.send({
      from: getFromAddress(user),
      to: email,
      subject: 'Reset Your Password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #3b82f6;">Password Reset Request</h2>
          <p>Click below to reset your password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">
              Reset Password
            </a>
          </div>
          <p>If that doesn't work, copy and paste this URL:</p>
          <p style="word-break: break-all; color: #666;">${resetUrl}</p>
        </div>
      `,
    })

    console.log('📧 Password reset email sent to:', email)
  } catch (error) {
    console.error('❌ Error sending password reset email:', error)
    throw new Error('Failed to send password reset email')
  }
}

// ✅ Send invoice email with PDF attachment
export const sendInvoiceEmail = async (email, invoiceData, pdfBuffer, user = {}) => {
  try {
    await resend.emails.send({
      from: getFromAddress(user),
      to: email,
      subject: `Invoice ${invoiceData.invoiceNumber} ${user.businessInfo?.businessName || ''}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #3b82f6;">Invoice from ${user.businessInfo?.businessName || 'InboxGuaranteed'}</h2>
          <p>Dear ${invoiceData.customerName},</p>
          <p>Please find attached your invoice.</p>
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Invoice Number:</strong> ${invoiceData.invoiceNumber}</p>
            <p><strong>Item:</strong> ${invoiceData.itemName}</p>
            <p><strong>Amount:</strong> ${invoiceData.currency || 'NGN'} ${Number(invoiceData.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p><strong>Status:</strong> ${invoiceData.status}</p>
          </div>
        </div>
      `,
      attachments:
        pdfBuffer instanceof Buffer
          ? [
              {
                filename: `invoice-${invoiceData.invoiceNumber}.pdf`,
                content: pdfBuffer.toString('base64'),
              },
            ]
          : [],
    })

    console.log('📧 Invoice email sent to:', email)
  } catch (error) {
    console.error('❌ Error sending invoice email:', error)
    throw new Error('Failed to send invoice email')
  }
}

// ✅ Send generic notification email
export const sendNotificationEmail = async (email, subject, message, user = {}) => {
  try {
    await resend.emails.send({
      from: getFromAddress(user),
      to: email,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #3b82f6;">Marketbook Solution</h2>
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
            ${message}
          </div>
        </div>
      `,
    })

    console.log('📧 Notification email sent to:', email)
  } catch (error) {
    console.error('❌ Error sending notification email:', error)
    throw new Error('Failed to send notification email')
  }
}

// ✅ Send scheduled note reminder email
export const sendNoteReminderEmail = async (email, userName, noteTitle, noteContent, scheduledDate, scheduledTime, timezone, noteCreatedAt, images = [], video = null, attachments = []) => {
  try {
    // Format the note creation date - display ONLY date, no time to avoid timezone confusion
    const createdAtDate = noteCreatedAt 
      ? new Date(noteCreatedAt).toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric' 
        })
      : new Date().toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric' 
        })
    
    // Build media HTML with proper error handling and fallbacks
    let mediaHTML = ''
    
    // Handle images - support both URL strings and image objects
    if (images && images.length > 0) {
      mediaHTML += '<div style="margin: 20px 0;">'
      mediaHTML += '<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">📸 Images:</p>'
      
      images.forEach((image, index) => {
        // Support both string URLs and image objects with .url property
        const imageUrl = typeof image === 'string' ? image : (image.url || image.publicId)
        
        if (imageUrl) {
          // Ensure the image URL is valid and properly formatted
          const validUrl = imageUrl.startsWith('http') ? imageUrl : `https://${imageUrl}`
          
          mediaHTML += `<div style="margin-bottom: 15px;">`
          mediaHTML += `<img src="${validUrl}" alt="Note image ${index + 1}" style="max-width: 100%; height: auto; border-radius: 8px; display: block; margin: 10px 0; max-height: 400px; border: 1px solid #ddd;" />`
          mediaHTML += `</div>`
        }
      })
      
      mediaHTML += '</div>'
    }
    
    // Handle videos - support both single video objects and arrays
    if (video) {
      const videos = Array.isArray(video) ? video : (video ? [video] : [])
      
      if (videos.length > 0) {
        mediaHTML += '<div style="margin: 20px 0;">'
        mediaHTML += `<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">🎥 Video${videos.length > 1 ? 's' : ''}:</p>`
        
        videos.forEach((vid, index) => {
          // Support both string URLs and video objects
          const videoUrl = typeof vid === 'string' ? vid : (vid.url || vid.publicId)
          const thumbnailUrl = typeof vid === 'object' ? vid.thumbnail : null
          
          if (videoUrl) {
            const validVideoUrl = videoUrl.startsWith('http') ? videoUrl : `https://${videoUrl}`
            
            mediaHTML += `<div style="margin-bottom: 20px; background-color: #f5f5f5; padding: 15px; border-radius: 8px;">`
            mediaHTML += `<p style="color: #555; font-weight: bold; font-size: 13px; margin: 0 0 10px 0;">Video ${index + 1}</p>`
            
            // If thumbnail available, show it
            if (thumbnailUrl) {
              const validThumbUrl = thumbnailUrl.startsWith('http') ? thumbnailUrl : `https://${thumbnailUrl}`
              mediaHTML += `<div style="margin-bottom: 12px;">`
              mediaHTML += `<img src="${validThumbUrl}" alt="Video ${index + 1} thumbnail" style="max-width: 100%; height: auto; border-radius: 6px; display: block; max-height: 300px; border: 1px solid #ddd;" />`
              mediaHTML += `</div>`
            }
            
            // Add watch button with proper styling
            mediaHTML += `<a href="${validVideoUrl}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; text-align: center; transition: background-color 0.3s;" onmouseover="this.style.backgroundColor='#2563eb'" onmouseout="this.style.backgroundColor='#3b82f6'">▶️ Watch Video ${index + 1}</a>`
            
            mediaHTML += `</div>`
          }
        })
        
        mediaHTML += '</div>'
      }
    }
    
    // Handle attachments (PDFs)
    if (attachments && attachments.length > 0) {
      mediaHTML += '<div style="margin: 20px 0;">'
      mediaHTML += '<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">📎 Attachments:</p>'
      
      attachments.forEach((attachment, index) => {
        const filename = typeof attachment === 'object' ? (attachment.filename || `Attachment ${index + 1}`) : `Attachment ${index + 1}`
        mediaHTML += `<p style="margin: 5px 0; color: #555; font-size: 13px;">📄 ${filename}</p>`
      })
      
      mediaHTML += '</div>'
    }
    
    // Convert attachments for Resend
    const resendAttachments = await convertAttachmentsToResend(attachments)
    
    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: `📝 Reminder: Your Scheduled Note - "${noteTitle}"`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h2 style="color: white; margin: 0; font-size: 24px;">📝 Note Reminder</h2>
          </div>
          
          <div style="padding: 30px; background-color: #ffffff;">
            <p style="margin-top: 0; font-size: 16px; color: #333;">Hi ${userName},</p>
            
            <p style="font-size: 15px; color: #555; margin: 15px 0;">Your scheduled note is ready for review:</p>
            
            <div style="background-color: #f8f9fa; padding: 25px; border-radius: 10px; margin: 25px 0; border-left: 5px solid #3b82f6;">
              <h3 style="margin-top: 0; color: #1e40af; font-size: 18px; word-break: break-word;">${noteTitle}</h3>
              <div style="color: #333; margin: 15px 0; line-height: 1.6; font-size: 14px; white-space: pre-wrap; word-break: break-word; background-color: white; padding: 12px; border-radius: 6px; border: 1px solid #e0e0e0;">${noteContent || '(No content)'}</div>
              ${mediaHTML}
              <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
              <p style="margin: 0; color: #666; font-size: 12px;">Note created on ${createdAtDate}</p>
            </div>
            
            <div style="background-color: #eff6ff; padding: 20px; border-radius: 10px; margin: 25px 0; border-left: 5px solid #0ea5e9;">
              <p style="margin: 0; color: #0c4a6e; font-size: 14px; line-height: 1.8;">
                <strong style="font-size: 15px;">📅 Scheduled Date:</strong> ${scheduledDate}<br>
                <strong style="font-size: 15px;">⏰ Scheduled Time:</strong> ${scheduledTime || '00:00'}<br>
                <strong style="font-size: 15px;">🌍 Timezone:</strong> ${timezone}
              </p>
            </div>
            
            <div style="background-color: #f0fdf4; padding: 20px; border-radius: 10px; margin: 25px 0; border-left: 5px solid #22c55e;">
              <p style="margin: 0; color: #166534; font-size: 13px; line-height: 1.6;">
                ✅ This reminder was sent on the scheduled date and time in your timezone.
              </p>
            </div>
            
            <p style="color: #666; font-size: 14px; margin: 20px 0;">
              You can view and manage all your notes in your Marketbook dashboard.
            </p>
          </div>
          
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 0 0 12px 12px; text-align: center; border-top: 1px solid #e0e0e0;">
            <p style="color: #999; font-size: 12px; margin: 0;">
              This is an automated reminder from InboxGuaranteed. If you did not set this reminder, please contact support.
            </p>
          </div>
        </div>
      `,
      ...(resendAttachments.length > 0 && { attachments: resendAttachments })
    })

    console.log('✅ Note reminder email sent successfully to:', email)
    console.log('📬 Resend Response ID:', result?.id)
    return result
  } catch (error) {
    console.error('❌ Error sending note reminder email to', email, ':', error)
    throw new Error(`Failed to send note reminder email: ${error.message}`)
  }
}

// ✅ Send shared note email
export const sendSharedNoteEmail = async (recipientEmail, senderName, noteTitle, noteContent, customMessage, user = {}, timezone = 'UTC', subject = 'Shared Note', images = [], video = null, allRecipients = [], attachments = [], fromEmail = null, callToActionText = null, callLink = null) => {
  try {
    // Build media HTML with proper error handling and fallbacks
    let mediaHTML = ''
    
    // Handle images - support both URL strings and image objects
    if (images && images.length > 0) {
      mediaHTML += '<div style="margin: 20px 0;">'
      mediaHTML += '<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">📸 Images:</p>'
      
      images.forEach((image, index) => {
        // Support both string URLs and image objects with .url property
        const imageUrl = typeof image === 'string' ? image : (image.url || image.publicId)
        
        if (imageUrl) {
          // Ensure the image URL is valid and properly formatted
          const validUrl = imageUrl.startsWith('http') ? imageUrl : `https://${imageUrl}`
          
          mediaHTML += `<div style="margin-bottom: 15px;">`
          mediaHTML += `<img src="${validUrl}" alt="Note image ${index + 1}" style="max-width: 100%; height: auto; border-radius: 8px; display: block; margin: 10px 0; max-height: 400px; border: 1px solid #ddd;" />`
          mediaHTML += `</div>`
        }
      })
      
      mediaHTML += '</div>'
    }
    
    // Handle videos - support both single video objects and arrays
    if (video) {
      const videos = Array.isArray(video) ? video : (video ? [video] : [])
      
      if (videos.length > 0) {
        mediaHTML += '<div style="margin: 20px 0;">'
        mediaHTML += `<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">🎥 Video${videos.length > 1 ? 's' : ''}:</p>`
        
        videos.forEach((vid, index) => {
          // Support both string URLs and video objects
          const videoUrl = typeof vid === 'string' ? vid : (vid.url || vid.publicId)
          const thumbnailUrl = typeof vid === 'object' ? vid.thumbnail : null
          
          if (videoUrl) {
            const validVideoUrl = videoUrl.startsWith('http') ? videoUrl : `https://${videoUrl}`
            
            mediaHTML += `<div style="margin-bottom: 20px; background-color: #f5f5f5; padding: 15px; border-radius: 8px;">`
            mediaHTML += `<p style="color: #555; font-weight: bold; font-size: 13px; margin: 0 0 10px 0;">Video ${index + 1}</p>`
            
            // If thumbnail available, show it
            if (thumbnailUrl) {
              const validThumbUrl = thumbnailUrl.startsWith('http') ? thumbnailUrl : `https://${thumbnailUrl}`
              mediaHTML += `<div style="margin-bottom: 12px;">`
              mediaHTML += `<img src="${validThumbUrl}" alt="Video ${index + 1} thumbnail" style="max-width: 100%; height: auto; border-radius: 6px; display: block; max-height: 300px; border: 1px solid #ddd;" />`
              mediaHTML += `</div>`
            }
            
            // Add watch button with proper styling
            mediaHTML += `<a href="${validVideoUrl}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; text-align: center; transition: background-color 0.3s;" onmouseover="this.style.backgroundColor='#2563eb'" onmouseout="this.style.backgroundColor='#3b82f6'">▶️ Watch Video ${index + 1}</a>`
            
            mediaHTML += `</div>`
          }
        })
        
        mediaHTML += '</div>'
      }
    }
    
    // Handle attachments (PDFs)
    if (attachments && attachments.length > 0) {
      mediaHTML += '<div style="margin: 20px 0;">'
      mediaHTML += '<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">📎 Attachments:</p>'
      
      attachments.forEach((attachment, index) => {
        const filename = typeof attachment === 'object' ? (attachment.filename || `Attachment ${index + 1}`) : `Attachment ${index + 1}`
        mediaHTML += `<p style="margin: 5px 0; color: #555; font-size: 13px;">📄 ${filename}</p>`
      })
      
      mediaHTML += '</div>'
    }
    
    // Convert attachments for Resend
    const resendAttachments = await convertAttachmentsToResend(attachments)
    
    // Build recipients list HTML - REMOVED: Don't show recipients in email
    
    const emailFrom = fromEmail || process.env.EMAIL_FROM
    const fromAddress = `${senderName} <${emailFrom}>`
    
    // Build CTA button HTML if provided
    let ctaHTML = ''
    if (callToActionText && callLink) {
      ctaHTML = `
        <div style="text-align: center; margin: 30px 0;">
          <a href="${callLink}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; transition: transform 0.3s, box-shadow 0.3s;" onmouseover="this.style.transform='scale(1.05)'; this.style.boxShadow='0 10px 20px rgba(102, 126, 234, 0.3)'" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='none'">
            ${callToActionText}
          </a>
        </div>
      `
    }
    
    const result = await resend.emails.send({
      from: fromAddress,
      to: recipientEmail,
      subject: `📝 ${senderName} shared a note with you: "${noteTitle}"`,
      ...(emailFrom !== displayEmail && { replyTo: emailFrom }),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; padding: 20px 0;">
          <div style="max-width: 600px; margin: 0 auto;">
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #ea66c0 0%, #764ba2 100%); padding: 40px 30px; text-align: center; border-radius: 16px 16px 0 0;">
              <div style="background-color: rgba(255,255,255,0.15); width: 56px; height: 56px; border-radius: 12px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
                <span style="font-size: 28px;">📝</span>
              </div>
              <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 600;">Note Shared with You</h1>
              <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px;">from <strong>${senderName}</strong></p>
            </div>
            
            <!-- Main Content -->
            <div style="background-color: #ffffff; padding: 40px 30px;">
              <!-- Greeting -->
              <p style="margin: 0 0 24px 0; font-size: 16px; color: #1e293b; line-height: 1.5;">Hi there,</p>
              
              <!-- Note Content Card -->
              <div style="background-color: #f1f5f9; border-left: 4px solid #667eea; padding: 24px; border-radius: 8px; margin: 24px 0;">
                <h2 style="margin: 0 0 16px 0; color: #0f172a; font-size: 20px; font-weight: 600; word-break: break-word;">${noteTitle}</h2>
                <div style="background-color: #ffffff; padding: 16px; border-radius: 6px; color: #334155; font-size: 15px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;">${noteContent || '(No content)'}</div>
                ${mediaHTML}
              </div>
              
              <!-- Personal Message -->
              ${customMessage ? `
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 24px 0;">
                <p style="margin: 0 0 8px 0; color: #92400e; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">💬 Message</p>
                <p style="margin: 0; color: #78350f; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${customMessage}</p>
              </div>
              ` : ''}
              
              <!-- CTA Button -->
              ${ctaHTML}
            </div>
            
            <!-- Footer -->
            <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-radius: 0 0 16px 16px; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 1.5;">
                <strong style=
                "color: #0f172a;">Note Received</strong><br>
                Your note management platform
              </p>
            </div>
          </div>
        </div>
      `,
      ...(resendAttachments.length > 0 && { attachments: resendAttachments })
    })

    console.log('✅ Shared note email sent successfully to:', recipientEmail)
    console.log('📬 Resend Response ID:', result?.id)
    return result
  } catch (error) {
    console.error('❌ Error sending shared note email to', recipientEmail, ':', error)
    throw new Error(`Failed to send shared note email: ${error.message}`)
  }
}












