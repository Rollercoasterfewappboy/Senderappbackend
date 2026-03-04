import express from 'express';
import multer from 'multer';
import nodemailer from 'nodemailer';

/*
 * CRITICAL EMAIL HTML RENDERING GUIDELINES
 * --------------------------------------------------
 * - HTML MUST be sent raw, unescaped, and un-sanitized.
 *   Avoid any calls to escape(), sanitize(), res.send(html) or
 *   template engine escaping (e.g. handlebars {{html}}).
 * - When using a templating system that auto-escapes, use
 *   triple braces ({{{html}}}) or equivalent to prevent escaping.
 * - NEVER concatenate HTML strings inline.  Use fixed template
 *   functions or build complete documents with template literals.
 * - Ensure <a> tags are not broken (no missing quotes, no
 *   line breaks inside attributes, no escaped characters).
 *   A broken <a> tag will cause CSS styles to render as text.
 * - Always send email as multipart/alternative with separate
 *   text and html parts; do not embed HTML inside the text field.
 * - Log final HTML before sending to detect any corruption early.
 *
 * Failure to follow these rules will result in rendering bugs where
 * CSS appears as visible text and buttons are malformed in inboxes.
 */

import { authenticateToken, requireUser } from '../middleware/auth.js';
import EmailProvider from '../models/EmailProvider.js';
import EmailLog from '../models/EmailLog.js';
import { sendEmailWithProvider, decodeHtmlEntities } from '../utils/emailSenders.js';
// HTML-to-plain-text conversion is no longer performed by the backend.
// import { htmlToPlainText } from '../utils/htmlSanitizer.js';
import { generateProfessionalEmailTemplate, validateEmailHtml, extractBodyContent } from '../utils/emailTemplates.js';
// The following imports were required when we were performing CSS inlining
// and HTML sanitization.  The requirements have changed: we now pass the
// sender-provided HTML through untouched, exactly the same way the standalone
// sender script does.  All processing/inlining logic has been removed, so
// these modules are no longer used.
// validation helper was previously imported but is no longer required
// since we no longer mutate or inspect HTML.  The sender is expected
// to provide valid email-ready HTML.

// NOTE: cssInliner and emailCssProcessor imports were intentionally dropped.
import placeholderService from '../services/placeholderService.js';
import path from 'path';
import fs from 'fs';
import cloudinary from 'cloudinary';
import crypto from 'crypto';

const router = express.Router();

// Configure Cloudinary from env
cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// =====================
// PROFESSIONAL PLACEHOLDER SYSTEM (like high-volume senders)
// =====================
// Supports placeholders like {RECIPIENT_NAME}, {RECIPIENT_EMAIL}, etc.
// All placeholders are replaced using simple regex substitution

function capitalize(str) {
  if (str && typeof str === 'string') {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  return str;
}

// =====================
// PLACEHOLDER VALUE GENERATORS
// =====================

// Generate random 10-digit number
function generateRandom10DigitNumber() {
  return Math.floor(1000000000 + Math.random() * 9000000000).toString();
}

// Normalize filenames to avoid invalid extensions (Resend rejects ".com" etc)
function normalizeFilename(name, contentType) {
  if (!name) return name;
  let clean = name.replace(/[\/]/g, '_').replace(/\s+/g, '_');
  // remove characters that may cause provider errors
  clean = clean.replace(/@/g, '_');
  // strip problematic trailing tokens from raw curly placeholders
  clean = clean.replace(/\.com$/i, '').replace(/\.net$/i, '');
  const mapping = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  };
  const ext = mapping[contentType];
  if (ext) {
    // if the cleaned name doesn’t already end in the correct extension, append it
    if (!clean.toLowerCase().endsWith('.' + ext)) {
      clean = clean + '.' + ext;
    }
  }
  // trim any trailing period left behind
  clean = clean.replace(/\.$/, '');
  return clean;
}

// Generate random string (7-10 chars, alphanumeric)
function generateRandomString() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const len = 7 + Math.floor(Math.random() * 4);
  let result = '';
  for (let i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Generate random MD5 hash
function generateRandomMD5() {
  return crypto.createHash('md5').update(Math.random().toString()).digest('hex');
}

// Generate random path
function generateRandomPath() {
  const segments = ['user', 'data', 'files', 'documents', 'assets', 'media', 'uploads'];
  const randomSegments = [];
  const length = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < length; i++) {
    randomSegments.push(segments[Math.floor(Math.random() * segments.length)] + Math.floor(Math.random() * 1000));
  }
  return '/' + randomSegments.join('/');
}

// Generate random tracking link
function generateRandomLink() {
  const baseUrl = 'https://example.com/track';
  const trackId = Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 8);
  return `${baseUrl}/${trackId}`;
}

