import mongoose from 'mongoose';

const EmailProviderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  provider: { type: String, enum: ['smtp', 'aws', 'resend'], required: true },
  smtp: {
    host: String,
    port: String,
    username: String,
    password: String,
    encryption: { type: String, enum: ['ssl', 'tls'] },
  },
  aws: {
    username: String,
    password: String,
    region: String,
  },
  resend: {
    apiKey: String,
  },
  fromEmail: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

EmailProviderSchema.index({ userId: 1, provider: 1 }, { unique: true });

export default mongoose.model('EmailProvider', EmailProviderSchema);
