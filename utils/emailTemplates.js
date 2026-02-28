/**
 * Professional Email Template Generator
 * Generates email-safe HTML using industry-standard practices
 * - Uses table-based layouts (universal email client support)
 * - Only inline CSS (no <style> blocks to prevent CSS leaking)
 * - Complete HTML document structure
 * - Optimized for Gmail, Outlook, Yahoo, iOS Mail, Android Mail
 */

/**
 * Check if HTML is a complete document (not a fragment)
 * Complete documents have DOCTYPE and html/body tags
 */
function isCompleteHtmlDocument(html) {
  if (!html || typeof html !== 'string') return false;
  const hasDoctype = /<!DOCTYPE/i.test(html);
  const hasHtmlTag = /<html[^>]*>/i.test(html);
  const hasBodyTag = /<body[^>]*>/i.test(html);
  return hasDoctype && hasHtmlTag && hasBodyTag;
}

/**
 * Extract just the body content from a complete HTML document
 * Returns the content between <body> and </body> tags
 */
export function extractBodyContent(html) {
  if (!html || typeof html !== 'string') return html;
  
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch && bodyMatch[1]) {
    console.log('[emailTemplates] Extracted body content from complete HTML document');
    return bodyMatch[1].trim();
  }
  
  return html;
}

/**
 * Generate professional email-safe HTML wrapper
 * Uses table-based layout with maximum email client compatibility
 * All CSS is inline to prevent style blocks from appearing as text
 *
 * Intelligently handles both complete HTML documents and fragments:
 * - If input is a complete document, sends it as-is (no wrapping needed)
 * - If input is a fragment, wraps it in a table-based layout
 *
 * @param {string} content - The email content (partial HTML or complete document)
 * @returns {string} - Complete, email-safe HTML document
 */
