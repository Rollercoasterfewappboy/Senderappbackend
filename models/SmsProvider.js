import mongoose from 'mongoose';

const SmsProviderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  provider: { type: String, required: true }, // twilio, nexmo, plivo, aws, custom
  enabled: { type: Boolean, default: false },
  defaultCountryCode: { type: String, default: '+1' },
  dailyLimit: { type: Number, default: 1000 },
  rateLimitPerMinute: { type: Number, default: 60 },
  retryEnabled: { type: Boolean, default: true },
  maxRetryAttempts: { type: Number, default: 3 },
  retryDelaySeconds: { type: Number, default: 60 },
  senderType: { type: String, enum: ['alphanumeric','phone'], default: 'phone' },
  senderValue: { type: String },
  // Provider-specific credentials stored encrypted in production - plain here for demo
  credentials: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

export default mongoose.model('SmsProvider', SmsProviderSchema);
