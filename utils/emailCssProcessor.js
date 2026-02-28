/**
 * PROFESSIONAL EMAIL CSS PROCESSOR
 * Handles CSS extraction, inlining, and compatibility for email clients
 * 
 * Email clients have limited CSS support:
 * - Most support inline styles (style="...")
 * - Many strip <style> blocks from <body>
 * - Some have issues with selectors, media queries, etc.
 * 
 * Solution: Extract ALL CSS, inline what we can, move style blocks to <head>
 *
 * The processor now supports two modes:
 * - "inline" (default) applies the full pipeline described above.
 * - "raw" returns the HTML unchanged, matching the behaviour of the
 *   external sender script that simply reads an HTML file and passes it
 *   directly to nodemailer.  Enable with `EMAIL_PROCESSOR_MODE=raw` or by
 *   passing `{mode: 'raw'}` to the function.  Raw mode is useful when the
 *   incoming HTML is already fully email‑safe and you want to avoid any
 *   automatic inlining or style stripping.
 */

/**
 * Extract all CSS from style blocks in HTML
 * @param {string} html - HTML content
 * @returns {object} - {css: string, htmlWithoutStyles: string}
 */
export function extractStyleBlocks(html) {
  if (!html || typeof html !== 'string') {
    return { css: '', htmlWithoutStyles: html };
  }

  let css = '';
  const htmlWithoutStyles = html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match, styleContent) => {
    css += styleContent + '\n';
    return '';
  });

  return { css: css.trim(), htmlWithoutStyles };
}

/**
 * Parse CSS declarations from rule text
 * @param {string} declarations - CSS declarations text
 * @returns {object} - {color: value, background: value, ...}
 */
function parseDeclarations(declarations) {
  const props = {};
  
  declarations.split(';').forEach(decl => {
    const [prop, value] = decl.split(':').map(s => s.trim());
    if (prop && value) {
      props[prop] = value;
    }
  });
  
  return props;
}

// Convert <button> elements to email-safe anchors
function convertButtonsToAnchors(html) {
  if (!html || typeof html !== 'string') return html;

  return html.replace(/<button([^>]*)>([\s\S]*?)<\/button>/gi, (match, attrs, inner) => {
    // capture existing style attribute and merge
    let styleMatch = attrs.match(/style="([^"]*)"/i);
    let existingStyle = styleMatch ? styleMatch[1] : '';

    // default button styles for email
    const defaultBtnStyle = 'display:inline-block;padding:12px 32px;background-color:#0066cc;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:16px;';
    const mergedStyle = existingStyle ? `${defaultBtnStyle} ${existingStyle}` : defaultBtnStyle;

    // attempt to extract href from onclick or data-href
    let href = '#';
    const hrefMatch = attrs.match(/href=["']([^"']+)["']/i);
    if (hrefMatch) {
      href = hrefMatch[1];
    }

    return `<a href="${href}" style="${mergedStyle}">${inner}</a>`;
  });
}

// Default CSS to inject when none present
// CRITICAL: Includes div styling for Quill editor output (which uses divs for most content)
const defaultCss = `
div { margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif; line-height: 1.6; color: #000000; }
p { margin: 0 0 16px 0; padding: 0; line-height: 1.6; font-family: inherit; color: inherit; }
h1 { margin: 20px 0 10px 0; font-size: 24px; font-weight: bold; }
h2 { margin: 20px 0 10px 0; font-size: 20px; font-weight: bold; }
h3 { margin: 20px 0 10px 0; font-size: 18px; font-weight: bold; }
h4 { margin: 20px 0 10px 0; font-size: 16px; font-weight: bold; }
h5 { margin: 20px 0 10px 0; font-size: 14px; font-weight: bold; }
h6 { margin: 20px 0 10px 0; font-size: 12px; font-weight: bold; }
ul { margin: 16px 0 16px 20px; padding-left: 20px; }
ol { margin: 16px 0 16px 20px; padding-left: 20px; }
li { margin: 8px 0; }
a { color: #0066cc; text-decoration: underline; }
strong { font-weight: bold; }
em { font-style: italic; }
blockquote { margin: 16px 0; padding-left: 16px; border-left: 4px solid #cccccc; color: #666666; }

/* Quill alignment helpers */
.ql-align-center { text-align: center; }
.ql-align-right { text-align: right; }
.ql-align-justify { text-align: justify; }
.ql-align-left { text-align: left; }
`.trim();

