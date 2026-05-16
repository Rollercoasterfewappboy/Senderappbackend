const express = require('express');
const SmsProvider = require('../models/SmsProvider.js');
const SmsLog = require('../models/SmsLog.js');
const { authenticateToken, requireUser, requireAuthorizedIp } = require('../middleware/auth.js');
const { normalizePhone, sendSmsWithProvider } = require('../utils/smsProviders.js');

const router = express.Router();

// Save SMS settings
router.post('/settings', authenticateToken, requireUser, async (req, res) => {
  try {
    const userId = req.user._id;
    const payload = req.body;
    let doc = await SmsProvider.findOne({ userId });
    if (!doc) doc = new SmsProvider({ userId });
    Object.assign(doc, payload);
    await doc.save();
    res.json({ success: true, settings: doc });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get SMS settings
router.get('/settings', authenticateToken, requireUser, async (req, res) => {
  try {
    const userId = req.user._id;
    const doc = await SmsProvider.findOne({ userId });
    res.json({ success: true, settings: doc });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Send SMS
router.post('/send', authenticateToken, requireUser, requireAuthorizedIp, async (req, res) => {
  try {
    const userId = req.user._id;
    const { numbers, message, clientPublicIP } = req.body; // numbers: comma or newline separated
    if (!message || !message.trim()) return res.status(400).json({ success: false, error: 'Message is required' });

    // Load provider
    const providerDoc = await SmsProvider.findOne({ userId });
    if (!providerDoc || !providerDoc.enabled) return res.status(400).json({ success: false, error: 'SMS provider not configured or disabled' });

    // Parse numbers
    const list = (typeof numbers === 'string' ? numbers.split(/,|\n/) : numbers || []).map(s => s.trim()).filter(Boolean);
    if (list.length === 0) return res.status(400).json({ success: false, error: 'At least one recipient number is required' });

    // Normalize numbers
    const normalized = list.map(n => normalizePhone(n, providerDoc.defaultCountryCode)).filter(Boolean);

    // Basic validation: ensure starts with + and digits
    const invalid = normalized.filter(n => !/^\+[0-9]{6,20}$/.test(n));
    if (invalid.length > 0) return res.status(400).json({ success: false, error: `Invalid phone numbers: ${invalid.join(', ')}` });

    // Prevent HTML or tags in message
    if (/<[^>]+>/.test(message)) return res.status(400).json({ success: false, error: 'HTML or tags are not allowed in SMS messages' });

    // Log request details
    console.log(`[SMS Send Request] User: ${userId}, Provider: ${providerDoc.provider}, SenderType: ${providerDoc.senderType}, SenderValue: ${providerDoc.senderValue}, Recipients: ${normalized.length}, MsgLen: ${message.length}`);

    // Emit start event immediately so UI can show live progress from the first recipient
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(String(userId)).emit('sms-send-start', {
          total: normalized.length,
          successful: 0,
          failed: 0,
          remaining: normalized.length,
        });
      }
    } catch (emitErr) {
      console.warn('[SMS Send] Failed to emit start event:', emitErr.message);
    }

    // Define progress callback that emits socket events
    const onProgress = (data) => {
      try {
        const io = req.app.get('io');
        if (io) {
          io.to(String(userId)).emit('sms-send-progress', data);
        }
      } catch (emitErr) {
        console.warn('[SMS Send] Failed to emit progress event:', emitErr.message);
      }
    };

    // Send via provider utility with progress callback
    const result = await sendSmsWithProvider({ providerDoc, to: normalized, message, userId, onProgress });
    
    // Log results
    console.log(`[SMS Send Result] Success: ${result.success}, Results:`, result.results);
    
    if (!result.success) return res.status(500).json({ success: false, error: result.error });

    // Compute delivery summary
    const total = result.results.length;
    const successful = result.results.filter(r => r.success).length;
    const failed = total - successful;

    // Emit completion event with summary
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(String(userId)).emit('sms-send-complete', {
          total,
          successful,
          failed,
          results: result.results,
        });
      }
    } catch (emitErr) {
      console.warn('[SMS Send] Failed to emit completion event:', emitErr.message);
    }

    res.json({ success: true, results: result.results, summary: { total, successful, failed } });
  } catch (err) {
    console.error(`[SMS Send Error] ${err.message}`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// List recent SMS logs with pagination support
router.get('/logs', authenticateToken, requireUser, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 25));
    const skip = (page - 1) * limit;

    const query = { userId: req.user._id };
    const [logs, total] = await Promise.all([
      SmsLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      SmsLog.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limit);
    res.json({ success: true, logs, pagination: { total, page, limit, totalPages } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Clear SMS logs
router.delete('/logs', authenticateToken, requireUser, async (req, res) => {
  try {
    await SmsLog.deleteMany({ userId: req.user._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
