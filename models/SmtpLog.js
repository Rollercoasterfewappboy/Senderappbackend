import mongoose from 'mongoose';

const SmtpLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  smtpName: { type: String, required: true },
  smtpHost: { type: String, required: true },
  smtpPort: { type: String, required: true },
  action: { type: String, enum: ['send_attempt', 'send_success', 'send_failure', 'failover'], required: true },
  recipientCount: { type: Number, default: 0 },
  error: String,
  messageId: String,
  createdAt: { type: Date, default: Date.now },
});

SmtpLogSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('SmtpLog', SmtpLogSchema);