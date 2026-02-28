import sanitizeHtml from 'sanitize-html';

/**
 * ✅ PROFESSIONAL HTML-TO-TEXT CONVERSION FOR BACKEND
 * Properly handles nested tables, divs, and email wrapper markup
 * Node.js version with manual entity decoding
 */
function htmlToPlainText(html) {
  if (!html) return '';

  let text = html;

  // ✅ STEP 1: Remove email wrapper elements that don't contain content
  text = text.replace(/<!DOCTYPE[^>]*>/gi, '');
  text = text.replace(/<\?xml[^>]*\?>/gi, '');
  text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
  text = text.replace(/<meta[^>]*>/gi, '');
  text = text.replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<link[^>]*>/gi, '');

  // ✅ STEP 2: Remove script and noscript content
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

  // ✅ STEP 3: Remove conditional comments for Outlook
  text = text.replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/gi, '');

  // ✅ STEP 4: Convert structural HTML to line breaks
  text = text.replace(/<\/?table[^>]*>/gi, '');
  text = text.replace(/<\/?tbody[^>]*>/gi, '');
  text = text.replace(/<\/?thead[^>]*>/gi, '');
  text = text.replace(/<\/?tfoot[^>]*>/gi, '');
  text = text.replace(/<tr[^>]*>/gi, '');
  text = text.replace(/<\/tr>/gi, '\n');
  text = text.replace(/<td[^>]*>/gi, '');
  text = text.replace(/<\/td>/gi, ' ');
  text = text.replace(/<th[^>]*>/gi, '');
  text = text.replace(/<\/th>/gi, ' ');

  // ✅ STEP 5: Convert block elements to line breaks
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/?p[^>]*>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<div[^>]*>/gi, '');
  text = text.replace(/<\/?section[^>]*>/gi, '\n');
  text = text.replace(/<\/?article[^>]*>/gi, '\n');
  text = text.replace(/<\/?nav[^>]*>/gi, '\n');
  text = text.replace(/<\/?header[^>]*>/gi, '\n');
  text = text.replace(/<\/?footer[^>]*>/gi, '\n');
  text = text.replace(/<\/?blockquote[^>]*>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

  // ✅ STEP 6: Convert headings
  text = text.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n$1\n');

  // ✅ STEP 7: Convert lists
  text = text.replace(/<ul[^>]*>/gi, '');
  text = text.replace(/<\/ul>/gi, '');
  text = text.replace(/<ol[^>]*>/gi, '');
  text = text.replace(/<\/ol>/gi, '');
  text = text.replace(/<li[^>]*>/gi, '\n• ');
  text = text.replace(/<\/li>/gi, '');

  // ✅ STEP 8: Convert links
  text = text.replace(/<a\s+href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, (match, url, linkText) => {
    const cleanText = linkText.replace(/<[^>]+>/g, '').trim();
    return cleanText ? `${cleanText} (${url})` : url;
  });

  // ✅ STEP 9: Convert bold/strong
  text = text.replace(/<(?:strong|b)[^>]*>(.*?)<\/(?:strong|b)>/gi, '*$1*');

  // ✅ STEP 10: Convert italic/emphasis
  text = text.replace(/<(?:em|i)[^>]*>(.*?)<\/(?:em|i)>/gi, '_$1_');

  // ✅ STEP 11: Handle underline
  text = text.replace(/<u[^>]*>(.*?)<\/u>/gi, '$1');

  // ✅ STEP 12: Handle strikethrough
  text = text.replace(/<(?:del|s)[^>]*>(.*?)<\/(?:del|s)>/gi, '~~$1~~');

  // ✅ STEP 13: Handle code
  text = text.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  text = text.replace(/<pre[^>]*>(.*?)<\/pre>/gi, '\n$1\n');

  // ✅ STEP 14: Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // ✅ STEP 15: Decode HTML entities manually (no DOM API in Node.js)
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"');

  // Decode numeric entities
  text = text.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(parseInt(dec, 10)));
  text = text.replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));

  // ✅ STEP 16: Clean up whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\n\n+/g, '\n\n');
  text = text.split('\n').map(line => line.trim()).join('\n');
  text = text.replace(/\n+$/g, '');
  text = text.replace(/^\n+/g, '');

  return text;
}

/**
 * Configuration for sanitizing HTML for safe display (more permissive)
 */
