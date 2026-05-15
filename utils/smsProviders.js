import axios from 'axios';
import SmsLog from '../models/SmsLog.js';

// Normalize phone: basic normalization: remove spaces, ensure leading +
function normalizePhone(phone, defaultCountry) {
  if (!phone) return null;
  let p = String(phone).trim();
  p = p.replace(/[\s\-()]/g, '');
  if (!p.startsWith('+')) {
    if (p.startsWith('00')) p = '+' + p.slice(2);
    else p = (defaultCountry || '+1') + p.replace(/^\+/, '');
  }
  return p;
}

export async function sendSmsWithProvider({ providerDoc, to, message, userId, onProgress }) {
  try {
    if (!providerDoc || !providerDoc.enabled) throw new Error('No SMS provider configured');
    const provider = providerDoc.provider;
    if (!Array.isArray(to)) to = [to];

    const results = [];
    let sentCount = 0;
    let failedCount = 0;

    for (let index = 0; index < to.length; index += 1) {
      const recipient = to[index];
      const log = new SmsLog({ userId, sender: providerDoc.senderValue || '', recipient, message, provider: providerDoc.provider, status: 'Pending' });
      await log.save();

      let progressResult = {
        recipient,
        success: false,
        error: null,
        providerMessageId: null,
        index: index + 1,
        sent: sentCount,
        failed: failedCount,
        pending: to.length - (sentCount + failedCount),
      };

      try {
        if (provider === 'twilio') {
          const { accountSid, authToken, from } = providerDoc.credentials || {};
          if (!accountSid || !authToken) throw new Error('Twilio credentials missing');
          const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
          const params = new URLSearchParams();
          const fromValue = providerDoc.senderType === 'alphanumeric' ? providerDoc.senderValue : (from || providerDoc.senderValue || '');
          params.append('From', fromValue);
          params.append('To', recipient);
          params.append('Body', message);

          console.log(`[Twilio Send] SenderType: ${providerDoc.senderType}, From: ${fromValue}, To: ${recipient}`);

          const res = await axios.post(url, params.toString(), {
            auth: { username: accountSid, password: authToken },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          });

          log.status = 'Sent';
          log.providerMessageId = res.data.sid;
          log.meta = res.data;
          await log.save();
          sentCount += 1;
          progressResult = {
            recipient,
            success: true,
            error: null,
            providerMessageId: res.data.sid,
            index: index + 1,
            sent: sentCount,
            failed: failedCount,
            pending: to.length - (sentCount + failedCount),
          };
          results.push({ recipient, success: true, id: res.data.sid });
        } else if (provider === 'mock' || !provider) {
          log.status = 'Sent';
          log.providerMessageId = `mock-${Date.now()}`;
          await log.save();
          sentCount += 1;
          progressResult = {
            recipient,
            success: true,
            error: null,
            providerMessageId: log.providerMessageId,
            index: index + 1,
            sent: sentCount,
            failed: failedCount,
            pending: to.length - (sentCount + failedCount),
          };
          results.push({ recipient, success: true, id: log.providerMessageId });
        } else {
          const { sendUrl, apiKey, method = 'POST', bodyField = 'body', toField = 'to', fromField = 'from' } = providerDoc.credentials || {};
          if (!sendUrl) throw new Error('Custom provider not configured');
          const payload = {};
          payload[toField] = recipient;
          payload[fromField] = providerDoc.senderValue || '';
          payload[bodyField] = message;
          const res = await axios({ url: sendUrl, method, data: payload, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
          log.status = 'Sent';
          log.providerMessageId = res.data?.messageId || res.data?.id || `custom-${Date.now()}`;
          log.meta = res.data;
          await log.save();
          sentCount += 1;
          progressResult = {
            recipient,
            success: true,
            error: null,
            providerMessageId: log.providerMessageId,
            index: index + 1,
            sent: sentCount,
            failed: failedCount,
            pending: to.length - (sentCount + failedCount),
          };
          results.push({ recipient, success: true, id: log.providerMessageId });
        }
      } catch (err) {
        log.status = 'Failed';
        let errorDetail = err.message;
        if (err.response?.data) {
          const errorData = err.response.data;
          errorDetail = `${err.status || err.response.status} ${errorData.code || ''}: ${errorData.message || JSON.stringify(errorData)}`;
          console.error(`[SMS Error] Provider: ${provider}, Status: ${err.response.status}, Error: ${errorDetail}`);
        } else {
          console.error(`[SMS Error] ${errorDetail}`);
        }

        log.error = errorDetail;
        log.attempts = (log.attempts || 0) + 1;
        await log.save();
        failedCount += 1;
        progressResult = {
          recipient,
          success: false,
          error: errorDetail,
          providerMessageId: null,
          index: index + 1,
          sent: sentCount,
          failed: failedCount,
          pending: to.length - (sentCount + failedCount),
        };
        results.push({ recipient, success: false, error: errorDetail });
      }

      if (typeof onProgress === 'function') {
        onProgress(progressResult);
      }
    }

    return { success: true, results };
  } catch (error) {
    console.error('[smsProviders] ERROR', error.message);
    return { success: false, error: error.message };
  }
}

export { normalizePhone };