// Generate fake company name
function generateFakeCompanyName() {
  const prefixes = ['Tech', 'Data', 'Digital', 'Smart', 'Cloud', 'Web', 'Cyber', 'Next', 'Prime', 'Ultra', 'Pro', 'Mega', 'Elite'];
  const suffixes = ['Nova', 'Solutions', 'Systems', 'Labs', 'Hub', 'Works', 'Wave', 'Stream', 'Tech', 'Sync', 'Flow', 'Link', 'Direct'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  return `${prefix}${suffix}`;
}

// Generate fake company email
function generateFakeCompanyEmail() {
  const companyName = generateFakeCompanyName();
  const domains = ['com', 'net', 'io', 'co', 'org', 'us'];
  const domain = domains[Math.floor(Math.random() * domains.length)];
  return `contact@${companyName.toLowerCase()}.${domain}`;
}

// Generate fake company full info
function generateFakeCompanyEmailAndFullName() {
  const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'James', 'Emily', 'David', 'Lisa', 'Robert', 'Jennifer'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  const email = generateFakeCompanyEmail();
  return `${firstName} ${lastName} <${email}>`;
}

// Encode email in Base64
function encodeBase64(str) {
  return Buffer.from(str).toString('base64');
}

function replaceBracedPlaceholders(content, placeholders) {
  if (!content || typeof content !== 'string') return content;
  let replacedContent = content;
  for (const [placeholder, value] of Object.entries(placeholders)) {
    const regex = new RegExp(`{${placeholder}}`, 'g');
    replacedContent = replacedContent.replace(regex, String(value || ''));
  }
  return replacedContent;
}

// Multer setup for attachments
const upload = multer({ dest: 'uploads/email_attachments/' });


// Helper function to inject image into HTML body
function injectImageIntoHtml(htmlContent, bodyImageData, placeholders = {}) {
  if (!bodyImageData) return htmlContent;

  try {
    const imageObj = typeof bodyImageData === 'string' ? JSON.parse(bodyImageData) : bodyImageData;
    let src = imageObj.url || imageObj.base64 || imageObj.src;
    let link = imageObj.link;

    if (!src) return htmlContent;

    // Replace any braced placeholders in src and link using the provided placeholders map
    try {
      if (typeof src === 'string' && Object.keys(placeholders || {}).length > 0) {
        src = replaceBracedPlaceholders(src, placeholders);
      }
    } catch (e) {
      console.warn('[Email Send] Failed to replace placeholders in image src:', e.message);
    }

    try {
      if (typeof link === 'string' && Object.keys(placeholders || {}).length > 0) {
        link = replaceBracedPlaceholders(link, placeholders);
      }
    } catch (e) {
      console.warn('[Email Send] Failed to replace placeholders in image link:', e.message);
    }

    // Create image HTML with optional link wrapping
    let imageHtml = `<img src="${src}" alt="Email image" style="max-width: 100%; height: auto; display: block; margin: 1em auto;" />`;

    if (link) {
      imageHtml = `<a href="${link}" style="text-decoration: none;"><div>${imageHtml}</div></a>`;
    }

    // Inject image: if htmlContent is empty, just return the image; otherwise append with spacing
    if (!htmlContent || htmlContent.trim().length === 0) {
      return imageHtml;
    }
    return `${htmlContent}\n<br />\n${imageHtml}`;
  } catch (e) {
    console.warn('[Email Send] Failed to parse bodyImage:', e.message);
    return htmlContent;
  }
}

// **HTML HELPER FUNCTIONS REMOVED**
// The previous implementation contained several helper routines that
// manipulated or validated HTML (`extractQuillContent`,
// `validateAndCleanHtmlForEmail`, `ensureHtmlStructure`, `applyBodyStyling`).
// These were used to try to make the HTML safe for email clients, wrap
// partial fragments, strip Quill wrappers, etc.  Per the latest requirement
// the backend no longer touches or inspects HTML; whatever string is sent by
// the client is forwarded directly to the email provider.  To avoid accidental
// invocation we have removed all of that code from this file.

// If you need a reference to the old logic it is available in the git
// history or documentation files; do not reintroduce any HTML processing
// unless there is a compelling new requirement.

// ensureHtmlStructure logic removed – HTML handling is now completely delegated
// to the sender.  Content is forwarded exactly as provided without any
// wrapping, validation, or templating.  The old implementation lived here but
// has been deleted to avoid confusion.

// applyBodyStyling removed: HTML is passed through without any additional spacing or alignment wrappers.
// Save or update email provider settings
// When users supply SMTP configuration we also run a quick connection
// verification to catch typos/blocked ports before they attempt to send.
router.post('/settings', authenticateToken, requireUser, async (req, res) => {
  try {
    const { provider, smtp, aws, resend, fromEmail } = req.body;
    const userId = req.user._id;

    console.log('[emailSettings] POST /settings called, provider=', provider);
    if (provider === 'smtp' && smtp) {
      console.log('[emailSettings] SMTP settings provided:', {
        host: smtp.host,
        port: smtp.port,
        encryption: smtp.encryption,
        requireAuth: smtp.requireAuth,
      });
    }

    // Save settings without blocking on SMTP verification.
    // Users can test connections separately using POST /settings/test endpoint.
    let doc = await EmailProvider.findOne({ userId });
    if (!doc) doc = new EmailProvider({ userId });
    doc.provider = provider;
    // Persist smtp object but ensure requireAuth remains a boolean
    doc.smtp = smtp && typeof smtp === 'object' ? { ...smtp } : {};
    if (smtp && Object.prototype.hasOwnProperty.call(smtp, 'requireAuth')) {
      // Accept boolean, numeric, or string representations from the client
      const v = smtp.requireAuth;
      doc.smtp.requireAuth = (v === true || v === 'true' || v === '1' || v === 1) ? true : false;
    }
    doc.aws = aws || {};
    doc.resend = resend || {};
    doc.fromEmail = fromEmail || '';
    doc.updatedAt = new Date();
    console.log('[emailSettings] Saving EmailProvider for user:', userId);
    await doc.save();
    console.log('[emailSettings] EmailProvider saved for user:', userId, 'provider:', doc.provider);
    res.json({ success: true, message: 'Settings saved successfully. Use the test connection button to verify SMTP credentials.' });
  } catch (error) {
    console.error('[emailSettings] POST /settings error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get current email provider settings
router.get('/settings', authenticateToken, requireUser, async (req, res) => {
  try {
    const doc = await EmailProvider.findOne({ userId: req.user._id });
    if (!doc) {
      res.json({ settings: null });
      return;
    }
    // Transform nested structure to flat structure for frontend
    const settings = {
      provider: doc.provider || 'smtp',
      smtpHost: doc.smtp?.host || '',
      smtpPort: doc.smtp?.port || '',
      smtpUser: doc.smtp?.username || '',
      smtpPass: doc.smtp?.password || '',
      smtpEncryption: doc.smtp?.encryption || 'ssl',
      smtpRequireAuth: typeof doc.smtp?.requireAuth === 'boolean' ? doc.smtp.requireAuth : true,
      awsAccessKeyId: doc.aws?.username || '',
      awsSecretAccessKey: doc.aws?.password || '',
      awsRegion: doc.aws?.region || '',
      resendApiKey: doc.resend?.apiKey || '',
      fromEmail: doc.fromEmail || '',
    };
    res.json({ settings });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /settings/test will perform connection verification without
// persisting any data.  Useful for checking SMTP credentials and network
// reachability before attempting to send email.
router.post('/settings/test', authenticateToken, requireUser, async (req, res) => {
  try {
    const { provider, smtp } = req.body;

    console.log('[emailSettings] POST /settings/test called, provider=', provider);
    if (provider === 'smtp') {
      if (!smtp || !smtp.host) {
        return res.json({ success: false, message: 'SMTP host is required' });
      }
      console.log('[emailSettings] Testing SMTP connection to', smtp.host, 'port', smtp.port, 'encryption', smtp.encryption);

      try {
        const transportConfig = {
          host: smtp.host,
          port: Number(smtp.port || 587),
          logger: false,
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 10000,
        };
        const encryption = smtp.encryption || 'ssl';
        if (encryption === 'ssl') {
          transportConfig.secure = true;
        } else if (encryption === 'tls') {
          transportConfig.secure = false;
          transportConfig.requireTLS = true;
          transportConfig.tls = { rejectUnauthorized: false };
        } else if (encryption === 'none') {
          transportConfig.secure = false;
        }
        // Determine whether SMTP requires authentication. Accept boolean/string/number
        const requireAuth = !(smtp.requireAuth === false || smtp.requireAuth === 'false' || smtp.requireAuth === '0' || smtp.requireAuth === 0);
        if (requireAuth) {
          transportConfig.auth = {
            user: smtp.username,
            pass: smtp.password,
          };
        }
        const transporter = nodemailer.createTransport(transportConfig);
        console.log('[emailSettings] SMTP test transportConfig:', transportConfig);
        await transporter.verify();
        console.log('[emailSettings] SMTP test successful');
        return res.json({ success: true, message: 'SMTP connection successful' });
      } catch (verifyErr) {
        console.warn('[emailSettings] SMTP test failed:', verifyErr.message);
        let msg = `Connection failed: ${verifyErr.message}`;
        
        if (/timeout/i.test(verifyErr.message) || verifyErr.code === 'ETIMEDOUT' || verifyErr.code === 'ECONNREFUSED') {
          msg = 'Connection timeout. This may be due to:\n• Network/firewall blocking outbound SMTP connections\n• Hosting provider restrictions (e.g., Render.com, Heroku block SMTP)\n• Incorrect SMTP host/port\n• SMTP server temporarily unavailable\n\nTry using a transactional email service like AWS SES, SendGrid, or Resend instead of direct SMTP.';
        } else if (/auth/i.test(verifyErr.message) || verifyErr.code === 'EAUTH') {
          msg = 'Authentication failed. Check your SMTP username and password.';
        }
        
        return res.json({ success: false, message: msg });
      }
    }

    // non-SMTP providers don't require verification
    return res.json({ success: true });
  } catch (error) {
    console.error('[emailSettings] SMTP test error:', error);
    res.json({ success: false, message: error.message });
  }
});

// =====================
// SEND EMAIL - PROFESSIONAL PLACEHOLDER SYSTEM
// =====================
// Uses braced placeholders like {RECIPIENT_NAME}, {RECIPIENT_EMAIL}, etc.
// Works exactly like professional mass email senders
router.post('/send', authenticateToken, requireUser, upload.array('attachments'), async (req, res) => {
  try {
    const userId = req.user._id;
    const { to, bcc, subject, body, bodyPlainText, replyTo, fromName, fromEmail, bodyImage, ctaText, ctaLink, htmlAlignment, htmlMarginTop, htmlMarginBottom } = req.body;
    const timezone = req.body.timezone || 'UTC';
    const files = req.files || [];
    
    console.log('\n\n⚠️⚠️⚠️ [Email Send] CRITICAL EXTRACTION CHECK ⚠️⚠️⚠️');
    console.log('bodyPlainText extracted:', bodyPlainText);
    console.log('bodyPlainText type:', typeof bodyPlainText);
    console.log('bodyPlainText length:', bodyPlainText?.length || 0);
    console.log('Direct req.body.bodyPlainText:', req.body.bodyPlainText);
    console.log('All request body keys:', Object.keys(req.body));
    console.log('⚠️⚠️⚠️ END CRITICAL CHECK ⚠️⚠️⚠️\n');
    
    // Validate required fields
    console.log('[Email Send] Required fields check:', { hasSubject: !!subject });
    if (!subject) {
      console.error('[Email Send] Validation failed: Subject missing');
      return res.status(400).json({ success: false, error: 'Subject is required' });
    }
    
    const hasBody = body && body.trim().length > 0 && body.trim() !== '<p><br></p>';
    const hasPlainText = bodyPlainText && bodyPlainText.trim().length > 0;
    const hasCtaLink = ctaLink && ctaLink.trim().length > 0;
    let hasImage = false;
    let bodyImageObj = null;
    
    // Parse bodyImage if provided (may contain base64 or a direct URL/link)
    if (bodyImage) {
      try {
        bodyImageObj = typeof bodyImage === 'string' ? JSON.parse(bodyImage) : bodyImage;
        // treat either a base64 blob or a url as "image present" for
        // validation purposes.  the front-end may send only a link when the
        // user chooses an external image rather than uploading one.
        hasImage = !!(bodyImageObj && (bodyImageObj.base64 || bodyImageObj.url));
      } catch (e) {
        console.warn('[Email Send] Failed to parse bodyImage:', e.message);
      }
    }
    
    console.log('[Email Send] Content validation:', { hasBody, hasPlainText, hasImage, hasCtaLink });
    
    if (!hasBody && !hasPlainText && !hasImage && !hasCtaLink) {
      console.error('[Email Send] Validation failed: No content provided', { hasBody, hasPlainText, hasImage, hasCtaLink });
      return res.status(400).json({ success: false, error: 'Please provide at least one of: email body, plain text, image, or CTA link' });
    }
    
    // Get email provider
    const providerDoc = await EmailProvider.findOne({ userId });
    if (!providerDoc) {
      return res.status(400).json({ success: false, error: 'No email provider configured.' });
    }
    
    // Upload image to Cloudinary if provided
    if (bodyImageObj && bodyImageObj.base64 && process.env.CLOUDINARY_CLOUD_NAME) {
      try {
        const uploadResult = await cloudinary.v2.uploader.upload(bodyImageObj.base64, {
          folder: 'email_images',
          resource_type: 'image',
        });
        if (uploadResult && uploadResult.secure_url) {
          bodyImageObj.url = uploadResult.secure_url;
          delete bodyImageObj.base64;
          console.log('[Email Send] Image uploaded to Cloudinary:', bodyImageObj.url);
        }
      } catch (e) {
        console.warn('[Email Send] Cloudinary upload failed:', e.message);
      }
    }
    // log final bodyImageObj for diagnostics (may include url/link)
    if (bodyImageObj) {
      console.log('[Email Send] Final bodyImage object:', bodyImageObj);
    }
    
    // Parse recipients
    const toArray = to ? (Array.isArray(to) ? to : to.split(/,|\n/).map(e => e.trim()).filter(Boolean)) : [];
    const bccArray = bcc ? (Array.isArray(bcc) ? bcc : bcc.split(/,|\n/).map(e => e.trim()).filter(Boolean)) : [];
    
    console.log('[Email Send] Recipients parsed:', { toCount: toArray.length, bccCount: bccArray.length, toArray, bccArray });
    
    if (toArray.length === 0 && bccArray.length === 0) {
      console.error('[Email Send] Validation failed: No recipients', { toArray, bccArray });
      return res.status(400).json({ success: false, error: 'At least one recipient is required' });
    }
    
    // Prepare attachments (from multer `files`)
    // Safety check: ensure files is an array
    console.log('[Email Send] 📎 ATTACHMENT PROCESSING - Incoming files:', {
      filesType: typeof files,
      filesIsArray: Array.isArray(files),
      filesLength: files?.length || 0,
      filesValue: files,
    });
    
    let filesArray = [];
    try {
      filesArray = Array.isArray(files) ? files : (files ? [files] : []);
      console.log('[Email Send] 📎 Files converted to array successfully:', filesArray.length, 'file(s)');
    } catch (fileError) {
      console.error('[Email Send] 📎 ERROR converting files to array:', {
        message: fileError.message,
        filesType: typeof files,
      });
      filesArray = [];
    }
    
    let attachments = [];
    try {
      attachments = filesArray.map(file => ({
        filename: file.originalname,
        path: file.path,
        contentType: file.mimetype,
      }));
      console.log('[Email Send] 📎 Attachments mapped successfully:', attachments.map(a => ({ filename: a.filename, path: a.path, contentType: a.contentType })));
    } catch (mapError) {
      console.error('[Email Send] 📎 ERROR mapping attachment files:', {
        message: mapError.message,
        filesArrayLength: filesArray.length,
        filesArraySample: filesArray.slice(0, 1),
      });
      attachments = [];
    }
    
    console.log('[Email Send] 📎 FINAL ATTACHMENT RESULT:', {
      totalAttachments: attachments.length,
      attachmentDetails: attachments.map(a => ({ filename: a.filename, path: a.path, contentType: a.contentType })),
    });

    // Process each recipient with professional placeholder system
    let successCount = 0;
    let failureCount = 0;
    const results = [];
    
    // Combine all recipients
    const allRecipients = [
      ...toArray.map(email => ({ email, isTo: true })),
      ...bccArray.map(email => ({ email, isTo: false }))
    ];
    
    for (const recipientData of allRecipients) {
      try {
        const recipientEmail = recipientData.email;
        const isTo = recipientData.isTo;
        
        // Extract recipient info from email
        const emailLocalPart = recipientEmail.split('@')[0];
        const recipientName = capitalize(emailLocalPart.split('.')[0] || emailLocalPart);
        const recipientDomain = recipientEmail.split('@')[1];
        const recipientDomainName = capitalize(recipientDomain.split('.')[0]);
        
        // Get current date/time
        const currentDate = new Date().toLocaleDateString();
        const currentTime = new Date().toLocaleTimeString();
        
        // Build braced placeholder map (professional sender style)
        // Includes ALL professional system placeholders
        const placeholderMap = {
          'RECIPIENT_NAME': recipientName,
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
        };
        
        // Replace braced placeholders in subject and body
        let renderedSubject = replaceBracedPlaceholders(subject, placeholderMap);
        let renderedBody = replaceBracedPlaceholders(body || '', placeholderMap);
        // 🔧 If any placeholders produced escaped HTML (e.g. &lt; &gt;), decode them now
        if (typeof renderedBody === 'string') {
          const beforeDecode = renderedBody;
          renderedBody = decodeHtmlEntities(renderedBody);
          if (beforeDecode !== renderedBody) {
            console.log('[Email Send] 🔧 decoded placeholders in HTML body (escaped entities removed)');
          }
        }
        // 📌 INJECT BODY IMAGE IF PRESENT (and after placeholders so link can use them)
        if (bodyImageObj) {
          renderedBody = injectImageIntoHtml(renderedBody, bodyImageObj, placeholderMap);
          console.log('[Email Send] Body image injected into HTML for recipient', recipientEmail);
        }

        let renderedPlainText = bodyPlainText ? replaceBracedPlaceholders(bodyPlainText, placeholderMap) : null;
        // if there is no plain text but we have an image URL or link, provide a simple fallback
        if (!renderedPlainText && bodyImageObj) {
          const textParts = [];
          if (bodyImageObj.url) textParts.push(`Image: ${bodyImageObj.url}`);
          if (bodyImageObj.link) textParts.push(`Link: ${bodyImageObj.link}`);
          renderedPlainText = textParts.join(' ');
        }
        let renderedCtaText = ctaText ? replaceBracedPlaceholders(ctaText, placeholderMap) : null;
        let renderedCtaLink = ctaLink ? replaceBracedPlaceholders(ctaLink, placeholderMap) : null;
        // ✅ CRITICAL Fix: Replace placeholders in FROM fields and REPLY-TO
        let renderedFromName = fromName ? replaceBracedPlaceholders(fromName, placeholderMap) : null;
        let renderedFromEmail = fromEmail ? replaceBracedPlaceholders(fromEmail, placeholderMap) : null;
        let renderedReplyTo = replyTo ? replaceBracedPlaceholders(replyTo, placeholderMap) : null;
        
        console.log(`[Email Send] Rendering for ${recipientEmail}: subject="${renderedSubject.substring(0, 50)}..."`);
        console.log(`[Email Send] Rendered CTA for ${recipientEmail}:`, { 
          ctaText: renderedCtaText || 'none', 
          ctaLink: renderedCtaLink || 'none' 
        });
        console.log(`[Email Send] Rendered Plain Text for ${recipientEmail}:`, {
          length: renderedPlainText?.length || 0,
          preview: renderedPlainText?.substring(0, 100) || 'AUTO-GENERATED FROM HTML'
        });
        console.log(`[Email Send] Rendered FROM fields for ${recipientEmail}:`, { 
          fromName: renderedFromName || 'NOT SET', 
          fromEmail: renderedFromEmail || 'NOT SET',
          replyTo: renderedReplyTo || 'NOT SET'
        });
        
        // Image injection is disabled – we no longer modify the HTML at all.
        // renderedBody = injectImageIntoHtml(renderedBody, bodyImageObj, placeholderMap);
        
        // Wrap the sender-provided HTML in a professional email template structure.
        // This ensures proper DOCTYPE, meta tags, charset, and outer container
        // for consistent rendering across all email clients (Gmail, Outlook, etc.).
        // The user's HTML content becomes the inner 'content' of the template.
        
        // 🔍 DIAGNOSTIC: Before template wrapping (decode entities to check real content)
        const decodedBefore = decodeHtmlEntities(renderedBody || '');
        console.log(`[Email Send] 🔍 HTML BEFORE TEMPLATE WRAPPING for ${recipientEmail}:`, {
          length: decodedBefore.length,
          hasDoctype: decodedBefore.includes('<!DOCTYPE') ? 'YES' : 'NO',
          hasTableTag: decodedBefore.includes('<table') ? 'YES' : 'NO',
          hasStyleAttr: decodedBefore.includes('style=') ? 'YES' : 'NO',
          hasEscapedHtml: (decodedBefore.includes('&lt;') || decodedBefore.includes('&gt;')) ? 'YES - STILL ESCAPED' : 'NO',
          lineCount: decodedBefore.split('\n').length || 0,
          preview_first200: decodedBefore.substring(0, 200) || 'EMPTY',
          preview_last200: decodedBefore.substring(Math.max(0, decodedBefore.length - 200)) || 'EMPTY',
        });
        
        // ✅ CRITICAL FIX: If the HTML is already a complete document (has DOCTYPE, html, body tags),
        // send it as-is without ANY wrapping. The wrapper was causing the original HTML
        // to be corrupted by being wrapped inside paragraphs.
        const isCompleteDocument = decodedBefore.includes('<!DOCTYPE') && 
                                    decodedBefore.includes('<html') && 
                                    decodedBefore.includes('<body');
        
        if (isCompleteDocument) {
          console.log('[Email Send] ✅ Complete HTML document detected - sending as-is WITHOUT wrapper');
          // Use the decoded version directly, no template wrapping
          renderedBody = decodedBefore;
        } else {
          // For fragments, apply the template wrapper
            console.log('[Email Send] HTML fragment detected - wrapping in professional email template');
            // If the fragment accidentally contains a full document, extract only the inner body
            let contentToWrap = renderedBody;
            if (/<!DOCTYPE/i.test(renderedBody) || /<html/i.test(renderedBody)) {
              contentToWrap = extractBodyContent(renderedBody);
              console.log('[Email Send] 🔧 Extracted inner <body> for wrapping to avoid nested documents');
            }
            const templateWrappedHtml = generateProfessionalEmailTemplate(contentToWrap);
            // Decode after wrapping as well in case the user HTML contained escaped segments
            let decodedWrapped = decodeHtmlEntities(templateWrappedHtml);
            if (decodedWrapped !== templateWrappedHtml) {
              console.log('[Email Send] 🔧 decoded escaped entities introduced during wrapping');
            }
            renderedBody = decodedWrapped;
        }
        
        // 🔍 DIAGNOSTIC: After template processing
        const decodedAfter = decodeHtmlEntities(renderedBody || '');
        console.log(`[Email Send] 🔍 HTML FINAL for ${recipientEmail}:`, {
          length: decodedAfter.length,
          hasDoctype: decodedAfter.includes('<!DOCTYPE') ? 'YES' : 'NO',
          hasNestedTables: (decodedAfter.match(/<table/g) || []).length,
          hasStyleAttr: decodedAfter.includes('style=') ? 'YES' : 'NO',
          hasEscapedHtml: (decodedAfter.includes('&lt;') || decodedAfter.includes('&gt;')) ? 'YES - CORRUPTED' : 'NO',
          lineCount: decodedAfter.split('\n').length || 0,
          preview_first200: decodedAfter.substring(0, 200) || 'EMPTY',
          preview_last200: decodedAfter.substring(Math.max(0, decodedAfter.length - 200)) || 'EMPTY',
        });

        // Auto-generate plain text if not provided (disabled)
        // if (!renderedPlainText) {
        //   renderedPlainText = htmlToPlainText(renderedBody);
        // }

        // 🔧 DIAGNOSTIC: Before plain text cleanup in routes
        const beforeCleanupRoute = renderedPlainText;
        const beforeLinesRoute = beforeCleanupRoute.split('\n');
        const blankLineCountRoute = beforeLinesRoute.filter(line => line.trim().length === 0).length;
        console.log(`[Email Send] 🔧 PLAIN TEXT BEFORE CLEANUP:`, {
          totalLength: beforeCleanupRoute.length,
          totalLines: beforeLinesRoute.length,
          blankLines: blankLineCountRoute,
          consec_newlines: (beforeCleanupRoute.match(/\n\n+/g) || []).length,
          preview: beforeCleanupRoute.substring(0, 80),
        });
        
        // ✅ CRITICAL: Preserve original formatting while cleaning excess whitespace
        // Only collapse 3+ consecutive newlines to 2, preserve 1-2 blank lines for readability
        renderedPlainText = renderedPlainText
          .replace(/\n\n\n+/g, '\n\n')  // Collapse 3+ newlines to 2 (preserve structure)
          .replace(/[ \t]+$/gm, '')  // Remove trailing spaces from each line
          .trim();  // Remove leading/trailing whitespace
        
        // 🔧 DIAGNOSTIC: After cleanup
        const afterCleanupRoute = renderedPlainText;
        const afterLinesRoute = afterCleanupRoute.split('\n');
        console.log(`[Email Send] 🔧 PLAIN TEXT AFTER CLEANUP:`, {
          totalLength: afterCleanupRoute.length,
          totalLines: afterLinesRoute.length,
          blankLines: (afterLinesRoute.filter(line => line.trim().length === 0).length),
          reduction_chars: (beforeCleanupRoute.length - afterCleanupRoute.length),
          preview: afterCleanupRoute.substring(0, 80),
        });
        
        // Send email
        const recipientList = isTo ? [recipientEmail] : [];
        const bccList = isTo ? [] : [recipientEmail];
        
        console.log(`[Email Send] ⚠️  CRITICAL CHECK before sendEmailWithProvider - Recipient: ${recipientEmail}`, {
          bodyPlainTextOriginal: bodyPlainText?.substring(0, 100) || 'ORIGINAL NOT PROVIDED',
          renderedPlainTextPreview: renderedPlainText?.substring(0, 100) || 'NOT SET/EMPTY',
          renderedPlainTextLength: renderedPlainText?.length || 0,
          bodyHTMLLength: renderedBody?.length || 0,
          htmlDocHasProperStructure: renderedBody?.includes('<!DOCTYPE') && renderedBody?.includes('</html>') ? 'YES' : 'NO',
          ctaTextValue: renderedCtaText || 'NOT SET',
          ctaLinkValue: renderedCtaLink || 'NOT SET',
        });
        
        // helper: ensure attachment name has safe/expected extension and no illegal characters
        const normalizeFilename = (name, contentType) => {
          if (!name) return name;
          // strip path characters and collapse spaces
          let clean = name.replace(/[\/]/g, '_').replace(/\s+/g, '_');
          // remove characters that may cause provider errors
          clean = clean.replace(/@/g, '_');
          // strip trailing .com/.net tokens that might have remained
          clean = clean.replace(/\.com$/i, '').replace(/\.net$/i, '');
          const mapping = {
            'application/pdf': 'pdf',
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/gif': 'gif',
            'application/msword': 'doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
          };
          const ext = mapping[contentType];
          if (ext) {
            if (!clean.toLowerCase().endsWith('.' + ext)) {
              clean = clean + '.' + ext;
            }
          }
          // trim trailing dot
          clean = clean.replace(/\.$/, '');
          return clean;
        };

        // replace placeholders in attachment filenames for this recipient
        let attachmentsForRecipient = [];
        if (attachments && Array.isArray(attachments)) {
          attachmentsForRecipient = attachments.map(att => {
            let newName = replaceBracedPlaceholders(att.filename || '', placeholderMap);
            newName = normalizeFilename(newName, att.contentType);
            return { ...att, filename: newName };
          });
        }

        const result = await sendEmailWithProvider({
          providerDoc,
          to: recipientList,
          bcc: bccList,
          subject: renderedSubject,
          body: renderedBody,
          bodyPlainText: renderedPlainText,
          ctaText: renderedCtaText,
          ctaLink: renderedCtaLink,
          replyTo: renderedReplyTo,
          fromName: renderedFromName,
          fromEmail: renderedFromEmail,
          attachments: attachmentsForRecipient,
        });
        if (result.success) {
          successCount++;
        } else {
          failureCount++;
          console.error('[Email Send] Provider reported failure for', recipientEmail, 'error:', result.error);
        }
        
        results.push({
          email: recipientEmail,
          success: result.success,
          error: result.error || null,
        });
        
        // Log email
        try {
          await EmailLog.create({
            userId,
            to: recipientList,
            bcc: bccList,
            subject: renderedSubject,
            body: renderedBody,
            bodyPlainText: renderedPlainText,
            ctaText: renderedCtaText,
            ctaLink: renderedCtaLink,
            attachments: attachments.map(a => a.path),
            replyTo,
            fromName,
            provider: providerDoc.provider,
            status: result.success ? 'Success' : 'Failed',
            error: result.error || null,
            sentAt: new Date(),
          });
        } catch (logError) {
          console.error('Failed to log email:', logError);
        }
      } catch (error) {
        failureCount++;
        results.push({
          email: recipientData.email,
          success: false,
          error: error.message,
        });
        console.error(`Error sending to ${recipientData.email}:`, error.message);
      }
    }
    
    console.log(`[Email Send] Complete: ${successCount} successful, ${failureCount} failed`);
    
    // Build response object with error message for partial failures
    const responseObj = {
      success: failureCount === 0,
      summary: {
        total: allRecipients.length,
        successful: successCount,
        failed: failureCount,
      },
      results,
    };
    if (!responseObj.success) {
      responseObj.error = `Failed to send to ${failureCount} recipient${failureCount === 1 ? '' : 's'}`;
    }
    console.log('[Email Send] Responding with result object:', responseObj);
    res.json(responseObj);

    // === CLEANUP: remove uploaded attachment files now that email(s) have been sent ===
    attachments.forEach(att => {
      fs.unlink(att.path, (err) => {
        if (err) console.warn('[Email Send] Failed to delete attachment file', att.path, err.message);
      });
    });
  } catch (error) {
    console.error('[Email Send] Unhandled error:', {
      message: error.message,
      stack: error.stack,
      statusCode: error.statusCode || 500
    });
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

// =====================
// BULK SEND WITH PLACEHOLDERS (Merge Tags)
// =====================
// Endpoint: POST /api/email/send-bulk
// Sends personalized emails with placeholder replacement
// 
// Request body:
// {
//   "subject": "Hello [FirstName]",
//   "body": "<p>Hi [FirstName], your email is [Email]</p>",
//   "recipients": [
//     { "email": "john@example.com", "firstName": "John", "lastName": "Doe" },
//     { "email": "jane@example.com", "firstName": "Jane", "lastName": "Smith" }
//   ],
//   "format": "html",
//   "timezone": "UTC"
// }
router.post('/send-bulk', authenticateToken, requireUser, upload.array('attachments'), async (req, res) => {
  try {
    const userId = req.user._id;
    const { subject, body, bodyPlainText, recipients, replyTo, fromName, fromEmail, timezone = 'UTC' } = req.body;
    const files = req.files || [];

    // Validate required fields
    if (!subject || !body) {
      return res.status(400).json({ success: false, error: 'Subject and HTML body are required' });
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one recipient is required' });
    }

    // Validate recipient data
    const validRecipients = recipients.filter(r => r && r.email);
    if (validRecipients.length === 0) {
      return res.status(400).json({ success: false, error: 'Recipients must have email addresses' });
    }

    console.log(`[Bulk Send] Processing ${validRecipients.length} recipients with placeholders`);

    // Get email provider
    const providerDoc = await EmailProvider.findOne({ userId });
    if (!providerDoc) {
      return res.status(400).json({ success: false, error: 'No email provider configured.' });
    }

    // Validate provider configuration
    if (providerDoc.provider === 'smtp') {
      const requireAuth = !(providerDoc.smtp?.requireAuth === false || providerDoc.smtp?.requireAuth === 'false' || providerDoc.smtp?.requireAuth === '0' || providerDoc.smtp?.requireAuth === 0);
      if (!providerDoc.smtp?.host || (requireAuth && !providerDoc.smtp?.username)) {
        return res.status(400).json({ success: false, error: 'SMTP provider not fully configured' });
      }
    }
    if (providerDoc.provider === 'aws' && (!providerDoc.aws?.username || !providerDoc.aws?.password)) {
      return res.status(400).json({ success: false, error: 'AWS provider not fully configured' });
    }
    if (providerDoc.provider === 'resend' && !providerDoc.resend?.apiKey) {
      return res.status(400).json({ success: false, error: 'Resend API key not configured' });
    }

    // Prepare attachments (BULK SEND)
    // Safety check: ensure files is an array
    console.log('[Bulk Send] 📎 ATTACHMENT PROCESSING - Incoming files:', {
      filesType: typeof files,
      filesIsArray: Array.isArray(files),
      filesLength: files?.length || 0,
    });
    
    let filesArray = [];
    try {
      filesArray = Array.isArray(files) ? files : (files ? [files] : []);
      console.log('[Bulk Send] 📎 Files converted to array successfully:', filesArray.length, 'file(s)');
    } catch (fileError) {
      console.error('[Bulk Send] 📎 ERROR converting files to array:', fileError.message);
      filesArray = [];
    }
    
    let attachments = [];
    try {
      attachments = filesArray.map(file => ({
        filename: file.originalname,
        path: file.path,
        contentType: file.mimetype,
      }));
      console.log('[Bulk Send] 📎 Attachments mapped successfully:', attachments.length);
    } catch (mapError) {
      console.error('[Bulk Send] 📎 ERROR mapping attachment files:', mapError.message);
      attachments = [];
    }

    // Process each recipient
    let successCount = 0;
    let failureCount = 0;
    const results = [];

    for (const recipient of validRecipients) {
      try {
        // Render subject and body with placeholders
        const renderedSubject = placeholderService.render(subject, recipient, {
          timezone,
          sanitize: true,
          logWarnings: false,
        });

        let renderedBody = placeholderService.render(body, recipient, {
          timezone,
          sanitize: true,
          logWarnings: false,
        });

        // 🔍 DIAGNOSTIC: Before template wrapping in bulk send
        console.log(`[Bulk Email Send] 🔍 HTML BEFORE WRAP for ${recipient.email}:`, {
          length: renderedBody?.length || 0,
          hasDoctype: renderedBody?.includes('<!DOCTYPE') ? 'YES' : 'NO',
          hasEscapedHtml: (renderedBody?.includes('&lt;') || renderedBody?.includes('&gt;')) ? 'YES - CORRUPTED' : 'NO',
          preview: renderedBody?.substring(0, 150) || 'EMPTY',
        });
        
        // ✅ CRITICAL FIX: If the HTML is already a complete document (has DOCTYPE, html, body tags),
        // send it as-is WITHOUT ANY wrapping. Complete documents should never be wrapped.
        const isCompleteDocBulk = renderedBody?.includes('<!DOCTYPE') && 
                                  renderedBody?.includes('<html') && 
                                  renderedBody?.includes('<body');
        
        if (isCompleteDocBulk) {
          console.log('[Bulk Email Send] ✅ Complete HTML document detected - sending as-is WITHOUT wrapper');
          // Use as-is, no template wrapping
        } else {
          console.log('[Bulk Email Send] HTML fragment detected - wrapping in professional email template');
          // If the fragment accidentally contains a full document, extract only the inner body
          let contentToWrapBulk = renderedBody;
          if (/<!DOCTYPE/i.test(renderedBody) || /<html/i.test(renderedBody)) {
            contentToWrapBulk = extractBodyContent(renderedBody);
            console.log('[Bulk Email Send] 🔧 Extracted inner <body> for wrapping to avoid nested documents');
          }
          const templateWrappedHtml = generateProfessionalEmailTemplate(contentToWrapBulk);
          renderedBody = templateWrappedHtml;
        }
        
        // 🔍 DIAGNOSTIC: After template wrapping (or skipped) in bulk send
        console.log(`[Bulk Email Send] 🔍 HTML FINAL for ${recipient.email}:`, {
          length: renderedBody?.length || 0,
          hasDoctype: renderedBody?.includes('<!DOCTYPE') ? 'YES' : 'NO',
          hasEscapedHtml: (renderedBody?.includes('&lt;') || renderedBody?.includes('&gt;')) ? 'YES - CORRUPTED' : 'NO',
          preview: renderedBody?.substring(0, 150) || 'EMPTY',
        });

        let renderedPlainText = null;
        if (bodyPlainText) {
          renderedPlainText = placeholderService.render(bodyPlainText, recipient, {
            timezone,
            sanitize: true,
            logWarnings: false,
          });
        }

        // ⚠️ IMPORTANT: Sanitization was removed for email HTML to prevent
        // accidental escaping or alteration of the raw content.  The system
        // now sends HTML exactly as provided after previous processing steps.
        // If this function is called elsewhere the serializer will simply return
        // the original string without modification (see htmlSanitizer.js).
        // renderedBody = sanitizeHtmlForEmail(renderedBody);

        // Auto-generate plain text if not provided (disabled in bulk send)
        // if (!renderedPlainText) {
        //   renderedPlainText = htmlToPlainText(renderedBody);
        // }

        // 🔧 DIAGNOSTIC: Before cleanup in bulk send
        const beforeCleanupBulk = renderedPlainText;
        const beforeLinesBulk = beforeCleanupBulk.split('\n');
        const blankLineCountBulk = beforeLinesBulk.filter(line => line.trim().length === 0).length;
        console.log(`[Email Send Bulk] 🔧 PLAIN TEXT BEFORE CLEANUP:`, {
          totalLength: beforeCleanupBulk.length,
          totalLines: beforeLinesBulk.length,
          blankLines: blankLineCountBulk,
          preview: beforeCleanupBulk.substring(0, 80),
        });

        // ✅ CRITICAL: Preserve original formatting while cleaning excess whitespace
        // Only collapse 3+ consecutive newlines to 2, preserve 1-2 blank lines for readability
        renderedPlainText = renderedPlainText
          .replace(/\n\n\n+/g, '\n\n')  // Collapse 3+ newlines to 2 (preserve structure)
          .replace(/[ \t]+$/gm, '')  // Remove trailing spaces from each line
          .trim();  // Remove leading/trailing whitespace

        // 🔧 DIAGNOSTIC: After cleanup
        const afterCleanupBulk = renderedPlainText;
        const afterLinesBulk = afterCleanupBulk.split('\n');
        console.log(`[Email Send Bulk] 🔧 PLAIN TEXT AFTER CLEANUP:`, {
          totalLength: afterCleanupBulk.length,
          totalLines: afterLinesBulk.length,
          blankLines: (afterLinesBulk.filter(line => line.trim().length === 0).length),
          reduction_chars: (beforeCleanupBulk.length - afterCleanupBulk.length),
          preview: afterCleanupBulk.substring(0, 80),
        });

        // ✅ CRITICAL FIX: Render FROM fields and REPLY-TO with placeholders
        const renderedFromName = fromName ? placeholderService.render(fromName, recipient, {
          timezone,
          sanitize: true,
          logWarnings: false,
        }) : null;

        const renderedFromEmail = fromEmail ? placeholderService.render(fromEmail, recipient, {
          timezone,
          sanitize: true,
          logWarnings: false,
        }) : null;

        const renderedReplyTo = replyTo ? placeholderService.render(replyTo, recipient, {
          timezone,
          sanitize: true,
          logWarnings: false,
        }) : null;

        // per-recipient attachments: render placeholders and sanitize names
        let attachmentsForRecipient = [];
        if (attachments && Array.isArray(attachments)) {
          attachmentsForRecipient = attachments.map(att => {
            let filename = placeholderService.render(att.filename || '', recipient, {
              timezone,
              sanitize: true,
              logWarnings: false,
            });
            filename = normalizeFilename(filename, att.contentType);
            return { ...att, filename };
          });
        }

        // Send individual email
        const result = await sendEmailWithProvider({
          providerDoc,
          to: [recipient.email],
          bcc: [],
          subject: renderedSubject,
          body: renderedBody,
          bodyPlainText: renderedPlainText,
          replyTo: renderedReplyTo,
          fromName: renderedFromName,
          fromEmail: renderedFromEmail,
          attachments: attachmentsForRecipient,
        });

        if (result.success) {
          successCount++;
        } else {
          failureCount++;
        }

        results.push({
          email: recipient.email,
          success: result.success,
          error: result.error || null,
        });

        // Log each email
        try {
          await EmailLog.create({
            userId,
            to: [recipient.email],
            bcc: [],
            subject: renderedSubject,
            body: renderedBody,
            bodyPlainText: renderedPlainText,
            attachments: attachments.map(a => a.path),
            replyTo,
            fromName,
            provider: providerDoc.provider,
            status: result.success ? 'Success' : 'Failed',
            error: result.error || null,
            sentAt: new Date(),
          });
        } catch (logError) {
          console.error('Failed to log email:', logError);
        }
      } catch (error) {
        failureCount++;
        results.push({
          email: recipient.email,
          success: false,
          error: error.message,
        });
        console.error(`Error sending to ${recipient.email}:`, error.message);
      }
    }

    console.log(`[Bulk Send] Complete: ${successCount} successful, ${failureCount} failed`);

    // Build response object for bulk send
    const bulkResponse = {
      success: failureCount === 0,
      summary: {
        total: validRecipients.length,
        successful: successCount,
        failed: failureCount,
      },
      results,
    };
    if (!bulkResponse.success) {
      bulkResponse.error = `Failed to send to ${failureCount} recipient${failureCount === 1 ? '' : 's'}`;
    }
    console.log('[Bulk Send] Responding with result object:', bulkResponse);
    res.json(bulkResponse);
  } catch (error) {
    console.error('Bulk send error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================
// PLACEHOLDER INFO ENDPOINTS
// =====================

// Get all available placeholders
router.get('/placeholders', authenticateToken, requireUser, (req, res) => {
  try {
    const placeholders = placeholderService.getPlaceholdersByCategory();
    res.json({ success: true, placeholders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Validate template for placeholders
router.post('/validate-template', authenticateToken, requireUser, (req, res) => {
  try {
    const { subject, body } = req.body;

    const subjectValidation = placeholderService.validateTemplate(subject);
    const bodyValidation = placeholderService.validateTemplate(body);

    res.json({
      success: true,
      subject: subjectValidation,
      body: bodyValidation,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Preview placeholders for a sample recipient
router.post('/preview-template', authenticateToken, requireUser, (req, res) => {
  try {
    const { subject, body, sampleRecipient, timezone = 'UTC', format = 'html' } = req.body;

    // Use provided sample or create a default one
    const recipient = sampleRecipient || {
      name: 'John Doe',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      company: 'Example Corp',
      phone: '+1-555-0123',
      cellPhone: '+1-555-0123',
      address: '123 Main Street',
      city: 'New York',
      state: 'NY',
      zipCode: '10001',
      country: 'USA',
    };

    const renderedSubject = placeholderService.render(subject, recipient, {
      timezone,
      sanitize: false,
      logWarnings: false,
    });

    let renderedBody = placeholderService.render(body, recipient, {
      timezone,
      sanitize: false,
      logWarnings: false,
    });

    res.json({
      success: true,
      preview: {
        subject: renderedSubject,
        body: renderedBody,
        sampleRecipient: recipient,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get email logs
router.get('/logs', authenticateToken, requireUser, async (req, res) => {
  try {
    const logs = await EmailLog.find({ userId: req.user._id }).sort({ sentAt: -1 }).limit(100);
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// =====================
// PLACEHOLDER TESTING ENDPOINT
// =====================
// Test endpoint to preview all professional placeholders
router.post('/test-placeholders', authenticateToken, requireUser, (req, res) => {
  try {
    const testRecipientEmail = 'john.doe@example.com';
    const testSubject = 'Subject: {RECIPIENT_NAME} from {FAKE_COMPANY}';
    const testBody = `
      <p>Hello {RECIPIENT_NAME},</p>
      <p>This is a test email sent on {CURRENT_DATE} at {CURRENT_TIME}.</p>
      <p>Your email: {RECIPIENT_EMAIL}</p>
      <p>Domain: {RECIPIENT_DOMAIN} ({RECIPIENT_DOMAIN_NAME})</p>
      <p>Base64 Email: {RECIPIENT_BASE64_EMAIL}</p>
      <p>Random Number: {RANDOM_NUMBER10}</p>
      <p>Random String: {RANDOM_STRING}</p>
      <p>Random MD5: {RANDOM_MD5}</p>
      <p>Random Path: {RANDOM_PATH}</p>
      <p>Random Link: {RANDLINK}</p>
      <p>Company: {FAKE_COMPANY}</p>
      <p>Company Email: {FAKE_COMPANY_EMAIL}</p>
      <p>Company Full: {FAKE_COMPANY_EMAIL_AND_FULLNAME}</p>
    `;

    // Generate placeholder values
    const emailLocalPart = testRecipientEmail.split('@')[0];
    const recipientName = capitalize(emailLocalPart.split('.')[0] || emailLocalPart);
    const recipientDomain = testRecipientEmail.split('@')[1];
    const recipientDomainName = capitalize(recipientDomain.split('.')[0]);
    const currentDate = new Date().toLocaleDateString();
    const currentTime = new Date().toLocaleTimeString();

    const placeholderMap = {
      'RECIPIENT_NAME': recipientName,
      'RECIPIENT_EMAIL': testRecipientEmail,
      'RECIPIENT_DOMAIN': recipientDomain,
      'RECIPIENT_DOMAIN_NAME': recipientDomainName,
      'RECIPIENT_BASE64_EMAIL': encodeBase64(testRecipientEmail),
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
    };

    // Render placeholders
    const renderedSubject = replaceBracedPlaceholders(testSubject, placeholderMap);
    const renderedBody = replaceBracedPlaceholders(testBody, placeholderMap);

    res.json({
      success: true,
      test: {
        originalSubject: testSubject,
        renderedSubject,
        originalBody: testBody,
        renderedBody,
        placeholderValues: placeholderMap,
      },
    });
  } catch (error) {
    console.error('Placeholder test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear all email logs for the user
router.delete('/logs', authenticateToken, requireUser, async (req, res) => {
  try {
    await EmailLog.deleteMany({ userId: req.user._id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;


















// import express from 'express';
// import multer from 'multer';
// import nodemailer from 'nodemailer';

// /*
//  * CRITICAL EMAIL HTML RENDERING GUIDELINES
//  * --------------------------------------------------
//  * - HTML MUST be sent raw, unescaped, and un-sanitized.
//  *   Avoid any calls to escape(), sanitize(), res.send(html) or
//  *   template engine escaping (e.g. handlebars {{html}}).
//  * - When using a templating system that auto-escapes, use
//  *   triple braces ({{{html}}}) or equivalent to prevent escaping.
//  * - NEVER concatenate HTML strings inline.  Use fixed template
//  *   functions or build complete documents with template literals.
//  * - Ensure <a> tags are not broken (no missing quotes, no
//  *   line breaks inside attributes, no escaped characters).
//  *   A broken <a> tag will cause CSS styles to render as text.
//  * - Always send email as multipart/alternative with separate
//  *   text and html parts; do not embed HTML inside the text field.
//  * - Log final HTML before sending to detect any corruption early.
//  *
//  * Failure to follow these rules will result in rendering bugs where
//  * CSS appears as visible text and buttons are malformed in inboxes.
//  */

// import { authenticateToken, requireUser } from '../middleware/auth.js';
// import EmailProvider from '../models/EmailProvider.js';
// import EmailLog from '../models/EmailLog.js';
// import { sendEmailWithProvider, decodeHtmlEntities } from '../utils/emailSenders.js';
// // HTML-to-plain-text conversion is no longer performed by the backend.
// // import { htmlToPlainText } from '../utils/htmlSanitizer.js';
// import { generateProfessionalEmailTemplate, validateEmailHtml, extractBodyContent } from '../utils/emailTemplates.js';
// // The following imports were required when we were performing CSS inlining
// // and HTML sanitization.  The requirements have changed: we now pass the
// // sender-provided HTML through untouched, exactly the same way the standalone
// // sender script does.  All processing/inlining logic has been removed, so
// // these modules are no longer used.
// // validation helper was previously imported but is no longer required
// // since we no longer mutate or inspect HTML.  The sender is expected
// // to provide valid email-ready HTML.

// // NOTE: cssInliner and emailCssProcessor imports were intentionally dropped.
// import placeholderService from '../services/placeholderService.js';
// import path from 'path';
// import fs from 'fs';
// import cloudinary from 'cloudinary';
// import crypto from 'crypto';

// const router = express.Router();

// // Configure Cloudinary from env
// cloudinary.v2.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET,
// });

// // =====================
// // PROFESSIONAL PLACEHOLDER SYSTEM (like high-volume senders)
// // =====================
// // Supports placeholders like {RECIPIENT_NAME}, {RECIPIENT_EMAIL}, etc.
// // All placeholders are replaced using simple regex substitution

// function capitalize(str) {
//   if (str && typeof str === 'string') {
//     return str.charAt(0).toUpperCase() + str.slice(1);
//   }
//   return str;
// }

// // =====================
// // PLACEHOLDER VALUE GENERATORS
// // =====================

// // Generate random 10-digit number
// function generateRandom10DigitNumber() {
//   return Math.floor(1000000000 + Math.random() * 9000000000).toString();
// }

// // Normalize filenames to avoid invalid extensions (Resend rejects ".com" etc)
// function normalizeFilename(name, contentType) {
//   if (!name) return name;
//   let clean = name.replace(/[\/]/g, '_').replace(/\s+/g, '_');
//   // remove characters that may cause provider errors
//   clean = clean.replace(/@/g, '_');
//   // strip problematic trailing tokens from raw curly placeholders
//   clean = clean.replace(/\.com$/i, '').replace(/\.net$/i, '');
//   const mapping = {
//     'application/pdf': 'pdf',
//     'image/jpeg': 'jpg',
//     'image/png': 'png',
//     'image/gif': 'gif',
//     'application/msword': 'doc',
//     'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
//   };
//   const ext = mapping[contentType];
//   if (ext) {
//     // if the cleaned name doesn’t already end in the correct extension, append it
//     if (!clean.toLowerCase().endsWith('.' + ext)) {
//       clean = clean + '.' + ext;
//     }
//   }
//   // trim any trailing period left behind
//   clean = clean.replace(/\.$/, '');
//   return clean;
// }

// // Generate random string (7-10 chars, alphanumeric)
// function generateRandomString() {
//   const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
//   const len = 7 + Math.floor(Math.random() * 4);
//   let result = '';
//   for (let i = 0; i < len; i++) {
//     result += chars.charAt(Math.floor(Math.random() * chars.length));
//   }
//   return result;
// }

// // Generate random MD5 hash
// function generateRandomMD5() {
//   return crypto.createHash('md5').update(Math.random().toString()).digest('hex');
// }

// // Generate random path
// function generateRandomPath() {
//   const segments = ['user', 'data', 'files', 'documents', 'assets', 'media', 'uploads'];
//   const randomSegments = [];
//   const length = 2 + Math.floor(Math.random() * 3);
//   for (let i = 0; i < length; i++) {
//     randomSegments.push(segments[Math.floor(Math.random() * segments.length)] + Math.floor(Math.random() * 1000));
//   }
//   return '/' + randomSegments.join('/');
// }

// // Generate random tracking link
// function generateRandomLink() {
//   const baseUrl = 'https://example.com/track';
//   const trackId = Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 8);
//   return `${baseUrl}/${trackId}`;
// }

// // Generate fake company name
// function generateFakeCompanyName() {
//   const prefixes = ['Tech', 'Data', 'Digital', 'Smart', 'Cloud', 'Web', 'Cyber', 'Next', 'Prime', 'Ultra', 'Pro', 'Mega', 'Elite'];
//   const suffixes = ['Nova', 'Solutions', 'Systems', 'Labs', 'Hub', 'Works', 'Wave', 'Stream', 'Tech', 'Sync', 'Flow', 'Link', 'Direct'];
//   const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
//   const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
//   return `${prefix}${suffix}`;
// }

// // Generate fake company email
// function generateFakeCompanyEmail() {
//   const companyName = generateFakeCompanyName();
//   const domains = ['com', 'net', 'io', 'co', 'org', 'us'];
//   const domain = domains[Math.floor(Math.random() * domains.length)];
//   return `contact@${companyName.toLowerCase()}.${domain}`;
// }

// // Generate fake company full info
// function generateFakeCompanyEmailAndFullName() {
//   const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'James', 'Emily', 'David', 'Lisa', 'Robert', 'Jennifer'];
//   const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
//   const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
//   const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
//   const email = generateFakeCompanyEmail();
//   return `${firstName} ${lastName} <${email}>`;
// }

// // Encode email in Base64
// function encodeBase64(str) {
//   return Buffer.from(str).toString('base64');
// }

// function replaceBracedPlaceholders(content, placeholders) {
//   if (!content || typeof content !== 'string') return content;
//   let replacedContent = content;
//   for (const [placeholder, value] of Object.entries(placeholders)) {
//     const regex = new RegExp(`{${placeholder}}`, 'g');
//     replacedContent = replacedContent.replace(regex, String(value || ''));
//   }
//   return replacedContent;
// }

// // Multer setup for attachments
// const upload = multer({ dest: 'uploads/email_attachments/' });


// // Helper function to inject image into HTML body
// function injectImageIntoHtml(htmlContent, bodyImageData, placeholders = {}) {
//   if (!bodyImageData) return htmlContent;

//   try {
//     const imageObj = typeof bodyImageData === 'string' ? JSON.parse(bodyImageData) : bodyImageData;
//     let src = imageObj.url || imageObj.base64 || imageObj.src;
//     let link = imageObj.link;

//     if (!src) return htmlContent;

//     // Replace any braced placeholders in src and link using the provided placeholders map
//     try {
//       if (typeof src === 'string' && Object.keys(placeholders || {}).length > 0) {
//         src = replaceBracedPlaceholders(src, placeholders);
//       }
//     } catch (e) {
//       console.warn('[Email Send] Failed to replace placeholders in image src:', e.message);
//     }

//     try {
//       if (typeof link === 'string' && Object.keys(placeholders || {}).length > 0) {
//         link = replaceBracedPlaceholders(link, placeholders);
//       }
//     } catch (e) {
//       console.warn('[Email Send] Failed to replace placeholders in image link:', e.message);
//     }

//     // Create image HTML with optional link wrapping
//     let imageHtml = `<img src="${src}" alt="Email image" style="max-width: 100%; height: auto; display: block; margin: 1em auto;" />`;

//     if (link) {
//       imageHtml = `<a href="${link}" style="text-decoration: none;"><div>${imageHtml}</div></a>`;
//     }

//     // Inject image: if htmlContent is empty, just return the image; otherwise append with spacing
//     if (!htmlContent || htmlContent.trim().length === 0) {
//       return imageHtml;
//     }
//     return `${htmlContent}\n<br />\n${imageHtml}`;
//   } catch (e) {
//     console.warn('[Email Send] Failed to parse bodyImage:', e.message);
//     return htmlContent;
//   }
// }

// // **HTML HELPER FUNCTIONS REMOVED**
// // The previous implementation contained several helper routines that
// // manipulated or validated HTML (`extractQuillContent`,
// // `validateAndCleanHtmlForEmail`, `ensureHtmlStructure`, `applyBodyStyling`).
// // These were used to try to make the HTML safe for email clients, wrap
// // partial fragments, strip Quill wrappers, etc.  Per the latest requirement
// // the backend no longer touches or inspects HTML; whatever string is sent by
// // the client is forwarded directly to the email provider.  To avoid accidental
// // invocation we have removed all of that code from this file.

// // If you need a reference to the old logic it is available in the git
// // history or documentation files; do not reintroduce any HTML processing
// // unless there is a compelling new requirement.

// // ensureHtmlStructure logic removed – HTML handling is now completely delegated
// // to the sender.  Content is forwarded exactly as provided without any
// // wrapping, validation, or templating.  The old implementation lived here but
// // has been deleted to avoid confusion.

// // applyBodyStyling removed: HTML is passed through without any additional spacing or alignment wrappers.
// // Save or update email provider settings
// // When users supply SMTP configuration we also run a quick connection
// // verification to catch typos/blocked ports before they attempt to send.
// router.post('/settings', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const { provider, smtp, aws, resend, fromEmail } = req.body;
//     const userId = req.user._id;

//     console.log('[emailSettings] POST /settings called, provider=', provider);
//     if (provider === 'smtp' && smtp) {
//       console.log('[emailSettings] SMTP settings provided:', {
//         host: smtp.host,
//         port: smtp.port,
//         encryption: smtp.encryption,
//         requireAuth: smtp.requireAuth,
//       });
//     }

//     // Save settings without blocking on SMTP verification.
//     // Users can test connections separately using POST /settings/test endpoint.
//     let doc = await EmailProvider.findOne({ userId });
//     if (!doc) doc = new EmailProvider({ userId });
//     doc.provider = provider;
//     // Persist smtp object but ensure requireAuth remains a boolean
//     doc.smtp = smtp && typeof smtp === 'object' ? { ...smtp } : {};
//     if (smtp && Object.prototype.hasOwnProperty.call(smtp, 'requireAuth')) {
//       // Accept boolean, numeric, or string representations from the client
//       const v = smtp.requireAuth;
//       doc.smtp.requireAuth = (v === true || v === 'true' || v === '1' || v === 1) ? true : false;
//     }
//     doc.aws = aws || {};
//     doc.resend = resend || {};
//     doc.fromEmail = fromEmail || '';
//     doc.updatedAt = new Date();
//     console.log('[emailSettings] Saving EmailProvider for user:', userId);
//     await doc.save();
//     console.log('[emailSettings] EmailProvider saved for user:', userId, 'provider:', doc.provider);
//     res.json({ success: true, message: 'Settings saved successfully. Use the test connection button to verify SMTP credentials.' });
//   } catch (error) {
//     console.error('[emailSettings] POST /settings error:', error);
//     res.status(500).json({ success: false, message: error.message });
//   }
// });

// // Get current email provider settings
// router.get('/settings', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const doc = await EmailProvider.findOne({ userId: req.user._id });
//     if (!doc) {
//       res.json({ settings: null });
//       return;
//     }
//     // Transform nested structure to flat structure for frontend
//     const settings = {
//       provider: doc.provider || 'smtp',
//       smtpHost: doc.smtp?.host || '',
//       smtpPort: doc.smtp?.port || '',
//       smtpUser: doc.smtp?.username || '',
//       smtpPass: doc.smtp?.password || '',
//       smtpEncryption: doc.smtp?.encryption || 'ssl',
//       smtpRequireAuth: typeof doc.smtp?.requireAuth === 'boolean' ? doc.smtp.requireAuth : true,
//       awsAccessKeyId: doc.aws?.username || '',
//       awsSecretAccessKey: doc.aws?.password || '',
//       awsRegion: doc.aws?.region || '',
//       resendApiKey: doc.resend?.apiKey || '',
//       fromEmail: doc.fromEmail || '',
//     };
//     res.json({ settings });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// });

// // POST /settings/test will perform connection verification without
// // persisting any data.  Useful for checking SMTP credentials and network
// // reachability before attempting to send email.
// router.post('/settings/test', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const { provider, smtp } = req.body;

//     console.log('[emailSettings] POST /settings/test called, provider=', provider);
//     if (provider === 'smtp') {
//       if (!smtp || !smtp.host) {
//         return res.json({ success: false, message: 'SMTP host is required' });
//       }
//       console.log('[emailSettings] Testing SMTP connection to', smtp.host, 'port', smtp.port, 'encryption', smtp.encryption);

//       try {
//         const transportConfig = {
//           host: smtp.host,
//           port: Number(smtp.port || 587),
//           logger: false,
//           connectionTimeout: 10000,
//           greetingTimeout: 10000,
//           socketTimeout: 10000,
//         };
//         const encryption = smtp.encryption || 'ssl';
//         if (encryption === 'ssl') {
//           transportConfig.secure = true;
//         } else if (encryption === 'tls') {
//           transportConfig.secure = false;
//           transportConfig.requireTLS = true;
//           transportConfig.tls = { rejectUnauthorized: false };
//         } else if (encryption === 'none') {
//           transportConfig.secure = false;
//         }
//         // Determine whether SMTP requires authentication. Accept boolean/string/number
//         const requireAuth = !(smtp.requireAuth === false || smtp.requireAuth === 'false' || smtp.requireAuth === '0' || smtp.requireAuth === 0);
//         if (requireAuth) {
//           transportConfig.auth = {
//             user: smtp.username,
//             pass: smtp.password,
//           };
//         }
//         const transporter = nodemailer.createTransport(transportConfig);
//         console.log('[emailSettings] SMTP test transportConfig:', transportConfig);
//         await transporter.verify();
//         console.log('[emailSettings] SMTP test successful');
//         return res.json({ success: true, message: 'SMTP connection successful' });
//       } catch (verifyErr) {
//         console.warn('[emailSettings] SMTP test failed:', verifyErr.message);
//         let msg = `Connection failed: ${verifyErr.message}`;
        
//         if (/timeout/i.test(verifyErr.message) || verifyErr.code === 'ETIMEDOUT' || verifyErr.code === 'ECONNREFUSED') {
//           msg = 'Connection timeout. Verify SMTP host and port are correct and network allows outbound connections.';
//         } else if (/auth/i.test(verifyErr.message) || verifyErr.code === 'EAUTH') {
//           msg = 'Authentication failed. Check your SMTP username and password.';
//         }
        
//         return res.json({ success: false, message: msg });
//       }
//     }

//     // non-SMTP providers don't require verification
//     return res.json({ success: true });
//   } catch (error) {
//     console.error('[emailSettings] SMTP test error:', error);
//     res.json({ success: false, message: error.message });
//   }
// });

// // =====================
// // SEND EMAIL - PROFESSIONAL PLACEHOLDER SYSTEM
// // =====================
// // Uses braced placeholders like {RECIPIENT_NAME}, {RECIPIENT_EMAIL}, etc.
// // Works exactly like professional mass email senders
// router.post('/send', authenticateToken, requireUser, upload.array('attachments'), async (req, res) => {
//   try {
//     const userId = req.user._id;
//     const { to, bcc, subject, body, bodyPlainText, replyTo, fromName, fromEmail, bodyImage, ctaText, ctaLink, htmlAlignment, htmlMarginTop, htmlMarginBottom } = req.body;
//     const timezone = req.body.timezone || 'UTC';
//     const files = req.files || [];
    
//     console.log('\n\n⚠️⚠️⚠️ [Email Send] CRITICAL EXTRACTION CHECK ⚠️⚠️⚠️');
//     console.log('bodyPlainText extracted:', bodyPlainText);
//     console.log('bodyPlainText type:', typeof bodyPlainText);
//     console.log('bodyPlainText length:', bodyPlainText?.length || 0);
//     console.log('Direct req.body.bodyPlainText:', req.body.bodyPlainText);
//     console.log('All request body keys:', Object.keys(req.body));
//     console.log('⚠️⚠️⚠️ END CRITICAL CHECK ⚠️⚠️⚠️\n');
    
//     // Validate required fields
//     console.log('[Email Send] Required fields check:', { hasSubject: !!subject });
//     if (!subject) {
//       console.error('[Email Send] Validation failed: Subject missing');
//       return res.status(400).json({ success: false, error: 'Subject is required' });
//     }
    
//     const hasBody = body && body.trim().length > 0 && body.trim() !== '<p><br></p>';
//     const hasPlainText = bodyPlainText && bodyPlainText.trim().length > 0;
//     const hasCtaLink = ctaLink && ctaLink.trim().length > 0;
//     let hasImage = false;
//     let bodyImageObj = null;
    
//     // Parse bodyImage if provided (may contain base64 or a direct URL/link)
//     if (bodyImage) {
//       try {
//         bodyImageObj = typeof bodyImage === 'string' ? JSON.parse(bodyImage) : bodyImage;
//         // treat either a base64 blob or a url as "image present" for
//         // validation purposes.  the front-end may send only a link when the
//         // user chooses an external image rather than uploading one.
//         hasImage = !!(bodyImageObj && (bodyImageObj.base64 || bodyImageObj.url));
//       } catch (e) {
//         console.warn('[Email Send] Failed to parse bodyImage:', e.message);
//       }
//     }
    
//     console.log('[Email Send] Content validation:', { hasBody, hasPlainText, hasImage, hasCtaLink });
    
//     if (!hasBody && !hasPlainText && !hasImage && !hasCtaLink) {
//       console.error('[Email Send] Validation failed: No content provided', { hasBody, hasPlainText, hasImage, hasCtaLink });
//       return res.status(400).json({ success: false, error: 'Please provide at least one of: email body, plain text, image, or CTA link' });
//     }
    
//     // Get email provider
//     const providerDoc = await EmailProvider.findOne({ userId });
//     if (!providerDoc) {
//       return res.status(400).json({ success: false, error: 'No email provider configured.' });
//     }
    
//     // Upload image to Cloudinary if provided
//     if (bodyImageObj && bodyImageObj.base64 && process.env.CLOUDINARY_CLOUD_NAME) {
//       try {
//         const uploadResult = await cloudinary.v2.uploader.upload(bodyImageObj.base64, {
//           folder: 'email_images',
//           resource_type: 'image',
//         });
//         if (uploadResult && uploadResult.secure_url) {
//           bodyImageObj.url = uploadResult.secure_url;
//           delete bodyImageObj.base64;
//           console.log('[Email Send] Image uploaded to Cloudinary:', bodyImageObj.url);
//         }
//       } catch (e) {
//         console.warn('[Email Send] Cloudinary upload failed:', e.message);
//       }
//     }
//     // log final bodyImageObj for diagnostics (may include url/link)
//     if (bodyImageObj) {
//       console.log('[Email Send] Final bodyImage object:', bodyImageObj);
//     }
    
//     // Parse recipients
//     const toArray = to ? (Array.isArray(to) ? to : to.split(/,|\n/).map(e => e.trim()).filter(Boolean)) : [];
//     const bccArray = bcc ? (Array.isArray(bcc) ? bcc : bcc.split(/,|\n/).map(e => e.trim()).filter(Boolean)) : [];
    
//     console.log('[Email Send] Recipients parsed:', { toCount: toArray.length, bccCount: bccArray.length, toArray, bccArray });
    
//     if (toArray.length === 0 && bccArray.length === 0) {
//       console.error('[Email Send] Validation failed: No recipients', { toArray, bccArray });
//       return res.status(400).json({ success: false, error: 'At least one recipient is required' });
//     }
    
//     // Prepare attachments (from multer `files`)
//     // Safety check: ensure files is an array
//     console.log('[Email Send] 📎 ATTACHMENT PROCESSING - Incoming files:', {
//       filesType: typeof files,
//       filesIsArray: Array.isArray(files),
//       filesLength: files?.length || 0,
//       filesValue: files,
//     });
    
//     let filesArray = [];
//     try {
//       filesArray = Array.isArray(files) ? files : (files ? [files] : []);
//       console.log('[Email Send] 📎 Files converted to array successfully:', filesArray.length, 'file(s)');
//     } catch (fileError) {
//       console.error('[Email Send] 📎 ERROR converting files to array:', {
//         message: fileError.message,
//         filesType: typeof files,
//       });
//       filesArray = [];
//     }
    
//     let attachments = [];
//     try {
//       attachments = filesArray.map(file => ({
//         filename: file.originalname,
//         path: file.path,
//         contentType: file.mimetype,
//       }));
//       console.log('[Email Send] 📎 Attachments mapped successfully:', attachments.map(a => ({ filename: a.filename, path: a.path, contentType: a.contentType })));
//     } catch (mapError) {
//       console.error('[Email Send] 📎 ERROR mapping attachment files:', {
//         message: mapError.message,
//         filesArrayLength: filesArray.length,
//         filesArraySample: filesArray.slice(0, 1),
//       });
//       attachments = [];
//     }
    
//     console.log('[Email Send] 📎 FINAL ATTACHMENT RESULT:', {
//       totalAttachments: attachments.length,
//       attachmentDetails: attachments.map(a => ({ filename: a.filename, path: a.path, contentType: a.contentType })),
//     });

//     // Process each recipient with professional placeholder system
//     let successCount = 0;
//     let failureCount = 0;
//     const results = [];
    
//     // Combine all recipients
//     const allRecipients = [
//       ...toArray.map(email => ({ email, isTo: true })),
//       ...bccArray.map(email => ({ email, isTo: false }))
//     ];
    
//     for (const recipientData of allRecipients) {
//       try {
//         const recipientEmail = recipientData.email;
//         const isTo = recipientData.isTo;
        
//         // Extract recipient info from email
//         const emailLocalPart = recipientEmail.split('@')[0];
//         const recipientName = capitalize(emailLocalPart.split('.')[0] || emailLocalPart);
//         const recipientDomain = recipientEmail.split('@')[1];
//         const recipientDomainName = capitalize(recipientDomain.split('.')[0]);
        
//         // Get current date/time
//         const currentDate = new Date().toLocaleDateString();
//         const currentTime = new Date().toLocaleTimeString();
        
//         // Build braced placeholder map (professional sender style)
//         // Includes ALL professional system placeholders
//         const placeholderMap = {
//           'RECIPIENT_NAME': recipientName,
//           'RECIPIENT_EMAIL': recipientEmail,
//           'RECIPIENT_DOMAIN': recipientDomain,
//           'RECIPIENT_DOMAIN_NAME': recipientDomainName,
//           'RECIPIENT_BASE64_EMAIL': encodeBase64(recipientEmail),
//           'CURRENT_DATE': currentDate,
//           'CURRENT_TIME': currentTime,
//           'RANDOM_NUMBER10': generateRandom10DigitNumber(),
//           'RANDOM_STRING': generateRandomString(),
//           'RANDOM_MD5': generateRandomMD5(),
//           'RANDOM_PATH': generateRandomPath(),
//           'RANDLINK': generateRandomLink(),
//           'FAKE_COMPANY': generateFakeCompanyName(),
//           'FAKE_COMPANY_EMAIL': generateFakeCompanyEmail(),
//           'FAKE_COMPANY_EMAIL_AND_FULLNAME': generateFakeCompanyEmailAndFullName(),
//         };
        
//         // Replace braced placeholders in subject and body
//         let renderedSubject = replaceBracedPlaceholders(subject, placeholderMap);
//         let renderedBody = replaceBracedPlaceholders(body || '', placeholderMap);
//         // 🔧 If any placeholders produced escaped HTML (e.g. &lt; &gt;), decode them now
//         if (typeof renderedBody === 'string') {
//           const beforeDecode = renderedBody;
//           renderedBody = decodeHtmlEntities(renderedBody);
//           if (beforeDecode !== renderedBody) {
//             console.log('[Email Send] 🔧 decoded placeholders in HTML body (escaped entities removed)');
//           }
//         }
//         // 📌 INJECT BODY IMAGE IF PRESENT (and after placeholders so link can use them)
//         if (bodyImageObj) {
//           renderedBody = injectImageIntoHtml(renderedBody, bodyImageObj, placeholderMap);
//           console.log('[Email Send] Body image injected into HTML for recipient', recipientEmail);
//         }

//         let renderedPlainText = bodyPlainText ? replaceBracedPlaceholders(bodyPlainText, placeholderMap) : null;
//         // if there is no plain text but we have an image URL or link, provide a simple fallback
//         if (!renderedPlainText && bodyImageObj) {
//           const textParts = [];
//           if (bodyImageObj.url) textParts.push(`Image: ${bodyImageObj.url}`);
//           if (bodyImageObj.link) textParts.push(`Link: ${bodyImageObj.link}`);
//           renderedPlainText = textParts.join(' ');
//         }
//         let renderedCtaText = ctaText ? replaceBracedPlaceholders(ctaText, placeholderMap) : null;
//         let renderedCtaLink = ctaLink ? replaceBracedPlaceholders(ctaLink, placeholderMap) : null;
//         // ✅ CRITICAL Fix: Replace placeholders in FROM fields and REPLY-TO
//         let renderedFromName = fromName ? replaceBracedPlaceholders(fromName, placeholderMap) : null;
//         let renderedFromEmail = fromEmail ? replaceBracedPlaceholders(fromEmail, placeholderMap) : null;
//         let renderedReplyTo = replyTo ? replaceBracedPlaceholders(replyTo, placeholderMap) : null;
        
//         console.log(`[Email Send] Rendering for ${recipientEmail}: subject="${renderedSubject.substring(0, 50)}..."`);
//         console.log(`[Email Send] Rendered CTA for ${recipientEmail}:`, { 
//           ctaText: renderedCtaText || 'none', 
//           ctaLink: renderedCtaLink || 'none' 
//         });
//         console.log(`[Email Send] Rendered Plain Text for ${recipientEmail}:`, {
//           length: renderedPlainText?.length || 0,
//           preview: renderedPlainText?.substring(0, 100) || 'AUTO-GENERATED FROM HTML'
//         });
//         console.log(`[Email Send] Rendered FROM fields for ${recipientEmail}:`, { 
//           fromName: renderedFromName || 'NOT SET', 
//           fromEmail: renderedFromEmail || 'NOT SET',
//           replyTo: renderedReplyTo || 'NOT SET'
//         });
        
//         // Image injection is disabled – we no longer modify the HTML at all.
//         // renderedBody = injectImageIntoHtml(renderedBody, bodyImageObj, placeholderMap);
        
//         // Wrap the sender-provided HTML in a professional email template structure.
//         // This ensures proper DOCTYPE, meta tags, charset, and outer container
//         // for consistent rendering across all email clients (Gmail, Outlook, etc.).
//         // The user's HTML content becomes the inner 'content' of the template.
        
//         // 🔍 DIAGNOSTIC: Before template wrapping (decode entities to check real content)
//         const decodedBefore = decodeHtmlEntities(renderedBody || '');
//         console.log(`[Email Send] 🔍 HTML BEFORE TEMPLATE WRAPPING for ${recipientEmail}:`, {
//           length: decodedBefore.length,
//           hasDoctype: decodedBefore.includes('<!DOCTYPE') ? 'YES' : 'NO',
//           hasTableTag: decodedBefore.includes('<table') ? 'YES' : 'NO',
//           hasStyleAttr: decodedBefore.includes('style=') ? 'YES' : 'NO',
//           hasEscapedHtml: (decodedBefore.includes('&lt;') || decodedBefore.includes('&gt;')) ? 'YES - STILL ESCAPED' : 'NO',
//           lineCount: decodedBefore.split('\n').length || 0,
//           preview_first200: decodedBefore.substring(0, 200) || 'EMPTY',
//           preview_last200: decodedBefore.substring(Math.max(0, decodedBefore.length - 200)) || 'EMPTY',
//         });
        
//         // ✅ CRITICAL FIX: If the HTML is already a complete document (has DOCTYPE, html, body tags),
//         // send it as-is without ANY wrapping. The wrapper was causing the original HTML
//         // to be corrupted by being wrapped inside paragraphs.
//         const isCompleteDocument = decodedBefore.includes('<!DOCTYPE') && 
//                                     decodedBefore.includes('<html') && 
//                                     decodedBefore.includes('<body');
        
//         if (isCompleteDocument) {
//           console.log('[Email Send] ✅ Complete HTML document detected - sending as-is WITHOUT wrapper');
//           // Use the decoded version directly, no template wrapping
//           renderedBody = decodedBefore;
//         } else {
//           // For fragments, apply the template wrapper
//             console.log('[Email Send] HTML fragment detected - wrapping in professional email template');
//             // If the fragment accidentally contains a full document, extract only the inner body
//             let contentToWrap = renderedBody;
//             if (/<!DOCTYPE/i.test(renderedBody) || /<html/i.test(renderedBody)) {
//               contentToWrap = extractBodyContent(renderedBody);
//               console.log('[Email Send] 🔧 Extracted inner <body> for wrapping to avoid nested documents');
//             }
//             const templateWrappedHtml = generateProfessionalEmailTemplate(contentToWrap);
//             // Decode after wrapping as well in case the user HTML contained escaped segments
//             let decodedWrapped = decodeHtmlEntities(templateWrappedHtml);
//             if (decodedWrapped !== templateWrappedHtml) {
//               console.log('[Email Send] 🔧 decoded escaped entities introduced during wrapping');
//             }
//             renderedBody = decodedWrapped;
//         }
        
//         // 🔍 DIAGNOSTIC: After template processing
//         const decodedAfter = decodeHtmlEntities(renderedBody || '');
//         console.log(`[Email Send] 🔍 HTML FINAL for ${recipientEmail}:`, {
//           length: decodedAfter.length,
//           hasDoctype: decodedAfter.includes('<!DOCTYPE') ? 'YES' : 'NO',
//           hasNestedTables: (decodedAfter.match(/<table/g) || []).length,
//           hasStyleAttr: decodedAfter.includes('style=') ? 'YES' : 'NO',
//           hasEscapedHtml: (decodedAfter.includes('&lt;') || decodedAfter.includes('&gt;')) ? 'YES - CORRUPTED' : 'NO',
//           lineCount: decodedAfter.split('\n').length || 0,
//           preview_first200: decodedAfter.substring(0, 200) || 'EMPTY',
//           preview_last200: decodedAfter.substring(Math.max(0, decodedAfter.length - 200)) || 'EMPTY',
//         });

//         // Auto-generate plain text if not provided (disabled)
//         // if (!renderedPlainText) {
//         //   renderedPlainText = htmlToPlainText(renderedBody);
//         // }

//         // 🔧 DIAGNOSTIC: Before plain text cleanup in routes
//         const beforeCleanupRoute = renderedPlainText;
//         const beforeLinesRoute = beforeCleanupRoute.split('\n');
//         const blankLineCountRoute = beforeLinesRoute.filter(line => line.trim().length === 0).length;
//         console.log(`[Email Send] 🔧 PLAIN TEXT BEFORE CLEANUP:`, {
//           totalLength: beforeCleanupRoute.length,
//           totalLines: beforeLinesRoute.length,
//           blankLines: blankLineCountRoute,
//           consec_newlines: (beforeCleanupRoute.match(/\n\n+/g) || []).length,
//           preview: beforeCleanupRoute.substring(0, 80),
//         });
        
//         // ✅ CRITICAL: Preserve original formatting while cleaning excess whitespace
//         // Only collapse 3+ consecutive newlines to 2, preserve 1-2 blank lines for readability
//         renderedPlainText = renderedPlainText
//           .replace(/\n\n\n+/g, '\n\n')  // Collapse 3+ newlines to 2 (preserve structure)
//           .replace(/[ \t]+$/gm, '')  // Remove trailing spaces from each line
//           .trim();  // Remove leading/trailing whitespace
        
//         // 🔧 DIAGNOSTIC: After cleanup
//         const afterCleanupRoute = renderedPlainText;
//         const afterLinesRoute = afterCleanupRoute.split('\n');
//         console.log(`[Email Send] 🔧 PLAIN TEXT AFTER CLEANUP:`, {
//           totalLength: afterCleanupRoute.length,
//           totalLines: afterLinesRoute.length,
//           blankLines: (afterLinesRoute.filter(line => line.trim().length === 0).length),
//           reduction_chars: (beforeCleanupRoute.length - afterCleanupRoute.length),
//           preview: afterCleanupRoute.substring(0, 80),
//         });
        
//         // Send email
//         const recipientList = isTo ? [recipientEmail] : [];
//         const bccList = isTo ? [] : [recipientEmail];
        
//         console.log(`[Email Send] ⚠️  CRITICAL CHECK before sendEmailWithProvider - Recipient: ${recipientEmail}`, {
//           bodyPlainTextOriginal: bodyPlainText?.substring(0, 100) || 'ORIGINAL NOT PROVIDED',
//           renderedPlainTextPreview: renderedPlainText?.substring(0, 100) || 'NOT SET/EMPTY',
//           renderedPlainTextLength: renderedPlainText?.length || 0,
//           bodyHTMLLength: renderedBody?.length || 0,
//           htmlDocHasProperStructure: renderedBody?.includes('<!DOCTYPE') && renderedBody?.includes('</html>') ? 'YES' : 'NO',
//           ctaTextValue: renderedCtaText || 'NOT SET',
//           ctaLinkValue: renderedCtaLink || 'NOT SET',
//         });
        
//         // helper: ensure attachment name has safe/expected extension and no illegal characters
//         const normalizeFilename = (name, contentType) => {
//           if (!name) return name;
//           // strip path characters and collapse spaces
//           let clean = name.replace(/[\/]/g, '_').replace(/\s+/g, '_');
//           // remove characters that may cause provider errors
//           clean = clean.replace(/@/g, '_');
//           // strip trailing .com/.net tokens that might have remained
//           clean = clean.replace(/\.com$/i, '').replace(/\.net$/i, '');
//           const mapping = {
//             'application/pdf': 'pdf',
//             'image/jpeg': 'jpg',
//             'image/png': 'png',
//             'image/gif': 'gif',
//             'application/msword': 'doc',
//             'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
//           };
//           const ext = mapping[contentType];
//           if (ext) {
//             if (!clean.toLowerCase().endsWith('.' + ext)) {
//               clean = clean + '.' + ext;
//             }
//           }
//           // trim trailing dot
//           clean = clean.replace(/\.$/, '');
//           return clean;
//         };

//         // replace placeholders in attachment filenames for this recipient
//         let attachmentsForRecipient = [];
//         if (attachments && Array.isArray(attachments)) {
//           attachmentsForRecipient = attachments.map(att => {
//             let newName = replaceBracedPlaceholders(att.filename || '', placeholderMap);
//             newName = normalizeFilename(newName, att.contentType);
//             return { ...att, filename: newName };
//           });
//         }

//         const result = await sendEmailWithProvider({
//           providerDoc,
//           to: recipientList,
//           bcc: bccList,
//           subject: renderedSubject,
//           body: renderedBody,
//           bodyPlainText: renderedPlainText,
//           ctaText: renderedCtaText,
//           ctaLink: renderedCtaLink,
//           replyTo: renderedReplyTo,
//           fromName: renderedFromName,
//           fromEmail: renderedFromEmail,
//           attachments: attachmentsForRecipient,
//         });
//         if (result.success) {
//           successCount++;
//         } else {
//           failureCount++;
//           console.error('[Email Send] Provider reported failure for', recipientEmail, 'error:', result.error);
//         }
        
//         results.push({
//           email: recipientEmail,
//           success: result.success,
//           error: result.error || null,
//         });
        
//         // Log email
//         try {
//           await EmailLog.create({
//             userId,
//             to: recipientList,
//             bcc: bccList,
//             subject: renderedSubject,
//             body: renderedBody,
//             bodyPlainText: renderedPlainText,
//             ctaText: renderedCtaText,
//             ctaLink: renderedCtaLink,
//             attachments: attachments.map(a => a.path),
//             replyTo,
//             fromName,
//             provider: providerDoc.provider,
//             status: result.success ? 'Success' : 'Failed',
//             error: result.error || null,
//             sentAt: new Date(),
//           });
//         } catch (logError) {
//           console.error('Failed to log email:', logError);
//         }
//       } catch (error) {
//         failureCount++;
//         results.push({
//           email: recipientData.email,
//           success: false,
//           error: error.message,
//         });
//         console.error(`Error sending to ${recipientData.email}:`, error.message);
//       }
//     }
    
//     console.log(`[Email Send] Complete: ${successCount} successful, ${failureCount} failed`);
    
//     // Build response object with error message for partial failures
//     const responseObj = {
//       success: failureCount === 0,
//       summary: {
//         total: allRecipients.length,
//         successful: successCount,
//         failed: failureCount,
//       },
//       results,
//     };
//     if (!responseObj.success) {
//       responseObj.error = `Failed to send to ${failureCount} recipient${failureCount === 1 ? '' : 's'}`;
//     }
//     console.log('[Email Send] Responding with result object:', responseObj);
//     res.json(responseObj);

//     // === CLEANUP: remove uploaded attachment files now that email(s) have been sent ===
//     attachments.forEach(att => {
//       fs.unlink(att.path, (err) => {
//         if (err) console.warn('[Email Send] Failed to delete attachment file', att.path, err.message);
//       });
//     });
//   } catch (error) {
//     console.error('[Email Send] Unhandled error:', {
//       message: error.message,
//       stack: error.stack,
//       statusCode: error.statusCode || 500
//     });
//     res.status(error.statusCode || 500).json({ success: false, error: error.message });
//   }
// });

// // =====================
// // BULK SEND WITH PLACEHOLDERS (Merge Tags)
// // =====================
// // Endpoint: POST /api/email/send-bulk
// // Sends personalized emails with placeholder replacement
// // 
// // Request body:
// // {
// //   "subject": "Hello [FirstName]",
// //   "body": "<p>Hi [FirstName], your email is [Email]</p>",
// //   "recipients": [
// //     { "email": "john@example.com", "firstName": "John", "lastName": "Doe" },
// //     { "email": "jane@example.com", "firstName": "Jane", "lastName": "Smith" }
// //   ],
// //   "format": "html",
// //   "timezone": "UTC"
// // }
// router.post('/send-bulk', authenticateToken, requireUser, upload.array('attachments'), async (req, res) => {
//   try {
//     const userId = req.user._id;
//     const { subject, body, bodyPlainText, recipients, replyTo, fromName, fromEmail, timezone = 'UTC' } = req.body;
//     const files = req.files || [];

//     // Validate required fields
//     if (!subject || !body) {
//       return res.status(400).json({ success: false, error: 'Subject and HTML body are required' });
//     }

//     if (!Array.isArray(recipients) || recipients.length === 0) {
//       return res.status(400).json({ success: false, error: 'At least one recipient is required' });
//     }

//     // Validate recipient data
//     const validRecipients = recipients.filter(r => r && r.email);
//     if (validRecipients.length === 0) {
//       return res.status(400).json({ success: false, error: 'Recipients must have email addresses' });
//     }

//     console.log(`[Bulk Send] Processing ${validRecipients.length} recipients with placeholders`);

//     // Get email provider
//     const providerDoc = await EmailProvider.findOne({ userId });
//     if (!providerDoc) {
//       return res.status(400).json({ success: false, error: 'No email provider configured.' });
//     }

//     // Validate provider configuration
//     if (providerDoc.provider === 'smtp') {
//       const requireAuth = !(providerDoc.smtp?.requireAuth === false || providerDoc.smtp?.requireAuth === 'false' || providerDoc.smtp?.requireAuth === '0' || providerDoc.smtp?.requireAuth === 0);
//       if (!providerDoc.smtp?.host || (requireAuth && !providerDoc.smtp?.username)) {
//         return res.status(400).json({ success: false, error: 'SMTP provider not fully configured' });
//       }
//     }
//     if (providerDoc.provider === 'aws' && (!providerDoc.aws?.username || !providerDoc.aws?.password)) {
//       return res.status(400).json({ success: false, error: 'AWS provider not fully configured' });
//     }
//     if (providerDoc.provider === 'resend' && !providerDoc.resend?.apiKey) {
//       return res.status(400).json({ success: false, error: 'Resend API key not configured' });
//     }

//     // Prepare attachments (BULK SEND)
//     // Safety check: ensure files is an array
//     console.log('[Bulk Send] 📎 ATTACHMENT PROCESSING - Incoming files:', {
//       filesType: typeof files,
//       filesIsArray: Array.isArray(files),
//       filesLength: files?.length || 0,
//     });
    
//     let filesArray = [];
//     try {
//       filesArray = Array.isArray(files) ? files : (files ? [files] : []);
//       console.log('[Bulk Send] 📎 Files converted to array successfully:', filesArray.length, 'file(s)');
//     } catch (fileError) {
//       console.error('[Bulk Send] 📎 ERROR converting files to array:', fileError.message);
//       filesArray = [];
//     }
    
//     let attachments = [];
//     try {
//       attachments = filesArray.map(file => ({
//         filename: file.originalname,
//         path: file.path,
//         contentType: file.mimetype,
//       }));
//       console.log('[Bulk Send] 📎 Attachments mapped successfully:', attachments.length);
//     } catch (mapError) {
//       console.error('[Bulk Send] 📎 ERROR mapping attachment files:', mapError.message);
//       attachments = [];
//     }

//     // Process each recipient
//     let successCount = 0;
//     let failureCount = 0;
//     const results = [];

//     for (const recipient of validRecipients) {
//       try {
//         // Render subject and body with placeholders
//         const renderedSubject = placeholderService.render(subject, recipient, {
//           timezone,
//           sanitize: true,
//           logWarnings: false,
//         });

//         let renderedBody = placeholderService.render(body, recipient, {
//           timezone,
//           sanitize: true,
//           logWarnings: false,
//         });

//         // 🔍 DIAGNOSTIC: Before template wrapping in bulk send
//         console.log(`[Bulk Email Send] 🔍 HTML BEFORE WRAP for ${recipient.email}:`, {
//           length: renderedBody?.length || 0,
//           hasDoctype: renderedBody?.includes('<!DOCTYPE') ? 'YES' : 'NO',
//           hasEscapedHtml: (renderedBody?.includes('&lt;') || renderedBody?.includes('&gt;')) ? 'YES - CORRUPTED' : 'NO',
//           preview: renderedBody?.substring(0, 150) || 'EMPTY',
//         });
        
//         // ✅ CRITICAL FIX: If the HTML is already a complete document (has DOCTYPE, html, body tags),
//         // send it as-is WITHOUT ANY wrapping. Complete documents should never be wrapped.
//         const isCompleteDocBulk = renderedBody?.includes('<!DOCTYPE') && 
//                                   renderedBody?.includes('<html') && 
//                                   renderedBody?.includes('<body');
        
//         if (isCompleteDocBulk) {
//           console.log('[Bulk Email Send] ✅ Complete HTML document detected - sending as-is WITHOUT wrapper');
//           // Use as-is, no template wrapping
//         } else {
//           console.log('[Bulk Email Send] HTML fragment detected - wrapping in professional email template');
//           // If the fragment accidentally contains a full document, extract only the inner body
//           let contentToWrapBulk = renderedBody;
//           if (/<!DOCTYPE/i.test(renderedBody) || /<html/i.test(renderedBody)) {
//             contentToWrapBulk = extractBodyContent(renderedBody);
//             console.log('[Bulk Email Send] 🔧 Extracted inner <body> for wrapping to avoid nested documents');
//           }
//           const templateWrappedHtml = generateProfessionalEmailTemplate(contentToWrapBulk);
//           renderedBody = templateWrappedHtml;
//         }
        
//         // 🔍 DIAGNOSTIC: After template wrapping (or skipped) in bulk send
//         console.log(`[Bulk Email Send] 🔍 HTML FINAL for ${recipient.email}:`, {
//           length: renderedBody?.length || 0,
//           hasDoctype: renderedBody?.includes('<!DOCTYPE') ? 'YES' : 'NO',
//           hasEscapedHtml: (renderedBody?.includes('&lt;') || renderedBody?.includes('&gt;')) ? 'YES - CORRUPTED' : 'NO',
//           preview: renderedBody?.substring(0, 150) || 'EMPTY',
//         });

//         let renderedPlainText = null;
//         if (bodyPlainText) {
//           renderedPlainText = placeholderService.render(bodyPlainText, recipient, {
//             timezone,
//             sanitize: true,
//             logWarnings: false,
//           });
//         }

//         // ⚠️ IMPORTANT: Sanitization was removed for email HTML to prevent
//         // accidental escaping or alteration of the raw content.  The system
//         // now sends HTML exactly as provided after previous processing steps.
//         // If this function is called elsewhere the serializer will simply return
//         // the original string without modification (see htmlSanitizer.js).
//         // renderedBody = sanitizeHtmlForEmail(renderedBody);

//         // Auto-generate plain text if not provided (disabled in bulk send)
//         // if (!renderedPlainText) {
//         //   renderedPlainText = htmlToPlainText(renderedBody);
//         // }

//         // 🔧 DIAGNOSTIC: Before cleanup in bulk send
//         const beforeCleanupBulk = renderedPlainText;
//         const beforeLinesBulk = beforeCleanupBulk.split('\n');
//         const blankLineCountBulk = beforeLinesBulk.filter(line => line.trim().length === 0).length;
//         console.log(`[Email Send Bulk] 🔧 PLAIN TEXT BEFORE CLEANUP:`, {
//           totalLength: beforeCleanupBulk.length,
//           totalLines: beforeLinesBulk.length,
//           blankLines: blankLineCountBulk,
//           preview: beforeCleanupBulk.substring(0, 80),
//         });

//         // ✅ CRITICAL: Preserve original formatting while cleaning excess whitespace
//         // Only collapse 3+ consecutive newlines to 2, preserve 1-2 blank lines for readability
//         renderedPlainText = renderedPlainText
//           .replace(/\n\n\n+/g, '\n\n')  // Collapse 3+ newlines to 2 (preserve structure)
//           .replace(/[ \t]+$/gm, '')  // Remove trailing spaces from each line
//           .trim();  // Remove leading/trailing whitespace

//         // 🔧 DIAGNOSTIC: After cleanup
//         const afterCleanupBulk = renderedPlainText;
//         const afterLinesBulk = afterCleanupBulk.split('\n');
//         console.log(`[Email Send Bulk] 🔧 PLAIN TEXT AFTER CLEANUP:`, {
//           totalLength: afterCleanupBulk.length,
//           totalLines: afterLinesBulk.length,
//           blankLines: (afterLinesBulk.filter(line => line.trim().length === 0).length),
//           reduction_chars: (beforeCleanupBulk.length - afterCleanupBulk.length),
//           preview: afterCleanupBulk.substring(0, 80),
//         });

//         // ✅ CRITICAL FIX: Render FROM fields and REPLY-TO with placeholders
//         const renderedFromName = fromName ? placeholderService.render(fromName, recipient, {
//           timezone,
//           sanitize: true,
//           logWarnings: false,
//         }) : null;

//         const renderedFromEmail = fromEmail ? placeholderService.render(fromEmail, recipient, {
//           timezone,
//           sanitize: true,
//           logWarnings: false,
//         }) : null;

//         const renderedReplyTo = replyTo ? placeholderService.render(replyTo, recipient, {
//           timezone,
//           sanitize: true,
//           logWarnings: false,
//         }) : null;

//         // per-recipient attachments: render placeholders and sanitize names
//         let attachmentsForRecipient = [];
//         if (attachments && Array.isArray(attachments)) {
//           attachmentsForRecipient = attachments.map(att => {
//             let filename = placeholderService.render(att.filename || '', recipient, {
//               timezone,
//               sanitize: true,
//               logWarnings: false,
//             });
//             filename = normalizeFilename(filename, att.contentType);
//             return { ...att, filename };
//           });
//         }

//         // Send individual email
//         const result = await sendEmailWithProvider({
//           providerDoc,
//           to: [recipient.email],
//           bcc: [],
//           subject: renderedSubject,
//           body: renderedBody,
//           bodyPlainText: renderedPlainText,
//           replyTo: renderedReplyTo,
//           fromName: renderedFromName,
//           fromEmail: renderedFromEmail,
//           attachments: attachmentsForRecipient,
//         });

//         if (result.success) {
//           successCount++;
//         } else {
//           failureCount++;
//         }

//         results.push({
//           email: recipient.email,
//           success: result.success,
//           error: result.error || null,
//         });

//         // Log each email
//         try {
//           await EmailLog.create({
//             userId,
//             to: [recipient.email],
//             bcc: [],
//             subject: renderedSubject,
//             body: renderedBody,
//             bodyPlainText: renderedPlainText,
//             attachments: attachments.map(a => a.path),
//             replyTo,
//             fromName,
//             provider: providerDoc.provider,
//             status: result.success ? 'Success' : 'Failed',
//             error: result.error || null,
//             sentAt: new Date(),
//           });
//         } catch (logError) {
//           console.error('Failed to log email:', logError);
//         }
//       } catch (error) {
//         failureCount++;
//         results.push({
//           email: recipient.email,
//           success: false,
//           error: error.message,
//         });
//         console.error(`Error sending to ${recipient.email}:`, error.message);
//       }
//     }

//     console.log(`[Bulk Send] Complete: ${successCount} successful, ${failureCount} failed`);

//     // Build response object for bulk send
//     const bulkResponse = {
//       success: failureCount === 0,
//       summary: {
//         total: validRecipients.length,
//         successful: successCount,
//         failed: failureCount,
//       },
//       results,
//     };
//     if (!bulkResponse.success) {
//       bulkResponse.error = `Failed to send to ${failureCount} recipient${failureCount === 1 ? '' : 's'}`;
//     }
//     console.log('[Bulk Send] Responding with result object:', bulkResponse);
//     res.json(bulkResponse);
//   } catch (error) {
//     console.error('Bulk send error:', error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

// // =====================
// // PLACEHOLDER INFO ENDPOINTS
// // =====================

// // Get all available placeholders
// router.get('/placeholders', authenticateToken, requireUser, (req, res) => {
//   try {
//     const placeholders = placeholderService.getPlaceholdersByCategory();
//     res.json({ success: true, placeholders });
//   } catch (error) {
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

// // Validate template for placeholders
// router.post('/validate-template', authenticateToken, requireUser, (req, res) => {
//   try {
//     const { subject, body } = req.body;

//     const subjectValidation = placeholderService.validateTemplate(subject);
//     const bodyValidation = placeholderService.validateTemplate(body);

//     res.json({
//       success: true,
//       subject: subjectValidation,
//       body: bodyValidation,
//     });
//   } catch (error) {
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

// // Preview placeholders for a sample recipient
// router.post('/preview-template', authenticateToken, requireUser, (req, res) => {
//   try {
//     const { subject, body, sampleRecipient, timezone = 'UTC', format = 'html' } = req.body;

//     // Use provided sample or create a default one
//     const recipient = sampleRecipient || {
//       name: 'John Doe',
//       firstName: 'John',
//       lastName: 'Doe',
//       email: 'john.doe@example.com',
//       company: 'Example Corp',
//       phone: '+1-555-0123',
//       cellPhone: '+1-555-0123',
//       address: '123 Main Street',
//       city: 'New York',
//       state: 'NY',
//       zipCode: '10001',
//       country: 'USA',
//     };

//     const renderedSubject = placeholderService.render(subject, recipient, {
//       timezone,
//       sanitize: false,
//       logWarnings: false,
//     });

//     let renderedBody = placeholderService.render(body, recipient, {
//       timezone,
//       sanitize: false,
//       logWarnings: false,
//     });

//     res.json({
//       success: true,
//       preview: {
//         subject: renderedSubject,
//         body: renderedBody,
//         sampleRecipient: recipient,
//       },
//     });
//   } catch (error) {
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

// // Get email logs
// router.get('/logs', authenticateToken, requireUser, async (req, res) => {
//   try {
//     const logs = await EmailLog.find({ userId: req.user._id }).sort({ sentAt: -1 }).limit(100);
//     res.json({ logs });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// });

// // =====================
// // PLACEHOLDER TESTING ENDPOINT
// // =====================
// // Test endpoint to preview all professional placeholders
// router.post('/test-placeholders', authenticateToken, requireUser, (req, res) => {
//   try {
//     const testRecipientEmail = 'john.doe@example.com';
//     const testSubject = 'Subject: {RECIPIENT_NAME} from {FAKE_COMPANY}';
//     const testBody = `
//       <p>Hello {RECIPIENT_NAME},</p>
//       <p>This is a test email sent on {CURRENT_DATE} at {CURRENT_TIME}.</p>
//       <p>Your email: {RECIPIENT_EMAIL}</p>
//       <p>Domain: {RECIPIENT_DOMAIN} ({RECIPIENT_DOMAIN_NAME})</p>
//       <p>Base64 Email: {RECIPIENT_BASE64_EMAIL}</p>
//       <p>Random Number: {RANDOM_NUMBER10}</p>
//       <p>Random String: {RANDOM_STRING}</p>
//       <p>Random MD5: {RANDOM_MD5}</p>
//       <p>Random Path: {RANDOM_PATH}</p>
//       <p>Random Link: {RANDLINK}</p>
//       <p>Company: {FAKE_COMPANY}</p>
//       <p>Company Email: {FAKE_COMPANY_EMAIL}</p>
//       <p>Company Full: {FAKE_COMPANY_EMAIL_AND_FULLNAME}</p>
//     `;

//     // Generate placeholder values
//     const emailLocalPart = testRecipientEmail.split('@')[0];
//     const recipientName = capitalize(emailLocalPart.split('.')[0] || emailLocalPart);
//     const recipientDomain = testRecipientEmail.split('@')[1];
//     const recipientDomainName = capitalize(recipientDomain.split('.')[0]);
//     const currentDate = new Date().toLocaleDateString();
//     const currentTime = new Date().toLocaleTimeString();

//     const placeholderMap = {
//       'RECIPIENT_NAME': recipientName,
//       'RECIPIENT_EMAIL': testRecipientEmail,
//       'RECIPIENT_DOMAIN': recipientDomain,
//       'RECIPIENT_DOMAIN_NAME': recipientDomainName,
//       'RECIPIENT_BASE64_EMAIL': encodeBase64(testRecipientEmail),
//       'CURRENT_DATE': currentDate,
//       'CURRENT_TIME': currentTime,
//       'RANDOM_NUMBER10': generateRandom10DigitNumber(),
//       'RANDOM_STRING': generateRandomString(),
//       'RANDOM_MD5': generateRandomMD5(),
//       'RANDOM_PATH': generateRandomPath(),
//       'RANDLINK': generateRandomLink(),
//       'FAKE_COMPANY': generateFakeCompanyName(),
//       'FAKE_COMPANY_EMAIL': generateFakeCompanyEmail(),
//       'FAKE_COMPANY_EMAIL_AND_FULLNAME': generateFakeCompanyEmailAndFullName(),
//     };

//     // Render placeholders
//     const renderedSubject = replaceBracedPlaceholders(testSubject, placeholderMap);
//     const renderedBody = replaceBracedPlaceholders(testBody, placeholderMap);

//     res.json({
//       success: true,
//       test: {
//         originalSubject: testSubject,
//         renderedSubject,
//         originalBody: testBody,
//         renderedBody,
//         placeholderValues: placeholderMap,
//       },
//     });
//   } catch (error) {
//     console.error('Placeholder test error:', error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

// // Clear all email logs for the user
// router.delete('/logs', authenticateToken, requireUser, async (req, res) => {
//   try {
//     await EmailLog.deleteMany({ userId: req.user._id });
//     res.json({ success: true });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// });

// export default router;











// import { Resend } from 'resend'
// import 'dotenv/config'
// import axios from 'axios'

// // ✅ Check if email is configured (optional)
// const isEmailConfigured = !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && process.env.FRONTEND_URL)

// // ✅ Create Resend client (only if email is configured)
// const resend = isEmailConfigured ? new Resend(process.env.RESEND_API_KEY) : null

// // ✅ Helper: Convert attachment URLs to Resend attachment format
// const convertAttachmentsToResend = async (attachments = []) => {
//   const resendAttachments = []
  
//   for (const attachment of attachments) {
//     try {
//       const url = typeof attachment === 'string' ? attachment : (attachment.url || attachment.publicId)
//       const filename = typeof attachment === 'object' ? (attachment.filename || 'attachment.pdf') : 'attachment.pdf'
      
//       if (url) {
//         // Fetch the PDF from the URL
//         const validUrl = url.startsWith('http') ? url : `https://${url}`
//         const response = await axios.get(validUrl, { responseType: 'arraybuffer' })
//         const buffer = Buffer.from(response.data)
        
//         resendAttachments.push({
//           filename: filename,
//           content: buffer.toString('base64'),
//         })
//       }
//     } catch (error) {
//       console.error(`⚠️ Failed to fetch attachment: ${error.message}`)
//       // Continue with other attachments if one fails
//     }
//   }
  
//   return resendAttachments
// }

// // ✅ Get sender info dynamically
// const getFromAddress = (user = {}) => {
//   const senderEmail = process.env.EMAIL_FROM
//   if (user.businessInfo?.businessName?.trim()) {
//     return `${user.businessInfo.businessName} <${senderEmail}>`
//   }
//   return `InboxGuaranteed <${senderEmail}>`
// }

// // ✅ Send confirmation email
// export const sendConfirmationEmail = async (email, token, user = {}) => {
//   if (!isEmailConfigured) {
//     console.warn('⚠️ Email not configured. Skipping confirmation email to:', email)
//     return
//   }

//   const confirmUrl = `${process.env.FRONTEND_URL}/confirm-email/${token}`

//   try {
//     await resend.emails.send({
//       from: getFromAddress(user),
//       to: email,
//       subject: 'Confirm Your Email Address',
//       html: `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//           <h2 style="color: #3b82f6;">Welcome to InboxGuaranteed!</h2>
//           <p>Click below to confirm your email address:</p>
//           <div style="text-align: center; margin: 30px 0;">
//             <a href="${confirmUrl}" style="background-color: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">
//               Confirm Email Address
//             </a>
//           </div>
//           <p>If that doesn't work, copy and paste this URL:</p>
//           <p style="word-break: break-all; color: #666;">${confirmUrl}</p>
//         </div>
//       `,
//     })

//     console.log('📧 Confirmation email sent to:', email)
//   } catch (error) {
//     console.error('❌ Error sending confirmation email:', error)
//     throw new Error('Failed to send confirmation email')
//   }
// }

// // ✅ Send password reset email
// export const sendPasswordResetEmail = async (email, token, user = {}) => {
//   if (!isEmailConfigured) {
//     console.warn('⚠️ Email not configured. Skipping password reset email to:', email)
//     return
//   }

//   const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${token}`

//   try {
//     await resend.emails.send({
//       from: getFromAddress(user),
//       to: email,
//       subject: 'Reset Your Password',
//       html: `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//           <h2 style="color: #3b82f6;">Password Reset Request</h2>
//           <p>Click below to reset your password:</p>
//           <div style="text-align: center; margin: 30px 0;">
//             <a href="${resetUrl}" style="background-color: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">
//               Reset Password
//             </a>
//           </div>
//           <p>If that doesn't work, copy and paste this URL:</p>
//           <p style="word-break: break-all; color: #666;">${resetUrl}</p>
//         </div>
//       `,
//     })

//     console.log('📧 Password reset email sent to:', email)
//   } catch (error) {
//     console.error('❌ Error sending password reset email:', error)
//     throw new Error('Failed to send password reset email')
//   }
// }

// // ✅ Send invoice email with PDF attachment
// export const sendInvoiceEmail = async (email, invoiceData, pdfBuffer, user = {}) => {
//   if (!isEmailConfigured) {
//     console.warn('⚠️ Email not configured. Skipping invoice email to:', email)
//     return
//   }

//   try {
//     await resend.emails.send({
//       from: getFromAddress(user),
//       to: email,
//       subject: `Invoice ${invoiceData.invoiceNumber} ${user.businessInfo?.businessName || ''}`,
//       html: `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//           <h2 style="color: #3b82f6;">Invoice from ${user.businessInfo?.businessName || 'InboxGuaranteed'}</h2>
//           <p>Dear ${invoiceData.customerName},</p>
//           <p>Please find attached your invoice.</p>
//           <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
//             <p><strong>Invoice Number:</strong> ${invoiceData.invoiceNumber}</p>
//             <p><strong>Item:</strong> ${invoiceData.itemName}</p>
//             <p><strong>Amount:</strong> ${invoiceData.currency || 'NGN'} ${Number(invoiceData.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
//             <p><strong>Status:</strong> ${invoiceData.status}</p>
//           </div>
//         </div>
//       `,
//       attachments:
//         pdfBuffer instanceof Buffer
//           ? [
//               {
//                 filename: `invoice-${invoiceData.invoiceNumber}.pdf`,
//                 content: pdfBuffer.toString('base64'),
//               },
//             ]
//           : [],
//     })

//     console.log('📧 Invoice email sent to:', email)
//   } catch (error) {
//     console.error('❌ Error sending invoice email:', error)
//     throw new Error('Failed to send invoice email')
//   }
// }

// // ✅ Send generic notification email
// export const sendNotificationEmail = async (email, subject, message, user = {}) => {
//   if (!isEmailConfigured) {
//     console.warn('⚠️ Email not configured. Skipping notification email to:', email)
//     return
//   }

//   try {
//     await resend.emails.send({
//       from: getFromAddress(user),
//       to: email,
//       subject,
//       html: `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//           <h2 style="color: #3b82f6;">Marketbook Solution</h2>
//           <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
//             ${message}
//           </div>
//         </div>
//       `,
//     })

//     console.log('📧 Notification email sent to:', email)
//   } catch (error) {
//     console.error('❌ Error sending notification email:', error)
//     throw new Error('Failed to send notification email')
//   }
// }

// // ✅ Send scheduled note reminder email
// export const sendNoteReminderEmail = async (email, userName, noteTitle, noteContent, scheduledDate, scheduledTime, timezone, noteCreatedAt, images = [], video = null, attachments = []) => {
//   if (!isEmailConfigured) {
//     console.warn('⚠️ Email not configured. Skipping note reminder email to:', email)
//     return
//   }

//   try {
//     // Format the note creation date - display ONLY date, no time to avoid timezone confusion
//     const createdAtDate = noteCreatedAt 
//       ? new Date(noteCreatedAt).toLocaleDateString('en-US', { 
//           year: 'numeric', 
//           month: 'short', 
//           day: 'numeric' 
//         })
//       : new Date().toLocaleDateString('en-US', { 
//           year: 'numeric', 
//           month: 'short', 
//           day: 'numeric' 
//         })
    
//     // Build media HTML with proper error handling and fallbacks
//     let mediaHTML = ''
    
//     // Handle images - support both URL strings and image objects
//     if (images && images.length > 0) {
//       mediaHTML += '<div style="margin: 20px 0;">'
//       mediaHTML += '<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">📸 Images:</p>'
      
//       images.forEach((image, index) => {
//         // Support both string URLs and image objects with .url property
//         const imageUrl = typeof image === 'string' ? image : (image.url || image.publicId)
        
//         if (imageUrl) {
//           // Ensure the image URL is valid and properly formatted
//           const validUrl = imageUrl.startsWith('http') ? imageUrl : `https://${imageUrl}`
          
//           mediaHTML += `<div style="margin-bottom: 15px;">`
//           mediaHTML += `<img src="${validUrl}" alt="Note image ${index + 1}" style="max-width: 100%; height: auto; border-radius: 8px; display: block; margin: 10px 0; max-height: 400px; border: 1px solid #ddd;" />`
//           mediaHTML += `</div>`
//         }
//       })
      
//       mediaHTML += '</div>'
//     }
    
//     // Handle videos - support both single video objects and arrays
//     if (video) {
//       const videos = Array.isArray(video) ? video : (video ? [video] : [])
      
//       if (videos.length > 0) {
//         mediaHTML += '<div style="margin: 20px 0;">'
//         mediaHTML += `<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">🎥 Video${videos.length > 1 ? 's' : ''}:</p>`
        
//         videos.forEach((vid, index) => {
//           // Support both string URLs and video objects
//           const videoUrl = typeof vid === 'string' ? vid : (vid.url || vid.publicId)
//           const thumbnailUrl = typeof vid === 'object' ? vid.thumbnail : null
          
//           if (videoUrl) {
//             const validVideoUrl = videoUrl.startsWith('http') ? videoUrl : `https://${videoUrl}`
            
//             mediaHTML += `<div style="margin-bottom: 20px; background-color: #f5f5f5; padding: 15px; border-radius: 8px;">`
//             mediaHTML += `<p style="color: #555; font-weight: bold; font-size: 13px; margin: 0 0 10px 0;">Video ${index + 1}</p>`
            
//             // If thumbnail available, show it
//             if (thumbnailUrl) {
//               const validThumbUrl = thumbnailUrl.startsWith('http') ? thumbnailUrl : `https://${thumbnailUrl}`
//               mediaHTML += `<div style="margin-bottom: 12px;">`
//               mediaHTML += `<img src="${validThumbUrl}" alt="Video ${index + 1} thumbnail" style="max-width: 100%; height: auto; border-radius: 6px; display: block; max-height: 300px; border: 1px solid #ddd;" />`
//               mediaHTML += `</div>`
//             }
            
//             // Add watch button with proper styling
//             mediaHTML += `<a href="${validVideoUrl}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; text-align: center; transition: background-color 0.3s;" onmouseover="this.style.backgroundColor='#2563eb'" onmouseout="this.style.backgroundColor='#3b82f6'">▶️ Watch Video ${index + 1}</a>`
            
//             mediaHTML += `</div>`
//           }
//         })
        
//         mediaHTML += '</div>'
//       }
//     }
    
//     // Handle attachments (PDFs)
//     if (attachments && attachments.length > 0) {
//       mediaHTML += '<div style="margin: 20px 0;">'
//       mediaHTML += '<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">📎 Attachments:</p>'
      
//       attachments.forEach((attachment, index) => {
//         const filename = typeof attachment === 'object' ? (attachment.filename || `Attachment ${index + 1}`) : `Attachment ${index + 1}`
//         mediaHTML += `<p style="margin: 5px 0; color: #555; font-size: 13px;">📄 ${filename}</p>`
//       })
      
//       mediaHTML += '</div>'
//     }
    
//     // Convert attachments for Resend
//     const resendAttachments = await convertAttachmentsToResend(attachments)
    
//     const result = await resend.emails.send({
//       from: process.env.EMAIL_FROM,
//       to: email,
//       subject: `📝 Reminder: Your Scheduled Note - "${noteTitle}"`,
//       html: `
//         <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
//           <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
//             <h2 style="color: white; margin: 0; font-size: 24px;">📝 Note Reminder</h2>
//           </div>
          
//           <div style="padding: 30px; background-color: #ffffff;">
//             <p style="margin-top: 0; font-size: 16px; color: #333;">Hi ${userName},</p>
            
//             <p style="font-size: 15px; color: #555; margin: 15px 0;">Your scheduled note is ready for review:</p>
            
//             <div style="background-color: #f8f9fa; padding: 25px; border-radius: 10px; margin: 25px 0; border-left: 5px solid #3b82f6;">
//               <h3 style="margin-top: 0; color: #1e40af; font-size: 18px; word-break: break-word;">${noteTitle}</h3>
//               <div style="color: #333; margin: 15px 0; line-height: 1.6; font-size: 14px; white-space: pre-wrap; word-break: break-word; background-color: white; padding: 12px; border-radius: 6px; border: 1px solid #e0e0e0;">${noteContent || '(No content)'}</div>
//               ${mediaHTML}
//               <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
//               <p style="margin: 0; color: #666; font-size: 12px;">Note created on ${createdAtDate}</p>
//             </div>
            
//             <div style="background-color: #eff6ff; padding: 20px; border-radius: 10px; margin: 25px 0; border-left: 5px solid #0ea5e9;">
//               <p style="margin: 0; color: #0c4a6e; font-size: 14px; line-height: 1.8;">
//                 <strong style="font-size: 15px;">📅 Scheduled Date:</strong> ${scheduledDate}<br>
//                 <strong style="font-size: 15px;">⏰ Scheduled Time:</strong> ${scheduledTime || '00:00'}<br>
//                 <strong style="font-size: 15px;">🌍 Timezone:</strong> ${timezone}
//               </p>
//             </div>
            
//             <div style="background-color: #f0fdf4; padding: 20px; border-radius: 10px; margin: 25px 0; border-left: 5px solid #22c55e;">
//               <p style="margin: 0; color: #166534; font-size: 13px; line-height: 1.6;">
//                 ✅ This reminder was sent on the scheduled date and time in your timezone.
//               </p>
//             </div>
            
//             <p style="color: #666; font-size: 14px; margin: 20px 0;">
//               You can view and manage all your notes in your Marketbook dashboard.
//             </p>
//           </div>
          
//           <div style="background-color: #f5f5f5; padding: 20px; border-radius: 0 0 12px 12px; text-align: center; border-top: 1px solid #e0e0e0;">
//             <p style="color: #999; font-size: 12px; margin: 0;">
//               This is an automated reminder from InboxGuaranteed. If you did not set this reminder, please contact support.
//             </p>
//           </div>
//         </div>
//       `,
//       ...(resendAttachments.length > 0 && { attachments: resendAttachments })
//     })

//     console.log('✅ Note reminder email sent successfully to:', email)
//     console.log('📬 Resend Response ID:', result?.id)
//     return result
//   } catch (error) {
//     console.error('❌ Error sending note reminder email to', email, ':', error)
//     throw new Error(`Failed to send note reminder email: ${error.message}`)
//   }
// }

// // ✅ Send shared note email
// export const sendSharedNoteEmail = async (recipientEmail, senderName, noteTitle, noteContent, customMessage, user = {}, timezone = 'UTC', subject = 'Shared Note', images = [], video = null, allRecipients = [], attachments = [], fromEmail = null, callToActionText = null, callLink = null) => {
//   if (!isEmailConfigured) {
//     console.warn('⚠️ Email not configured. Skipping shared note email to:', recipientEmail)
//     return
//   }

//   try {
//     // Build media HTML with proper error handling and fallbacks
//     let mediaHTML = ''
    
//     // Handle images - support both URL strings and image objects
//     if (images && images.length > 0) {
//       mediaHTML += '<div style="margin: 20px 0;">'
//       mediaHTML += '<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">📸 Images:</p>'
      
//       images.forEach((image, index) => {
//         // Support both string URLs and image objects with .url property
//         const imageUrl = typeof image === 'string' ? image : (image.url || image.publicId)
        
//         if (imageUrl) {
//           // Ensure the image URL is valid and properly formatted
//           const validUrl = imageUrl.startsWith('http') ? imageUrl : `https://${imageUrl}`
          
//           mediaHTML += `<div style="margin-bottom: 15px;">`
//           mediaHTML += `<img src="${validUrl}" alt="Note image ${index + 1}" style="max-width: 100%; height: auto; border-radius: 8px; display: block; margin: 10px 0; max-height: 400px; border: 1px solid #ddd;" />`
//           mediaHTML += `</div>`
//         }
//       })
      
//       mediaHTML += '</div>'
//     }
    
//     // Handle videos - support both single video objects and arrays
//     if (video) {
//       const videos = Array.isArray(video) ? video : (video ? [video] : [])
      
//       if (videos.length > 0) {
//         mediaHTML += '<div style="margin: 20px 0;">'
//         mediaHTML += `<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">🎥 Video${videos.length > 1 ? 's' : ''}:</p>`
        
//         videos.forEach((vid, index) => {
//           // Support both string URLs and video objects
//           const videoUrl = typeof vid === 'string' ? vid : (vid.url || vid.publicId)
//           const thumbnailUrl = typeof vid === 'object' ? vid.thumbnail : null
          
//           if (videoUrl) {
//             const validVideoUrl = videoUrl.startsWith('http') ? videoUrl : `https://${videoUrl}`
            
//             mediaHTML += `<div style="margin-bottom: 20px; background-color: #f5f5f5; padding: 15px; border-radius: 8px;">`
//             mediaHTML += `<p style="color: #555; font-weight: bold; font-size: 13px; margin: 0 0 10px 0;">Video ${index + 1}</p>`
            
//             // If thumbnail available, show it
//             if (thumbnailUrl) {
//               const validThumbUrl = thumbnailUrl.startsWith('http') ? thumbnailUrl : `https://${thumbnailUrl}`
//               mediaHTML += `<div style="margin-bottom: 12px;">`
//               mediaHTML += `<img src="${validThumbUrl}" alt="Video ${index + 1} thumbnail" style="max-width: 100%; height: auto; border-radius: 6px; display: block; max-height: 300px; border: 1px solid #ddd;" />`
//               mediaHTML += `</div>`
//             }
            
//             // Add watch button with proper styling
//             mediaHTML += `<a href="${validVideoUrl}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; text-align: center; transition: background-color 0.3s;" onmouseover="this.style.backgroundColor='#2563eb'" onmouseout="this.style.backgroundColor='#3b82f6'">▶️ Watch Video ${index + 1}</a>`
            
//             mediaHTML += `</div>`
//           }
//         })
        
//         mediaHTML += '</div>'
//       }
//     }
    
//     // Handle attachments (PDFs)
//     if (attachments && attachments.length > 0) {
//       mediaHTML += '<div style="margin: 20px 0;">'
//       mediaHTML += '<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">📎 Attachments:</p>'
      
//       attachments.forEach((attachment, index) => {
//         const filename = typeof attachment === 'object' ? (attachment.filename || `Attachment ${index + 1}`) : `Attachment ${index + 1}`
//         mediaHTML += `<p style="margin: 5px 0; color: #555; font-size: 13px;">📄 ${filename}</p>`
//       })
      
//       mediaHTML += '</div>'
//     }
    
//     // Convert attachments for Resend
//     const resendAttachments = await convertAttachmentsToResend(attachments)
    
//     // Build recipients list HTML - REMOVED: Don't show recipients in email
    
//     const emailFrom = fromEmail || process.env.EMAIL_FROM
//     const fromAddress = `${senderName} <${emailFrom}>`
    
//     // Build CTA button HTML if provided
//     let ctaHTML = ''
//     if (callToActionText && callLink) {
//       ctaHTML = `
//         <div style="text-align: center; margin: 30px 0;">
//           <a href="${callLink}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; transition: transform 0.3s, box-shadow 0.3s;" onmouseover="this.style.transform='scale(1.05)'; this.style.boxShadow='0 10px 20px rgba(102, 126, 234, 0.3)'" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='none'">
//             ${callToActionText}
//           </a>
//         </div>
//       `
//     }
    
//     const result = await resend.emails.send({
//       from: fromAddress,
//       to: recipientEmail,
//       subject: `📝 ${senderName} shared a note with you: "${noteTitle}"`,
//       ...(emailFrom !== displayEmail && { replyTo: emailFrom }),
//       html: `
//         <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; padding: 20px 0;">
//           <div style="max-width: 600px; margin: 0 auto;">
//             <!-- Header -->
//             <div style="background: linear-gradient(135deg, #ea66c0 0%, #764ba2 100%); padding: 40px 30px; text-align: center; border-radius: 16px 16px 0 0;">
//               <div style="background-color: rgba(255,255,255,0.15); width: 56px; height: 56px; border-radius: 12px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
//                 <span style="font-size: 28px;">📝</span>
//               </div>
//               <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 600;">Note Shared with You</h1>
//               <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px;">from <strong>${senderName}</strong></p>
//             </div>
            
//             <!-- Main Content -->
//             <div style="background-color: #ffffff; padding: 40px 30px;">
//               <!-- Greeting -->
//               <p style="margin: 0 0 24px 0; font-size: 16px; color: #1e293b; line-height: 1.5;">Hi there,</p>
              
//               <!-- Note Content Card -->
//               <div style="background-color: #f1f5f9; border-left: 4px solid #667eea; padding: 24px; border-radius: 8px; margin: 24px 0;">
//                 <h2 style="margin: 0 0 16px 0; color: #0f172a; font-size: 20px; font-weight: 600; word-break: break-word;">${noteTitle}</h2>
//                 <div style="background-color: #ffffff; padding: 16px; border-radius: 6px; color: #334155; font-size: 15px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;">${noteContent || '(No content)'}</div>
//                 ${mediaHTML}
//               </div>
              
//               <!-- Personal Message -->
//               ${customMessage ? `
//               <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 24px 0;">
//                 <p style="margin: 0 0 8px 0; color: #92400e; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">💬 Message</p>
//                 <p style="margin: 0; color: #78350f; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${customMessage}</p>
//               </div>
//               ` : ''}
              
//               <!-- CTA Button -->
//               ${ctaHTML}
//             </div>
            
//             <!-- Footer -->
//             <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-radius: 0 0 16px 16px; border-top: 1px solid #e2e8f0;">
//               <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 1.5;">
//                 <strong style=
//                 "color: #0f172a;">Note Received</strong><br>
//                 Your note management platform
//               </p>
//             </div>
//           </div>
//         </div>
//       `,
//       ...(resendAttachments.length > 0 && { attachments: resendAttachments })
//     })

//     console.log('✅ Shared note email sent successfully to:', recipientEmail)
//     console.log('📬 Resend Response ID:', result?.id)
//     return result
//   } catch (error) {
//     console.error('❌ Error sending shared note email to', recipientEmail, ':', error)
//     throw new Error(`Failed to send shared note email: ${error.message}`)
//   }
// }








// import { Resend } from 'resend'
// import 'dotenv/config'
// import axios from 'axios'

// // ✅ Validate required environment variables
// ;['RESEND_API_KEY', 'EMAIL_FROM', 'FRONTEND_URL'].forEach((key) => {
//   if (!process.env[key]) throw new Error(`❌ Missing ${key} in environment`)
// })

// // ✅ Create Resend client
// const resend = new Resend(process.env.RESEND_API_KEY)

// // ✅ Helper: Convert attachment URLs to Resend attachment format
// const convertAttachmentsToResend = async (attachments = []) => {
//   const resendAttachments = []
  
//   for (const attachment of attachments) {
//     try {
//       const url = typeof attachment === 'string' ? attachment : (attachment.url || attachment.publicId)
//       const filename = typeof attachment === 'object' ? (attachment.filename || 'attachment.pdf') : 'attachment.pdf'
      
//       if (url) {
//         // Fetch the PDF from the URL
//         const validUrl = url.startsWith('http') ? url : `https://${url}`
//         const response = await axios.get(validUrl, { responseType: 'arraybuffer' })
//         const buffer = Buffer.from(response.data)
        
//         resendAttachments.push({
//           filename: filename,
//           content: buffer.toString('base64'),
//         })
//       }
//     } catch (error) {
//       console.error(`⚠️ Failed to fetch attachment: ${error.message}`)
//       // Continue with other attachments if one fails
//     }
//   }
  
//   return resendAttachments
// }

// // ✅ Get sender info dynamically
// const getFromAddress = (user = {}) => {
//   const senderEmail = process.env.EMAIL_FROM
//   if (user.businessInfo?.businessName?.trim()) {
//     return `${user.businessInfo.businessName} <${senderEmail}>`
//   }
//   return `InboxGuaranteed <${senderEmail}>`
// }

// // ✅ Send confirmation email
// export const sendConfirmationEmail = async (email, token, user = {}) => {
//   const confirmUrl = `${process.env.FRONTEND_URL}/confirm-email/${token}`

//   try {
//     await resend.emails.send({
//       from: getFromAddress(user),
//       to: email,
//       subject: 'Confirm Your Email Address',
//       html: `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//           <h2 style="color: #3b82f6;">Welcome to InboxGuaranteed!</h2>
//           <p>Click below to confirm your email address:</p>
//           <div style="text-align: center; margin: 30px 0;">
//             <a href="${confirmUrl}" style="background-color: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">
//               Confirm Email Address
//             </a>
//           </div>
//           <p>If that doesn't work, copy and paste this URL:</p>
//           <p style="word-break: break-all; color: #666;">${confirmUrl}</p>
//         </div>
//       `,
//     })

//     console.log('📧 Confirmation email sent to:', email)
//   } catch (error) {
//     console.error('❌ Error sending confirmation email:', error)
//     throw new Error('Failed to send confirmation email')
//   }
// }

// // ✅ Send password reset email
// export const sendPasswordResetEmail = async (email, token, user = {}) => {
//   const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${token}`

//   try {
//     await resend.emails.send({
//       from: getFromAddress(user),
//       to: email,
//       subject: 'Reset Your Password',
//       html: `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//           <h2 style="color: #3b82f6;">Password Reset Request</h2>
//           <p>Click below to reset your password:</p>
//           <div style="text-align: center; margin: 30px 0;">
//             <a href="${resetUrl}" style="background-color: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">
//               Reset Password
//             </a>
//           </div>
//           <p>If that doesn't work, copy and paste this URL:</p>
//           <p style="word-break: break-all; color: #666;">${resetUrl}</p>
//         </div>
//       `,
//     })

//     console.log('📧 Password reset email sent to:', email)
//   } catch (error) {
//     console.error('❌ Error sending password reset email:', error)
//     throw new Error('Failed to send password reset email')
//   }
// }

// // ✅ Send invoice email with PDF attachment
// export const sendInvoiceEmail = async (email, invoiceData, pdfBuffer, user = {}) => {
//   try {
//     await resend.emails.send({
//       from: getFromAddress(user),
//       to: email,
//       subject: `Invoice ${invoiceData.invoiceNumber} ${user.businessInfo?.businessName || ''}`,
//       html: `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//           <h2 style="color: #3b82f6;">Invoice from ${user.businessInfo?.businessName || 'InboxGuaranteed'}</h2>
//           <p>Dear ${invoiceData.customerName},</p>
//           <p>Please find attached your invoice.</p>
//           <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
//             <p><strong>Invoice Number:</strong> ${invoiceData.invoiceNumber}</p>
//             <p><strong>Item:</strong> ${invoiceData.itemName}</p>
//             <p><strong>Amount:</strong> ${invoiceData.currency || 'NGN'} ${Number(invoiceData.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
//             <p><strong>Status:</strong> ${invoiceData.status}</p>
//           </div>
//         </div>
//       `,
//       attachments:
//         pdfBuffer instanceof Buffer
//           ? [
//               {
//                 filename: `invoice-${invoiceData.invoiceNumber}.pdf`,
//                 content: pdfBuffer.toString('base64'),
//               },
//             ]
//           : [],
//     })

//     console.log('📧 Invoice email sent to:', email)
//   } catch (error) {
//     console.error('❌ Error sending invoice email:', error)
//     throw new Error('Failed to send invoice email')
//   }
// }

// // ✅ Send generic notification email
// export const sendNotificationEmail = async (email, subject, message, user = {}) => {
//   try {
//     await resend.emails.send({
//       from: getFromAddress(user),
//       to: email,
//       subject,
//       html: `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//           <h2 style="color: #3b82f6;">Marketbook Solution</h2>
//           <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
//             ${message}
//           </div>
//         </div>
//       `,
//     })

//     console.log('📧 Notification email sent to:', email)
//   } catch (error) {
//     console.error('❌ Error sending notification email:', error)
//     throw new Error('Failed to send notification email')
//   }
// }

// // ✅ Send scheduled note reminder email
// export const sendNoteReminderEmail = async (email, userName, noteTitle, noteContent, scheduledDate, scheduledTime, timezone, noteCreatedAt, images = [], video = null, attachments = []) => {
//   try {
//     // Format the note creation date - display ONLY date, no time to avoid timezone confusion
//     const createdAtDate = noteCreatedAt 
//       ? new Date(noteCreatedAt).toLocaleDateString('en-US', { 
//           year: 'numeric', 
//           month: 'short', 
//           day: 'numeric' 
//         })
//       : new Date().toLocaleDateString('en-US', { 
//           year: 'numeric', 
//           month: 'short', 
//           day: 'numeric' 
//         })
    
//     // Build media HTML with proper error handling and fallbacks
//     let mediaHTML = ''
    
//     // Handle images - support both URL strings and image objects
//     if (images && images.length > 0) {
//       mediaHTML += '<div style="margin: 20px 0;">'
//       mediaHTML += '<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">📸 Images:</p>'
      
//       images.forEach((image, index) => {
//         // Support both string URLs and image objects with .url property
//         const imageUrl = typeof image === 'string' ? image : (image.url || image.publicId)
        
//         if (imageUrl) {
//           // Ensure the image URL is valid and properly formatted
//           const validUrl = imageUrl.startsWith('http') ? imageUrl : `https://${imageUrl}`
          
//           mediaHTML += `<div style="margin-bottom: 15px;">`
//           mediaHTML += `<img src="${validUrl}" alt="Note image ${index + 1}" style="max-width: 100%; height: auto; border-radius: 8px; display: block; margin: 10px 0; max-height: 400px; border: 1px solid #ddd;" />`
//           mediaHTML += `</div>`
//         }
//       })
      
//       mediaHTML += '</div>'
//     }
    
//     // Handle videos - support both single video objects and arrays
//     if (video) {
//       const videos = Array.isArray(video) ? video : (video ? [video] : [])
      
//       if (videos.length > 0) {
//         mediaHTML += '<div style="margin: 20px 0;">'
//         mediaHTML += `<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">🎥 Video${videos.length > 1 ? 's' : ''}:</p>`
        
//         videos.forEach((vid, index) => {
//           // Support both string URLs and video objects
//           const videoUrl = typeof vid === 'string' ? vid : (vid.url || vid.publicId)
//           const thumbnailUrl = typeof vid === 'object' ? vid.thumbnail : null
          
//           if (videoUrl) {
//             const validVideoUrl = videoUrl.startsWith('http') ? videoUrl : `https://${videoUrl}`
            
//             mediaHTML += `<div style="margin-bottom: 20px; background-color: #f5f5f5; padding: 15px; border-radius: 8px;">`
//             mediaHTML += `<p style="color: #555; font-weight: bold; font-size: 13px; margin: 0 0 10px 0;">Video ${index + 1}</p>`
            
//             // If thumbnail available, show it
//             if (thumbnailUrl) {
//               const validThumbUrl = thumbnailUrl.startsWith('http') ? thumbnailUrl : `https://${thumbnailUrl}`
//               mediaHTML += `<div style="margin-bottom: 12px;">`
//               mediaHTML += `<img src="${validThumbUrl}" alt="Video ${index + 1} thumbnail" style="max-width: 100%; height: auto; border-radius: 6px; display: block; max-height: 300px; border: 1px solid #ddd;" />`
//               mediaHTML += `</div>`
//             }
            
//             // Add watch button with proper styling
//             mediaHTML += `<a href="${validVideoUrl}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; text-align: center; transition: background-color 0.3s;" onmouseover="this.style.backgroundColor='#2563eb'" onmouseout="this.style.backgroundColor='#3b82f6'">▶️ Watch Video ${index + 1}</a>`
            
//             mediaHTML += `</div>`
//           }
//         })
        
//         mediaHTML += '</div>'
//       }
//     }
    
//     // Handle attachments (PDFs)
//     if (attachments && attachments.length > 0) {
//       mediaHTML += '<div style="margin: 20px 0;">'
//       mediaHTML += '<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">📎 Attachments:</p>'
      
//       attachments.forEach((attachment, index) => {
//         const filename = typeof attachment === 'object' ? (attachment.filename || `Attachment ${index + 1}`) : `Attachment ${index + 1}`
//         mediaHTML += `<p style="margin: 5px 0; color: #555; font-size: 13px;">📄 ${filename}</p>`
//       })
      
//       mediaHTML += '</div>'
//     }
    
//     // Convert attachments for Resend
//     const resendAttachments = await convertAttachmentsToResend(attachments)
    
//     const result = await resend.emails.send({
//       from: process.env.EMAIL_FROM,
//       to: email,
//       subject: `📝 Reminder: Your Scheduled Note - "${noteTitle}"`,
//       html: `
//         <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
//           <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
//             <h2 style="color: white; margin: 0; font-size: 24px;">📝 Note Reminder</h2>
//           </div>
          
//           <div style="padding: 30px; background-color: #ffffff;">
//             <p style="margin-top: 0; font-size: 16px; color: #333;">Hi ${userName},</p>
            
//             <p style="font-size: 15px; color: #555; margin: 15px 0;">Your scheduled note is ready for review:</p>
            
//             <div style="background-color: #f8f9fa; padding: 25px; border-radius: 10px; margin: 25px 0; border-left: 5px solid #3b82f6;">
//               <h3 style="margin-top: 0; color: #1e40af; font-size: 18px; word-break: break-word;">${noteTitle}</h3>
//               <div style="color: #333; margin: 15px 0; line-height: 1.6; font-size: 14px; white-space: pre-wrap; word-break: break-word; background-color: white; padding: 12px; border-radius: 6px; border: 1px solid #e0e0e0;">${noteContent || '(No content)'}</div>
//               ${mediaHTML}
//               <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
//               <p style="margin: 0; color: #666; font-size: 12px;">Note created on ${createdAtDate}</p>
//             </div>
            
//             <div style="background-color: #eff6ff; padding: 20px; border-radius: 10px; margin: 25px 0; border-left: 5px solid #0ea5e9;">
//               <p style="margin: 0; color: #0c4a6e; font-size: 14px; line-height: 1.8;">
//                 <strong style="font-size: 15px;">📅 Scheduled Date:</strong> ${scheduledDate}<br>
//                 <strong style="font-size: 15px;">⏰ Scheduled Time:</strong> ${scheduledTime || '00:00'}<br>
//                 <strong style="font-size: 15px;">🌍 Timezone:</strong> ${timezone}
//               </p>
//             </div>
            
//             <div style="background-color: #f0fdf4; padding: 20px; border-radius: 10px; margin: 25px 0; border-left: 5px solid #22c55e;">
//               <p style="margin: 0; color: #166534; font-size: 13px; line-height: 1.6;">
//                 ✅ This reminder was sent on the scheduled date and time in your timezone.
//               </p>
//             </div>
            
//             <p style="color: #666; font-size: 14px; margin: 20px 0;">
//               You can view and manage all your notes in your Marketbook dashboard.
//             </p>
//           </div>
          
//           <div style="background-color: #f5f5f5; padding: 20px; border-radius: 0 0 12px 12px; text-align: center; border-top: 1px solid #e0e0e0;">
//             <p style="color: #999; font-size: 12px; margin: 0;">
//               This is an automated reminder from InboxGuaranteed. If you did not set this reminder, please contact support.
//             </p>
//           </div>
//         </div>
//       `,
//       ...(resendAttachments.length > 0 && { attachments: resendAttachments })
//     })

//     console.log('✅ Note reminder email sent successfully to:', email)
//     console.log('📬 Resend Response ID:', result?.id)
//     return result
//   } catch (error) {
//     console.error('❌ Error sending note reminder email to', email, ':', error)
//     throw new Error(`Failed to send note reminder email: ${error.message}`)
//   }
// }

// // ✅ Send shared note email
// export const sendSharedNoteEmail = async (recipientEmail, senderName, noteTitle, noteContent, customMessage, user = {}, timezone = 'UTC', subject = 'Shared Note', images = [], video = null, allRecipients = [], attachments = [], fromEmail = null, callToActionText = null, callLink = null) => {
//   try {
//     // Build media HTML with proper error handling and fallbacks
//     let mediaHTML = ''
    
//     // Handle images - support both URL strings and image objects
//     if (images && images.length > 0) {
//       mediaHTML += '<div style="margin: 20px 0;">'
//       mediaHTML += '<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">📸 Images:</p>'
      
//       images.forEach((image, index) => {
//         // Support both string URLs and image objects with .url property
//         const imageUrl = typeof image === 'string' ? image : (image.url || image.publicId)
        
//         if (imageUrl) {
//           // Ensure the image URL is valid and properly formatted
//           const validUrl = imageUrl.startsWith('http') ? imageUrl : `https://${imageUrl}`
          
//           mediaHTML += `<div style="margin-bottom: 15px;">`
//           mediaHTML += `<img src="${validUrl}" alt="Note image ${index + 1}" style="max-width: 100%; height: auto; border-radius: 8px; display: block; margin: 10px 0; max-height: 400px; border: 1px solid #ddd;" />`
//           mediaHTML += `</div>`
//         }
//       })
      
//       mediaHTML += '</div>'
//     }
    
//     // Handle videos - support both single video objects and arrays
//     if (video) {
//       const videos = Array.isArray(video) ? video : (video ? [video] : [])
      
//       if (videos.length > 0) {
//         mediaHTML += '<div style="margin: 20px 0;">'
//         mediaHTML += `<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">🎥 Video${videos.length > 1 ? 's' : ''}:</p>`
        
//         videos.forEach((vid, index) => {
//           // Support both string URLs and video objects
//           const videoUrl = typeof vid === 'string' ? vid : (vid.url || vid.publicId)
//           const thumbnailUrl = typeof vid === 'object' ? vid.thumbnail : null
          
//           if (videoUrl) {
//             const validVideoUrl = videoUrl.startsWith('http') ? videoUrl : `https://${videoUrl}`
            
//             mediaHTML += `<div style="margin-bottom: 20px; background-color: #f5f5f5; padding: 15px; border-radius: 8px;">`
//             mediaHTML += `<p style="color: #555; font-weight: bold; font-size: 13px; margin: 0 0 10px 0;">Video ${index + 1}</p>`
            
//             // If thumbnail available, show it
//             if (thumbnailUrl) {
//               const validThumbUrl = thumbnailUrl.startsWith('http') ? thumbnailUrl : `https://${thumbnailUrl}`
//               mediaHTML += `<div style="margin-bottom: 12px;">`
//               mediaHTML += `<img src="${validThumbUrl}" alt="Video ${index + 1} thumbnail" style="max-width: 100%; height: auto; border-radius: 6px; display: block; max-height: 300px; border: 1px solid #ddd;" />`
//               mediaHTML += `</div>`
//             }
            
//             // Add watch button with proper styling
//             mediaHTML += `<a href="${validVideoUrl}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; text-align: center; transition: background-color 0.3s;" onmouseover="this.style.backgroundColor='#2563eb'" onmouseout="this.style.backgroundColor='#3b82f6'">▶️ Watch Video ${index + 1}</a>`
            
//             mediaHTML += `</div>`
//           }
//         })
        
//         mediaHTML += '</div>'
//       }
//     }
    
//     // Handle attachments (PDFs)
//     if (attachments && attachments.length > 0) {
//       mediaHTML += '<div style="margin: 20px 0;">'
//       mediaHTML += '<p style="color: #333; font-weight: bold; margin-bottom: 15px; font-size: 14px;">📎 Attachments:</p>'
      
//       attachments.forEach((attachment, index) => {
//         const filename = typeof attachment === 'object' ? (attachment.filename || `Attachment ${index + 1}`) : `Attachment ${index + 1}`
//         mediaHTML += `<p style="margin: 5px 0; color: #555; font-size: 13px;">📄 ${filename}</p>`
//       })
      
//       mediaHTML += '</div>'
//     }
    
//     // Convert attachments for Resend
//     const resendAttachments = await convertAttachmentsToResend(attachments)
    
//     // Build recipients list HTML - REMOVED: Don't show recipients in email
    
//     const emailFrom = fromEmail || process.env.EMAIL_FROM
//     const fromAddress = `${senderName} <${emailFrom}>`
    
//     // Build CTA button HTML if provided
//     let ctaHTML = ''
//     if (callToActionText && callLink) {
//       ctaHTML = `
//         <div style="text-align: center; margin: 30px 0;">
//           <a href="${callLink}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; transition: transform 0.3s, box-shadow 0.3s;" onmouseover="this.style.transform='scale(1.05)'; this.style.boxShadow='0 10px 20px rgba(102, 126, 234, 0.3)'" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='none'">
//             ${callToActionText}
//           </a>
//         </div>
//       `
//     }
    
//     const result = await resend.emails.send({
//       from: fromAddress,
//       to: recipientEmail,
//       subject: `📝 ${senderName} shared a note with you: "${noteTitle}"`,
//       ...(emailFrom !== displayEmail && { replyTo: emailFrom }),
//       html: `
//         <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; padding: 20px 0;">
//           <div style="max-width: 600px; margin: 0 auto;">
//             <!-- Header -->
//             <div style="background: linear-gradient(135deg, #ea66c0 0%, #764ba2 100%); padding: 40px 30px; text-align: center; border-radius: 16px 16px 0 0;">
//               <div style="background-color: rgba(255,255,255,0.15); width: 56px; height: 56px; border-radius: 12px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
//                 <span style="font-size: 28px;">📝</span>
//               </div>
//               <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 600;">Note Shared with You</h1>
//               <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px;">from <strong>${senderName}</strong></p>
//             </div>
            
//             <!-- Main Content -->
//             <div style="background-color: #ffffff; padding: 40px 30px;">
//               <!-- Greeting -->
//               <p style="margin: 0 0 24px 0; font-size: 16px; color: #1e293b; line-height: 1.5;">Hi there,</p>
              
//               <!-- Note Content Card -->
//               <div style="background-color: #f1f5f9; border-left: 4px solid #667eea; padding: 24px; border-radius: 8px; margin: 24px 0;">
//                 <h2 style="margin: 0 0 16px 0; color: #0f172a; font-size: 20px; font-weight: 600; word-break: break-word;">${noteTitle}</h2>
//                 <div style="background-color: #ffffff; padding: 16px; border-radius: 6px; color: #334155; font-size: 15px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;">${noteContent || '(No content)'}</div>
//                 ${mediaHTML}
//               </div>
              
//               <!-- Personal Message -->
//               ${customMessage ? `
//               <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 24px 0;">
//                 <p style="margin: 0 0 8px 0; color: #92400e; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">💬 Message</p>
//                 <p style="margin: 0; color: #78350f; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${customMessage}</p>
//               </div>
//               ` : ''}
              
//               <!-- CTA Button -->
//               ${ctaHTML}
//             </div>
            
//             <!-- Footer -->
//             <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-radius: 0 0 16px 16px; border-top: 1px solid #e2e8f0;">
//               <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 1.5;">
//                 <strong style=
//                 "color: #0f172a;">Note Received</strong><br>
//                 Your note management platform
//               </p>
//             </div>
//           </div>
//         </div>
//       `,
//       ...(resendAttachments.length > 0 && { attachments: resendAttachments })
//     })

//     console.log('✅ Shared note email sent successfully to:', recipientEmail)
//     console.log('📬 Resend Response ID:', result?.id)
//     return result
//   } catch (error) {
//     console.error('❌ Error sending shared note email to', recipientEmail, ':', error)
//     throw new Error(`Failed to send shared note email: ${error.message}`)
//   }
// }












