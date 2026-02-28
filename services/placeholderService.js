import { DateTime } from 'luxon';

/**
 * Dynamic Placeholder/Merge Tag System
 * Handles placeholder replacement for personalized bulk emails
 * Supports 3 categories: Recipient Data, System (Date/Time), Email Parsing
 */

const placeholderService = {
  // Placeholder definitions with metadata
  PLACEHOLDERS: {
    recipient: {
      '[Name]': { label: 'Full Name', field: 'name', example: 'John Doe', category: 'Recipient Data' },
      '[FirstName]': { label: 'First Name', field: 'firstName', example: 'John', category: 'Recipient Data' },
      '[LastName]': { label: 'Last Name', field: 'lastName', example: 'Doe', category: 'Recipient Data' },
      '[Email]': { label: 'Email Address', field: 'email', example: 'john@example.com', category: 'Recipient Data' },
      '[Salutation]': { label: 'Formal Greeting', field: 'salutation', example: 'Dear John', category: 'Recipient Data', derived: true },
      '[Company]': { label: 'Company Name', field: 'company', example: 'Acme Corp', category: 'Recipient Data' },
      '[PhoneNumber]': { label: 'Phone Number', field: 'phoneNumber', example: '+1-555-0123', category: 'Recipient Data' },
      '[CellPhoneNumber]': { label: 'Cell Phone', field: 'cellPhoneNumber', example: '+1-555-0123', category: 'Recipient Data' },
      '[Address]': { label: 'Street Address', field: 'address', example: '123 Main St', category: 'Recipient Data' },
      '[City]': { label: 'City', field: 'city', example: 'New York', category: 'Recipient Data' },
      '[State]': { label: 'State/Province', field: 'state', example: 'NY', category: 'Recipient Data' },
      '[ZipCode]': { label: 'Postal Code', field: 'zipCode', example: '10001', category: 'Recipient Data' },
      '[Country]': { label: 'Country', field: 'country', example: 'USA', category: 'Recipient Data' },
      '[CustomField1]': { label: 'Custom Field 1', field: 'customField1', example: 'Any Value', category: 'Recipient Data' },
      '[CustomField2]': { label: 'Custom Field 2', field: 'customField2', example: 'Any Value', category: 'Recipient Data' },
      '[CustomField3]': { label: 'Custom Field 3', field: 'customField3', example: 'Any Value', category: 'Recipient Data' },
    },
    system: {
      '[Date_short]': { label: 'Date (Short)', format: 'M/d/yyyy', example: '2/20/2026', category: 'Date & Time' },
      '[Date_long]': { label: 'Date (Long)', format: 'MMMM d, yyyy', example: 'February 20, 2026', category: 'Date & Time' },
      '[Date_iso]': { label: 'Date (ISO)', format: 'yyyy-MM-dd', example: '2026-02-20', category: 'Date & Time' },
      '[Time_short]': { label: 'Time (Short)', format: 'h:mm a', example: '2:30 PM', category: 'Date & Time' },
      '[Time_long]': { label: 'Time (Long)', format: 'h:mm:ss a', example: '2:30:45 PM', category: 'Date & Time' },
      '[Time_24h]': { label: 'Time (24h)', format: 'HH:mm', example: '14:30', category: 'Date & Time' },
      '[DateTime]': { label: 'Date & Time', format: 'M/d/yyyy h:mm a', example: '2/20/2026 2:30 PM', category: 'Date & Time' },
      '[Year]': { label: 'Year', example: '2026', category: 'Date & Time' },
      '[Month]': { label: 'Month Name', example: 'February', category: 'Date & Time' },
      '[MonthNum]': { label: 'Month Number', example: '02', category: 'Date & Time' },
      '[Day]': { label: 'Day', example: '20', category: 'Date & Time' },
      '[DayOfWeek]': { label: 'Day of Week', example: 'Friday', category: 'Date & Time' },
    },
    email_parsing: {
      '[Email_LocalPart]': { label: 'Email Local Part', example: 'john.doe', category: 'Email Parsing', description: 'Part before @' },
      '[Email_DomainPart]': { label: 'Email Domain', example: 'gmail.com', category: 'Email Parsing', description: 'Full domain with TLD' },
      '[Email_DomainPartNoTLD]': { label: 'Email Domain (No TLD)', example: 'gmail', category: 'Email Parsing', description: 'Domain without extension' },
    }
  },

  /**
   * Extract all placeholders from text (both [Placeholder] and [Placeholder|Fallback])
   */
  extractPlaceholders(text) {
    if (!text || typeof text !== 'string') return [];
    const regex = /\[([A-Za-z0-9_]+)(?:\|([^\]]*))?\]/g;
    const placeholders = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      placeholders.push({
        full: match[0],
        placeholder: `[${match[1]}]`,
        key: match[1],
        fallback: match[2] || null,
      });
    }
    return placeholders;
  },

  /**
   * Check if a placeholder is valid
   */
  isValidPlaceholder(placeholder) {
    const cleanPlaceholder = placeholder.replace(/\|.*\]/, ']'); // Remove fallback for check
    return Object.prototype.hasOwnProperty.call(this.PLACEHOLDERS.recipient, cleanPlaceholder) ||
           Object.prototype.hasOwnProperty.call(this.PLACEHOLDERS.system, cleanPlaceholder) ||
           Object.prototype.hasOwnProperty.call(this.PLACEHOLDERS.email_parsing, cleanPlaceholder);
  },

  /**
   * Get info/metadata about a placeholder
   */
  getPlaceholderInfo(placeholder) {
    const cleanPlaceholder = placeholder.replace(/\|.*\]/, ']');
    return this.PLACEHOLDERS.recipient[cleanPlaceholder] ||
           this.PLACEHOLDERS.system[cleanPlaceholder] ||
           this.PLACEHOLDERS.email_parsing[cleanPlaceholder] ||
           null;
  },

  /**
   * Resolve a recipient field (supports dot notation for nested objects)
   */
  resolveRecipientField(key, recipient) {
    if (!recipient || typeof recipient !== 'object') return null;
    
    // Handle dot notation (e.g., "address.city")
    const keys = key.split('.');
    let value = recipient;
    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k];
      } else {
        return null;
      }
    }
    return value !== undefined && value !== null ? String(value).trim() : null;
  },

  /**
   * Resolve a system field (date/time based on timezone)
   */
  resolveSystemField(key, timezone = 'UTC') {
    try {
      const tz = timezone || 'UTC';
      const now = DateTime.now().setZone(tz).isValid ? DateTime.now().setZone(tz) : DateTime.now();
      
      const formats = {
        '[Date_short]': () => now.toFormat('M/d/yyyy'),
        '[Date_long]': () => now.toFormat('MMMM d, yyyy'),
        '[Date_iso]': () => now.toFormat('yyyy-MM-dd'),
        '[Time_short]': () => now.toFormat('h:mm a'),
        '[Time_long]': () => now.toFormat('h:mm:ss a'),
        '[Time_24h]': () => now.toFormat('HH:mm'),
        '[DateTime]': () => now.toFormat('M/d/yyyy h:mm a'),
        '[Year]': () => String(now.year),
        '[Month]': () => now.toFormat('MMMM'),
        '[MonthNum]': () => now.toFormat('MM'),
        '[Day]': () => String(now.day),
        '[DayOfWeek]': () => now.toFormat('EEEE'),
      };

      return formats[key] ? formats[key]() : null;
    } catch (error) {
      console.error(`Error resolving system field ${key}:`, error);
      return null;
    }
  },

  /**
   * Resolve an email parsing field
   */
  resolveEmailParsingField(key, email) {
    if (!email || typeof email !== 'string') return null;
    
    const parts = email.split('@');
    if (parts.length !== 2) return null;

    const localPart = parts[0];
    const domainPart = parts[1];
    const domainWithoutTld = domainPart.split('.')[0];

    const fields = {
      '[Email_LocalPart]': localPart,
      '[Email_DomainPart]': domainPart,
      '[Email_DomainPartNoTLD]': domainWithoutTld,
    };

    return fields[key] || null;
  },

  /**
   * HTML escape and sanitize value to prevent XSS
   */
  sanitizeValue(value) {
    if (!value) return '';
    const str = String(value);
    
    // HTML entity escaping
    const escapeMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;',
      '/': '&#x2F;',
    };
    
    let sanitized = str.replace(/[&<>"'\/]/g, char => escapeMap[char]);
    
    // Remove dangerous patterns
    sanitized = sanitized.replace(/javascript:/gi, '');
    sanitized = sanitized.replace(/on\w+\s*=/gi, '');
    sanitized = sanitized.replace(/<script[^>]*>.*?<\/script>/gi, '');
    
    return sanitized;
  },

  /**
   * Render template for single recipient
   */
  render(template, recipient = {}, options = {}) {
    if (!template || typeof template !== 'string') return '';
    
    const timezone = options.timezone || 'UTC';
    const logging = options.logging || false;
    let result = template;

    // Extract all placeholders
    const placeholders = this.extractPlaceholders(template);
    
    for (const ph of placeholders) {
      const placeholderKey = ph.placeholder;
      let value = null;

      // Try to resolve in order: recipient field, system field, email parsing
      if (this.PLACEHOLDERS.recipient[placeholderKey]) {
        value = this.resolveRecipientField(
          this.PLACEHOLDERS.recipient[placeholderKey].field,
          recipient
        );
      } else if (this.PLACEHOLDERS.system[placeholderKey]) {
        value = this.resolveSystemField(placeholderKey, timezone);
      } else if (this.PLACEHOLDERS.email_parsing[placeholderKey]) {
        value = this.resolveEmailParsingField(placeholderKey, recipient.email);
      }

      // Use fallback if value not found
      if (!value && ph.fallback) {
        value = ph.fallback;
      }

      // Replace placeholder with value or empty string
      if (value !== null && value !== undefined) {
        const sanitized = this.sanitizeValue(value);
        result = result.replace(ph.full, sanitized);
      } else {
        result = result.replace(ph.full, ''); // Remove placeholder if no value
      }
    }

    return result;
  },

  /**
   * Render template for multiple recipients
   */
  renderBulk(template, recipients = [], options = {}) {
    if (!Array.isArray(recipients)) return [];
    return recipients.map(recipient => this.render(template, recipient, options));
  },

  /**
   * Validate template for valid placeholders
   */
  validateTemplate(template) {
    if (!template || typeof template !== 'string') {
      return { isValid: true, errors: [], warnings: [], placeholdersFound: [] };
    }

    const placeholders = this.extractPlaceholders(template);
    const errors = [];
    const warnings = [];
    const validPlaceholders = [];

    for (const ph of placeholders) {
      const info = this.getPlaceholderInfo(ph.placeholder);
      
      if (info) {
        validPlaceholders.push(ph.placeholder);
        // Warn if no fallback for optional fields
        if (!ph.fallback && ['[Company]', '[PhoneNumber]', '[Address]'].includes(ph.placeholder)) {
          warnings.push(`${ph.placeholder} is optional - consider adding a fallback value`);
        }
      } else {
        errors.push(`Unknown placeholder: ${ph.placeholder}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      placeholdersFound: validPlaceholders
    };
  },

  /**
   * Get validation report for template
   */
  getTemplateReport(template) {
    return this.validateTemplate(template);
  },

  /**
   * Get all placeholders organized by category
   */
  getPlaceholdersByCategory() {
    return {
      recipient: Object.entries(this.PLACEHOLDERS.recipient).map(([key, value]) => ({
        placeholder: key,
        ...value
      })),
      system: Object.entries(this.PLACEHOLDERS.system).map(([key, value]) => ({
        placeholder: key,
        ...value
      })),
      email_parsing: Object.entries(this.PLACEHOLDERS.email_parsing).map(([key, value]) => ({
        placeholder: key,
        ...value
      }))
    };
  },

  /**
   * Generate template report with statistics
   */
  getTemplateStats(template) {
    const report = this.validateTemplate(template);
    return {
      ...report,
      totalPlaceholders: report.placeholdersFound.length,
      uniquePlaceholders: [...new Set(report.placeholdersFound)].length,
      characterCount: template.length,
      estimatedTime: Math.ceil(template.length / 100), // Rough estimate in ms
    };
  }
};

export default placeholderService;