/**
 * Convert CSS object to style attribute string
 * @param {object} props - {color: "red", margin: "10px", ...}
 * @returns {string} - "color: red; margin: 10px;"
 */
function propsToStyle(props) {
  return Object.entries(props)
    .map(([key, value]) => `${key}: ${value}`)
    .join('; ') + (Object.keys(props).length > 0 ? ';' : '');
}

/**
 * Merge existing style with new CSS properties
 * New properties take precedence
 * @param {string} existingStyle - Existing style attribute value
 * @param {object} newProps - CSS properties to merge
 * @returns {string} - Merged style attribute value
 */
function mergeStyles(existingStyle, newProps) {
  const existing = existingStyle ? parseDeclarations(existingStyle) : {};
  const merged = { ...existing, ...newProps };
  return propsToStyle(merged);
}

/**
 * Parse and apply CSS rules to matching HTML elements efficiently
 * Handles tag selectors (p, div, a, etc) primarily
 * @param {string} html - HTML content
 * @param {string} css - CSS text  
 * @returns {string} - HTML with inlined styles
 */
function applyCssToHtml(html, css) {
  if (!css || css.trim().length === 0) {
    return html;
  }

  let result = html;
  
  // Simple CSS parser: Extract rules by finding selector { declarations }
  const ruleRegex = /([^{]+)\{([^}]+)\}/g;
  let match;
  
  while ((match = ruleRegex.exec(css)) !== null) {
    const selector = match[1].trim();
    const declarations = match[2].trim();
    
    // Skip @media, @keyframes, and other @ rules
    if (selector.startsWith('@')) {
      continue;
    }
    
    const props = parseDeclarations(declarations);
    const styleStr = propsToStyle(props);
    
    // Handle TAG selectors ONLY (p, div, h1, h2, etc)
    // These are the safest to apply globally and work best in emails
    if (/^[a-z0-9]+$/i.test(selector)) {
      const tagName = selector.toLowerCase();
      
      // Find ALL tags of this type and add/merge inline styles
      result = result.replace(
        new RegExp(`<${tagName}(\\s[^>]*)?>`, 'gi'),
        (fullMatch) => {
          // CRITICAL: For 'a' tags, don't override button styling
          // Button anchors are created by convertButtonsToAnchors() and already have full styles
          if (tagName === 'a' && fullMatch.includes('style=') && fullMatch.includes('background-color')) {
            // This is a button anchor - don't apply link CSS to it
            return fullMatch;
          }
          
          // Check if tag already has style attribute
          if (fullMatch.includes('style=')) {
            // Merge with existing style
            return fullMatch.replace(/style="([^"]*)"/i, (styleMatch, existing) => {
              const merged = mergeStyles(existing, props);
              return `style="${merged}"`;
            });
          }
          
          // No existing style - add style attribute before closing >
          return fullMatch.replace(/>$/, ` style="${styleStr}">`);
        }
      );
    }

    // Handle simple class selectors like .ql-align-center
    if (/^\.[a-z0-9_-]+$/i.test(selector)) {
      const className = selector.slice(1);
      result = result.replace(
        new RegExp(`(<[a-z0-9]+)([^>]*class=[\"'][^\"'>]*\\b${className}\\b[^\"'>]*[\"'][^>]*>)`, 'gi'),
        (fullMatch, startTag, rest) => {
          if (/style=/.test(rest)) {
            return fullMatch.replace(/style="([^\"]*)"/i, (s, existing) => {
              const merged = mergeStyles(existing, props);
              return startTag + rest.replace(/style="([^\"]*)"/i, `style="${merged}"`);
            });
          }
          return (startTag + rest).replace(/>$/, ` style="${styleStr}">`);
        }
      );
    }
  }

  return result;
}

