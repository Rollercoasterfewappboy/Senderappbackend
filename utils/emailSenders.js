
/*
 * SENDERS UTILS - EMAIL
 * --------------------------------------------------
 * This module accepts raw HTML from callers and forwards it directly to the
 * chosen email provider.  Strict rules:
 *   * HTML must NOT be escaped or sanitized here.
 *   * The html parameter is treated as fully-formed and will be logged.
 *   * Always send as multipart/alternative (see sendEmailWithProvider logic).
 *   * Inline CSS should be preserved intact; callers must avoid broken <a> tags.
 *   * Any sanitization helpers now return input unchanged with a warning.
 */

import nodemailer from 'nodemailer';
import axios from 'axios';
import fs from 'fs';
import { htmlToPlainText } from './htmlToPlainText.js';

// Helper to inject CTA button into HTML
function injectCtaIntoHtml(htmlContent, ctaText, ctaLink) {
  if (!ctaText || !ctaLink) {
    return htmlContent;
  }
  
  // Create styled CTA button HTML
  const ctaHtml = `
    <div style="margin-top: 24px; text-align: center;">
      <a href="${ctaLink}" style="display: inline-block; padding: 12px 32px; background-color: #0066cc; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">${ctaText}</a>
    </div>
  `;
  
  // Inject before closing body tag
  if (htmlContent && htmlContent.includes('</body>')) {
    return htmlContent.replace('</body>', `${ctaHtml}</body>`);
  }
  
  // If no body tag, just append
  return htmlContent + ctaHtml;
}

// Helper to add CTA to plain text
function addCtaToPlainText(plainText, ctaText, ctaLink) {
  if (!ctaText || !ctaLink) {
    return plainText;
  }
  
  return `${plainText}\n\n---\n${ctaText}\n${ctaLink}`;
}

// Small helper to check if content is HTML
function isHtmlContent(str) {
  if (!str || typeof str !== 'string') return false;
  return /<[^>]+>/g.test(str);
}

// Small helper to decode common HTML entities (undo accidental escaping)
export function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#039;/g, "'");
}

// Utility for trimming/minifying HTML so transport encodings don't break tags
export function minifyHtml(html) {
  if (typeof html !== 'string') return html;
  return html.replace(/\r?\n/g, ' ')
             .replace(/\s{2,}/g, ' ')
             .trim();
}

// Insert invisible breakpoints every ~72 characters so quoted-printable
// encoders (like Resend's) will have safe places to wrap lines without
// splitting inside words or style attributes. The zero-width space
// character (U+200B) is invisible in HTML and harmless.
export function addSafeBreaks(html) {
  if (typeof html !== 'string') return html;
  const CHUNK = 72;
  let out = '';
  let buffer = '';
  let inTag = false;
  let inEntity = false;

  function flushBuffer() {
    if (buffer.length === 0) return;
    // insert zero-width spaces every CHUNK characters
    for (let i = 0; i < buffer.length; i += CHUNK) {
      out += buffer.slice(i, i + CHUNK);
      if (i + CHUNK < buffer.length) out += '\u200B';
    }
    buffer = '';
  }

  for (let i = 0; i < html.length; i++) {
    const ch = html[i];

    if (!inEntity && ch === '<') {
      // entering tag: flush any buffered text first
      flushBuffer();
      inTag = true;
      out += ch;
      continue;
    }

    if (inTag) {
      out += ch;
      if (ch === '>') inTag = false;
      continue;
    }

    // outside tags
    if (!inEntity && ch === '&') {
      // start of an entity - flush buffered text first
      flushBuffer();
      inEntity = true;
      out += ch;
      continue;
    }

    if (inEntity) {
      out += ch;
      if (ch === ';') inEntity = false;
      continue;
    }

    // normal text outside tags/entities - buffer it
    buffer += ch;
    if (buffer.length >= CHUNK) {
      // flush chunk with a zero-width space appended
      out += buffer.slice(0, CHUNK) + '\u200B';
      buffer = buffer.slice(CHUNK);
    }
  }

  // flush remaining
  flushBuffer();
  return out;
}

