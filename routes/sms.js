import express from 'express';
import SmsProvider from '../models/SmsProvider.js';
import SmsLog from '../models/SmsLog.js';
import { authenticateToken, requireUser } from '../middleware/auth.js';
import { normalizePhone, sendSmsWithProvider } from '../utils/smsProviders.js';

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
router.post('/send', authenticateToken, requireUser, async (req, res) => {
  try {
    const userId = req.user._id;
    const { numbers, message } = req.body; // numbers: comma or newline separated
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

    // Send via provider utility
    const result = await sendSmsWithProvider({ providerDoc, to: normalized, message, userId });
    
    // Log results
    console.log(`[SMS Send Result] Success: ${result.success}, Results:`, result.results);
    
    if (!result.success) return res.status(500).json({ success: false, error: result.error });

    // Compute delivery summary
    const total = result.results.length;
    const successful = result.results.filter(r => r.success).length;
    const failed = total - successful;

    res.json({ success: true, results: result.results, summary: { total, successful, failed } });
  } catch (err) {
    console.error(`[SMS Send Error] ${err.message}`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// List recent SMS logs
router.get('/logs', authenticateToken, requireUser, async (req, res) => {
  try {
    const logs = await SmsLog.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, logs });
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

export default router;
