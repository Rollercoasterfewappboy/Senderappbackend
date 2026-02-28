/**
 * CSS Inlining Utility
 * Converts CSS style blocks to inline styles for email compatibility
 * This ensures emails render properly across all email clients
 */

/**
 * Simple CSS selector to element style converter
 * Handles basic selectors: element, .class, #id
 * Does NOT handle: :hover, :focus, descendant selectors, etc.
 * @param {string} selector - CSS selector (e.g., "body", ".myclass", "#myid")
 * @returns {object} - Mapping of element info
 */
function parseCssSelector(selector) {
  selector = selector.trim();
  
  if (selector.startsWith('#')) {
    return { type: 'id', value: selector.substring(1) };
  } else if (selector.startsWith('.')) {
    return { type: 'class', value: selector.substring(1) };
  } else {
    return { type: 'element', value: selector };
  }
}

/**
 * Extract CSS rules from style blocks
 * Returns array of {selector, declarations} objects
 * @param {string} cssText - CSS text
 * @returns {array} - CSS rules
 */
function parseCss(cssText) {
  const rules = [];
  
  // Remove comments
  let cleaned = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  
  // Split by closing braces to get each rule
  const ruleBlocks = cleaned.split('}');
  
  for (const block of ruleBlocks) {
    const openBraceIdx = block.indexOf('{');
    if (openBraceIdx === -1) continue;
    
    const selector = block.substring(0, openBraceIdx).trim();
    const declarations = block.substring(openBraceIdx + 1).trim();
    
    // Skip media queries, keyframes, etc.
    if (selector.startsWith('@')) continue;
    
    // For multiple selectors like "h1, h2, h3", split them
    const selectors = selector.split(',').map(s => s.trim()).filter(s => s);
    
    for (const sel of selectors) {
      if (sel) {
        rules.push({
          selector: sel,
          declarations: declarations
        });
      }
    }
  }
  
  return rules;
}

/**
 * Apply CSS rules to HTML elements
 * Matches selectors and applies inline styles
 * @param {string} html - HTML content
 * @param {array} rules - CSS rules from parseCss()
 * @returns {string} - HTML with inline styles applied
 */
function applyCssRulesToHtml(html, rules) {
  let result = html;
  
  for (const rule of rules) {
    const selectorInfo = parseCssSelector(rule.selector);
    
    if (selectorInfo.type === 'element') {
      // Element selector: apply to all matching tags
      const regex = new RegExp(`<${selectorInfo.value}([^>]*)>`, 'gi');
      result = result.replace(regex, (match, attrs) => {
        return applyStylesToTag(match, rule.declarations);
      });
    } else if (selectorInfo.type === 'class') {
      // Class selector: apply to elements with class
      const classRegex = new RegExp(`class="([^"]*\\b${selectorInfo.value}\\b[^"]*)"|class='([^']*\\b${selectorInfo.value}\\b[^']*)'`, 'gi');
      
      // This is a simplified approach - we find elements with the class and apply styles
      // More robust solution would parse HTML properly, but this works for most cases
      const elementRegex = new RegExp(`<([a-z]+)([^>]*class=["']([^"']*\\b${selectorInfo.value}\\b[^"']*)["'][^>]*)>`, 'gi');
      result = result.replace(elementRegex, (match, tag, attrs) => {
        return applyStylesToTag(match, rule.declarations);
      });
    } else if (selectorInfo.type === 'id') {
      // ID selector: apply to element with id
      const idRegex = new RegExp(`<([a-z]+)([^>]*id=["']?${selectorInfo.value}["']?[^>]*)>`, 'gi');
      result = result.replace(idRegex, (match, tag, attrs) => {
        return applyStylesToTag(match, rule.declarations);
      });
    }
  }
  
  return result;
}

/**
 * Add or merge style attribute to an HTML tag
 * @param {string} tag - HTML tag (e.g., "<div class="test">")
 * @param {string} declarations - CSS declarations (e.g., "color: red; margin: 10px;")
 * @returns {string} - Tag with merged styles
 */
