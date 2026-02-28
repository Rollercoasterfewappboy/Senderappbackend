import mongoose from 'mongoose';

const EmailLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  to: [String],
  bcc: [String],
  subject: String,
  body: String, // HTML version
  bodyPlainText: String, // Plain text version (optional, auto-generated if missing)
  ctaText: String, // Call-to-Action text (optional)
  ctaLink: String, // Call-to-Action link (optional)
  attachments: [String], // file paths or URLs
  replyTo: String,
  fromName: String,
  provider: String,
  status: { type: String, enum: ['Success', 'Failed'], default: 'Success' },
  error: String,
  sentAt: { type: Date, default: Date.now },
});

export default mongoose.model('EmailLog', EmailLogSchema);