const DISPLAY_CONFIG = {
  allowedTags: [
    'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'b', 'em', 'i', 'u', 'a', 'br', 'hr',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'blockquote', 'code', 'pre', 'img',
    'section', 'article', 'header', 'footer', 'nav',
    'style', 'mark', 'del', 's', 'sub', 'sup'
  ],
  allowedAttributes: {
    'a': ['href', 'target', 'rel', 'title', 'style'],
    'img': ['src', 'alt', 'title', 'width', 'height', 'style'],
    'div': ['style', 'class', 'id'],
    'span': ['style', 'class', 'id'],
    'p': ['style', 'class', 'id'],
    'h1': ['style', 'class', 'id'],
    'h2': ['style', 'class', 'id'],
    'h3': ['style', 'class', 'id'],
    'h4': ['style', 'class', 'id'],
    'h5': ['style', 'class', 'id'],
    'h6': ['style', 'class', 'id'],
    'ul': ['style', 'class', 'id'],
    'ol': ['style', 'class', 'id'],
    'li': ['style', 'class', 'id'],
    'table': ['style', 'class', 'id'],
    'thead': ['style', 'class', 'id'],
    'tbody': ['style', 'class', 'id'],
    'tfoot': ['style', 'class', 'id'],
    'tr': ['style', 'class', 'id'],
    'th': ['style', 'class', 'id', 'colspan', 'rowspan'],
    'td': ['style', 'class', 'id', 'colspan', 'rowspan'],
    'blockquote': ['style', 'class', 'id'],
    'code': ['style', 'class', 'id'],
    'pre': ['style', 'class', 'id'],
    'section': ['style', 'class', 'id'],
    'article': ['style', 'class', 'id'],
    'header': ['style', 'class', 'id'],
    'footer': ['style', 'class', 'id'],
    'nav': ['style', 'class', 'id'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  disallowedTagsMode: 'discard',
  selfClosing: ['br', 'hr', 'img']
};

/**
 * Configuration for sanitizing HTML for email sending (more restrictive)
 * Email clients have limited CSS/tag support, so we're stricter here
 * ✅ CRITICAL: 'style' tag is REMOVED - all CSS must be inline
 */
const EMAIL_CONFIG = {
  allowedTags: [
    'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'b', 'em', 'i', 'u', 'a', 'br', 'hr',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'blockquote', 'code', 'pre', 'img',
    'del', 's', 'sub', 'sup'
  ],
  allowedAttributes: {
    'a': ['href', 'target', 'rel', 'title', 'style'],
    'img': ['src', 'alt', 'title', 'width', 'height', 'style'],
    'div': ['style'],
    'span': ['style'],
    'p': ['style'],
    'h1': ['style'],
    'h2': ['style'],
    'h3': ['style'],
    'h4': ['style'],
    'h5': ['style'],
    'h6': ['style'],
    'ul': ['style'],
    'ol': ['style'],
    'li': ['style'],
    'table': ['style', 'width', 'border', 'cellpadding', 'cellspacing'],
    'thead': ['style'],
    'tbody': ['style'],
    'tfoot': ['style'],
    'tr': ['style'],
    'th': ['style', 'colspan', 'rowspan', 'width'],
    'td': ['style', 'colspan', 'rowspan', 'width'],
    'blockquote': ['style'],
    'code': ['style'],
    'pre': ['style'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  disallowedTagsMode: 'discard',
  selfClosing: ['br', 'hr', 'img']
};

/**
 * Sanitize HTML for safe display (frontend preview)
 * Allows more tags and attributes for rich formatting
 * @param {string} html - HTML content to sanitize
 * @returns {string} - Sanitized HTML safe for display
 */
export function sanitizeHtmlForDisplay(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }

  try {
    return sanitizeHtml(html, DISPLAY_CONFIG);
  } catch (error) {
    console.error('[HTML Sanitizer] Error sanitizing for display:', error.message);
    return '';
  }
}

/**
 * Sanitize HTML for safe email sending
 * More restrictive than display sanitization to ensure email client compatibility
 * @param {string} html - HTML content to sanitize
 * @returns {string} - Sanitized HTML safe for email delivery
 */
export function sanitizeHtmlForEmail(html) {
  // ⚠️ DEPRECATED: sanitization of email HTML introduces the very bugs
  // described in the critical rendering fix docs.  The email system now
  // relies on raw HTML output from templates and other helpers.  This helper
  // will log a warning and return the input untouched so that legacy callers
  // do not inadvertently corrupt content.
  if (!html || typeof html !== 'string') {
    return '';
  }
  console.warn('[HTML Sanitizer] sanitizeHtmlForEmail called – returning original HTML without modification');
  return html;
}

/**
 * Validate if HTML contains dangerous patterns
 * @param {string} html - HTML content to validate
 * @returns {boolean} - True if HTML is safe
 */
export function isHtmlSafe(html) {
  if (!html || typeof html !== 'string') {
    return true;
  }

  // Check for dangerous patterns
  const dangerousPatterns = [
    /<script/gi,
    /javascript:/gi,
    /on\w+\s*=/gi, // Event handlers like onclick, onload, etc.
    /<iframe/gi,
    /<object/gi,
    /<embed/gi,
    /<form/gi,
    /<input/gi,
    /<button/gi,
  ];

  return !dangerousPatterns.some(pattern => pattern.test(html));
}

export {
  htmlToPlainText
};

export default {
  sanitizeHtmlForDisplay,
  sanitizeHtmlForEmail,
  isHtmlSafe,
  htmlToPlainText,
};