export function generateProfessionalEmailTemplate(content = '') {
  // If the content is already a complete HTML document, send it as-is
  // No wrapping needed - it already has proper structure
  if (isCompleteHtmlDocument(content)) {
    console.log('[emailTemplates] Complete HTML document detected - sending as-is without wrapper to preserve structure');
    return content;
  }
  
  let actualContent = content;
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="format-detection" content="telephone=no">
  <meta name="format-detection" content="date=no">
  <meta name="format-detection" content="address=no">
  <meta name="format-detection" content="email=no">
  <title>Email</title>
  <style type="text/css">
    /* Email-safe CSS for content formatting */
    body { margin: 0; padding: 0; }
    p { margin: 0 0 16px 0; padding: 0; line-height: 1.6; }
    p:last-child { margin-bottom: 0; }
    h1, h2, h3, h4, h5, h6 { margin: 20px 0 10px 0; padding: 0; }
    ul, ol { margin: 16px 0 16px 20px; }
    li { margin: 8px 0; }
    a { color: #0066cc; text-decoration: underline; }
  </style>
</head>
<body style="margin:0;padding:0;min-width:100%!important;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:1.6;color:#333333;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <!-- Main container table -->
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;background-color:#ffffff;margin:0;padding:0;border-collapse:collapse;">
    <tbody>
      <!-- Center content -->
      <tr>
        <td align="center" style="padding:0;margin:0;background-color:#ffffff;">
          <!-- Content wrapper table -->
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;width:100%;margin:0;padding:0;background-color:#ffffff;border-collapse:collapse;">
            <tbody>
              <!-- Header spacer -->
              <tr>
                <td style="padding:0;margin:0;height:0;width:100%;border-collapse:collapse;"></td>
              </tr>
              
              <!-- Main content cell -->
              <tr>
                <td style="padding:24px 16px;margin:0;word-wrap:break-word;word-break:break-word;overflow-wrap:break-word;-webkit-hyphens:auto;-moz-hyphens:auto;hyphens:auto;border-collapse:collapse;">
                  <!-- Content container with normalization -->
                  <div style="max-width:600px;width:100%;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:1.6;color:#333333;word-wrap:break-word;">
                    ${actualContent}
                  </div>
                </td>
              </tr>
              
              <!-- Footer spacer -->
              <tr>
                <td style="padding:0;margin:0;height:0;width:100%;border-collapse:collapse;"></td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;
}

/**
 * Create email-safe button/CTA HTML with inline styling
 * Uses padding and border instead of modern button styling for maximum compatibility
 *
 * @param {string} text - Button text
 * @param {string} url - Button URL
 * @param {object} options - Styling options
 * @returns {string} - Email-safe button HTML
 */
export function generateEmailButton(text, url, options = {}) {
  const {
    backgroundColor = '#0066cc',
    textColor = '#ffffff',
    fontSize = '16px',
    paddingH = '24px',
    paddingV = '12px',
    borderRadius = '4px',
    marginTop = '20px',
    marginBottom = '20px'
  } = options;

  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:${marginTop} auto ${marginBottom};border-collapse:collapse;">
    <tbody>
      <tr>
        <td style="border-collapse:collapse;-webkit-border-radius:${borderRadius};-moz-border-radius:${borderRadius};border-radius:${borderRadius};background-color:${backgroundColor};text-align:center;">
          <a href="${url}" style="display:inline-block;padding:${paddingV} ${paddingH};background-color:${backgroundColor};color:${textColor};font-size:${fontSize};font-weight:bold;line-height:1.2;text-decoration:none;text-align:center;border-radius:${borderRadius};border:1px solid ${backgroundColor};margin:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;" target="_blank">${text}</a>
        </td>
      </tr>
    </tbody>
  </table>`;
}

/**
 * Create email-safe divider/separator
 *
 * @param {object} options - Styling options
 * @returns {string} - Email-safe divider HTML
 */
export function generateEmailDivider(options = {}) {
  const {
    color = '#cccccc',
    height = '1px',
    marginTop = '20px',
    marginBottom = '20px',
    width = '100%'
  } = options;

  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:${width};margin:${marginTop} 0 ${marginBottom};border-collapse:collapse;">
    <tbody>
      <tr>
        <td style="border-collapse:collapse;background-color:${color};height:${height};margin:0;padding:0;"></td>
      </tr>
    </tbody>
  </table>`;
}

/**
 * Sanitize inline styles to be email-safe
 * Removes problematic CSS properties that email clients don't support
 *
 * @param {string} styleString - CSS style string
 * @returns {string} - Sanitized style string
 */
export function sanitizeInlineStyles(styleString) {
  if (!styleString || typeof styleString !== 'string') {
    return '';
  }

  // Properties to remove (not widely supported in email clients)
  const problematicProperties = [
    'box-shadow',
    'text-shadow',
    'filter',
    'backdrop-filter',
    'transform',
    'transition',
    'animation',
    'position',
    'z-index',
    'clip-path',
    'mask',
    'mask-image',
    'flex-grow',
    'flex-shrink',
    'flex-basis',
    'grid-',
    'display: grid',
    'display: flex'
  ];

  let sanitized = styleString;

  // Remove problematic properties
  problematicProperties.forEach(prop => {
    const regex = new RegExp(`${prop}[^;]*;?`, 'gi');
    sanitized = sanitized.replace(regex, '');
  });

  // Clean up double semicolons
  sanitized = sanitized.replace(/;;/g, ';').trim();

  // Ensure no trailing semicolon issues
  if (sanitized.endsWith(';')) {
    sanitized = sanitized.slice(0, -1);
  }

  return sanitized;
}

/**
 * Convert div-based layout to table-based layout for email
 * Helpful for converting existing HTML to email-safe format
 * Note: This is a simple converter; complex layouts may need manual adjustment
 *
 * @param {string} html - HTML with div-based layout
 * @returns {string} - HTML with table-based layout
 */
export function convertDivsToTables(html) {
  if (!html || typeof html !== 'string') {
    return html;
  }

  let converted = html;

  // Replace container divs with table containers
  // Note: This is a basic replacement; complex nested divs may need manual work
  converted = converted.replace(/<div\s+class="[^"]*container[^"]*"[^>]*>/gi, '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tbody><tr><td>');
  converted = converted.replace(/<\/div>\s*<!--\s*\/container\s*-->/gi, '</td></tr></tbody></table>');

  return converted;
}

/**
 * Validate email HTML for common rendering issues
 *
 * @param {string} html - HTML content to validate
 * @returns {object} - Validation result with issues found
 */
export function validateEmailHtml(html) {
  const issues = [];

  if (!html || typeof html !== 'string') {
    return { valid: false, issues: ['HTML is empty or not a string'] };
  }

  // Check for DOCTYPE
  if (!html.includes('<!DOCTYPE')) {
    issues.push('Missing DOCTYPE declaration');
  }

  // Check for problematic CSS
  if (/<style[^>]*>[\s\S]*?<\/style>/gi.test(html)) {
    issues.push('CSS in <style> blocks may be visible as text in some email clients - consider using inline styles instead');
  }

  // Check for extern stylesheets
  if (/<link[^>]*rel="stylesheet"[^>]*>/gi.test(html)) {
    issues.push('External stylesheets are not supported in email - use inline styles instead');
  }

  // Check for script tags
  if (/<script[^>]*>[\s\S]*?<\/script>/gi.test(html)) {
    issues.push('Script tags are not supported in email and should be removed');
  }

  // Check for CSS classes
  if (/class="[^"]*\w[^"]*"/gi.test(html)) {
    const classCount = (html.match(/class="[^"]*\w[^"]*"/gi) || []).length;
    issues.push(`${classCount} CSS classes found - email clients ignore classes; use inline styles instead`);
  }

  // Check for problematic inline styles
  if (/style="[^"]*(?:animation|transform|filter|position|z-index)[^"]*"/gi.test(html)) {
    issues.push('Problematic CSS properties detected (animation, transform, filter, position, z-index) - these may not work in email clients');
  }

  // Check for div-based layout
  const divCount = (html.match(/<div[^>]*>/gi) || []).length;
  if (divCount > 5) {
    issues.push(`${divCount} div elements found - consider using tables for email layouts for better compatibility`);
  }

  // Check for proper head/body
  if (!html.toLowerCase().includes('<html')) {
    issues.push('Missing <html> tag');
  }
  if (!html.toLowerCase().includes('<body')) {
    issues.push('Missing <body> tag');
  }

  // Check for meta charset
  if (!html.includes('charset') && !html.includes('UTF-8')) {
    issues.push('Missing charset declaration - add <meta charset="UTF-8">');
  }

  // Check for viewport meta tag
  if (!html.includes('viewport')) {
    issues.push('Missing viewport meta tag - may not render properly on mobile');
  }

  return {
    valid: issues.length === 0,
    issues,
    issueCount: issues.length
  };
}

export default {
  generateProfessionalEmailTemplate,
  generateEmailButton,
  generateEmailDivider,
  sanitizeInlineStyles,
  convertDivsToTables,
  validateEmailHtml
};