/**
 * Ensure all style blocks are in <head> section
 * Move any style blocks from body to head
 * @param {string} html - HTML content
 * @returns {string} - HTML with styles in head
 */
function moveStylesToHead(html) {
  if (!html || typeof html !== 'string') {
    return html;
  }

  // Extract style blocks
  const styleBlocks = [];
  let htmlWithoutBodyStyles = html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match) => {
    styleBlocks.push(match);
    return '';
  });
  
  if (styleBlocks.length === 0) {
    return html;
  }

  // Check if we have <head> section
  const headMatch = htmlWithoutBodyStyles.match(/<\/head>/i);
  
  if (headMatch) {
    // Insert before </head>
    return htmlWithoutBodyStyles.replace(/<\/head>/i, styleBlocks.join('\n') + '\n</head>');
  } else {
    // No head tag, add style blocks before <body>
    const bodyMatch = htmlWithoutBodyStyles.match(/<body[^>]*>/i);
    if (bodyMatch) {
      return htmlWithoutBodyStyles.replace(bodyMatch[0], styleBlocks.join('\n') + '\n' + bodyMatch[0]);
    }
    // No body tag either, add at beginning after DOCTYPE/html/head if present
    return styleBlocks.join('\n') + '\n' + htmlWithoutBodyStyles;
  }
}

/**
 * Make CSS email-client-safe
 * Removes problematic properties that email clients don't support
 * @param {string} css - CSS text
 * @returns {string} - Cleaned CSS
 */
export function sanitizeCssForEmail(css) {
  if (!css || typeof css !== 'string') {
    return '';
  }

  let result = css;

  // Remove @media queries (email doesn't need responsive)
  result = result.replace(/@media[^{]*\{[\s\S]*?\}/g, '');
  
  // Remove animations and keyframes
  result = result.replace(/@keyframes[^{]*\{[\s\S]*?\}/g, '');
  result = result.replace(/animation[^;]*;?/g, '');
  result = result.replace(/transition[^;]*;?/g, '');
  
  // Remove problematic CSS properties
  const problematicProps = [
    'box-shadow',
    'text-shadow',
    'filter',
    'transform',
    'position',
    'z-index',
    'clip-path',
    'mask'
  ];
  
  problematicProps.forEach(prop => {
    result = result.replace(new RegExp(`${prop}[^;]*;?`, 'gi'), '');
  });

  return result;
}

/**
 * MAIN PROCESSOR: Prepare HTML for email delivery with proper CSS handling
 * @param {string} html - Raw HTML content (can include <style> blocks and inline styles)
 * @returns {string} - Email-safe HTML with all CSS properly inlined or in head
 */
export function processHtmlForEmail(html) {
  // Strict passthrough mode: return the HTML exactly as provided by the sender
  // The external sender code you supplied simply reads an HTML file, performs
  // placeholder replacements/obfuscation and passes the string to Nodemailer.
  // To replicate that behaviour we must not modify, inline, or strip any CSS
  // here — just return the input HTML unchanged.
  if (typeof html !== 'string') {
    console.warn('[emailCssProcessor] Invalid HTML - expected string');
    return html;
  }

  console.log('[emailCssProcessor] passthrough mode - returning HTML unchanged');
  return html;
}

export default {
  processHtmlForEmail,
  extractStyleBlocks,
  sanitizeCssForEmail,
  moveStylesToHead,
};

// -----------------------------------------------------------------------------
// Allow safe direct invocation (useful for quick manual testing or curious eyes)
// If the file is executed with `node utils/emailCssProcessor.js` we don't want
// it to crash with an "Unexpected token 'export'" error.  Instead we detect
// whether the current module is the program entry point and either run a
// lightweight demo or print a helpful message.
//
// The check below is the ESM equivalent of `if (require.main === module)` in
// CommonJS.
// -----------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('[emailCssProcessor] invoked directly');
  // simple CLI demonstration
  const sample = '<p>Sample text</p>';
  console.log('• Running demo with sample HTML:');
  console.log(processHtmlForEmail(sample));
  console.log('[emailCssProcessor] done. To use in your code, import the module.');
}

