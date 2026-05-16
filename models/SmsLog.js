const mongoose = require('mongoose');

const SmsLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sender: { type: String },
  recipient: { type: String, required: true },
  message: { type: String, required: true },
  provider: { type: String },
  providerMessageId: { type: String },
  status: { type: String, enum: ['Pending','Sent','Failed'], default: 'Pending' },
  error: { type: String },
  attempts: { type: Number, default: 0 },
  meta: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

module.exports = mongoose.model('SmsLog', SmsLogSchema);
