import { htmlToText as htmlToTextLib } from 'html-to-text';

/**
 * Robust HTML to Plain Text conversion using `html-to-text` with a safe fallback.
 * This is the professional-grade conversion used before sending multipart emails.
 */
export function htmlToPlainText(html) {
  if (!html) return '';

  try {
    const text = htmlToTextLib(html, {
      wordwrap: 130,
      selectors: [
        { selector: 'a', options: { hideLinkHrefIfSameAsText: false } },
        { selector: 'img', format: 'skip' },
      ],
      baseElements: { selectors: ['body'] },
      preserveNewlines: true,
      tables: true,
    });

    return (text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch (err) {
    console.error('[htmlToPlainText] html-to-text conversion failed, falling back:', err.message);
    return fallbackHtmlToPlainText(html);
  }
}

// Fallback implementation (previous regex-based converter)
function fallbackHtmlToPlainText(html) {
  if (!html) return '';

  let text = html;

  // Remove script and style elements
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Convert line breaks
  text = text.replace(/<br\s*\/?/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n');
  text = text.replace(/<\/blockquote>/gi, '\n');

  // Convert headings with some emphasis
  text = text.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n$1\n');

  // Convert horizontal rules
  text = text.replace(/<hr\s*\/?/gi, '\n---\n');

  // Convert list items with bullets/numbers
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, (match, content) => {
    return '• ' + stripTags(content) + '\n';
  });

  // Convert links: show URL after link text
  text = text.replace(/<a\s+href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '$2 ($1)');

  // Convert bold/italic/underline
  text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '$1');
  text = text.replace(/<b[^>]*>(.*?)<\/b>/gi, '$1');
  text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, '$1');
  text = text.replace(/<i[^>]*>(.*?)<\/i>/gi, '$1');
  text = text.replace(/<u[^>]*>(.*?)<\/u>/gi, '$1');

  // Convert blockquotes with indentation
  text = text.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, (match, content) => {
    const lines = stripTags(content).split('\n');
    return lines.map(line => '> ' + line).join('\n') + '\n';
  });

  // Remove all other HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Clean up multiple consecutive newlines
  text = text.replace(/\n\n\n+/g, '\n\n');

  // Remove leading/trailing whitespace
  return text.trim();
}

function stripTags(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, '');
}

function decodeHtmlEntities(text) {
  if (!text) return '';

  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
    '&euro;': '€',
    '&pound;': '£',
    '&yen;': '¥',
    '&cent;': '¢',
  };

  let decoded = text;
  Object.keys(entities).forEach(entity => {
    decoded = decoded.replace(new RegExp(entity, 'g'), entities[entity]);
  });

  // Handle numeric entities
  decoded = decoded.replace(/&#(\d+);/g, (match, dec) => {
    return String.fromCharCode(parseInt(dec, 10));
  });
  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });

  return decoded;
}
