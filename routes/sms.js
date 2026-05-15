import express from 'express';
import crypto from 'crypto';
import SmsProvider from '../models/SmsProvider.js';
import SmsLog from '../models/SmsLog.js';
import { authenticateToken, requireUser } from '../middleware/auth.js';
import { normalizePhone, sendSmsWithProvider } from '../utils/smsProviders.js';

const router = express.Router();

const createSendSessionId = (providedId) => {
  if (providedId && typeof providedId === 'string' && providedId.trim()) return providedId;
  return `${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2, 10)}`;
};

const emitSmsProgress = (io, userId, payload) => {
  if (!io || !userId) return;
  io.to(String(userId)).emit('sms-send-progress', payload);
};

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
    const { numbers, message, sendSessionId: providedSessionId } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ success: false, error: 'Message is required' });

    const providerDoc = await SmsProvider.findOne({ userId });
    if (!providerDoc || !providerDoc.enabled) return res.status(400).json({ success: false, error: 'SMS provider not configured or disabled' });

    const list = (typeof numbers === 'string' ? numbers.split(/,|\n/) : numbers || []).map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) return res.status(400).json({ success: false, error: 'At least one recipient number is required' });

    const normalized = list.map((n) => normalizePhone(n, providerDoc.defaultCountryCode)).filter(Boolean);
    const invalid = normalized.filter((n) => !/^\+[0-9]{6,20}$/.test(n));
    if (invalid.length > 0) return res.status(400).json({ success: false, error: `Invalid phone numbers: ${invalid.join(', ')}` });

    if (/<[^>]+>/.test(message)) return res.status(400).json({ success: false, error: 'HTML or tags are not allowed in SMS messages' });

    console.log(`[SMS Send Request] User: ${userId}, Provider: ${providerDoc.provider}, SenderType: ${providerDoc.senderType}, SenderValue: ${providerDoc.senderValue}, Recipients: ${normalized.length}, MsgLen: ${message.length}`);

    const io = req.app.get('io');
    const sessionId = createSendSessionId(providedSessionId);
    let sentCount = 0;
    let failedCount = 0;
    const totalRecipients = normalized.length;

    emitSmsProgress(io, userId, {
      sessionId,
      status: 'started',
      total: totalRecipients,
      sent: sentCount,
      failed: failedCount,
      pending: totalRecipients,
      lastRecipient: null,
      lastStatus: 'started',
      timestamp: new Date().toISOString(),
    });

    const result = await sendSmsWithProvider({
      providerDoc,
      to: normalized,
      message,
      userId,
      onProgress: ({ recipient, success, error, providerMessageId, index, sent, failed, pending }) => {
        sentCount = sent;
        failedCount = failed;
        emitSmsProgress(io, userId, {
          sessionId,
          status: 'in-progress',
          total: totalRecipients,
          sent: sentCount,
          failed: failedCount,
          pending,
          lastRecipient: recipient,
          lastStatus: success ? 'sent' : 'failed',
          recipient,
          success,
          error,
          providerMessageId,
          index,
          timestamp: new Date().toISOString(),
        });
      },
    });

    console.log(`[SMS Send Result] User: ${userId} Success: ${result.success}, Results:`, result.results);

    if (!result.success) {
      emitSmsProgress(io, userId, {
        sessionId,
        status: 'failed',
        total: totalRecipients,
        sent: sentCount,
        failed: failedCount,
        pending: totalRecipients - (sentCount + failedCount),
        lastRecipient: null,
        lastStatus: 'failed',
        error: result.error,
        completed: true,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({ success: false, error: result.error });
    }

    const total = result.results.length;
    const successful = result.results.filter((r) => r.success).length;
    const failed = total - successful;

    emitSmsProgress(io, userId, {
      sessionId,
      status: 'completed',
      total,
      sent: successful,
      failed,
      pending: 0,
      lastRecipient: null,
      lastStatus: 'completed',
      summary: { total, successful, failed },
      completed: true,
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, results: result.results, summary: { total, successful, failed } });
  } catch (err) {
    console.error(`[SMS Send Error] ${err.message}`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// List recent SMS logs
router.get('/logs', authenticateToken, requireUser, async (req, res) => {
  try {
    const userId = req.user._id;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const statusRaw = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const searchRaw = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const fromDate = req.query.fromDate ? new Date(req.query.fromDate) : null;
    const toDate = req.query.toDate ? new Date(req.query.toDate) : null;

    const filter = { userId };

    if (statusRaw && statusRaw !== 'All') {
      const statusList = statusRaw.split(',').map((item) => item.trim()).filter(Boolean);
      if (statusList.length > 0) {
        filter.status = { $in: statusList };
      }
    }

    if (searchRaw) {
      const escaped = searchRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { recipient: regex },
        { message: regex },
        { providerMessageId: regex },
        { error: regex },
      ];
    }

    if ((fromDate && !Number.isNaN(fromDate.valueOf())) || (toDate && !Number.isNaN(toDate.valueOf()))) {
      filter.createdAt = {};
      if (fromDate && !Number.isNaN(fromDate.valueOf())) filter.createdAt.$gte = fromDate;
      if (toDate && !Number.isNaN(toDate.valueOf())) {
        toDate.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = toDate;
      }
    }

    const total = await SmsLog.countDocuments(filter);
    const logs = await SmsLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      success: true,
      logs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
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