// ✅ CRITICAL: Validate HTML integrity before sending to prevent corruption
function validateHtmlIntegrity(htmlContent) {
  if (!htmlContent || typeof htmlContent !== 'string') return false;

  // decode any escaped entities so we inspect the true markup
  const decoded = decodeHtmlEntities(htmlContent);

  // Check for critical HTML structure
  const hasDoctype = decoded.includes('<!DOCTYPE');

  // EXTRA VALIDATION: newline inside style attribute may indicate broken tag
  const hasStyleNewline = /style=\s*['"][^'"]*\n/.test(decoded);
  if (hasStyleNewline) {
    console.warn('[validateHtmlIntegrity] ⚠️ Style attribute contains newline - this can break rendering');
  }
  const hasHtmlTag = decoded.includes('<html');
  const hasBodyTag = decoded.includes('<body');

  // Check for common corrupted patterns
  // Pattern 1: content= being corrupted to c"
  const hasCorruptedContent = /(?:^|[>\s])c\s*["']\w+=/i.test(decoded);
  
  // Pattern 2: Multiple meta tags should have proper content= pattern
  const metaTags = htmlContent.match(/<meta[^>]*>/gi) || [];
  const properContentPatterns = metaTags.filter(tag => /content\s*=\s*["']/i.test(tag)).length;
  const hasViewport = metaTags.some(tag => /viewport/i.test(tag));
  
  const checks = {
    has_doctype: hasDoctype,
    has_html_tag: hasHtmlTag,
    has_body_tag: hasBodyTag,
    meta_tags_found: metaTags.length,
    meta_with_proper_content: properContentPatterns,
    has_viewport: hasViewport,
    corrupted_content_attr: hasCorruptedContent,
  };
  
  console.log('[validateHtmlIntegrity] HTML Structure Check:', checks);
  
  // CRITICAL FAILURE: Detect corrupted content attributes
  if (hasCorruptedContent) {
    console.error('[validateHtmlIntegrity] ❌ CRITICAL: Corrupted content attribute pattern detected! c"... found!');
    console.error('[validateHtmlIntegrity] This indicates HTML has been damaged by unsafe string replacement');
    return false;
  }
  
  // WARNING: If we have viewport meta but proper content= pattern not found
  if (hasViewport && properContentPatterns === 0) {
    console.warn('[validateHtmlIntegrity] ⚠️  WARNING: Viewport meta tag detected but content= not properly formatted!');
  }
  
  return true;
}

export async function sendEmailWithProvider({ providerDoc, to, bcc, subject, body, bodyPlainText, ctaText, ctaLink, replyTo, fromName, fromEmail, attachments }) {
  try {
    console.log('\n\n⚠️⚠️⚠️ [emailSenders] sendEmailWithProvider() CALLED ⚠️⚠️⚠️');
    console.log('[emailSenders] Subject:', subject);
    console.log('[emailSenders] Recipients - To:', to, 'BCC:', bcc);
    console.log('[emailSenders] HTML Body Details:', {
      length: body?.length || 0,
      hasDoctype: body?.includes('<!DOCTYPE') ? 'YES' : 'NO',
      hasHtmlTag: body?.includes('<html') ? 'YES' : 'NO',
      hasBodyTag: body?.includes('<body') ? 'YES' : 'NO',
      preview: body?.substring(0, 300) || 'EMPTY',
    });
    console.log('[emailSenders] Plain Text Details:', {
      bodyPlainText: bodyPlainText?.substring(0, 100) || 'NOT PROVIDED',
      type: typeof bodyPlainText,
      length: bodyPlainText?.length || 0,
    });
    console.log('[emailSenders] CTA:', { ctaText: ctaText?.substring(0, 50) || 'NOT SET', ctaLink: ctaLink?.substring(0, 50) || 'NOT SET' });
    
    // ✅ CRITICAL: Validate HTML integrity before proceeding
    const htmlIsValid = validateHtmlIntegrity(body);
    if (!htmlIsValid) {
      throw new Error('HTML content validation failed - content may be corrupted');
    }
    console.log('✅ HTML integrity check passed');
    console.log('⚠️⚠️⚠️ END FUNCTION ENTRY CHECK ⚠️⚠️⚠️\n');
    
    // Validate recipients
    if ((!to || to.length === 0) && (!bcc || bcc.length === 0)) {
      throw new Error('No recipients provided (To and BCC are both empty)');
    }

    // Determine the 'from' field logic
    let fromField = '';
    if (fromName && fromEmail) {
      fromField = `${fromName} <${fromEmail}>`;
    } else if (fromEmail) {
      fromField = fromEmail;
    } else {
      throw new Error('No From email address configured');
    }

    // Multipart/alternative mode: use provided plain text or auto-generate from HTML
    // Decode any HTML entities that may have been introduced earlier
    let rawBody = typeof body === 'string' ? decodeHtmlEntities(body) : body;
    
    // ✅ CRITICAL: If user provided plain text, USE IT (but check if it's actually HTML)
    let plainText = bodyPlainText ? bodyPlainText : (htmlToPlainText(rawBody) || '');
    let htmlContent = rawBody;
    
    // 🔧 MINIFY HTML: remove newlines and collapse multiple spaces to avoid mail
    // clients (and transport encodings like quoted-printable) inserting breaks
    // inside long attributes which turn into visible text.
    if (typeof htmlContent === 'string') {
      htmlContent = htmlContent.replace(/\r?\n/g, ' ')
                               .replace(/\s{2,}/g, ' ')
                               .trim();
      console.log('[emailSenders] 🔧 HTML minified to prevent line-break corruption, length now', htmlContent.length);
    }

    // 🔧 Add safe invisible breakpoints so providers that use quoted-printable
    // encoding will wrap at these positions rather than mid-word/style.
    if (typeof htmlContent === 'string') {
      const before = htmlContent;
      htmlContent = addSafeBreaks(htmlContent);
      if (before !== htmlContent) {
        console.log('[emailSenders] 🔧 inserted safe breakpoints into HTML');
      }
    }
    
    // 🔥 CRITICAL FIX: If plainText contains HTML tags, it's not actually plain text!
    // This happens when user doesn't provide plain text field and the auto-generation failed
    // or when HTML is accidentally sent as plain text from frontend

    // === TEST MODE / DUMMY PROVIDER ===
    // When running unit tests we may call this function with a fake provider
    // named "dummy".  Instead of sending any network request we simply return
    // the prepared payload so tests can assert on it.  This keeps tests fast
    // and avoids touching real email providers.
    if (providerDoc && providerDoc.provider === 'dummy') {
      console.log('[emailSenders] TEST MODE - returning payload without sending');
      return { success: true, htmlContent, plainText, attachments: attachments || [], provider: providerDoc.provider };
    }

    // 🔥 CRITICAL FIX: If plainText contains HTML tags, it's not actually plain text!
    // This happens when user doesn't provide plain text field and the auto-generation failed
    // or when HTML is accidentally sent as plain text from frontend
    console.log(`[emailSenders] 🔥 CHECKING if plainText is actually HTML:`, {
      plainTextLength: plainText?.length || 0,
      containsHtmlTags: isHtmlContent(plainText) ? 'YES - WILL CONVERT' : 'NO - OK',
      preview: plainText?.substring(0, 100) || 'EMPTY',
    });
    
    if (plainText && isHtmlContent(plainText)) {
      console.log(`[emailSenders] 🔥 CONVERTING HTML plainText to actual plain text...`);
      plainText = htmlToPlainText(plainText);
      console.log(`[emailSenders] 🔥 After conversion:`, {
        plainTextLength: plainText?.length || 0,
        preview: plainText?.substring(0, 100) || 'EMPTY',
      });
    }
    
    console.log(`[emailSenders] ⚠️  CRITICAL - Input received:`, {
      bodyParameterValue: bodyPlainText?.substring(0, 100) || 'NOT PROVIDED',
      bodyParameterLength: bodyPlainText?.length || 0,
      htmlBodyValue: htmlContent?.substring(0, 100) || 'EMPTY',
      htmlBodyLength: htmlContent?.length || 0,
    });
    
    // ✅ INJECT CTA INTO EMAIL BODY
    if (ctaText && ctaLink) {
      console.log(`[emailSenders] Injecting CTA into HTML and plain text...`);
      htmlContent = injectCtaIntoHtml(htmlContent, ctaText, ctaLink);
      plainText = addCtaToPlainText(plainText, ctaText, ctaLink);
    }
    
    console.log(`[emailSenders] Multipart/alternative mode: HTML + Plain Text`);
    // ✅ FINAL SAFETY: Ensure we always have plain text content to send
    console.log(`[emailSenders] Before final safety check:`, {
      plainTextLength: plainText?.length || 0,
      plainTextTrimmedLength: plainText?.trim().length || 0,
      plainTextValue: plainText?.substring(0, 150) || 'EMPTY',
    });
    
    if (!plainText || plainText.trim().length === 0) {
      plainText = htmlToPlainText(htmlContent) || 'Email sent';
    }
    
    // 🔧 DIAGNOSTIC BEFORE CLEANUP
    const beforeCleanup = plainText;
    const beforeLines = plainText.split('\n');
    const blankLineCount = beforeLines.filter(line => line.trim().length === 0).length;
    console.log(`[emailSenders] 🔧 BEFORE CLEANUP:`, {
      totalLength: beforeCleanup.length,
      totalLines: beforeLines.length,
      blankLines: blankLineCount,
      consecutiveNewlines_count: (beforeCleanup.match(/\n\n+/g) || []).length,
      preview: beforeCleanup.substring(0, 100),
    });
    
    // ✅ CRITICAL: Clean up excessive whitespace in plain text before sending
    // Removes multiple blank lines and normalizes formatting
    plainText = plainText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)  // Remove blank lines
      .join('\n\n');  // Join with double newlines for readability
    
    // Max 2 consecutive newlines
    plainText = plainText.replace(/\n\n\n+/g, '\n\n').trim();
    
    // 🔧 DIAGNOSTIC AFTER CLEANUP
    const afterCleanup = plainText;
    const afterLines = afterCleanup.split('\n');
    console.log(`[emailSenders] 🔧 AFTER CLEANUP:`, {
      totalLength: afterCleanup.length,
      totalLines: afterLines.length,
      blankLines: (afterLines.filter(line => line.trim().length === 0).length),
      reduction_chars: (beforeCleanup.length - afterCleanup.length),
      preview: afterCleanup.substring(0, 100),
    });
    
    // 🔥 FINAL FIX: Double-check that plainText is NOT HTML
    if (plainText && isHtmlContent(plainText)) {
      console.log(`[emailSenders] 🔥 FINAL CHECK: plainText still contains HTML! Converting again...`);
      plainText = htmlToPlainText(plainText);
    }
    
    console.log(`[emailSenders] ⚠️  FINAL plain text to be sent:`, {
      plainTextLength: plainText?.length || 0,
      plainTextPreview: plainText?.substring(0, 150) || 'EMPTY',
      isPlainText: !isHtmlContent(plainText) ? 'YES (GOOD)' : 'NO (STILL HAS HTML)',
      willBeSent: plainText && plainText.length > 0 ? 'YES' : 'NO',
    });
    console.log(`[emailSenders] Recipients - To: ${JSON.stringify(to)}, BCC: ${JSON.stringify(bcc)}`);
    console.log(`[emailSenders] HTML preview (first 160): ${String(htmlContent || '').substring(0, 160)}...`);
    console.log(`[emailSenders] HTML contains angle-brackets? ${/<[^>]+>/.test(String(htmlContent || ''))}`);
    console.log(`[emailSenders] HTML contains CTA? ${htmlContent?.includes(ctaText) || htmlContent?.includes(ctaLink) ? 'YES' : 'NO'}`);
    console.log(`[emailSenders] Plain text preview: ${plainText?.substring(0, 100)}...`);
    console.log(`[emailSenders] Plain text length: ${plainText?.length || 0} chars`);
    console.log(`[emailSenders] Plain text contains CTA? ${plainText?.includes(ctaText) || plainText?.includes(ctaLink) ? 'YES' : 'NO'}`);
    console.log(`[emailSenders] Plain text was ${bodyPlainText ? 'PROVIDED' : 'AUTO-GENERATED'}`);
    console.log(`[emailSenders] CTA Text: ${ctaText ? 'YES - ' + ctaText.substring(0, 100) : 'Not provided'}`);
    console.log(`[emailSenders] CTA Link: ${ctaLink ? 'YES - ' + ctaLink.substring(0, 100) : 'Not provided'}`);
    console.log(`[emailSenders] From: ${fromField}`);
    console.log(`[emailSenders] Subject: ${subject}`);

    if (providerDoc.provider === 'smtp') {
      if (!providerDoc.smtp?.host) {
        throw new Error('SMTP host not configured');
      }
      // Authentication is required by default, but can be disabled for Port 25 direct relay
      // Accept boolean, numeric, and string representations stored in DB
      const requireAuth = !(providerDoc.smtp?.requireAuth === false || providerDoc.smtp?.requireAuth === 'false' || providerDoc.smtp?.requireAuth === '0' || providerDoc.smtp?.requireAuth === 0);
      
      if (requireAuth) {
        if (!providerDoc.smtp?.username) {
          throw new Error('SMTP username not configured');
        }
        if (!providerDoc.smtp?.password) {
          throw new Error('SMTP password not configured');
        }
        console.log(`[emailSenders] SMTP Mode: Authenticated (${providerDoc.smtp.host}:${providerDoc.smtp.port})`);
      } else {
        console.warn(`[emailSenders] ⚠️ UNAUTHENTICATED SMTP MODE - Relies on IP-based authentication`);
        console.warn(`[emailSenders] Target: ${providerDoc.smtp.host}:${providerDoc.smtp.port}`);
      }

      // Build transport config with explicit timeouts (match settings/test)
      const transportConfig = {
        host: providerDoc.smtp.host,
        port: Number(providerDoc.smtp.port || 587),
        logger: false,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 15000,
      };

      // Handle encryption settings
      const encryption = providerDoc.smtp?.encryption || 'ssl';
      if (encryption === 'ssl') {
        transportConfig.secure = true;
      } else if (encryption === 'tls') {
        transportConfig.secure = false;
        transportConfig.requireTLS = true;
        transportConfig.tls = { ciphers: 'SSLv3' };
      } else if (encryption === 'none') {
        transportConfig.secure = false;
        // No TLS - direct connection for Port 25
      }

      // Add authentication only if required
      if (requireAuth) {
        transportConfig.auth = {
          user: providerDoc.smtp.username,
          pass: providerDoc.smtp.password,
        };
      }

      const transporter = nodemailer.createTransport(transportConfig);
      
      // Workaround: some SMTP servers reject/timeout when `to` is empty even if bcc present.
      // ensure at least one recipient appears in `to` when using only BCC.
      let toField = to || [];
      let bccField = bcc || [];
      if ((!toField || toField.length === 0) && bccField && bccField.length > 0) {
        // move first BCC into To to keep server happy
        toField = [bccField[0]];
      }

      const mailOptions = {
        from: fromField,
        to: toField,
        bcc: bccField,
        subject,
        replyTo,
        attachments,
        text: plainText,
        html: htmlContent,
        // ✅ CRITICAL: Ensure Nodemailer sends proper multipart/alternative format
        // These headers ensure the email is sent as multipart/alternative with both text and html parts
        headers: {
          'X-Priority': '3',
          'X-Mailer': 'MarketBookSolution-Sender',
        },
        // ✅ CRITICAL: Explicitly set MIME type options for UTF-8 encoding
        textEncoding: 'utf8',
        htmlEncoding: 'utf8',
        // ✅ CRITICAL: Tell Nodemailer to treat this as a multipart email
        // Nodemailer automatically creates multipart/alternative when both text and html are provided
        alternative: true,
      };
      
      console.log(`[SMTP] Preparing to send - mailOptions:`, {
        from: mailOptions.from,
        to: mailOptions.to,
        bcc: mailOptions.bcc,
        subject: mailOptions.subject,
        htmlLength: htmlContent?.length || 0,
        textLength: plainText?.length || 0,
        attachmentCount: attachments?.length || 0,
      });
      console.log(`[SMTP] ⚠️  SENDING - Plain text field:`, {
        value: plainText?.substring(0, 200),
        length: plainText?.length,
      });
      console.log(`[SMTP] Sending multipart/alternative email (HTML + Plain Text)`);
      
      const sendResult = await transporter.sendMail(mailOptions);
      console.log(`[SMTP] Email sent successfully - Result:`, sendResult);
      return { success: true };
    } else if (providerDoc.provider === 'aws') {
      if (!providerDoc.smtp?.host) {
        throw new Error('SMTP host not configured for AWS');
      }
      if (!providerDoc.smtp?.username) {
        throw new Error('SMTP username not configured for AWS');
      }
      if (!providerDoc.smtp?.password) {
        throw new Error('SMTP password not configured for AWS');
      }

      const transporter = nodemailer.createTransport({
        host: providerDoc.smtp.host,
        port: Number(providerDoc.smtp.port || 587),
        secure: providerDoc.smtp?.encryption === 'ssl',
        auth: {
          user: providerDoc.smtp.username,
          pass: providerDoc.smtp.password,
        },
        tls: providerDoc.smtp?.encryption === 'tls' ? { ciphers: 'SSLv3' } : undefined,
        logger: false,
      });
      
      const mailOptions = {
        from: fromField,
        to: to || [],
        bcc: bcc || [],
        subject,
        replyTo,
        attachments,
        text: plainText,
        html: htmlContent,
        // ✅ CRITICAL: Ensure Nodemailer sends proper multipart/alternative format
        headers: {
          'X-Priority': '3',
          'X-Mailer': 'MarketBookSolution-Sender',
        },
        // ✅ CRITICAL: Explicitly set MIME type options for UTF-8 encoding
        textEncoding: 'utf8',
        htmlEncoding: 'utf8',
        alternative: true,
      };
      
      console.log(`[AWS SES] Preparing to send - mailOptions:`, {
        from: mailOptions.from,
        to: mailOptions.to,
        bcc: mailOptions.bcc,
        subject: mailOptions.subject,
        htmlLength: htmlContent?.length || 0,
        textLength: plainText?.length || 0,
        attachmentCount: attachments?.length || 0,
      });
      console.log(`[AWS SES] ⚠️  SENDING - Plain text field:`, {
        value: plainText?.substring(0, 200),
        length: plainText?.length,
      });
      console.log(`[AWS SES] Sending multipart/alternative email (HTML + Plain Text)`);
      
      const sendResult = await transporter.sendMail(mailOptions);
      console.log(`[AWS SES] Email sent successfully - Result:`, sendResult);
      return { success: true };
    } else if (providerDoc.provider === 'resend') {
      const apiKey = providerDoc.resend?.apiKey;
      if (!apiKey) throw new Error('Resend API key not configured');

      // Resend requires a non-empty `to` field. If we're sending only to BCC recipients
      // (per-recipient loop may supply to=[] and bcc=[recipient]), move the recipient
      // into `to` so Resend accepts the request. Keep original bcc when `to` is provided.
      const resendTo = (to && Array.isArray(to) && to.length > 0) ? to : ((bcc && Array.isArray(bcc) && bcc.length > 0) ? [bcc[0]] : []);
      const resendBcc = (to && Array.isArray(to) && to.length > 0) ? (bcc || []) : [];

      // Build Resend-specific payload
      const resendPayload = {
        from: fromField,
        to: resendTo,
        bcc: resendBcc,
        subject,
        reply_to: replyTo,
        // we intentionally include the text field only when absolutely
        // required; some clients/renderers treat the message as plain text
        // if the payload contains a text part, so omit it for Resend to be
        // safe and force HTML rendering.  (plainText is still generated
        // earlier for diagnostics and fallback in other providers.)
        html: htmlContent,
        // include explicit headers to force correct interpretation
        headers: {
          'Content-Type': 'text/html; charset=UTF-8',
          'Content-Transfer-Encoding': 'quoted-printable',
        },
      };

      // For Resend we drop the `text` field entirely unless the caller
      // explicitly wants only plain text (not our case).  This avoids any
      // chance the provider will deliver the text part as the primary body.
      if (plainText && providerDoc.provider !== 'resend') {
        resendPayload.text = plainText;
      }

      // Some Resend accounts/platforms may respect html_base64; include for
      // robustness though it's not documented.
      try {
        resendPayload.html_base64 = Buffer.from(htmlContent, 'utf-8').toString('base64');
      } catch (e) {
        // ignore if Buffer unavailable
      }

      if ((!resendPayload.to || resendPayload.to.length === 0)) {
        throw new Error('Resend payload would be missing required `to` field');
      }

      console.log(`[Resend] Preparing to send - payload:`, {
        from: resendPayload.from,
        to: resendPayload.to,
        bcc: resendPayload.bcc,
        subject: resendPayload.subject,
        htmlLength: htmlContent?.length || 0,
        textLength: plainText?.length || 0,
      });
      console.log(`[Resend] ⚠️  SENDING - Plain text field:`, {
        value: plainText?.substring(0, 200),
        length: plainText?.length,
      });
      console.log(`[Resend] ⚠️  PAYLOAD.TEXT field:`, {
        value: resendPayload.text?.substring(0, 200),
        length: resendPayload.text?.length,
      });
      console.log(`[Resend] Sending multipart/alternative email (HTML + Plain Text)`);

      // === ATTACHMENTS: convert to base64 and include if any provided ===
      if (attachments && attachments.length > 0) {
        resendPayload.attachments = [];
        for (const att of attachments) {
          try {
            const fileBuffer = fs.readFileSync(att.path);
            // Resend API expects either a `content` (base64) or `path` property
            // on each attachment.  Previously we mistakenly used `data`, which
            // resulted in a 422 invalid_attachment error.  Use `content` now.
            resendPayload.attachments.push({
              filename: att.filename,
              content: fileBuffer.toString('base64'),
            });
          } catch (e) {
            console.warn('[Resend] Failed to read attachment for Resend payload:', att.path, e.message);
          }
        }
        console.log('[Resend] Added attachments to payload:', resendPayload.attachments.map(a => a.filename));
      }

      const res = await axios.post('https://api.resend.com/emails', resendPayload, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      
      console.log(`[Resend] Response status: ${res.status}, data:`, res.data);
      
      if (res.data.error) throw new Error(res.data.error);
      console.log(`[Resend] Email sent successfully with ID: ${res.data.id}`);
      return { success: true };
    } else {
      throw new Error(`Unsupported email provider: ${providerDoc.provider}`);
    }
  } catch (error) {
    // If this was an Axios error with a response body, include that information
    // in the returned message.  Providers (Resend, SES, etc.) often return
    // helpful JSON in error.response.data which we otherwise hide behind
    // "Request failed with status code XYZ".
    let errMsg = error.message;
    if (error.response && error.response.data) {
      try {
        const respData = typeof error.response.data === 'object'
          ? JSON.stringify(error.response.data)
          : String(error.response.data);
        errMsg += ` | provider response: ${respData}`;
      } catch (e) {
        // ignore serialization errors
      }
    }
    console.error(`[emailSenders] ERROR - Provider: ${providerDoc?.provider}, Error:`, errMsg);
    console.error(`[emailSenders] Full error stack:`, error);
    return { success: false, error: errMsg };
  }
}














// /*
//  * SENDERS UTILS - EMAIL
//  * --------------------------------------------------
//  * This module accepts raw HTML from callers and forwards it directly to the
//  * chosen email provider.  Strict rules:
//  *   * HTML must NOT be escaped or sanitized here.
//  *   * The html parameter is treated as fully-formed and will be logged.
//  *   * Always send as multipart/alternative (see sendEmailWithProvider logic).
//  *   * Inline CSS should be preserved intact; callers must avoid broken <a> tags.
//  *   * Any sanitization helpers now return input unchanged with a warning.
//  */

// import nodemailer from 'nodemailer';
// import axios from 'axios';
// import fs from 'fs';
// import { htmlToPlainText } from './htmlToPlainText.js';

// // Helper to inject CTA button into HTML
// function injectCtaIntoHtml(htmlContent, ctaText, ctaLink) {
//   if (!ctaText || !ctaLink) {
//     return htmlContent;
//   }
  
//   // Create styled CTA button HTML
//   const ctaHtml = `
//     <div style="margin-top: 24px; text-align: center;">
//       <a href="${ctaLink}" style="display: inline-block; padding: 12px 32px; background-color: #0066cc; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">${ctaText}</a>
//     </div>
//   `;
  
//   // Inject before closing body tag
//   if (htmlContent && htmlContent.includes('</body>')) {
//     return htmlContent.replace('</body>', `${ctaHtml}</body>`);
//   }
  
//   // If no body tag, just append
//   return htmlContent + ctaHtml;
// }

// // Helper to add CTA to plain text
// function addCtaToPlainText(plainText, ctaText, ctaLink) {
//   if (!ctaText || !ctaLink) {
//     return plainText;
//   }
  
//   return `${plainText}\n\n---\n${ctaText}\n${ctaLink}`;
// }

// // Small helper to check if content is HTML
// function isHtmlContent(str) {
//   if (!str || typeof str !== 'string') return false;
//   return /<[^>]+>/g.test(str);
// }

// // Small helper to decode common HTML entities (undo accidental escaping)
// export function decodeHtmlEntities(str) {
//   if (!str || typeof str !== 'string') return str;
//   return str
//     .replace(/&lt;/g, '<')
//     .replace(/&gt;/g, '>')
//     .replace(/&amp;/g, '&')
//     .replace(/&quot;/g, '"')
//     .replace(/&#x27;/g, "'")
//     .replace(/&#039;/g, "'");
// }

// // Utility for trimming/minifying HTML so transport encodings don't break tags
// export function minifyHtml(html) {
//   if (typeof html !== 'string') return html;
//   return html.replace(/\r?\n/g, ' ')
//              .replace(/\s{2,}/g, ' ')
//              .trim();
// }

// // Insert invisible breakpoints every ~72 characters so quoted-printable
// // encoders (like Resend's) will have safe places to wrap lines without
// // splitting inside words or style attributes. The zero-width space
// // character (U+200B) is invisible in HTML and harmless.
// export function addSafeBreaks(html) {
//   if (typeof html !== 'string') return html;
//   const CHUNK = 72;
//   let out = '';
//   let buffer = '';
//   let inTag = false;
//   let inEntity = false;

//   function flushBuffer() {
//     if (buffer.length === 0) return;
//     // insert zero-width spaces every CHUNK characters
//     for (let i = 0; i < buffer.length; i += CHUNK) {
//       out += buffer.slice(i, i + CHUNK);
//       if (i + CHUNK < buffer.length) out += '\u200B';
//     }
//     buffer = '';
//   }

//   for (let i = 0; i < html.length; i++) {
//     const ch = html[i];

//     if (!inEntity && ch === '<') {
//       // entering tag: flush any buffered text first
//       flushBuffer();
//       inTag = true;
//       out += ch;
//       continue;
//     }

//     if (inTag) {
//       out += ch;
//       if (ch === '>') inTag = false;
//       continue;
//     }

//     // outside tags
//     if (!inEntity && ch === '&') {
//       // start of an entity - flush buffered text first
//       flushBuffer();
//       inEntity = true;
//       out += ch;
//       continue;
//     }

//     if (inEntity) {
//       out += ch;
//       if (ch === ';') inEntity = false;
//       continue;
//     }

//     // normal text outside tags/entities - buffer it
//     buffer += ch;
//     if (buffer.length >= CHUNK) {
//       // flush chunk with a zero-width space appended
//       out += buffer.slice(0, CHUNK) + '\u200B';
//       buffer = buffer.slice(CHUNK);
//     }
//   }

//   // flush remaining
//   flushBuffer();
//   return out;
// }

// // ✅ CRITICAL: Validate HTML integrity before sending to prevent corruption
// function validateHtmlIntegrity(htmlContent) {
//   if (!htmlContent || typeof htmlContent !== 'string') return false;

//   // decode any escaped entities so we inspect the true markup
//   const decoded = decodeHtmlEntities(htmlContent);

//   // Check for critical HTML structure
//   const hasDoctype = decoded.includes('<!DOCTYPE');

//   // EXTRA VALIDATION: newline inside style attribute may indicate broken tag
//   const hasStyleNewline = /style=\s*['"][^'"]*\n/.test(decoded);
//   if (hasStyleNewline) {
//     console.warn('[validateHtmlIntegrity] ⚠️ Style attribute contains newline - this can break rendering');
//   }
//   const hasHtmlTag = decoded.includes('<html');
//   const hasBodyTag = decoded.includes('<body');

//   // Check for common corrupted patterns
//   // Pattern 1: content= being corrupted to c"
//   const hasCorruptedContent = /(?:^|[>\s])c\s*["']\w+=/i.test(decoded);
  
//   // Pattern 2: Multiple meta tags should have proper content= pattern
//   const metaTags = htmlContent.match(/<meta[^>]*>/gi) || [];
//   const properContentPatterns = metaTags.filter(tag => /content\s*=\s*["']/i.test(tag)).length;
//   const hasViewport = metaTags.some(tag => /viewport/i.test(tag));
  
//   const checks = {
//     has_doctype: hasDoctype,
//     has_html_tag: hasHtmlTag,
//     has_body_tag: hasBodyTag,
//     meta_tags_found: metaTags.length,
//     meta_with_proper_content: properContentPatterns,
//     has_viewport: hasViewport,
//     corrupted_content_attr: hasCorruptedContent,
//   };
  
//   console.log('[validateHtmlIntegrity] HTML Structure Check:', checks);
  
//   // CRITICAL FAILURE: Detect corrupted content attributes
//   if (hasCorruptedContent) {
//     console.error('[validateHtmlIntegrity] ❌ CRITICAL: Corrupted content attribute pattern detected! c"... found!');
//     console.error('[validateHtmlIntegrity] This indicates HTML has been damaged by unsafe string replacement');
//     return false;
//   }
  
//   // WARNING: If we have viewport meta but proper content= pattern not found
//   if (hasViewport && properContentPatterns === 0) {
//     console.warn('[validateHtmlIntegrity] ⚠️  WARNING: Viewport meta tag detected but content= not properly formatted!');
//   }
  
//   return true;
// }

// export async function sendEmailWithProvider({ providerDoc, to, bcc, subject, body, bodyPlainText, ctaText, ctaLink, replyTo, fromName, fromEmail, attachments }) {
//   try {
//     console.log('\n\n⚠️⚠️⚠️ [emailSenders] sendEmailWithProvider() CALLED ⚠️⚠️⚠️');
//     console.log('[emailSenders] Subject:', subject);
//     console.log('[emailSenders] Recipients - To:', to, 'BCC:', bcc);
//     console.log('[emailSenders] HTML Body Details:', {
//       length: body?.length || 0,
//       hasDoctype: body?.includes('<!DOCTYPE') ? 'YES' : 'NO',
//       hasHtmlTag: body?.includes('<html') ? 'YES' : 'NO',
//       hasBodyTag: body?.includes('<body') ? 'YES' : 'NO',
//       preview: body?.substring(0, 300) || 'EMPTY',
//     });
//     console.log('[emailSenders] Plain Text Details:', {
//       bodyPlainText: bodyPlainText?.substring(0, 100) || 'NOT PROVIDED',
//       type: typeof bodyPlainText,
//       length: bodyPlainText?.length || 0,
//     });
//     console.log('[emailSenders] CTA:', { ctaText: ctaText?.substring(0, 50) || 'NOT SET', ctaLink: ctaLink?.substring(0, 50) || 'NOT SET' });
    
//     // ✅ CRITICAL: Validate HTML integrity before proceeding
//     const htmlIsValid = validateHtmlIntegrity(body);
//     if (!htmlIsValid) {
//       throw new Error('HTML content validation failed - content may be corrupted');
//     }
//     console.log('✅ HTML integrity check passed');
//     console.log('⚠️⚠️⚠️ END FUNCTION ENTRY CHECK ⚠️⚠️⚠️\n');
    
//     // Validate recipients
//     if ((!to || to.length === 0) && (!bcc || bcc.length === 0)) {
//       throw new Error('No recipients provided (To and BCC are both empty)');
//     }

//     // Determine the 'from' field logic
//     let fromField = '';
//     if (fromName && fromEmail) {
//       fromField = `${fromName} <${fromEmail}>`;
//     } else if (fromEmail) {
//       fromField = fromEmail;
//     } else {
//       throw new Error('No From email address configured');
//     }

//     // Multipart/alternative mode: use provided plain text or auto-generate from HTML
//     // Decode any HTML entities that may have been introduced earlier
//     let rawBody = typeof body === 'string' ? decodeHtmlEntities(body) : body;
    
//     // ✅ CRITICAL: If user provided plain text, USE IT (but check if it's actually HTML)
//     let plainText = bodyPlainText ? bodyPlainText : (htmlToPlainText(rawBody) || '');
//     let htmlContent = rawBody;
    
//     // 🔧 MINIFY HTML: remove newlines and collapse multiple spaces to avoid mail
//     // clients (and transport encodings like quoted-printable) inserting breaks
//     // inside long attributes which turn into visible text.
//     if (typeof htmlContent === 'string') {
//       htmlContent = htmlContent.replace(/\r?\n/g, ' ')
//                                .replace(/\s{2,}/g, ' ')
//                                .trim();
//       console.log('[emailSenders] 🔧 HTML minified to prevent line-break corruption, length now', htmlContent.length);
//     }

//     // 🔧 Add safe invisible breakpoints so providers that use quoted-printable
//     // encoding will wrap at these positions rather than mid-word/style.
//     if (typeof htmlContent === 'string') {
//       const before = htmlContent;
//       htmlContent = addSafeBreaks(htmlContent);
//       if (before !== htmlContent) {
//         console.log('[emailSenders] 🔧 inserted safe breakpoints into HTML');
//       }
//     }
    
//     // 🔥 CRITICAL FIX: If plainText contains HTML tags, it's not actually plain text!
//     // This happens when user doesn't provide plain text field and the auto-generation failed
//     // or when HTML is accidentally sent as plain text from frontend

//     // === TEST MODE / DUMMY PROVIDER ===
//     // When running unit tests we may call this function with a fake provider
//     // named "dummy".  Instead of sending any network request we simply return
//     // the prepared payload so tests can assert on it.  This keeps tests fast
//     // and avoids touching real email providers.
//     if (providerDoc && providerDoc.provider === 'dummy') {
//       console.log('[emailSenders] TEST MODE - returning payload without sending');
//       return { success: true, htmlContent, plainText, attachments: attachments || [], provider: providerDoc.provider };
//     }

//     // 🔥 CRITICAL FIX: If plainText contains HTML tags, it's not actually plain text!
//     // This happens when user doesn't provide plain text field and the auto-generation failed
//     // or when HTML is accidentally sent as plain text from frontend
//     console.log(`[emailSenders] 🔥 CHECKING if plainText is actually HTML:`, {
//       plainTextLength: plainText?.length || 0,
//       containsHtmlTags: isHtmlContent(plainText) ? 'YES - WILL CONVERT' : 'NO - OK',
//       preview: plainText?.substring(0, 100) || 'EMPTY',
//     });
    
//     if (plainText && isHtmlContent(plainText)) {
//       console.log(`[emailSenders] 🔥 CONVERTING HTML plainText to actual plain text...`);
//       plainText = htmlToPlainText(plainText);
//       console.log(`[emailSenders] 🔥 After conversion:`, {
//         plainTextLength: plainText?.length || 0,
//         preview: plainText?.substring(0, 100) || 'EMPTY',
//       });
//     }
    
//     console.log(`[emailSenders] ⚠️  CRITICAL - Input received:`, {
//       bodyParameterValue: bodyPlainText?.substring(0, 100) || 'NOT PROVIDED',
//       bodyParameterLength: bodyPlainText?.length || 0,
//       htmlBodyValue: htmlContent?.substring(0, 100) || 'EMPTY',
//       htmlBodyLength: htmlContent?.length || 0,
//     });
    
//     // ✅ INJECT CTA INTO EMAIL BODY
//     if (ctaText && ctaLink) {
//       console.log(`[emailSenders] Injecting CTA into HTML and plain text...`);
//       htmlContent = injectCtaIntoHtml(htmlContent, ctaText, ctaLink);
//       plainText = addCtaToPlainText(plainText, ctaText, ctaLink);
//     }
    
//     console.log(`[emailSenders] Multipart/alternative mode: HTML + Plain Text`);
//     // ✅ FINAL SAFETY: Ensure we always have plain text content to send
//     console.log(`[emailSenders] Before final safety check:`, {
//       plainTextLength: plainText?.length || 0,
//       plainTextTrimmedLength: plainText?.trim().length || 0,
//       plainTextValue: plainText?.substring(0, 150) || 'EMPTY',
//     });
    
//     if (!plainText || plainText.trim().length === 0) {
//       plainText = htmlToPlainText(htmlContent) || 'Email sent';
//     }
    
//     // 🔧 DIAGNOSTIC BEFORE CLEANUP
//     const beforeCleanup = plainText;
//     const beforeLines = plainText.split('\n');
//     const blankLineCount = beforeLines.filter(line => line.trim().length === 0).length;
//     console.log(`[emailSenders] 🔧 BEFORE CLEANUP:`, {
//       totalLength: beforeCleanup.length,
//       totalLines: beforeLines.length,
//       blankLines: blankLineCount,
//       consecutiveNewlines_count: (beforeCleanup.match(/\n\n+/g) || []).length,
//       preview: beforeCleanup.substring(0, 100),
//     });
    
//     // ✅ CRITICAL: Clean up excessive whitespace in plain text before sending
//     // Removes multiple blank lines and normalizes formatting
//     plainText = plainText
//       .split('\n')
//       .map(line => line.trim())
//       .filter(line => line.length > 0)  // Remove blank lines
//       .join('\n\n');  // Join with double newlines for readability
    
//     // Max 2 consecutive newlines
//     plainText = plainText.replace(/\n\n\n+/g, '\n\n').trim();
    
//     // 🔧 DIAGNOSTIC AFTER CLEANUP
//     const afterCleanup = plainText;
//     const afterLines = afterCleanup.split('\n');
//     console.log(`[emailSenders] 🔧 AFTER CLEANUP:`, {
//       totalLength: afterCleanup.length,
//       totalLines: afterLines.length,
//       blankLines: (afterLines.filter(line => line.trim().length === 0).length),
//       reduction_chars: (beforeCleanup.length - afterCleanup.length),
//       preview: afterCleanup.substring(0, 100),
//     });
    
//     // 🔥 FINAL FIX: Double-check that plainText is NOT HTML
//     if (plainText && isHtmlContent(plainText)) {
//       console.log(`[emailSenders] 🔥 FINAL CHECK: plainText still contains HTML! Converting again...`);
//       plainText = htmlToPlainText(plainText);
//     }
    
//     console.log(`[emailSenders] ⚠️  FINAL plain text to be sent:`, {
//       plainTextLength: plainText?.length || 0,
//       plainTextPreview: plainText?.substring(0, 150) || 'EMPTY',
//       isPlainText: !isHtmlContent(plainText) ? 'YES (GOOD)' : 'NO (STILL HAS HTML)',
//       willBeSent: plainText && plainText.length > 0 ? 'YES' : 'NO',
//     });
//     console.log(`[emailSenders] Recipients - To: ${JSON.stringify(to)}, BCC: ${JSON.stringify(bcc)}`);
//     console.log(`[emailSenders] HTML preview (first 160): ${String(htmlContent || '').substring(0, 160)}...`);
//     console.log(`[emailSenders] HTML contains angle-brackets? ${/<[^>]+>/.test(String(htmlContent || ''))}`);
//     console.log(`[emailSenders] HTML contains CTA? ${htmlContent?.includes(ctaText) || htmlContent?.includes(ctaLink) ? 'YES' : 'NO'}`);
//     console.log(`[emailSenders] Plain text preview: ${plainText?.substring(0, 100)}...`);
//     console.log(`[emailSenders] Plain text length: ${plainText?.length || 0} chars`);
//     console.log(`[emailSenders] Plain text contains CTA? ${plainText?.includes(ctaText) || plainText?.includes(ctaLink) ? 'YES' : 'NO'}`);
//     console.log(`[emailSenders] Plain text was ${bodyPlainText ? 'PROVIDED' : 'AUTO-GENERATED'}`);
//     console.log(`[emailSenders] CTA Text: ${ctaText ? 'YES - ' + ctaText.substring(0, 100) : 'Not provided'}`);
//     console.log(`[emailSenders] CTA Link: ${ctaLink ? 'YES - ' + ctaLink.substring(0, 100) : 'Not provided'}`);
//     console.log(`[emailSenders] From: ${fromField}`);
//     console.log(`[emailSenders] Subject: ${subject}`);

//     if (providerDoc.provider === 'smtp') {
//       if (!providerDoc.smtp?.host) {
//         throw new Error('SMTP host not configured');
//       }
//       // Authentication is required by default, but can be disabled for Port 25 direct relay
//       // Accept boolean, numeric, and string representations stored in DB
//       const requireAuth = !(providerDoc.smtp?.requireAuth === false || providerDoc.smtp?.requireAuth === 'false' || providerDoc.smtp?.requireAuth === '0' || providerDoc.smtp?.requireAuth === 0);
      
//       if (requireAuth) {
//         if (!providerDoc.smtp?.username) {
//           throw new Error('SMTP username not configured');
//         }
//         if (!providerDoc.smtp?.password) {
//           throw new Error('SMTP password not configured');
//         }
//         console.log(`[emailSenders] SMTP Mode: Authenticated (${providerDoc.smtp.host}:${providerDoc.smtp.port})`);
//       } else {
//         console.warn(`[emailSenders] ⚠️ UNAUTHENTICATED SMTP MODE - Relies on IP-based authentication`);
//         console.warn(`[emailSenders] Target: ${providerDoc.smtp.host}:${providerDoc.smtp.port}`);
//       }

//       // Build transport config
//       const transportConfig = {
//         host: providerDoc.smtp.host,
//         port: Number(providerDoc.smtp.port || 587),
//         logger: false,
//       };

//       // Handle encryption settings
//       const encryption = providerDoc.smtp?.encryption || 'ssl';
//       if (encryption === 'ssl') {
//         transportConfig.secure = true;
//       } else if (encryption === 'tls') {
//         transportConfig.secure = false;
//         transportConfig.requireTLS = true;
//         transportConfig.tls = { ciphers: 'SSLv3' };
//       } else if (encryption === 'none') {
//         transportConfig.secure = false;
//         // No TLS - direct connection for Port 25
//       }

//       // Add authentication only if required
//       if (requireAuth) {
//         transportConfig.auth = {
//           user: providerDoc.smtp.username,
//           pass: providerDoc.smtp.password,
//         };
//       }

//       const transporter = nodemailer.createTransport(transportConfig);
      
//       const mailOptions = {
//         from: fromField,
//         to: to || [],
//         bcc: bcc || [],
//         subject,
//         replyTo,
//         attachments,
//         text: plainText,
//         html: htmlContent,
//         // ✅ CRITICAL: Ensure Nodemailer sends proper multipart/alternative format
//         // These headers ensure the email is sent as multipart/alternative with both text and html parts
//         headers: {
//           'X-Priority': '3',
//           'X-Mailer': 'MarketBookSolution-Sender',
//         },
//         // ✅ CRITICAL: Explicitly set MIME type options for UTF-8 encoding
//         textEncoding: 'utf8',
//         htmlEncoding: 'utf8',
//         // ✅ CRITICAL: Tell Nodemailer to treat this as a multipart email
//         // Nodemailer automatically creates multipart/alternative when both text and html are provided
//         alternative: true,
//       };
      
//       console.log(`[SMTP] Preparing to send - mailOptions:`, {
//         from: mailOptions.from,
//         to: mailOptions.to,
//         bcc: mailOptions.bcc,
//         subject: mailOptions.subject,
//         htmlLength: htmlContent?.length || 0,
//         textLength: plainText?.length || 0,
//         attachmentCount: attachments?.length || 0,
//       });
//       console.log(`[SMTP] ⚠️  SENDING - Plain text field:`, {
//         value: plainText?.substring(0, 200),
//         length: plainText?.length,
//       });
//       console.log(`[SMTP] Sending multipart/alternative email (HTML + Plain Text)`);
      
//       const sendResult = await transporter.sendMail(mailOptions);
//       console.log(`[SMTP] Email sent successfully - Result:`, sendResult);
//       return { success: true };
//     } else if (providerDoc.provider === 'aws') {
//       if (!providerDoc.smtp?.host) {
//         throw new Error('SMTP host not configured for AWS');
//       }
//       if (!providerDoc.smtp?.username) {
//         throw new Error('SMTP username not configured for AWS');
//       }
//       if (!providerDoc.smtp?.password) {
//         throw new Error('SMTP password not configured for AWS');
//       }

//       const transporter = nodemailer.createTransport({
//         host: providerDoc.smtp.host,
//         port: Number(providerDoc.smtp.port || 587),
//         secure: providerDoc.smtp?.encryption === 'ssl',
//         auth: {
//           user: providerDoc.smtp.username,
//           pass: providerDoc.smtp.password,
//         },
//         tls: providerDoc.smtp?.encryption === 'tls' ? { ciphers: 'SSLv3' } : undefined,
//         logger: false,
//       });
      
//       const mailOptions = {
//         from: fromField,
//         to: to || [],
//         bcc: bcc || [],
//         subject,
//         replyTo,
//         attachments,
//         text: plainText,
//         html: htmlContent,
//         // ✅ CRITICAL: Ensure Nodemailer sends proper multipart/alternative format
//         headers: {
//           'X-Priority': '3',
//           'X-Mailer': 'MarketBookSolution-Sender',
//         },
//         // ✅ CRITICAL: Explicitly set MIME type options for UTF-8 encoding
//         textEncoding: 'utf8',
//         htmlEncoding: 'utf8',
//         alternative: true,
//       };
      
//       console.log(`[AWS SES] Preparing to send - mailOptions:`, {
//         from: mailOptions.from,
//         to: mailOptions.to,
//         bcc: mailOptions.bcc,
//         subject: mailOptions.subject,
//         htmlLength: htmlContent?.length || 0,
//         textLength: plainText?.length || 0,
//         attachmentCount: attachments?.length || 0,
//       });
//       console.log(`[AWS SES] ⚠️  SENDING - Plain text field:`, {
//         value: plainText?.substring(0, 200),
//         length: plainText?.length,
//       });
//       console.log(`[AWS SES] Sending multipart/alternative email (HTML + Plain Text)`);
      
//       const sendResult = await transporter.sendMail(mailOptions);
//       console.log(`[AWS SES] Email sent successfully - Result:`, sendResult);
//       return { success: true };
//     } else if (providerDoc.provider === 'resend') {
//       const apiKey = providerDoc.resend?.apiKey;
//       if (!apiKey) throw new Error('Resend API key not configured');

//       // Resend requires a non-empty `to` field. If we're sending only to BCC recipients
//       // (per-recipient loop may supply to=[] and bcc=[recipient]), move the recipient
//       // into `to` so Resend accepts the request. Keep original bcc when `to` is provided.
//       const resendTo = (to && Array.isArray(to) && to.length > 0) ? to : ((bcc && Array.isArray(bcc) && bcc.length > 0) ? [bcc[0]] : []);
//       const resendBcc = (to && Array.isArray(to) && to.length > 0) ? (bcc || []) : [];

//       // Build Resend-specific payload
//       const resendPayload = {
//         from: fromField,
//         to: resendTo,
//         bcc: resendBcc,
//         subject,
//         reply_to: replyTo,
//         // we intentionally include the text field only when absolutely
//         // required; some clients/renderers treat the message as plain text
//         // if the payload contains a text part, so omit it for Resend to be
//         // safe and force HTML rendering.  (plainText is still generated
//         // earlier for diagnostics and fallback in other providers.)
//         html: htmlContent,
//         // include explicit headers to force correct interpretation
//         headers: {
//           'Content-Type': 'text/html; charset=UTF-8',
//           'Content-Transfer-Encoding': 'quoted-printable',
//         },
//       };

//       // For Resend we drop the `text` field entirely unless the caller
//       // explicitly wants only plain text (not our case).  This avoids any
//       // chance the provider will deliver the text part as the primary body.
//       if (plainText && providerDoc.provider !== 'resend') {
//         resendPayload.text = plainText;
//       }

//       // Some Resend accounts/platforms may respect html_base64; include for
//       // robustness though it's not documented.
//       try {
//         resendPayload.html_base64 = Buffer.from(htmlContent, 'utf-8').toString('base64');
//       } catch (e) {
//         // ignore if Buffer unavailable
//       }

//       if ((!resendPayload.to || resendPayload.to.length === 0)) {
//         throw new Error('Resend payload would be missing required `to` field');
//       }

//       console.log(`[Resend] Preparing to send - payload:`, {
//         from: resendPayload.from,
//         to: resendPayload.to,
//         bcc: resendPayload.bcc,
//         subject: resendPayload.subject,
//         htmlLength: htmlContent?.length || 0,
//         textLength: plainText?.length || 0,
//       });
//       console.log(`[Resend] ⚠️  SENDING - Plain text field:`, {
//         value: plainText?.substring(0, 200),
//         length: plainText?.length,
//       });
//       console.log(`[Resend] ⚠️  PAYLOAD.TEXT field:`, {
//         value: resendPayload.text?.substring(0, 200),
//         length: resendPayload.text?.length,
//       });
//       console.log(`[Resend] Sending multipart/alternative email (HTML + Plain Text)`);

//       // === ATTACHMENTS: convert to base64 and include if any provided ===
//       if (attachments && attachments.length > 0) {
//         resendPayload.attachments = [];
//         for (const att of attachments) {
//           try {
//             const fileBuffer = fs.readFileSync(att.path);
//             // Resend API expects either a `content` (base64) or `path` property
//             // on each attachment.  Previously we mistakenly used `data`, which
//             // resulted in a 422 invalid_attachment error.  Use `content` now.
//             resendPayload.attachments.push({
//               filename: att.filename,
//               content: fileBuffer.toString('base64'),
//             });
//           } catch (e) {
//             console.warn('[Resend] Failed to read attachment for Resend payload:', att.path, e.message);
//           }
//         }
//         console.log('[Resend] Added attachments to payload:', resendPayload.attachments.map(a => a.filename));
//       }

//       const res = await axios.post('https://api.resend.com/emails', resendPayload, {
//         headers: {
//           'Authorization': `Bearer ${apiKey}`,
//           'Content-Type': 'application/json',
//         },
//       });
      
//       console.log(`[Resend] Response status: ${res.status}, data:`, res.data);
      
//       if (res.data.error) throw new Error(res.data.error);
//       console.log(`[Resend] Email sent successfully with ID: ${res.data.id}`);
//       return { success: true };
//     } else {
//       throw new Error(`Unsupported email provider: ${providerDoc.provider}`);
//     }
//   } catch (error) {
//     // If this was an Axios error with a response body, include that information
//     // in the returned message.  Providers (Resend, SES, etc.) often return
//     // helpful JSON in error.response.data which we otherwise hide behind
//     // "Request failed with status code XYZ".
//     let errMsg = error.message;
//     if (error.response && error.response.data) {
//       try {
//         const respData = typeof error.response.data === 'object'
//           ? JSON.stringify(error.response.data)
//           : String(error.response.data);
//         errMsg += ` | provider response: ${respData}`;
//       } catch (e) {
//         // ignore serialization errors
//       }
//     }
//     console.error(`[emailSenders] ERROR - Provider: ${providerDoc?.provider}, Error:`, errMsg);
//     console.error(`[emailSenders] Full error stack:`, error);
//     return { success: false, error: errMsg };
//   }
// }




















// /*
//  * SENDERS UTILS - EMAIL
//  * --------------------------------------------------
//  * This module accepts raw HTML from callers and forwards it directly to the
//  * chosen email provider.  Strict rules:
//  *   * HTML must NOT be escaped or sanitized here.
//  *   * The html parameter is treated as fully-formed and will be logged.
//  *   * Always send as multipart/alternative (see sendEmailWithProvider logic).
//  *   * Inline CSS should be preserved intact; callers must avoid broken <a> tags.
//  *   * Any sanitization helpers now return input unchanged with a warning.
//  */

// import nodemailer from 'nodemailer';
// import axios from 'axios';
// import fs from 'fs';
// import { htmlToPlainText } from './htmlToPlainText.js';

// // Helper to inject CTA button into HTML
// function injectCtaIntoHtml(htmlContent, ctaText, ctaLink) {
//   if (!ctaText || !ctaLink) {
//     return htmlContent;
//   }
  
//   // Create styled CTA button HTML
//   const ctaHtml = `
//     <div style="margin-top: 24px; text-align: center;">
//       <a href="${ctaLink}" style="display: inline-block; padding: 12px 32px; background-color: #0066cc; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">${ctaText}</a>
//     </div>
//   `;
  
//   // Inject before closing body tag
//   if (htmlContent && htmlContent.includes('</body>')) {
//     return htmlContent.replace('</body>', `${ctaHtml}</body>`);
//   }
  
//   // If no body tag, just append
//   return htmlContent + ctaHtml;
// }

// // Helper to add CTA to plain text
// function addCtaToPlainText(plainText, ctaText, ctaLink) {
//   if (!ctaText || !ctaLink) {
//     return plainText;
//   }
  
//   return `${plainText}\n\n---\n${ctaText}\n${ctaLink}`;
// }

// // Small helper to check if content is HTML
// function isHtmlContent(str) {
//   if (!str || typeof str !== 'string') return false;
//   return /<[^>]+>/g.test(str);
// }

// // Small helper to decode common HTML entities (undo accidental escaping)
// export function decodeHtmlEntities(str) {
//   if (!str || typeof str !== 'string') return str;
//   return str
//     .replace(/&lt;/g, '<')
//     .replace(/&gt;/g, '>')
//     .replace(/&amp;/g, '&')
//     .replace(/&quot;/g, '"')
//     .replace(/&#x27;/g, "'")
//     .replace(/&#039;/g, "'");
// }

// // Utility for trimming/minifying HTML so transport encodings don't break tags
// export function minifyHtml(html) {
//   if (typeof html !== 'string') return html;
//   return html.replace(/\r?\n/g, ' ')
//              .replace(/\s{2,}/g, ' ')
//              .trim();
// }

// // Insert invisible breakpoints every ~72 characters so quoted-printable
// // encoders (like Resend's) will have safe places to wrap lines without
// // splitting inside words or style attributes. The zero-width space
// // character (U+200B) is invisible in HTML and harmless.
// export function addSafeBreaks(html) {
//   if (typeof html !== 'string') return html;
//   const CHUNK = 72;
//   let out = '';
//   let buffer = '';
//   let inTag = false;
//   let inEntity = false;

//   function flushBuffer() {
//     if (buffer.length === 0) return;
//     // insert zero-width spaces every CHUNK characters
//     for (let i = 0; i < buffer.length; i += CHUNK) {
//       out += buffer.slice(i, i + CHUNK);
//       if (i + CHUNK < buffer.length) out += '\u200B';
//     }
//     buffer = '';
//   }

//   for (let i = 0; i < html.length; i++) {
//     const ch = html[i];

//     if (!inEntity && ch === '<') {
//       // entering tag: flush any buffered text first
//       flushBuffer();
//       inTag = true;
//       out += ch;
//       continue;
//     }

//     if (inTag) {
//       out += ch;
//       if (ch === '>') inTag = false;
//       continue;
//     }

//     // outside tags
//     if (!inEntity && ch === '&') {
//       // start of an entity - flush buffered text first
//       flushBuffer();
//       inEntity = true;
//       out += ch;
//       continue;
//     }

//     if (inEntity) {
//       out += ch;
//       if (ch === ';') inEntity = false;
//       continue;
//     }

//     // normal text outside tags/entities - buffer it
//     buffer += ch;
//     if (buffer.length >= CHUNK) {
//       // flush chunk with a zero-width space appended
//       out += buffer.slice(0, CHUNK) + '\u200B';
//       buffer = buffer.slice(CHUNK);
//     }
//   }

//   // flush remaining
//   flushBuffer();
//   return out;
// }

// // ✅ CRITICAL: Validate HTML integrity before sending to prevent corruption
// function validateHtmlIntegrity(htmlContent) {
//   if (!htmlContent || typeof htmlContent !== 'string') return false;

//   // decode any escaped entities so we inspect the true markup
//   const decoded = decodeHtmlEntities(htmlContent);

//   // Check for critical HTML structure
//   const hasDoctype = decoded.includes('<!DOCTYPE');

//   // EXTRA VALIDATION: newline inside style attribute may indicate broken tag
//   const hasStyleNewline = /style=\s*['"][^'"]*\n/.test(decoded);
//   if (hasStyleNewline) {
//     console.warn('[validateHtmlIntegrity] ⚠️ Style attribute contains newline - this can break rendering');
//   }
//   const hasHtmlTag = decoded.includes('<html');
//   const hasBodyTag = decoded.includes('<body');

//   // Check for common corrupted patterns
//   // Pattern 1: content= being corrupted to c"
//   const hasCorruptedContent = /(?:^|[>\s])c\s*["']\w+=/i.test(decoded);
  
//   // Pattern 2: Multiple meta tags should have proper content= pattern
//   const metaTags = htmlContent.match(/<meta[^>]*>/gi) || [];
//   const properContentPatterns = metaTags.filter(tag => /content\s*=\s*["']/i.test(tag)).length;
//   const hasViewport = metaTags.some(tag => /viewport/i.test(tag));
  
//   const checks = {
//     has_doctype: hasDoctype,
//     has_html_tag: hasHtmlTag,
//     has_body_tag: hasBodyTag,
//     meta_tags_found: metaTags.length,
//     meta_with_proper_content: properContentPatterns,
//     has_viewport: hasViewport,
//     corrupted_content_attr: hasCorruptedContent,
//   };
  
//   console.log('[validateHtmlIntegrity] HTML Structure Check:', checks);
  
//   // CRITICAL FAILURE: Detect corrupted content attributes
//   if (hasCorruptedContent) {
//     console.error('[validateHtmlIntegrity] ❌ CRITICAL: Corrupted content attribute pattern detected! c"... found!');
//     console.error('[validateHtmlIntegrity] This indicates HTML has been damaged by unsafe string replacement');
//     return false;
//   }
  
//   // WARNING: If we have viewport meta but proper content= pattern not found
//   if (hasViewport && properContentPatterns === 0) {
//     console.warn('[validateHtmlIntegrity] ⚠️  WARNING: Viewport meta tag detected but content= not properly formatted!');
//   }
  
//   return true;
// }

// export async function sendEmailWithProvider({ providerDoc, to, bcc, subject, body, bodyPlainText, ctaText, ctaLink, replyTo, fromName, fromEmail, attachments }) {
//   try {
//     console.log('\n\n⚠️⚠️⚠️ [emailSenders] sendEmailWithProvider() CALLED ⚠️⚠️⚠️');
//     console.log('[emailSenders] Subject:', subject);
//     console.log('[emailSenders] Recipients - To:', to, 'BCC:', bcc);
//     console.log('[emailSenders] HTML Body Details:', {
//       length: body?.length || 0,
//       hasDoctype: body?.includes('<!DOCTYPE') ? 'YES' : 'NO',
//       hasHtmlTag: body?.includes('<html') ? 'YES' : 'NO',
//       hasBodyTag: body?.includes('<body') ? 'YES' : 'NO',
//       preview: body?.substring(0, 300) || 'EMPTY',
//     });
//     console.log('[emailSenders] Plain Text Details:', {
//       bodyPlainText: bodyPlainText?.substring(0, 100) || 'NOT PROVIDED',
//       type: typeof bodyPlainText,
//       length: bodyPlainText?.length || 0,
//     });
//     console.log('[emailSenders] CTA:', { ctaText: ctaText?.substring(0, 50) || 'NOT SET', ctaLink: ctaLink?.substring(0, 50) || 'NOT SET' });
    
//     // ✅ CRITICAL: Validate HTML integrity before proceeding
//     const htmlIsValid = validateHtmlIntegrity(body);
//     if (!htmlIsValid) {
//       throw new Error('HTML content validation failed - content may be corrupted');
//     }
//     console.log('✅ HTML integrity check passed');
//     console.log('⚠️⚠️⚠️ END FUNCTION ENTRY CHECK ⚠️⚠️⚠️\n');
    
//     // Validate recipients
//     if ((!to || to.length === 0) && (!bcc || bcc.length === 0)) {
//       throw new Error('No recipients provided (To and BCC are both empty)');
//     }

//     // Determine the 'from' field logic
//     let fromField = '';
//     if (fromName && fromEmail) {
//       fromField = `${fromName} <${fromEmail}>`;
//     } else if (fromEmail) {
//       fromField = fromEmail;
//     } else {
//       throw new Error('No From email address configured');
//     }

//     // Multipart/alternative mode: use provided plain text or auto-generate from HTML
//     // Decode any HTML entities that may have been introduced earlier
//     let rawBody = typeof body === 'string' ? decodeHtmlEntities(body) : body;
    
//     // ✅ CRITICAL: If user provided plain text, USE IT (but check if it's actually HTML)
//     let plainText = bodyPlainText ? bodyPlainText : (htmlToPlainText(rawBody) || '');
//     let htmlContent = rawBody;
    
//     // 🔧 MINIFY HTML: remove newlines and collapse multiple spaces to avoid mail
//     // clients (and transport encodings like quoted-printable) inserting breaks
//     // inside long attributes which turn into visible text.
//     if (typeof htmlContent === 'string') {
//       htmlContent = htmlContent.replace(/\r?\n/g, ' ')
//                                .replace(/\s{2,}/g, ' ')
//                                .trim();
//       console.log('[emailSenders] 🔧 HTML minified to prevent line-break corruption, length now', htmlContent.length);
//     }

//     // 🔧 Add safe invisible breakpoints so providers that use quoted-printable
//     // encoding will wrap at these positions rather than mid-word/style.
//     if (typeof htmlContent === 'string') {
//       const before = htmlContent;
//       htmlContent = addSafeBreaks(htmlContent);
//       if (before !== htmlContent) {
//         console.log('[emailSenders] 🔧 inserted safe breakpoints into HTML');
//       }
//     }
    
//     // 🔥 CRITICAL FIX: If plainText contains HTML tags, it's not actually plain text!
//     // This happens when user doesn't provide plain text field and the auto-generation failed
//     // or when HTML is accidentally sent as plain text from frontend

//     // === TEST MODE / DUMMY PROVIDER ===
//     // When running unit tests we may call this function with a fake provider
//     // named "dummy".  Instead of sending any network request we simply return
//     // the prepared payload so tests can assert on it.  This keeps tests fast
//     // and avoids touching real email providers.
//     if (providerDoc && providerDoc.provider === 'dummy') {
//       console.log('[emailSenders] TEST MODE - returning payload without sending');
//       return { success: true, htmlContent, plainText, attachments: attachments || [], provider: providerDoc.provider };
//     }

//     // 🔥 CRITICAL FIX: If plainText contains HTML tags, it's not actually plain text!
//     // This happens when user doesn't provide plain text field and the auto-generation failed
//     // or when HTML is accidentally sent as plain text from frontend
//     console.log(`[emailSenders] 🔥 CHECKING if plainText is actually HTML:`, {
//       plainTextLength: plainText?.length || 0,
//       containsHtmlTags: isHtmlContent(plainText) ? 'YES - WILL CONVERT' : 'NO - OK',
//       preview: plainText?.substring(0, 100) || 'EMPTY',
//     });
    
//     if (plainText && isHtmlContent(plainText)) {
//       console.log(`[emailSenders] 🔥 CONVERTING HTML plainText to actual plain text...`);
//       plainText = htmlToPlainText(plainText);
//       console.log(`[emailSenders] 🔥 After conversion:`, {
//         plainTextLength: plainText?.length || 0,
//         preview: plainText?.substring(0, 100) || 'EMPTY',
//       });
//     }
    
//     console.log(`[emailSenders] ⚠️  CRITICAL - Input received:`, {
//       bodyParameterValue: bodyPlainText?.substring(0, 100) || 'NOT PROVIDED',
//       bodyParameterLength: bodyPlainText?.length || 0,
//       htmlBodyValue: htmlContent?.substring(0, 100) || 'EMPTY',
//       htmlBodyLength: htmlContent?.length || 0,
//     });
    
//     // ✅ INJECT CTA INTO EMAIL BODY
//     if (ctaText && ctaLink) {
//       console.log(`[emailSenders] Injecting CTA into HTML and plain text...`);
//       htmlContent = injectCtaIntoHtml(htmlContent, ctaText, ctaLink);
//       plainText = addCtaToPlainText(plainText, ctaText, ctaLink);
//     }
    
//     console.log(`[emailSenders] Multipart/alternative mode: HTML + Plain Text`);
//     // ✅ FINAL SAFETY: Ensure we always have plain text content to send
//     console.log(`[emailSenders] Before final safety check:`, {
//       plainTextLength: plainText?.length || 0,
//       plainTextTrimmedLength: plainText?.trim().length || 0,
//       plainTextValue: plainText?.substring(0, 150) || 'EMPTY',
//     });
    
//     if (!plainText || plainText.trim().length === 0) {
//       plainText = htmlToPlainText(htmlContent) || 'Email sent';
//     }
    
//     // 🔧 DIAGNOSTIC BEFORE CLEANUP
//     const beforeCleanup = plainText;
//     const beforeLines = plainText.split('\n');
//     const blankLineCount = beforeLines.filter(line => line.trim().length === 0).length;
//     console.log(`[emailSenders] 🔧 BEFORE CLEANUP:`, {
//       totalLength: beforeCleanup.length,
//       totalLines: beforeLines.length,
//       blankLines: blankLineCount,
//       consecutiveNewlines_count: (beforeCleanup.match(/\n\n+/g) || []).length,
//       preview: beforeCleanup.substring(0, 100),
//     });
    
//     // ✅ CRITICAL: Clean up excessive whitespace in plain text before sending
//     // Removes multiple blank lines and normalizes formatting
//     plainText = plainText
//       .split('\n')
//       .map(line => line.trim())
//       .filter(line => line.length > 0)  // Remove blank lines
//       .join('\n\n');  // Join with double newlines for readability
    
//     // Max 2 consecutive newlines
//     plainText = plainText.replace(/\n\n\n+/g, '\n\n').trim();
    
//     // 🔧 DIAGNOSTIC AFTER CLEANUP
//     const afterCleanup = plainText;
//     const afterLines = afterCleanup.split('\n');
//     console.log(`[emailSenders] 🔧 AFTER CLEANUP:`, {
//       totalLength: afterCleanup.length,
//       totalLines: afterLines.length,
//       blankLines: (afterLines.filter(line => line.trim().length === 0).length),
//       reduction_chars: (beforeCleanup.length - afterCleanup.length),
//       preview: afterCleanup.substring(0, 100),
//     });
    
//     // 🔥 FINAL FIX: Double-check that plainText is NOT HTML
//     if (plainText && isHtmlContent(plainText)) {
//       console.log(`[emailSenders] 🔥 FINAL CHECK: plainText still contains HTML! Converting again...`);
//       plainText = htmlToPlainText(plainText);
//     }
    
//     console.log(`[emailSenders] ⚠️  FINAL plain text to be sent:`, {
//       plainTextLength: plainText?.length || 0,
//       plainTextPreview: plainText?.substring(0, 150) || 'EMPTY',
//       isPlainText: !isHtmlContent(plainText) ? 'YES (GOOD)' : 'NO (STILL HAS HTML)',
//       willBeSent: plainText && plainText.length > 0 ? 'YES' : 'NO',
//     });
//     console.log(`[emailSenders] Recipients - To: ${JSON.stringify(to)}, BCC: ${JSON.stringify(bcc)}`);
//     console.log(`[emailSenders] HTML preview (first 160): ${String(htmlContent || '').substring(0, 160)}...`);
//     console.log(`[emailSenders] HTML contains angle-brackets? ${/<[^>]+>/.test(String(htmlContent || ''))}`);
//     console.log(`[emailSenders] HTML contains CTA? ${htmlContent?.includes(ctaText) || htmlContent?.includes(ctaLink) ? 'YES' : 'NO'}`);
//     console.log(`[emailSenders] Plain text preview: ${plainText?.substring(0, 100)}...`);
//     console.log(`[emailSenders] Plain text length: ${plainText?.length || 0} chars`);
//     console.log(`[emailSenders] Plain text contains CTA? ${plainText?.includes(ctaText) || plainText?.includes(ctaLink) ? 'YES' : 'NO'}`);
//     console.log(`[emailSenders] Plain text was ${bodyPlainText ? 'PROVIDED' : 'AUTO-GENERATED'}`);
//     console.log(`[emailSenders] CTA Text: ${ctaText ? 'YES - ' + ctaText.substring(0, 100) : 'Not provided'}`);
//     console.log(`[emailSenders] CTA Link: ${ctaLink ? 'YES - ' + ctaLink.substring(0, 100) : 'Not provided'}`);
//     console.log(`[emailSenders] From: ${fromField}`);
//     console.log(`[emailSenders] Subject: ${subject}`);

//     if (providerDoc.provider === 'smtp') {
//       if (!providerDoc.smtp?.host) {
//         throw new Error('SMTP host not configured');
//       }
//       // Authentication is required by default, but can be disabled for Port 25 direct relay
//       const requireAuth = providerDoc.smtp?.requireAuth !== false; // default true for backward compatibility
      
//       if (requireAuth) {
//         if (!providerDoc.smtp?.username) {
//           throw new Error('SMTP username not configured');
//         }
//         if (!providerDoc.smtp?.password) {
//           throw new Error('SMTP password not configured');
//         }
//         console.log(`[emailSenders] SMTP Mode: Authenticated (${providerDoc.smtp.host}:${providerDoc.smtp.port})`);
//       } else {
//         console.warn(`[emailSenders] ⚠️ UNAUTHENTICATED SMTP MODE - Relies on IP-based authentication`);
//         console.warn(`[emailSenders] Target: ${providerDoc.smtp.host}:${providerDoc.smtp.port}`);
//       }

//       // Build transport config
//       const transportConfig = {
//         host: providerDoc.smtp.host,
//         port: Number(providerDoc.smtp.port || 587),
//         logger: false,
//       };

//       // Handle encryption settings
//       const encryption = providerDoc.smtp?.encryption || 'ssl';
//       if (encryption === 'ssl') {
//         transportConfig.secure = true;
//       } else if (encryption === 'tls') {
//         transportConfig.secure = false;
//         transportConfig.requireTLS = true;
//         transportConfig.tls = { ciphers: 'SSLv3' };
//       } else if (encryption === 'none') {
//         transportConfig.secure = false;
//         // No TLS - direct connection for Port 25
//       }

//       // Add authentication only if required
//       if (requireAuth) {
//         transportConfig.auth = {
//           user: providerDoc.smtp.username,
//           pass: providerDoc.smtp.password,
//         };
//       }

//       const transporter = nodemailer.createTransport(transportConfig);
      
//       const mailOptions = {
//         from: fromField,
//         to: to || [],
//         bcc: bcc || [],
//         subject,
//         replyTo,
//         attachments,
//         text: plainText,
//         html: htmlContent,
//         // ✅ CRITICAL: Ensure Nodemailer sends proper multipart/alternative format
//         // These headers ensure the email is sent as multipart/alternative with both text and html parts
//         headers: {
//           'X-Priority': '3',
//           'X-Mailer': 'MarketBookSolution-Sender',
//         },
//         // ✅ CRITICAL: Explicitly set MIME type options for UTF-8 encoding
//         textEncoding: 'utf8',
//         htmlEncoding: 'utf8',
//         // ✅ CRITICAL: Tell Nodemailer to treat this as a multipart email
//         // Nodemailer automatically creates multipart/alternative when both text and html are provided
//         alternative: true,
//       };
      
//       console.log(`[SMTP] Preparing to send - mailOptions:`, {
//         from: mailOptions.from,
//         to: mailOptions.to,
//         bcc: mailOptions.bcc,
//         subject: mailOptions.subject,
//         htmlLength: htmlContent?.length || 0,
//         textLength: plainText?.length || 0,
//         attachmentCount: attachments?.length || 0,
//       });
//       console.log(`[SMTP] ⚠️  SENDING - Plain text field:`, {
//         value: plainText?.substring(0, 200),
//         length: plainText?.length,
//       });
//       console.log(`[SMTP] Sending multipart/alternative email (HTML + Plain Text)`);
      
//       const sendResult = await transporter.sendMail(mailOptions);
//       console.log(`[SMTP] Email sent successfully - Result:`, sendResult);
//       return { success: true };
//     } else if (providerDoc.provider === 'aws') {
//       if (!providerDoc.smtp?.host) {
//         throw new Error('SMTP host not configured for AWS');
//       }
//       if (!providerDoc.smtp?.username) {
//         throw new Error('SMTP username not configured for AWS');
//       }
//       if (!providerDoc.smtp?.password) {
//         throw new Error('SMTP password not configured for AWS');
//       }

//       const transporter = nodemailer.createTransport({
//         host: providerDoc.smtp.host,
//         port: Number(providerDoc.smtp.port || 587),
//         secure: providerDoc.smtp?.encryption === 'ssl',
//         auth: {
//           user: providerDoc.smtp.username,
//           pass: providerDoc.smtp.password,
//         },
//         tls: providerDoc.smtp?.encryption === 'tls' ? { ciphers: 'SSLv3' } : undefined,
//         logger: false,
//       });
      
//       const mailOptions = {
//         from: fromField,
//         to: to || [],
//         bcc: bcc || [],
//         subject,
//         replyTo,
//         attachments,
//         text: plainText,
//         html: htmlContent,
//         // ✅ CRITICAL: Ensure Nodemailer sends proper multipart/alternative format
//         headers: {
//           'X-Priority': '3',
//           'X-Mailer': 'MarketBookSolution-Sender',
//         },
//         // ✅ CRITICAL: Explicitly set MIME type options for UTF-8 encoding
//         textEncoding: 'utf8',
//         htmlEncoding: 'utf8',
//         alternative: true,
//       };
      
//       console.log(`[AWS SES] Preparing to send - mailOptions:`, {
//         from: mailOptions.from,
//         to: mailOptions.to,
//         bcc: mailOptions.bcc,
//         subject: mailOptions.subject,
//         htmlLength: htmlContent?.length || 0,
//         textLength: plainText?.length || 0,
//         attachmentCount: attachments?.length || 0,
//       });
//       console.log(`[AWS SES] ⚠️  SENDING - Plain text field:`, {
//         value: plainText?.substring(0, 200),
//         length: plainText?.length,
//       });
//       console.log(`[AWS SES] Sending multipart/alternative email (HTML + Plain Text)`);
      
//       const sendResult = await transporter.sendMail(mailOptions);
//       console.log(`[AWS SES] Email sent successfully - Result:`, sendResult);
//       return { success: true };
//     } else if (providerDoc.provider === 'resend') {
//       const apiKey = providerDoc.resend?.apiKey;
//       if (!apiKey) throw new Error('Resend API key not configured');

//       // Resend requires a non-empty `to` field. If we're sending only to BCC recipients
//       // (per-recipient loop may supply to=[] and bcc=[recipient]), move the recipient
//       // into `to` so Resend accepts the request. Keep original bcc when `to` is provided.
//       const resendTo = (to && Array.isArray(to) && to.length > 0) ? to : ((bcc && Array.isArray(bcc) && bcc.length > 0) ? [bcc[0]] : []);
//       const resendBcc = (to && Array.isArray(to) && to.length > 0) ? (bcc || []) : [];

//       // Build Resend-specific payload
//       const resendPayload = {
//         from: fromField,
//         to: resendTo,
//         bcc: resendBcc,
//         subject,
//         reply_to: replyTo,
//         // we intentionally include the text field only when absolutely
//         // required; some clients/renderers treat the message as plain text
//         // if the payload contains a text part, so omit it for Resend to be
//         // safe and force HTML rendering.  (plainText is still generated
//         // earlier for diagnostics and fallback in other providers.)
//         html: htmlContent,
//         // include explicit headers to force correct interpretation
//         headers: {
//           'Content-Type': 'text/html; charset=UTF-8',
//           'Content-Transfer-Encoding': 'quoted-printable',
//         },
//       };

//       // For Resend we drop the `text` field entirely unless the caller
//       // explicitly wants only plain text (not our case).  This avoids any
//       // chance the provider will deliver the text part as the primary body.
//       if (plainText && providerDoc.provider !== 'resend') {
//         resendPayload.text = plainText;
//       }

//       // Some Resend accounts/platforms may respect html_base64; include for
//       // robustness though it's not documented.
//       try {
//         resendPayload.html_base64 = Buffer.from(htmlContent, 'utf-8').toString('base64');
//       } catch (e) {
//         // ignore if Buffer unavailable
//       }

//       if ((!resendPayload.to || resendPayload.to.length === 0)) {
//         throw new Error('Resend payload would be missing required `to` field');
//       }

//       console.log(`[Resend] Preparing to send - payload:`, {
//         from: resendPayload.from,
//         to: resendPayload.to,
//         bcc: resendPayload.bcc,
//         subject: resendPayload.subject,
//         htmlLength: htmlContent?.length || 0,
//         textLength: plainText?.length || 0,
//       });
//       console.log(`[Resend] ⚠️  SENDING - Plain text field:`, {
//         value: plainText?.substring(0, 200),
//         length: plainText?.length,
//       });
//       console.log(`[Resend] ⚠️  PAYLOAD.TEXT field:`, {
//         value: resendPayload.text?.substring(0, 200),
//         length: resendPayload.text?.length,
//       });
//       console.log(`[Resend] Sending multipart/alternative email (HTML + Plain Text)`);

//       // === ATTACHMENTS: convert to base64 and include if any provided ===
//       if (attachments && attachments.length > 0) {
//         resendPayload.attachments = [];
//         for (const att of attachments) {
//           try {
//             const fileBuffer = fs.readFileSync(att.path);
//             // Resend API expects either a `content` (base64) or `path` property
//             // on each attachment.  Previously we mistakenly used `data`, which
//             // resulted in a 422 invalid_attachment error.  Use `content` now.
//             resendPayload.attachments.push({
//               filename: att.filename,
//               content: fileBuffer.toString('base64'),
//             });
//           } catch (e) {
//             console.warn('[Resend] Failed to read attachment for Resend payload:', att.path, e.message);
//           }
//         }
//         console.log('[Resend] Added attachments to payload:', resendPayload.attachments.map(a => a.filename));
//       }

//       const res = await axios.post('https://api.resend.com/emails', resendPayload, {
//         headers: {
//           'Authorization': `Bearer ${apiKey}`,
//           'Content-Type': 'application/json',
//         },
//       });
      
//       console.log(`[Resend] Response status: ${res.status}, data:`, res.data);
      
//       if (res.data.error) throw new Error(res.data.error);
//       console.log(`[Resend] Email sent successfully with ID: ${res.data.id}`);
//       return { success: true };
//     } else {
//       throw new Error(`Unsupported email provider: ${providerDoc.provider}`);
//     }
//   } catch (error) {
//     // If this was an Axios error with a response body, include that information
//     // in the returned message.  Providers (Resend, SES, etc.) often return
//     // helpful JSON in error.response.data which we otherwise hide behind
//     // "Request failed with status code XYZ".
//     let errMsg = error.message;
//     if (error.response && error.response.data) {
//       try {
//         const respData = typeof error.response.data === 'object'
//           ? JSON.stringify(error.response.data)
//           : String(error.response.data);
//         errMsg += ` | provider response: ${respData}`;
//       } catch (e) {
//         // ignore serialization errors
//       }
//     }
//     console.error(`[emailSenders] ERROR - Provider: ${providerDoc?.provider}, Error:`, errMsg);
//     console.error(`[emailSenders] Full error stack:`, error);
//     return { success: false, error: errMsg };
//   }
// }















// /*
//  * SENDERS UTILS - EMAIL
//  * --------------------------------------------------
//  * This module accepts raw HTML from callers and forwards it directly to the
//  * chosen email provider.  Strict rules:
//  *   * HTML must NOT be escaped or sanitized here.
//  *   * The html parameter is treated as fully-formed and will be logged.
//  *   * Always send as multipart/alternative (see sendEmailWithProvider logic).
//  *   * Inline CSS should be preserved intact; callers must avoid broken <a> tags.
//  *   * Any sanitization helpers now return input unchanged with a warning.
//  */

// import nodemailer from 'nodemailer';
// import axios from 'axios';
// import fs from 'fs';
// import { htmlToPlainText } from './htmlToPlainText.js';

// // Helper to inject CTA button into HTML
// function injectCtaIntoHtml(htmlContent, ctaText, ctaLink) {
//   if (!ctaText || !ctaLink) {
//     return htmlContent;
//   }
  
//   // Create styled CTA button HTML
//   const ctaHtml = `
//     <div style="margin-top: 24px; text-align: center;">
//       <a href="${ctaLink}" style="display: inline-block; padding: 12px 32px; background-color: #0066cc; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">${ctaText}</a>
//     </div>
//   `;
  
//   // Inject before closing body tag
//   if (htmlContent && htmlContent.includes('</body>')) {
//     return htmlContent.replace('</body>', `${ctaHtml}</body>`);
//   }
  
//   // If no body tag, just append
//   return htmlContent + ctaHtml;
// }

// // Helper to add CTA to plain text
// function addCtaToPlainText(plainText, ctaText, ctaLink) {
//   if (!ctaText || !ctaLink) {
//     return plainText;
//   }
  
//   return `${plainText}\n\n---\n${ctaText}\n${ctaLink}`;
// }

// // Small helper to check if content is HTML
// function isHtmlContent(str) {
//   if (!str || typeof str !== 'string') return false;
//   return /<[^>]+>/g.test(str);
// }

// // Small helper to decode common HTML entities (undo accidental escaping)
// export function decodeHtmlEntities(str) {
//   if (!str || typeof str !== 'string') return str;
//   return str
//     .replace(/&lt;/g, '<')
//     .replace(/&gt;/g, '>')
//     .replace(/&amp;/g, '&')
//     .replace(/&quot;/g, '"')
//     .replace(/&#x27;/g, "'")
//     .replace(/&#039;/g, "'");
// }

// // Utility for trimming/minifying HTML so transport encodings don't break tags
// export function minifyHtml(html) {
//   if (typeof html !== 'string') return html;
//   return html.replace(/\r?\n/g, ' ')
//              .replace(/\s{2,}/g, ' ')
//              .trim();
// }

// // Insert invisible breakpoints every ~72 characters so quoted-printable
// // encoders (like Resend's) will have safe places to wrap lines without
// // splitting inside words or style attributes. The zero-width space
// // character (U+200B) is invisible in HTML and harmless.
// export function addSafeBreaks(html) {
//   if (typeof html !== 'string') return html;
//   const CHUNK = 72;
//   let out = '';
//   let buffer = '';
//   let inTag = false;
//   let inEntity = false;

//   function flushBuffer() {
//     if (buffer.length === 0) return;
//     // insert zero-width spaces every CHUNK characters
//     for (let i = 0; i < buffer.length; i += CHUNK) {
//       out += buffer.slice(i, i + CHUNK);
//       if (i + CHUNK < buffer.length) out += '\u200B';
//     }
//     buffer = '';
//   }

//   for (let i = 0; i < html.length; i++) {
//     const ch = html[i];

//     if (!inEntity && ch === '<') {
//       // entering tag: flush any buffered text first
//       flushBuffer();
//       inTag = true;
//       out += ch;
//       continue;
//     }

//     if (inTag) {
//       out += ch;
//       if (ch === '>') inTag = false;
//       continue;
//     }

//     // outside tags
//     if (!inEntity && ch === '&') {
//       // start of an entity - flush buffered text first
//       flushBuffer();
//       inEntity = true;
//       out += ch;
//       continue;
//     }

//     if (inEntity) {
//       out += ch;
//       if (ch === ';') inEntity = false;
//       continue;
//     }

//     // normal text outside tags/entities - buffer it
//     buffer += ch;
//     if (buffer.length >= CHUNK) {
//       // flush chunk with a zero-width space appended
//       out += buffer.slice(0, CHUNK) + '\u200B';
//       buffer = buffer.slice(CHUNK);
//     }
//   }

//   // flush remaining
//   flushBuffer();
//   return out;
// }

// // ✅ CRITICAL: Validate HTML integrity before sending to prevent corruption
// function validateHtmlIntegrity(htmlContent) {
//   if (!htmlContent || typeof htmlContent !== 'string') return false;

//   // decode any escaped entities so we inspect the true markup
//   const decoded = decodeHtmlEntities(htmlContent);

//   // Check for critical HTML structure
//   const hasDoctype = decoded.includes('<!DOCTYPE');

//   // EXTRA VALIDATION: newline inside style attribute may indicate broken tag
//   const hasStyleNewline = /style=\s*['"][^'"]*\n/.test(decoded);
//   if (hasStyleNewline) {
//     console.warn('[validateHtmlIntegrity] ⚠️ Style attribute contains newline - this can break rendering');
//   }
//   const hasHtmlTag = decoded.includes('<html');
//   const hasBodyTag = decoded.includes('<body');

//   // Check for common corrupted patterns
//   // Pattern 1: content= being corrupted to c"
//   const hasCorruptedContent = /(?:^|[>\s])c\s*["']\w+=/i.test(decoded);
  
//   // Pattern 2: Multiple meta tags should have proper content= pattern
//   const metaTags = htmlContent.match(/<meta[^>]*>/gi) || [];
//   const properContentPatterns = metaTags.filter(tag => /content\s*=\s*["']/i.test(tag)).length;
//   const hasViewport = metaTags.some(tag => /viewport/i.test(tag));
  
//   const checks = {
//     has_doctype: hasDoctype,
//     has_html_tag: hasHtmlTag,
//     has_body_tag: hasBodyTag,
//     meta_tags_found: metaTags.length,
//     meta_with_proper_content: properContentPatterns,
//     has_viewport: hasViewport,
//     corrupted_content_attr: hasCorruptedContent,
//   };
  
//   console.log('[validateHtmlIntegrity] HTML Structure Check:', checks);
  
//   // CRITICAL FAILURE: Detect corrupted content attributes
//   if (hasCorruptedContent) {
//     console.error('[validateHtmlIntegrity] ❌ CRITICAL: Corrupted content attribute pattern detected! c"... found!');
//     console.error('[validateHtmlIntegrity] This indicates HTML has been damaged by unsafe string replacement');
//     return false;
//   }
  
//   // WARNING: If we have viewport meta but proper content= pattern not found
//   if (hasViewport && properContentPatterns === 0) {
//     console.warn('[validateHtmlIntegrity] ⚠️  WARNING: Viewport meta tag detected but content= not properly formatted!');
//   }
  
//   return true;
// }

// export async function sendEmailWithProvider({ providerDoc, to, bcc, subject, body, bodyPlainText, ctaText, ctaLink, replyTo, fromName, fromEmail, attachments }) {
//   try {
//     console.log('\n\n⚠️⚠️⚠️ [emailSenders] sendEmailWithProvider() CALLED ⚠️⚠️⚠️');
//     console.log('[emailSenders] Subject:', subject);
//     console.log('[emailSenders] Recipients - To:', to, 'BCC:', bcc);
//     console.log('[emailSenders] HTML Body Details:', {
//       length: body?.length || 0,
//       hasDoctype: body?.includes('<!DOCTYPE') ? 'YES' : 'NO',
//       hasHtmlTag: body?.includes('<html') ? 'YES' : 'NO',
//       hasBodyTag: body?.includes('<body') ? 'YES' : 'NO',
//       preview: body?.substring(0, 300) || 'EMPTY',
//     });
//     console.log('[emailSenders] Plain Text Details:', {
//       bodyPlainText: bodyPlainText?.substring(0, 100) || 'NOT PROVIDED',
//       type: typeof bodyPlainText,
//       length: bodyPlainText?.length || 0,
//     });
//     console.log('[emailSenders] CTA:', { ctaText: ctaText?.substring(0, 50) || 'NOT SET', ctaLink: ctaLink?.substring(0, 50) || 'NOT SET' });
    
//     // ✅ CRITICAL: Validate HTML integrity before proceeding
//     const htmlIsValid = validateHtmlIntegrity(body);
//     if (!htmlIsValid) {
//       throw new Error('HTML content validation failed - content may be corrupted');
//     }
//     console.log('✅ HTML integrity check passed');
//     console.log('⚠️⚠️⚠️ END FUNCTION ENTRY CHECK ⚠️⚠️⚠️\n');
    
//     // Validate recipients
//     if ((!to || to.length === 0) && (!bcc || bcc.length === 0)) {
//       throw new Error('No recipients provided (To and BCC are both empty)');
//     }

//     // Determine the 'from' field logic
//     let fromField = '';
//     if (fromName && fromEmail) {
//       fromField = `${fromName} <${fromEmail}>`;
//     } else if (fromEmail) {
//       fromField = fromEmail;
//     } else {
//       throw new Error('No From email address configured');
//     }

//     // Multipart/alternative mode: use provided plain text or auto-generate from HTML
//     // Decode any HTML entities that may have been introduced earlier
//     let rawBody = typeof body === 'string' ? decodeHtmlEntities(body) : body;
    
//     // ✅ CRITICAL: If user provided plain text, USE IT (but check if it's actually HTML)
//     let plainText = bodyPlainText ? bodyPlainText : (htmlToPlainText(rawBody) || '');
//     let htmlContent = rawBody;
    
//     // 🔧 MINIFY HTML: remove newlines and collapse multiple spaces to avoid mail
//     // clients (and transport encodings like quoted-printable) inserting breaks
//     // inside long attributes which turn into visible text.
//     if (typeof htmlContent === 'string') {
//       htmlContent = htmlContent.replace(/\r?\n/g, ' ')
//                                .replace(/\s{2,}/g, ' ')
//                                .trim();
//       console.log('[emailSenders] 🔧 HTML minified to prevent line-break corruption, length now', htmlContent.length);
//     }

//     // 🔧 Add safe invisible breakpoints so providers that use quoted-printable
//     // encoding will wrap at these positions rather than mid-word/style.
//     if (typeof htmlContent === 'string') {
//       const before = htmlContent;
//       htmlContent = addSafeBreaks(htmlContent);
//       if (before !== htmlContent) {
//         console.log('[emailSenders] 🔧 inserted safe breakpoints into HTML');
//       }
//     }
    
//     // 🔥 CRITICAL FIX: If plainText contains HTML tags, it's not actually plain text!
//     // This happens when user doesn't provide plain text field and the auto-generation failed
//     // or when HTML is accidentally sent as plain text from frontend

//     // === TEST MODE / DUMMY PROVIDER ===
//     // When running unit tests we may call this function with a fake provider
//     // named "dummy".  Instead of sending any network request we simply return
//     // the prepared payload so tests can assert on it.  This keeps tests fast
//     // and avoids touching real email providers.
//     if (providerDoc && providerDoc.provider === 'dummy') {
//       console.log('[emailSenders] TEST MODE - returning payload without sending');
//       return { success: true, htmlContent, plainText, attachments: attachments || [], provider: providerDoc.provider };
//     }

//     // 🔥 CRITICAL FIX: If plainText contains HTML tags, it's not actually plain text!
//     // This happens when user doesn't provide plain text field and the auto-generation failed
//     // or when HTML is accidentally sent as plain text from frontend
//     console.log(`[emailSenders] 🔥 CHECKING if plainText is actually HTML:`, {
//       plainTextLength: plainText?.length || 0,
//       containsHtmlTags: isHtmlContent(plainText) ? 'YES - WILL CONVERT' : 'NO - OK',
//       preview: plainText?.substring(0, 100) || 'EMPTY',
//     });
    
//     if (plainText && isHtmlContent(plainText)) {
//       console.log(`[emailSenders] 🔥 CONVERTING HTML plainText to actual plain text...`);
//       plainText = htmlToPlainText(plainText);
//       console.log(`[emailSenders] 🔥 After conversion:`, {
//         plainTextLength: plainText?.length || 0,
//         preview: plainText?.substring(0, 100) || 'EMPTY',
//       });
//     }
    
//     console.log(`[emailSenders] ⚠️  CRITICAL - Input received:`, {
//       bodyParameterValue: bodyPlainText?.substring(0, 100) || 'NOT PROVIDED',
//       bodyParameterLength: bodyPlainText?.length || 0,
//       htmlBodyValue: htmlContent?.substring(0, 100) || 'EMPTY',
//       htmlBodyLength: htmlContent?.length || 0,
//     });
    
//     // ✅ INJECT CTA INTO EMAIL BODY
//     if (ctaText && ctaLink) {
//       console.log(`[emailSenders] Injecting CTA into HTML and plain text...`);
//       htmlContent = injectCtaIntoHtml(htmlContent, ctaText, ctaLink);
//       plainText = addCtaToPlainText(plainText, ctaText, ctaLink);
//     }
    
//     console.log(`[emailSenders] Multipart/alternative mode: HTML + Plain Text`);
//     // ✅ FINAL SAFETY: Ensure we always have plain text content to send
//     console.log(`[emailSenders] Before final safety check:`, {
//       plainTextLength: plainText?.length || 0,
//       plainTextTrimmedLength: plainText?.trim().length || 0,
//       plainTextValue: plainText?.substring(0, 150) || 'EMPTY',
//     });
    
//     if (!plainText || plainText.trim().length === 0) {
//       plainText = htmlToPlainText(htmlContent) || 'Email sent';
//     }
    
//     // 🔧 DIAGNOSTIC BEFORE CLEANUP
//     const beforeCleanup = plainText;
//     const beforeLines = plainText.split('\n');
//     const blankLineCount = beforeLines.filter(line => line.trim().length === 0).length;
//     console.log(`[emailSenders] 🔧 BEFORE CLEANUP:`, {
//       totalLength: beforeCleanup.length,
//       totalLines: beforeLines.length,
//       blankLines: blankLineCount,
//       consecutiveNewlines_count: (beforeCleanup.match(/\n\n+/g) || []).length,
//       preview: beforeCleanup.substring(0, 100),
//     });
    
//     // ✅ CRITICAL: Clean up excessive whitespace in plain text before sending
//     // Removes multiple blank lines and normalizes formatting
//     plainText = plainText
//       .split('\n')
//       .map(line => line.trim())
//       .filter(line => line.length > 0)  // Remove blank lines
//       .join('\n\n');  // Join with double newlines for readability
    
//     // Max 2 consecutive newlines
//     plainText = plainText.replace(/\n\n\n+/g, '\n\n').trim();
    
//     // 🔧 DIAGNOSTIC AFTER CLEANUP
//     const afterCleanup = plainText;
//     const afterLines = afterCleanup.split('\n');
//     console.log(`[emailSenders] 🔧 AFTER CLEANUP:`, {
//       totalLength: afterCleanup.length,
//       totalLines: afterLines.length,
//       blankLines: (afterLines.filter(line => line.trim().length === 0).length),
//       reduction_chars: (beforeCleanup.length - afterCleanup.length),
//       preview: afterCleanup.substring(0, 100),
//     });
    
//     // 🔥 FINAL FIX: Double-check that plainText is NOT HTML
//     if (plainText && isHtmlContent(plainText)) {
//       console.log(`[emailSenders] 🔥 FINAL CHECK: plainText still contains HTML! Converting again...`);
//       plainText = htmlToPlainText(plainText);
//     }
    
//     console.log(`[emailSenders] ⚠️  FINAL plain text to be sent:`, {
//       plainTextLength: plainText?.length || 0,
//       plainTextPreview: plainText?.substring(0, 150) || 'EMPTY',
//       isPlainText: !isHtmlContent(plainText) ? 'YES (GOOD)' : 'NO (STILL HAS HTML)',
//       willBeSent: plainText && plainText.length > 0 ? 'YES' : 'NO',
//     });
//     console.log(`[emailSenders] Recipients - To: ${JSON.stringify(to)}, BCC: ${JSON.stringify(bcc)}`);
//     console.log(`[emailSenders] HTML preview (first 160): ${String(htmlContent || '').substring(0, 160)}...`);
//     console.log(`[emailSenders] HTML contains angle-brackets? ${/<[^>]+>/.test(String(htmlContent || ''))}`);
//     console.log(`[emailSenders] HTML contains CTA? ${htmlContent?.includes(ctaText) || htmlContent?.includes(ctaLink) ? 'YES' : 'NO'}`);
//     console.log(`[emailSenders] Plain text preview: ${plainText?.substring(0, 100)}...`);
//     console.log(`[emailSenders] Plain text length: ${plainText?.length || 0} chars`);
//     console.log(`[emailSenders] Plain text contains CTA? ${plainText?.includes(ctaText) || plainText?.includes(ctaLink) ? 'YES' : 'NO'}`);
//     console.log(`[emailSenders] Plain text was ${bodyPlainText ? 'PROVIDED' : 'AUTO-GENERATED'}`);
//     console.log(`[emailSenders] CTA Text: ${ctaText ? 'YES - ' + ctaText.substring(0, 100) : 'Not provided'}`);
//     console.log(`[emailSenders] CTA Link: ${ctaLink ? 'YES - ' + ctaLink.substring(0, 100) : 'Not provided'}`);
//     console.log(`[emailSenders] From: ${fromField}`);
//     console.log(`[emailSenders] Subject: ${subject}`);

//     if (providerDoc.provider === 'smtp') {
//       if (!providerDoc.smtp?.host) {
//         throw new Error('SMTP host not configured');
//       }
//       if (!providerDoc.smtp?.username) {
//         throw new Error('SMTP username not configured');
//       }
//       if (!providerDoc.smtp?.password) {
//         throw new Error('SMTP password not configured');
//       }

//       const transporter = nodemailer.createTransport({
//         host: providerDoc.smtp.host,
//         port: Number(providerDoc.smtp.port || 587),
//         secure: providerDoc.smtp?.encryption === 'ssl',
//         auth: {
//           user: providerDoc.smtp.username,
//           pass: providerDoc.smtp.password,
//         },
//         tls: providerDoc.smtp?.encryption === 'tls' ? { ciphers: 'SSLv3' } : undefined,
//         logger: false,
//       });
      
//       const mailOptions = {
//         from: fromField,
//         to: to || [],
//         bcc: bcc || [],
//         subject,
//         replyTo,
//         attachments,
//         text: plainText,
//         html: htmlContent,
//         // ✅ CRITICAL: Ensure Nodemailer sends proper multipart/alternative format
//         // These headers ensure the email is sent as multipart/alternative with both text and html parts
//         headers: {
//           'X-Priority': '3',
//           'X-Mailer': 'MarketBookSolution-Sender',
//         },
//         // ✅ CRITICAL: Explicitly set MIME type options for UTF-8 encoding
//         textEncoding: 'utf8',
//         htmlEncoding: 'utf8',
//         // ✅ CRITICAL: Tell Nodemailer to treat this as a multipart email
//         // Nodemailer automatically creates multipart/alternative when both text and html are provided
//         alternative: true,
//       };
      
//       console.log(`[SMTP] Preparing to send - mailOptions:`, {
//         from: mailOptions.from,
//         to: mailOptions.to,
//         bcc: mailOptions.bcc,
//         subject: mailOptions.subject,
//         htmlLength: htmlContent?.length || 0,
//         textLength: plainText?.length || 0,
//         attachmentCount: attachments?.length || 0,
//       });
//       console.log(`[SMTP] ⚠️  SENDING - Plain text field:`, {
//         value: plainText?.substring(0, 200),
//         length: plainText?.length,
//       });
//       console.log(`[SMTP] Sending multipart/alternative email (HTML + Plain Text)`);
      
//       const sendResult = await transporter.sendMail(mailOptions);
//       console.log(`[SMTP] Email sent successfully - Result:`, sendResult);
//       return { success: true };
//     } else if (providerDoc.provider === 'aws') {
//       if (!providerDoc.smtp?.host) {
//         throw new Error('SMTP host not configured for AWS');
//       }
//       if (!providerDoc.smtp?.username) {
//         throw new Error('SMTP username not configured for AWS');
//       }
//       if (!providerDoc.smtp?.password) {
//         throw new Error('SMTP password not configured for AWS');
//       }

//       const transporter = nodemailer.createTransport({
//         host: providerDoc.smtp.host,
//         port: Number(providerDoc.smtp.port || 587),
//         secure: providerDoc.smtp?.encryption === 'ssl',
//         auth: {
//           user: providerDoc.smtp.username,
//           pass: providerDoc.smtp.password,
//         },
//         tls: providerDoc.smtp?.encryption === 'tls' ? { ciphers: 'SSLv3' } : undefined,
//         logger: false,
//       });
      
//       const mailOptions = {
//         from: fromField,
//         to: to || [],
//         bcc: bcc || [],
//         subject,
//         replyTo,
//         attachments,
//         text: plainText,
//         html: htmlContent,
//         // ✅ CRITICAL: Ensure Nodemailer sends proper multipart/alternative format
//         headers: {
//           'X-Priority': '3',
//           'X-Mailer': 'MarketBookSolution-Sender',
//         },
//         // ✅ CRITICAL: Explicitly set MIME type options for UTF-8 encoding
//         textEncoding: 'utf8',
//         htmlEncoding: 'utf8',
//         alternative: true,
//       };
      
//       console.log(`[AWS SES] Preparing to send - mailOptions:`, {
//         from: mailOptions.from,
//         to: mailOptions.to,
//         bcc: mailOptions.bcc,
//         subject: mailOptions.subject,
//         htmlLength: htmlContent?.length || 0,
//         textLength: plainText?.length || 0,
//         attachmentCount: attachments?.length || 0,
//       });
//       console.log(`[AWS SES] ⚠️  SENDING - Plain text field:`, {
//         value: plainText?.substring(0, 200),
//         length: plainText?.length,
//       });
//       console.log(`[AWS SES] Sending multipart/alternative email (HTML + Plain Text)`);
      
//       const sendResult = await transporter.sendMail(mailOptions);
//       console.log(`[AWS SES] Email sent successfully - Result:`, sendResult);
//       return { success: true };
//     } else if (providerDoc.provider === 'resend') {
//       const apiKey = providerDoc.resend?.apiKey;
//       if (!apiKey) throw new Error('Resend API key not configured');

//       // Resend requires a non-empty `to` field. If we're sending only to BCC recipients
//       // (per-recipient loop may supply to=[] and bcc=[recipient]), move the recipient
//       // into `to` so Resend accepts the request. Keep original bcc when `to` is provided.
//       const resendTo = (to && Array.isArray(to) && to.length > 0) ? to : ((bcc && Array.isArray(bcc) && bcc.length > 0) ? [bcc[0]] : []);
//       const resendBcc = (to && Array.isArray(to) && to.length > 0) ? (bcc || []) : [];

//       // Build Resend-specific payload
//       const resendPayload = {
//         from: fromField,
//         to: resendTo,
//         bcc: resendBcc,
//         subject,
//         reply_to: replyTo,
//         // we intentionally include the text field only when absolutely
//         // required; some clients/renderers treat the message as plain text
//         // if the payload contains a text part, so omit it for Resend to be
//         // safe and force HTML rendering.  (plainText is still generated
//         // earlier for diagnostics and fallback in other providers.)
//         html: htmlContent,
//         // include explicit headers to force correct interpretation
//         headers: {
//           'Content-Type': 'text/html; charset=UTF-8',
//           'Content-Transfer-Encoding': 'quoted-printable',
//         },
//       };

//       // For Resend we drop the `text` field entirely unless the caller
//       // explicitly wants only plain text (not our case).  This avoids any
//       // chance the provider will deliver the text part as the primary body.
//       if (plainText && providerDoc.provider !== 'resend') {
//         resendPayload.text = plainText;
//       }

//       // Some Resend accounts/platforms may respect html_base64; include for
//       // robustness though it's not documented.
//       try {
//         resendPayload.html_base64 = Buffer.from(htmlContent, 'utf-8').toString('base64');
//       } catch (e) {
//         // ignore if Buffer unavailable
//       }

//       if ((!resendPayload.to || resendPayload.to.length === 0)) {
//         throw new Error('Resend payload would be missing required `to` field');
//       }

//       console.log(`[Resend] Preparing to send - payload:`, {
//         from: resendPayload.from,
//         to: resendPayload.to,
//         bcc: resendPayload.bcc,
//         subject: resendPayload.subject,
//         htmlLength: htmlContent?.length || 0,
//         textLength: plainText?.length || 0,
//       });
//       console.log(`[Resend] ⚠️  SENDING - Plain text field:`, {
//         value: plainText?.substring(0, 200),
//         length: plainText?.length,
//       });
//       console.log(`[Resend] ⚠️  PAYLOAD.TEXT field:`, {
//         value: resendPayload.text?.substring(0, 200),
//         length: resendPayload.text?.length,
//       });
//       console.log(`[Resend] Sending multipart/alternative email (HTML + Plain Text)`);

//       // === ATTACHMENTS: convert to base64 and include if any provided ===
//       if (attachments && attachments.length > 0) {
//         resendPayload.attachments = [];
//         for (const att of attachments) {
//           try {
//             const fileBuffer = fs.readFileSync(att.path);
//             // Resend API expects either a `content` (base64) or `path` property
//             // on each attachment.  Previously we mistakenly used `data`, which
//             // resulted in a 422 invalid_attachment error.  Use `content` now.
//             resendPayload.attachments.push({
//               filename: att.filename,
//               content: fileBuffer.toString('base64'),
//             });
//           } catch (e) {
//             console.warn('[Resend] Failed to read attachment for Resend payload:', att.path, e.message);
//           }
//         }
//         console.log('[Resend] Added attachments to payload:', resendPayload.attachments.map(a => a.filename));
//       }

//       const res = await axios.post('https://api.resend.com/emails', resendPayload, {
//         headers: {
//           'Authorization': `Bearer ${apiKey}`,
//           'Content-Type': 'application/json',
//         },
//       });
      
//       console.log(`[Resend] Response status: ${res.status}, data:`, res.data);
      
//       if (res.data.error) throw new Error(res.data.error);
//       console.log(`[Resend] Email sent successfully with ID: ${res.data.id}`);
//       return { success: true };
//     } else {
//       throw new Error(`Unsupported email provider: ${providerDoc.provider}`);
//     }
//   } catch (error) {
//     // If this was an Axios error with a response body, include that information
//     // in the returned message.  Providers (Resend, SES, etc.) often return
//     // helpful JSON in error.response.data which we otherwise hide behind
//     // "Request failed with status code XYZ".
//     let errMsg = error.message;
//     if (error.response && error.response.data) {
//       try {
//         const respData = typeof error.response.data === 'object'
//           ? JSON.stringify(error.response.data)
//           : String(error.response.data);
//         errMsg += ` | provider response: ${respData}`;
//       } catch (e) {
//         // ignore serialization errors
//       }
//     }
//     console.error(`[emailSenders] ERROR - Provider: ${providerDoc?.provider}, Error:`, errMsg);
//     console.error(`[emailSenders] Full error stack:`, error);
//     return { success: false, error: errMsg };
//   }
// }













// /*
//  * SENDERS UTILS - EMAIL
//  * --------------------------------------------------
//  * This module accepts raw HTML from callers and forwards it directly to the
//  * chosen email provider.  Strict rules:
//  *   * HTML must NOT be escaped or sanitized here.
//  *   * The html parameter is treated as fully-formed and will be logged.
//  *   * Always send as multipart/alternative (see sendEmailWithProvider logic).
//  *   * Inline CSS should be preserved intact; callers must avoid broken <a> tags.
//  *   * Any sanitization helpers now return input unchanged with a warning.
//  */

// import nodemailer from 'nodemailer';
// import axios from 'axios';
// import { htmlToPlainText } from './htmlToPlainText.js';

// // Helper to inject CTA button into HTML
// function injectCtaIntoHtml(htmlContent, ctaText, ctaLink) {
//   if (!ctaText || !ctaLink) {
//     return htmlContent;
//   }
  
//   // Create styled CTA button HTML
//   const ctaHtml = `
//     <div style="margin-top: 24px; text-align: center;">
//       <a href="${ctaLink}" style="display: inline-block; padding: 12px 32px; background-color: #0066cc; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">${ctaText}</a>
//     </div>
//   `;
  
//   // Inject before closing body tag
//   if (htmlContent && htmlContent.includes('</body>')) {
//     return htmlContent.replace('</body>', `${ctaHtml}</body>`);
//   }
  
//   // If no body tag, just append
//   return htmlContent + ctaHtml;
// }

// // Helper to add CTA to plain text
// function addCtaToPlainText(plainText, ctaText, ctaLink) {
//   if (!ctaText || !ctaLink) {
//     return plainText;
//   }
  
//   return `${plainText}\n\n---\n${ctaText}\n${ctaLink}`;
// }

// // Small helper to check if content is HTML
// function isHtmlContent(str) {
//   if (!str || typeof str !== 'string') return false;
//   return /<[^>]+>/g.test(str);
// }

// // Small helper to decode common HTML entities (undo accidental escaping)
// export function decodeHtmlEntities(str) {
//   if (!str || typeof str !== 'string') return str;
//   return str
//     .replace(/&lt;/g, '<')
//     .replace(/&gt;/g, '>')
//     .replace(/&amp;/g, '&')
//     .replace(/&quot;/g, '"')
//     .replace(/&#x27;/g, "'")
//     .replace(/&#039;/g, "'");
// }

// // Utility for trimming/minifying HTML so transport encodings don't break tags
// export function minifyHtml(html) {
//   if (typeof html !== 'string') return html;
//   return html.replace(/\r?\n/g, ' ')
//              .replace(/\s{2,}/g, ' ')
//              .trim();
// }

// // ✅ CRITICAL: Validate HTML integrity before sending to prevent corruption
// function validateHtmlIntegrity(htmlContent) {
//   if (!htmlContent || typeof htmlContent !== 'string') return false;
  
//   // Check for critical HTML structure
//   const hasDoctype = htmlContent.includes('<!DOCTYPE');
  
//   // EXTRA VALIDATION: newline inside style attribute may indicate broken tag
//   const hasStyleNewline = /style=\s*['"][^'"]*\n/.test(htmlContent);
//   if (hasStyleNewline) {
//     console.warn('[validateHtmlIntegrity] ⚠️ Style attribute contains newline - this can break rendering');
//   }
//   const hasHtmlTag = htmlContent.includes('<html');
//   const hasBodyTag = htmlContent.includes('<body');
  
//   // Check for common corrupted patterns
//   // Pattern 1: content= being corrupted to c"
//   const hasCorruptedContent = /(?:^|[>\s])c\s*["']\w+=/i.test(htmlContent);
  
//   // Pattern 2: Multiple meta tags should have proper content= pattern
//   const metaTags = htmlContent.match(/<meta[^>]*>/gi) || [];
//   const properContentPatterns = metaTags.filter(tag => /content\s*=\s*["']/i.test(tag)).length;
//   const hasViewport = metaTags.some(tag => /viewport/i.test(tag));
  
//   const checks = {
//     has_doctype: hasDoctype,
//     has_html_tag: hasHtmlTag,
//     has_body_tag: hasBodyTag,
//     meta_tags_found: metaTags.length,
//     meta_with_proper_content: properContentPatterns,
//     has_viewport: hasViewport,
//     corrupted_content_attr: hasCorruptedContent,
//   };
  
//   console.log('[validateHtmlIntegrity] HTML Structure Check:', checks);
  
//   // CRITICAL FAILURE: Detect corrupted content attributes
//   if (hasCorruptedContent) {
//     console.error('[validateHtmlIntegrity] ❌ CRITICAL: Corrupted content attribute pattern detected! c"... found!');
//     console.error('[validateHtmlIntegrity] This indicates HTML has been damaged by unsafe string replacement');
//     return false;
//   }
  
//   // WARNING: If we have viewport meta but proper content= pattern not found
//   if (hasViewport && properContentPatterns === 0) {
//     console.warn('[validateHtmlIntegrity] ⚠️  WARNING: Viewport meta tag detected but content= not properly formatted!');
//   }
  
//   return true;
// }

// export async function sendEmailWithProvider({ providerDoc, to, bcc, subject, body, bodyPlainText, ctaText, ctaLink, replyTo, fromName, fromEmail, attachments }) {
//   try {
//     console.log('\n\n⚠️⚠️⚠️ [emailSenders] sendEmailWithProvider() CALLED ⚠️⚠️⚠️');
//     console.log('[emailSenders] Subject:', subject);
//     console.log('[emailSenders] Recipients - To:', to, 'BCC:', bcc);
//     console.log('[emailSenders] HTML Body Details:', {
//       length: body?.length || 0,
//       hasDoctype: body?.includes('<!DOCTYPE') ? 'YES' : 'NO',
//       hasHtmlTag: body?.includes('<html') ? 'YES' : 'NO',
//       hasBodyTag: body?.includes('<body') ? 'YES' : 'NO',
//       preview: body?.substring(0, 300) || 'EMPTY',
//     });
//     console.log('[emailSenders] Plain Text Details:', {
//       bodyPlainText: bodyPlainText?.substring(0, 100) || 'NOT PROVIDED',
//       type: typeof bodyPlainText,
//       length: bodyPlainText?.length || 0,
//     });
//     console.log('[emailSenders] CTA:', { ctaText: ctaText?.substring(0, 50) || 'NOT SET', ctaLink: ctaLink?.substring(0, 50) || 'NOT SET' });
    
//     // ✅ CRITICAL: Validate HTML integrity before proceeding
//     const htmlIsValid = validateHtmlIntegrity(body);
//     if (!htmlIsValid) {
//       throw new Error('HTML content validation failed - content may be corrupted');
//     }
//     console.log('✅ HTML integrity check passed');
//     console.log('⚠️⚠️⚠️ END FUNCTION ENTRY CHECK ⚠️⚠️⚠️\n');
    
//     // Validate recipients
//     if ((!to || to.length === 0) && (!bcc || bcc.length === 0)) {
//       throw new Error('No recipients provided (To and BCC are both empty)');
//     }

//     // Determine the 'from' field logic
//     let fromField = '';
//     if (fromName && fromEmail) {
//       fromField = `${fromName} <${fromEmail}>`;
//     } else if (fromEmail) {
//       fromField = fromEmail;
//     } else {
//       throw new Error('No From email address configured');
//     }

//     // Multipart/alternative mode: use provided plain text or auto-generate from HTML
//     // Decode any HTML entities that may have been introduced earlier
//     let rawBody = typeof body === 'string' ? decodeHtmlEntities(body) : body;
    
//     // ✅ CRITICAL: If user provided plain text, USE IT (but check if it's actually HTML)
//     let plainText = bodyPlainText ? bodyPlainText : (htmlToPlainText(rawBody) || '');
//     let htmlContent = rawBody;
    
//     // 🔧 MINIFY HTML: remove newlines and collapse multiple spaces to avoid mail
//     // clients (and transport encodings like quoted-printable) inserting breaks
//     // inside long attributes which turn into visible text.
//     if (typeof htmlContent === 'string') {
//       htmlContent = htmlContent.replace(/\r?\n/g, ' ')
//                                .replace(/\s{2,}/g, ' ')
//                                .trim();
//       console.log('[emailSenders] 🔧 HTML minified to prevent line-break corruption, length now', htmlContent.length);
//     }
    
//     // 🔥 CRITICAL FIX: If plainText contains HTML tags, it's not actually plain text!
//     // This happens when user doesn't provide plain text field and the auto-generation failed
//     // or when HTML is accidentally sent as plain text from frontend
//     console.log(`[emailSenders] 🔥 CHECKING if plainText is actually HTML:`, {
//       plainTextLength: plainText?.length || 0,
//       containsHtmlTags: isHtmlContent(plainText) ? 'YES - WILL CONVERT' : 'NO - OK',
//       preview: plainText?.substring(0, 100) || 'EMPTY',
//     });
    
//     if (plainText && isHtmlContent(plainText)) {
//       console.log(`[emailSenders] 🔥 CONVERTING HTML plainText to actual plain text...`);
//       plainText = htmlToPlainText(plainText);
//       console.log(`[emailSenders] 🔥 After conversion:`, {
//         plainTextLength: plainText?.length || 0,
//         preview: plainText?.substring(0, 100) || 'EMPTY',
//       });
//     }
    
//     console.log(`[emailSenders] ⚠️  CRITICAL - Input received:`, {
//       bodyParameterValue: bodyPlainText?.substring(0, 100) || 'NOT PROVIDED',
//       bodyParameterLength: bodyPlainText?.length || 0,
//       htmlBodyValue: htmlContent?.substring(0, 100) || 'EMPTY',
//       htmlBodyLength: htmlContent?.length || 0,
//     });
    
//     // ✅ INJECT CTA INTO EMAIL BODY
//     if (ctaText && ctaLink) {
//       console.log(`[emailSenders] Injecting CTA into HTML and plain text...`);
//       htmlContent = injectCtaIntoHtml(htmlContent, ctaText, ctaLink);
//       plainText = addCtaToPlainText(plainText, ctaText, ctaLink);
//     }
    
//     console.log(`[emailSenders] Multipart/alternative mode: HTML + Plain Text`);
//     // ✅ FINAL SAFETY: Ensure we always have plain text content to send
//     console.log(`[emailSenders] Before final safety check:`, {
//       plainTextLength: plainText?.length || 0,
//       plainTextTrimmedLength: plainText?.trim().length || 0,
//       plainTextValue: plainText?.substring(0, 150) || 'EMPTY',
//     });
    
//     if (!plainText || plainText.trim().length === 0) {
//       plainText = htmlToPlainText(htmlContent) || 'Email sent';
//     }
    
//     // 🔧 DIAGNOSTIC BEFORE CLEANUP
//     const beforeCleanup = plainText;
//     const beforeLines = plainText.split('\n');
//     const blankLineCount = beforeLines.filter(line => line.trim().length === 0).length;
//     console.log(`[emailSenders] 🔧 BEFORE CLEANUP:`, {
//       totalLength: beforeCleanup.length,
//       totalLines: beforeLines.length,
//       blankLines: blankLineCount,
//       consecutiveNewlines_count: (beforeCleanup.match(/\n\n+/g) || []).length,
//       preview: beforeCleanup.substring(0, 100),
//     });
    
//     // ✅ CRITICAL: Clean up excessive whitespace in plain text before sending
//     // Removes multiple blank lines and normalizes formatting
//     plainText = plainText
//       .split('\n')
//       .map(line => line.trim())
//       .filter(line => line.length > 0)  // Remove blank lines
//       .join('\n\n');  // Join with double newlines for readability
    
//     // Max 2 consecutive newlines
//     plainText = plainText.replace(/\n\n\n+/g, '\n\n').trim();
    
//     // 🔧 DIAGNOSTIC AFTER CLEANUP
//     const afterCleanup = plainText;
//     const afterLines = afterCleanup.split('\n');
//     console.log(`[emailSenders] 🔧 AFTER CLEANUP:`, {
//       totalLength: afterCleanup.length,
//       totalLines: afterLines.length,
//       blankLines: (afterLines.filter(line => line.trim().length === 0).length),
//       reduction_chars: (beforeCleanup.length - afterCleanup.length),
//       preview: afterCleanup.substring(0, 100),
//     });
    
//     // 🔥 FINAL FIX: Double-check that plainText is NOT HTML
//     if (plainText && isHtmlContent(plainText)) {
//       console.log(`[emailSenders] 🔥 FINAL CHECK: plainText still contains HTML! Converting again...`);
//       plainText = htmlToPlainText(plainText);
//     }
    
//     console.log(`[emailSenders] ⚠️  FINAL plain text to be sent:`, {
//       plainTextLength: plainText?.length || 0,
//       plainTextPreview: plainText?.substring(0, 150) || 'EMPTY',
//       isPlainText: !isHtmlContent(plainText) ? 'YES (GOOD)' : 'NO (STILL HAS HTML)',
//       willBeSent: plainText && plainText.length > 0 ? 'YES' : 'NO',
//     });
//     console.log(`[emailSenders] Recipients - To: ${JSON.stringify(to)}, BCC: ${JSON.stringify(bcc)}`);
//     console.log(`[emailSenders] HTML preview (first 160): ${String(htmlContent || '').substring(0, 160)}...`);
//     console.log(`[emailSenders] HTML contains angle-brackets? ${/<[^>]+>/.test(String(htmlContent || ''))}`);
//     console.log(`[emailSenders] HTML contains CTA? ${htmlContent?.includes(ctaText) || htmlContent?.includes(ctaLink) ? 'YES' : 'NO'}`);
//     console.log(`[emailSenders] Plain text preview: ${plainText?.substring(0, 100)}...`);
//     console.log(`[emailSenders] Plain text length: ${plainText?.length || 0} chars`);
//     console.log(`[emailSenders] Plain text contains CTA? ${plainText?.includes(ctaText) || plainText?.includes(ctaLink) ? 'YES' : 'NO'}`);
//     console.log(`[emailSenders] Plain text was ${bodyPlainText ? 'PROVIDED' : 'AUTO-GENERATED'}`);
//     console.log(`[emailSenders] CTA Text: ${ctaText ? 'YES - ' + ctaText.substring(0, 100) : 'Not provided'}`);
//     console.log(`[emailSenders] CTA Link: ${ctaLink ? 'YES - ' + ctaLink.substring(0, 100) : 'Not provided'}`);
//     console.log(`[emailSenders] From: ${fromField}`);
//     console.log(`[emailSenders] Subject: ${subject}`);

//     if (providerDoc.provider === 'smtp') {
//       if (!providerDoc.smtp?.host) {
//         throw new Error('SMTP host not configured');
//       }
//       if (!providerDoc.smtp?.username) {
//         throw new Error('SMTP username not configured');
//       }
//       if (!providerDoc.smtp?.password) {
//         throw new Error('SMTP password not configured');
//       }

//       const transporter = nodemailer.createTransport({
//         host: providerDoc.smtp.host,
//         port: Number(providerDoc.smtp.port || 587),
//         secure: providerDoc.smtp?.encryption === 'ssl',
//         auth: {
//           user: providerDoc.smtp.username,
//           pass: providerDoc.smtp.password,
//         },
//         tls: providerDoc.smtp?.encryption === 'tls' ? { ciphers: 'SSLv3' } : undefined,
//         logger: false,
//       });
      
//       const mailOptions = {
//         from: fromField,
//         to: to || [],
//         bcc: bcc || [],
//         subject,
//         replyTo,
//         attachments,
//         text: plainText,
//         html: htmlContent,
//         // ✅ CRITICAL: Ensure Nodemailer sends proper multipart/alternative format
//         // These headers ensure the email is sent as multipart/alternative with both text and html parts
//         headers: {
//           'X-Priority': '3',
//           'X-Mailer': 'MarketBookSolution-Sender',
//         },
//         // ✅ CRITICAL: Explicitly set MIME type options for UTF-8 encoding
//         textEncoding: 'utf8',
//         htmlEncoding: 'utf8',
//         // ✅ CRITICAL: Tell Nodemailer to treat this as a multipart email
//         // Nodemailer automatically creates multipart/alternative when both text and html are provided
//         alternative: true,
//       };
      
//       console.log(`[SMTP] Preparing to send - mailOptions:`, {
//         from: mailOptions.from,
//         to: mailOptions.to,
//         bcc: mailOptions.bcc,
//         subject: mailOptions.subject,
//         htmlLength: htmlContent?.length || 0,
//         textLength: plainText?.length || 0,
//         attachmentCount: attachments?.length || 0,
//       });
//       console.log(`[SMTP] ⚠️  SENDING - Plain text field:`, {
//         value: plainText?.substring(0, 200),
//         length: plainText?.length,
//       });
//       console.log(`[SMTP] Sending multipart/alternative email (HTML + Plain Text)`);
      
//       const sendResult = await transporter.sendMail(mailOptions);
//       console.log(`[SMTP] Email sent successfully - Result:`, sendResult);
//       return { success: true };
//     } else if (providerDoc.provider === 'aws') {
//       if (!providerDoc.smtp?.host) {
//         throw new Error('SMTP host not configured for AWS');
//       }
//       if (!providerDoc.smtp?.username) {
//         throw new Error('SMTP username not configured for AWS');
//       }
//       if (!providerDoc.smtp?.password) {
//         throw new Error('SMTP password not configured for AWS');
//       }

//       const transporter = nodemailer.createTransport({
//         host: providerDoc.smtp.host,
//         port: Number(providerDoc.smtp.port || 587),
//         secure: providerDoc.smtp?.encryption === 'ssl',
//         auth: {
//           user: providerDoc.smtp.username,
//           pass: providerDoc.smtp.password,
//         },
//         tls: providerDoc.smtp?.encryption === 'tls' ? { ciphers: 'SSLv3' } : undefined,
//         logger: false,
//       });
      
//       const mailOptions = {
//         from: fromField,
//         to: to || [],
//         bcc: bcc || [],
//         subject,
//         replyTo,
//         attachments,
//         text: plainText,
//         html: htmlContent,
//         // ✅ CRITICAL: Ensure Nodemailer sends proper multipart/alternative format
//         headers: {
//           'X-Priority': '3',
//           'X-Mailer': 'MarketBookSolution-Sender',
//         },
//         // ✅ CRITICAL: Explicitly set MIME type options for UTF-8 encoding
//         textEncoding: 'utf8',
//         htmlEncoding: 'utf8',
//         alternative: true,
//       };
      
//       console.log(`[AWS SES] Preparing to send - mailOptions:`, {
//         from: mailOptions.from,
//         to: mailOptions.to,
//         bcc: mailOptions.bcc,
//         subject: mailOptions.subject,
//         htmlLength: htmlContent?.length || 0,
//         textLength: plainText?.length || 0,
//         attachmentCount: attachments?.length || 0,
//       });
//       console.log(`[AWS SES] ⚠️  SENDING - Plain text field:`, {
//         value: plainText?.substring(0, 200),
//         length: plainText?.length,
//       });
//       console.log(`[AWS SES] Sending multipart/alternative email (HTML + Plain Text)`);
      
//       const sendResult = await transporter.sendMail(mailOptions);
//       console.log(`[AWS SES] Email sent successfully - Result:`, sendResult);
//       return { success: true };
//     } else if (providerDoc.provider === 'resend') {
//       const apiKey = providerDoc.resend?.apiKey;
//       if (!apiKey) throw new Error('Resend API key not configured');

//       // Resend requires a non-empty `to` field. If we're sending only to BCC recipients
//       // (per-recipient loop may supply to=[] and bcc=[recipient]), move the recipient
//       // into `to` so Resend accepts the request. Keep original bcc when `to` is provided.
//       const resendTo = (to && Array.isArray(to) && to.length > 0) ? to : ((bcc && Array.isArray(bcc) && bcc.length > 0) ? [bcc[0]] : []);
//       const resendBcc = (to && Array.isArray(to) && to.length > 0) ? (bcc || []) : [];

//       // Build Resend-specific payload
//       const resendPayload = {
//         from: fromField,
//         to: resendTo,
//         bcc: resendBcc,
//         subject,
//         reply_to: replyTo,
//         text: plainText,
//         html: htmlContent,
//       };

//       if ((!resendPayload.to || resendPayload.to.length === 0)) {
//         throw new Error('Resend payload would be missing required `to` field');
//       }

//       console.log(`[Resend] Preparing to send - payload:`, {
//         from: resendPayload.from,
//         to: resendPayload.to,
//         bcc: resendPayload.bcc,
//         subject: resendPayload.subject,
//         htmlLength: htmlContent?.length || 0,
//         textLength: plainText?.length || 0,
//       });
//       console.log(`[Resend] ⚠️  SENDING - Plain text field:`, {
//         value: plainText?.substring(0, 200),
//         length: plainText?.length,
//       });
//       console.log(`[Resend] ⚠️  PAYLOAD.TEXT field:`, {
//         value: resendPayload.text?.substring(0, 200),
//         length: resendPayload.text?.length,
//       });
//       console.log(`[Resend] Sending multipart/alternative email (HTML + Plain Text)`);

//       const res = await axios.post('https://api.resend.com/emails', resendPayload, {
//         headers: {
//           'Authorization': `Bearer ${apiKey}`,
//           'Content-Type': 'application/json',
//         },
//       });
      
//       console.log(`[Resend] Response status: ${res.status}, data:`, res.data);
      
//       if (res.data.error) throw new Error(res.data.error);
//       console.log(`[Resend] Email sent successfully with ID: ${res.data.id}`);
//       return { success: true };
//     } else {
//       throw new Error(`Unsupported email provider: ${providerDoc.provider}`);
//     }
//   } catch (error) {
//     console.error(`[emailSenders] ERROR - Provider: ${providerDoc?.provider}, Error:`, error.message);
//     console.error(`[emailSenders] Full error stack:`, error);
//     return { success: false, error: error.message };
//   }
// }













// import nodemailer from 'nodemailer';
// import axios from 'axios';
// import { htmlToPlainText } from './htmlToPlainText.js';

// // Helper to inject CTA button into HTML
// function injectCtaIntoHtml(htmlContent, ctaText, ctaLink) {
//   if (!ctaText || !ctaLink) {
//     return htmlContent;
//   }
  
//   // Create styled CTA button HTML
//   const ctaHtml = `
//     <div style="margin-top: 24px; text-align: center;">
//       <a href="${ctaLink}" style="
//         display: inline-block;
//         padding: 12px 32px;
//         background-color: #0066cc;
//         color: #ffffff;
//         text-decoration: none;
//         border-radius: 6px;
//         font-weight: bold;
//         font-size: 16px;
//       ">${ctaText}</a>
//     </div>
//   `;
  
//   // Inject before closing body tag
//   if (htmlContent && htmlContent.includes('</body>')) {
//     return htmlContent.replace('</body>', `${ctaHtml}</body>`);
//   }
  
//   // If no body tag, just append
//   return htmlContent + ctaHtml;
// }

// // Helper to add CTA to plain text
// function addCtaToPlainText(plainText, ctaText, ctaLink) {
//   if (!ctaText || !ctaLink) {
//     return plainText;
//   }
  
//   return `${plainText}\n\n---\n${ctaText}\n${ctaLink}`;
// }

// // Small helper to decode common HTML entities (undo accidental escaping)
// function decodeHtmlEntities(str) {
//   if (!str || typeof str !== 'string') return str;
//   return str
//     .replace(/&lt;/g, '<')
//     .replace(/&gt;/g, '>')
//     .replace(/&amp;/g, '&')
//     .replace(/&quot;/g, '"')
//     .replace(/&#x27;/g, "'")
//     .replace(/&#039;/g, "'");
// }

// export async function sendEmailWithProvider({ providerDoc, to, bcc, subject, body, bodyPlainText, ctaText, ctaLink, replyTo, fromName, fromEmail, attachments }) {
//   try {
//     console.log('\n\n⚠️⚠️⚠️ [emailSenders] sendEmailWithProvider() CALLED ⚠️⚠️⚠️');
//     console.log('bodyPlainText parameter received:', bodyPlainText);
//     console.log('bodyPlainText type:', typeof bodyPlainText);
//     console.log('bodyPlainText length:', bodyPlainText?.length || 0);
//     console.log('⚠️⚠️⚠️ END FUNCTION ENTRY CHECK ⚠️⚠️⚠️\n');
    
//     // Validate recipients
//     if ((!to || to.length === 0) && (!bcc || bcc.length === 0)) {
//       throw new Error('No recipients provided (To and BCC are both empty)');
//     }

//     // Determine the 'from' field logic
//     let fromField = '';
//     if (fromName && fromEmail) {
//       fromField = `${fromName} <${fromEmail}>`;
//     } else if (fromEmail) {
//       fromField = fromEmail;
//     } else {
//       throw new Error('No From email address configured');
//     }

//     // Multipart/alternative mode: use provided plain text or auto-generate from HTML
//     // Decode any HTML entities that may have been introduced earlier
//     let rawBody = typeof body === 'string' ? decodeHtmlEntities(body) : body;
    
//     // ✅ CRITICAL: If user provided plain text, USE IT
//     let plainText = bodyPlainText ? bodyPlainText : (htmlToPlainText(rawBody) || '');
//     let htmlContent = rawBody;
    
//     console.log(`[emailSenders] ⚠️  CRITICAL - Input received:`, {
//       bodyParameterValue: bodyPlainText?.substring(0, 100) || 'NOT PROVIDED',
//       bodyParameterLength: bodyPlainText?.length || 0,
//       htmlBodyValue: htmlContent?.substring(0, 100) || 'EMPTY',
//       htmlBodyLength: htmlContent?.length || 0,
//     });
    
//     // ✅ INJECT CTA INTO EMAIL BODY
//     if (ctaText && ctaLink) {
//       console.log(`[emailSenders] Injecting CTA into HTML and plain text...`);
//       htmlContent = injectCtaIntoHtml(htmlContent, ctaText, ctaLink);
//       plainText = addCtaToPlainText(plainText, ctaText, ctaLink);
//     }
    
//     console.log(`[emailSenders] Multipart/alternative mode: HTML + Plain Text`);
//     // ✅ FINAL SAFETY: Ensure we always have plain text content to send
//     console.log(`[emailSenders] Before final safety check:`, {
//       plainTextLength: plainText?.length || 0,
//       plainTextTrimmedLength: plainText?.trim().length || 0,
//       plainTextValue: plainText?.substring(0, 150) || 'EMPTY',
//     });
    
//     if (!plainText || plainText.trim().length === 0) {
//       plainText = htmlToPlainText(htmlContent) || 'Email sent';
//     }
    
//     console.log(`[emailSenders] ⚠️  FINAL plain text to be sent:`, {
//       plainTextLength: plainText?.length || 0,
//       plainTextPreview: plainText?.substring(0, 150) || 'EMPTY',
//       willBeSent: plainText && plainText.length > 0 ? 'YES' : 'NO',
//     });
//     console.log(`[emailSenders] Recipients - To: ${JSON.stringify(to)}, BCC: ${JSON.stringify(bcc)}`);
//     console.log(`[emailSenders] HTML preview (first 160): ${String(htmlContent || '').substring(0, 160)}...`);
//     console.log(`[emailSenders] HTML contains angle-brackets? ${/<[^>]+>/.test(String(htmlContent || ''))}`);
//     console.log(`[emailSenders] HTML contains CTA? ${htmlContent?.includes(ctaText) || htmlContent?.includes(ctaLink) ? 'YES' : 'NO'}`);
//     console.log(`[emailSenders] Plain text preview: ${plainText?.substring(0, 100)}...`);
//     console.log(`[emailSenders] Plain text length: ${plainText?.length || 0} chars`);
//     console.log(`[emailSenders] Plain text contains CTA? ${plainText?.includes(ctaText) || plainText?.includes(ctaLink) ? 'YES' : 'NO'}`);
//     console.log(`[emailSenders] Plain text was ${bodyPlainText ? 'PROVIDED' : 'AUTO-GENERATED'}`);
//     console.log(`[emailSenders] CTA Text: ${ctaText ? 'YES - ' + ctaText.substring(0, 100) : 'Not provided'}`);
//     console.log(`[emailSenders] CTA Link: ${ctaLink ? 'YES - ' + ctaLink.substring(0, 100) : 'Not provided'}`);
//     console.log(`[emailSenders] From: ${fromField}`);
//     console.log(`[emailSenders] Subject: ${subject}`);

//     if (providerDoc.provider === 'smtp') {
//       if (!providerDoc.smtp?.host) {
//         throw new Error('SMTP host not configured');
//       }
//       if (!providerDoc.smtp?.username) {
//         throw new Error('SMTP username not configured');
//       }
//       if (!providerDoc.smtp?.password) {
//         throw new Error('SMTP password not configured');
//       }

//       const transporter = nodemailer.createTransport({
//         host: providerDoc.smtp.host,
//         port: Number(providerDoc.smtp.port || 587),
//         secure: providerDoc.smtp?.encryption === 'ssl',
//         auth: {
//           user: providerDoc.smtp.username,
//           pass: providerDoc.smtp.password,
//         },
//         tls: providerDoc.smtp?.encryption === 'tls' ? { ciphers: 'SSLv3' } : undefined,
//       });
      
//       const mailOptions = {
//         from: fromField,
//         to: to || [],
//         bcc: bcc || [],
//         subject,
//         replyTo,
//         attachments,
//         text: plainText,
//         html: htmlContent,
//       };
      
//       console.log(`[SMTP] Preparing to send - mailOptions:`, {
//         from: mailOptions.from,
//         to: mailOptions.to,
//         bcc: mailOptions.bcc,
//         subject: mailOptions.subject,
//         htmlLength: htmlContent?.length || 0,
//         textLength: plainText?.length || 0,
//         attachmentCount: attachments?.length || 0,
//       });
//       console.log(`[SMTP] ⚠️  SENDING - Plain text field:`, {
//         value: plainText?.substring(0, 200),
//         length: plainText?.length,
//       });
//       console.log(`[SMTP] Sending multipart/alternative email (HTML + Plain Text)`);
      
//       const sendResult = await transporter.sendMail(mailOptions);
//       console.log(`[SMTP] Email sent successfully - Result:`, sendResult);
//       return { success: true };
//     } else if (providerDoc.provider === 'aws') {
//       if (!providerDoc.smtp?.host) {
//         throw new Error('SMTP host not configured for AWS');
//       }
//       if (!providerDoc.smtp?.username) {
//         throw new Error('SMTP username not configured for AWS');
//       }
//       if (!providerDoc.smtp?.password) {
//         throw new Error('SMTP password not configured for AWS');
//       }

//       const transporter = nodemailer.createTransport({
//         host: providerDoc.smtp.host,
//         port: Number(providerDoc.smtp.port || 587),
//         secure: providerDoc.smtp?.encryption === 'ssl',
//         auth: {
//           user: providerDoc.smtp.username,
//           pass: providerDoc.smtp.password,
//         },
//         tls: providerDoc.smtp?.encryption === 'tls' ? { ciphers: 'SSLv3' } : undefined,
//       });
      
//       const mailOptions = {
//         from: fromField,
//         to: to || [],
//         bcc: bcc || [],
//         subject,
//         replyTo,
//         attachments,
//         text: plainText,
//         html: htmlContent,
//       };
      
//       console.log(`[AWS SES] Preparing to send - mailOptions:`, {
//         from: mailOptions.from,
//         to: mailOptions.to,
//         bcc: mailOptions.bcc,
//         subject: mailOptions.subject,
//         htmlLength: htmlContent?.length || 0,
//         textLength: plainText?.length || 0,
//         attachmentCount: attachments?.length || 0,
//       });
//       console.log(`[AWS SES] ⚠️  SENDING - Plain text field:`, {
//         value: plainText?.substring(0, 200),
//         length: plainText?.length,
//       });
//       console.log(`[AWS SES] Sending multipart/alternative email (HTML + Plain Text)`);
      
//       const sendResult = await transporter.sendMail(mailOptions);
//       console.log(`[AWS SES] Email sent successfully - Result:`, sendResult);
//       return { success: true };
//     } else if (providerDoc.provider === 'resend') {
//       const apiKey = providerDoc.resend?.apiKey;
//       if (!apiKey) throw new Error('Resend API key not configured');

//       // Resend requires a non-empty `to` field. If we're sending only to BCC recipients
//       // (per-recipient loop may supply to=[] and bcc=[recipient]), move the recipient
//       // into `to` so Resend accepts the request. Keep original bcc when `to` is provided.
//       const resendTo = (to && Array.isArray(to) && to.length > 0) ? to : ((bcc && Array.isArray(bcc) && bcc.length > 0) ? [bcc[0]] : []);
//       const resendBcc = (to && Array.isArray(to) && to.length > 0) ? (bcc || []) : [];

//       // Build Resend-specific payload
//       const resendPayload = {
//         from: fromField,
//         to: resendTo,
//         bcc: resendBcc,
//         subject,
//         reply_to: replyTo,
//         text: plainText,
//         html: htmlContent,
//       };

//       if ((!resendPayload.to || resendPayload.to.length === 0)) {
//         throw new Error('Resend payload would be missing required `to` field');
//       }

//       console.log(`[Resend] Preparing to send - payload:`, {
//         from: resendPayload.from,
//         to: resendPayload.to,
//         bcc: resendPayload.bcc,
//         subject: resendPayload.subject,
//         htmlLength: htmlContent?.length || 0,
//         textLength: plainText?.length || 0,
//       });
//       console.log(`[Resend] ⚠️  SENDING - Plain text field:`, {
//         value: plainText?.substring(0, 200),
//         length: plainText?.length,
//       });
//       console.log(`[Resend] ⚠️  PAYLOAD.TEXT field:`, {
//         value: resendPayload.text?.substring(0, 200),
//         length: resendPayload.text?.length,
//       });
//       console.log(`[Resend] Sending multipart/alternative email (HTML + Plain Text)`);

//       const res = await axios.post('https://api.resend.com/emails', resendPayload, {
//         headers: {
//           'Authorization': `Bearer ${apiKey}`,
//           'Content-Type': 'application/json',
//         },
//       });
      
//       console.log(`[Resend] Response status: ${res.status}, data:`, res.data);
      
//       if (res.data.error) throw new Error(res.data.error);
//       console.log(`[Resend] Email sent successfully with ID: ${res.data.id}`);
//       return { success: true };
//     } else {
//       throw new Error(`Unsupported email provider: ${providerDoc.provider}`);
//     }
//   } catch (error) {
//     console.error(`[emailSenders] ERROR - Provider: ${providerDoc?.provider}, Error:`, error.message);
//     console.error(`[emailSenders] Full error stack:`, error);
//     return { success: false, error: error.message };
//   }
// }