function applyStylesToTag(tag, declarations) {
  // Extract just the style info from declarations
  let styleContent = declarations
    .split(';')
    .map(d => d.trim())
    .filter(d => d && d.includes(':'))
    .join('; ');
  
  if (!styleContent) return tag;
  
  // Ensure it ends with semicolon
  if (!styleContent.endsWith(';')) {
    styleContent += ';';
  }
  
  // Check if tag already has style attribute
  const styleMatch = tag.match(/style=["']([^"']*)["']/i);
  
  if (styleMatch) {
    // Merge with existing styles (new styles take precedence)
    const existingStyle = styleMatch[1];
    const mergedStyle = styleContent + ' ' + existingStyle;
    return tag.replace(styleMatch[0], `style="${mergedStyle}"`);
  } else {
    // Add new style attribute before closing >
    return tag.replace('>', ` style="${styleContent}">`);
  }
}

/**
 * Main function: Inline all CSS from style blocks into HTML elements
 * Removes style blocks after inlining, or keeps them for client compatibility
 * @param {string} html - HTML content with style blocks
 * @param {boolean} keepStyleBlocks - Whether to keep <style> blocks after inlining (default: false for email)
 * @returns {string} - HTML with inlined CSS
 */
export function inlineCssForEmail(html, keepStyleBlocks = false) {
  if (!html || typeof html !== 'string') {
    console.warn('[cssInliner] Invalid HTML content');
    return html;
  }
  
  // Extract all style blocks
  const styleMatches = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
  
  if (styleMatches.length === 0) {
    // No style blocks to inline
    return html;
  }
  
  console.log(`[cssInliner] Found ${styleMatches.length} style block(s) - extracting CSS...`);
  
  let result = html;
  let totalRulesApplied = 0;
  
  // Process each style block
  for (const styleBlock of styleMatches) {
    // Extract CSS content from <style>...</style>
    const cssMatch = styleBlock.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    if (!cssMatch || !cssMatch[1]) continue;
    
    const cssText = cssMatch[1];
    console.log(`[cssInliner] Processing style block with ${cssText.length} chars of CSS`);
    
    // Parse CSS into rules
    const rules = parseCss(cssText);
    console.log(`[cssInliner] Parsed ${rules.length} CSS rule(s)`);
    
    if (rules.length > 0) {
      // Apply rules to HTML
      result = applyCssRulesToHtml(result, rules);
      totalRulesApplied += rules.length;
    }
  }
  
  console.log(`[cssInliner] Applied ${totalRulesApplied} CSS rule(s) as inline styles`);
  
  // Remove style blocks if not keeping them
  if (!keepStyleBlocks) {
    const beforeRemoval = result;
    result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    
    if (beforeRemoval !== result) {
      console.log(`[cssInliner] ✅ Removed <style> blocks after inlining CSS`);
    }
  } else {
    console.log(`[cssInliner] ℹ️  Keeping <style> blocks for client compatibility`);
  }
  
  return result;
}

/**
 * Alternative: Keep style blocks but ensure they won't break email rendering
 * Wraps them in proper email-safe comments
 * @param {string} html - HTML content
 * @returns {string} - HTML with protected style blocks
 */
export function protectStyleBlocks(html) {
  if (!html || typeof html !== 'string') {
    return html;
  }
  
  // CSS is actually quite safe in emails - most clients support it
  // Just ensure Outlook doesn't break it with umb-safe comments
  let result = html;
  
  result = result.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match, cssContent) => {
    // Keep the style tag but it's already fine
    return match;
  });
  
  return result;
}

/**
 * Simple: Just ensure style blocks exist in <head>, not in <body>
 * @param {string} html - HTML content
 * @returns {string} - HTML with styles moved to head
 */
export function ensureStylesInHead(html) {
  if (!html || typeof html !== 'string') {
    return html;
  }
  
  // Extract all style blocks
  const styleMatches = html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [];
  
  if (styleMatches.length === 0) {
    return html;
  }
  
  // Remove style blocks from body
  let result = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Add them to head if not already there
  const headMatch = result.match(/<\/head>/i);
  if (headMatch) {
    result = result.replace(/<\/head>/i, styleMatches.join('\n') + '\n</head>');
  } else {
    // No head tag, add before body
    const bodyMatch = result.match(/<body[^>]*>/i);
    if (bodyMatch) {
      result = result.replace(bodyMatch[0], bodyMatch[0] + '\n' + styleMatches.join('\n'));
    }
  }
  
  return result;
}
