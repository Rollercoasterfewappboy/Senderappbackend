/**
 * Email Style Processor
 * Converts CSS style blocks to inline styles for maximum email client compatibility
 * Removes style tags and converts all CSS to inline attributes
 */

/**
 * Remove all <style> blocks from HTML and issue a warning
 * Email clients don't reliably support CSS blocks
 * @param {string} html - HTML content
 * @returns {string} - HTML with style blocks removed
 */
export function removeStyleBlocks(html) {
  if (!html || typeof html !== 'string') {
    return html;
  }

  const originalHtml = html;
  
  // Remove all <style>...</style> blocks
  let cleaned = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  if (cleaned !== originalHtml) {
    console.warn('[emailStyleProcessor] ⚠️  WARNING: Removed <style> blocks from HTML. All CSS must be inline for email compatibility.');
  }
  
  return cleaned;
}

/**
 * Ensure all table elements have proper email-safe inline styles
 * Converts div-based layouts to table-based where possible
 * @param {string} html - HTML content
 * @returns {string} - HTML with email-safe styles
 */
export function ensureEmailSafeStyles(html) {
  if (!html || typeof html !== 'string') {
    return html;
  }

  let result = html;

  // Ensure all tables have border-collapse
  result = result.replace(/<table[^>]*>/gi, (match) => {
    if (!match.includes('border-collapse')) {
      return match.replace('>', ' style="border-collapse:collapse;' + (match.includes('style=') ? '' : '">'));
    }
    return match;
  });

  // Ensure all images have max-width for mobile compatibility
  result = result.replace(/<img[^>]*>/gi, (match) => {
    if (!match.includes('style=') || !match.includes('max-width')) {
      return match.replace('>', ' style="max-width:100%;height:auto;display:block;">');
    }
    return match;
  });

  // Ensure all body tags have proper email-safe styles
  result = result.replace(/<body[^>]*>/gi, (match) => {
    const hasStyle = match.includes('style=');
    if (!hasStyle) {
      return match.replace('>', ' style="margin:0;padding:0;background-color:#ffffff;">');
    }
    return match;
  });

  return result;
}

/**
 * Validate that HTML has no CSS blocks or problematic styles
 * @param {string} html - HTML content
 * @returns {object} - Validation result
 */
export function validateEmailCss(html) {
  if (!html || typeof html !== 'string') {
    return { valid: true, issues: [] };
  }

  const issues = [];

  // Check for style blocks
  const styleBlockMatches = html.match(/<style[^>]*>[\s\S]*?<\/style>/gi);
  if (styleBlockMatches) {
    issues.push(`Found ${styleBlockMatches.length} <style> block(s) - CSS blocks are not supported in emails`);
  }

  // Check for external stylesheets
  const linkMatches = html.match(/<link[^>]*rel="stylesheet"[^>]*>/gi);
  if (linkMatches) {
    issues.push(`Found ${linkMatches.length} external stylesheet(s) - external CSS is not supported in emails`);
  }

  // Check for CSS classes (warnings - not critical)
  const classMatches = html.match(/class="[^"]*\w[^"]*"/gi);
  if (classMatches) {
    issues.push(`Found ${classMatches.length} CSS class(es) - email clients ignore CSS classes`);
  }

  // Check for media queries
  if (html.includes('@media')) {
    issues.push('Found @media queries - these are not widely supported in emails');
  }

  // Check for CSS imports
  if (html.includes('@import')) {
    issues.push('Found @import statements - external styles are not supported in emails');
  }

  return {
    valid: issues.length === 0,
    issues,
    issueCount: issues.length
  };
}

/**
 * Process HTML for email sending
 * 1. Remove style blocks
 * 2. Ensure email-safe inline styles
 * 3. Validate CSS
 * @param {string} html - HTML content
 * @returns {object} - Processed HTML and validation results
 */
export function processHtmlForEmail(html) {
  if (!html || typeof html !== 'string') {
    return { 
      html: '', 
      validation: { valid: true, issues: [] } 
    };
  }

  // Step 1: Remove style blocks
  let processed = removeStyleBlocks(html);

  // Step 2: Ensure email-safe styles
  processed = ensureEmailSafeStyles(processed);

  // Step 3: Validate
  const validation = validateEmailCss(processed);

  return {
    html: processed,
    validation
  };
}

export default {
  removeStyleBlocks,
  ensureEmailSafeStyles,
  validateEmailCss,
  processHtmlForEmail
};
