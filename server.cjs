require('dotenv').config();

const emailRoutes = require('./routes/email.js');

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { createServer } = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

// ---------------------
// Validate required env variables
// ---------------------
const requiredEnv = [
  'MONGODB_URI',
  'JWT_SECRET',
  'PORT',
];

requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
});

// Import routes
const authRoutes = require('./routes/auth.js');
const userRoutes = require('./routes/users.js');
const globalAdminRoutes = require('./routes/globalAdmin.js');
const notesRoutes = require('./routes/notes.js');
const smsRoutes = require('./routes/sms.js');

// Import middleware
const { authenticateToken } = require('./middleware/auth.js');

const app = express();
const server = createServer(app);

// ---------------------
// Allowed Origins
// ---------------------
const allowedOrigins = new Set([
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
].filter(Boolean));

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (origin === 'null') return true;
  if (origin.startsWith('file://')) return true;

  return allowedOrigins.has(origin);
};

// ---------------------
// Socket.IO
// ---------------------
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      return callback(new Error('CORS origin not allowed'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  },
});

// ---------------------
// Trust proxy
// ---------------------
app.set('trust proxy', 1);

// ---------------------
// Security Middleware
// ---------------------
app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: 'cross-origin',
    },
  })
);

// ---------------------
// CORS
// ---------------------
const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error('CORS origin not allowed'));
  },

  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ---------------------
// Rate Limiting
// ---------------------
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,

  trustProxy: false,

  standardHeaders: true,
  legacyHeaders: false,

  handler: (req, res) => {
    return res.status(429).json({
      message: 'Too many requests from this IP, please try again later.',
    });
  },
});

app.use('/api/', limiter);

// ---------------------
// Body Parsers
// ---------------------
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ---------------------
// Static Uploads
// ---------------------
app.use('/uploads', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');

  res.removeHeader('Access-Control-Allow-Credentials');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

app.use(
  '/uploads',
  express.static('uploads', {
    maxAge: '1d',
    etag: false,
  })
);

// ---------------------
// Socket.IO JWT Auth
// ---------------------
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error('No token provided'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    socket.user = decoded;

    next();
  } catch (err) {
    console.error('Socket auth error:', err.message);

    return next(new Error('Invalid token'));
  }
});

// ---------------------
// Socket Events
// ---------------------
io.on('connection', (socket) => {
  console.log(
    'User connected:',
    socket.id,
    'UserID:',
    socket.user?.userId || socket.user?._id || 'unknown'
  );

  socket.on('join-room', (userId) => {
    socket.join(userId);

    console.log(`User ${userId} joined room`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Make io available globally
app.set('io', io);

// ---------------------
// Routes
// ---------------------
app.use('/api/auth', authRoutes);

app.use('/api/users', userRoutes);

app.use('/api/email', emailRoutes);

app.use('/api/sms', smsRoutes);

app.use('/api/notes', authenticateToken, notesRoutes);

app.use('/api/global-admin', globalAdminRoutes);

// ---------------------
// Health Check
// ---------------------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ---------------------
// Email Config Diagnostic
// ---------------------
app.get('/api/admin/email-config', authenticateToken, (req, res) => {
  if (!req.user?.adminConfig?.isAdmin) {
    return res.status(403).json({
      message: 'Admin access required',
    });
  }

  const emailConfig = {
    hasResendApiKey: !!process.env.RESEND_API_KEY,
    resendApiKeyLength: process.env.RESEND_API_KEY?.length || 0,
    emailFrom: process.env.EMAIL_FROM,
    frontendUrl: process.env.FRONTEND_URL,
    nodeEnv: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  };

  res.json(emailConfig);
});

// ---------------------
// Test Email Endpoint
// ---------------------
app.post('/api/admin/test-email', authenticateToken, async (req, res) => {
  if (!req.user?.adminConfig?.isAdmin) {
    return res.status(403).json({
      message: 'Admin access required',
    });
  }

  try {
    const { testEmail } = req.body;

    if (!testEmail) {
      return res.status(400).json({
        message: 'Test email address required',
      });
    }

    const { sendNoteReminderEmail } = require('./utils/email.js');

    console.log(`\n📧 [TEST] Sending test reminder email to: ${testEmail}`);
    console.log(`📧 [TEST] Using EMAIL_FROM: ${process.env.EMAIL_FROM}`);
    console.log(
      `📧 [TEST] Resend API Key configured: ${!!process.env.RESEND_API_KEY}`
    );

    const result = await sendNoteReminderEmail(
      testEmail,
      'Test User',
      'Test Scheduled Note',
      'This is a test note to verify email delivery is working correctly.',
      'Jan 31, 2026',
      '14:30',
      req.user.preferredTimezone || 'UTC'
    );

    console.log(`✅ [TEST] Email test successful. Response:`, result);

    return res.json({
      success: true,
      message: 'Test email sent successfully',
      emailTo: testEmail,
      resendResponse: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`❌ [TEST] Email test failed:`, error);

    return res.status(500).json({
      success: false,
      message: 'Test email failed',
      error: error.message,
      fullError: error.toString(),
      timestamp: new Date().toISOString(),
    });
  }
});

// ---------------------
// Error Handler
// ---------------------
app.use((err, req, res, next) => {
  console.error(err.stack);

  res.status(500).json({
    message: 'Something went wrong!',
    error:
      process.env.NODE_ENV === 'development'
        ? err.message
        : undefined,
  });
});

// ---------------------
// 404 Handler
// ---------------------
app.use('*', (req, res) => {
  res.status(404).json({
    message: 'Route not found',
  });
});

const PORT = process.env.PORT || 5000;

// ---------------------
// Legacy Encryption Validator
// ---------------------
function validateEncryptionKeyOnStartup() {
  // no-op
}

// ---------------------
// Start Server
// ---------------------
async function startServer() {
  try {
    validateEncryptionKeyOnStartup();

    console.log('Connecting to MongoDB...');

    await mongoose.connect(process.env.MONGODB_URI);

    console.log('Connected to MongoDB successfully');

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);

      console.log(
        `Frontend URL: ${
          process.env.FRONTEND_URL || 'http://localhost:5173'
        }`
      );
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);

    console.error('Error details:', error);

    process.exit(1);
  }
}

// ---------------------
// MongoDB Events
// ---------------------
mongoose.connection.on('error', (error) => {
  console.error('MongoDB connection error:', error);
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
});

// ---------------------
// Graceful Shutdown
// ---------------------
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');

  try {
    await mongoose.connection.close();

    console.log('MongoDB connection closed');

    server.close(() => {
      console.log('Server closed');

      process.exit(0);
    });
  } catch (error) {
    console.error('Error during shutdown:', error);

    process.exit(1);
  }
});

// ---------------------
// Start App
// ---------------------
startServer();

module.exports = { io };


// This is the one that is inline config

// const emailRoutes = require('./routes/email.js');
// const dotenv = require('dotenv');
// dotenv.config();

// const CONFIG = {
//   // FRONTEND_URL: 'http://localhost:5173',
//   FRONTEND_URL: 'http://127.0.0.1:5500',
//   GLOBAL_ADMIN_EMAIL: 'admin@inboxguaranteed.com',
//   GLOBAL_ADMIN_PASSWORD: 'admin123456',
//   GLOBAL_ADMIN_RESET_CODE: '3237',
//   JWT_SECRET: 'wsPfsUho/p9gAlWkpQ6a5Y4vbny8rl0PmMUdvVLFf/M=',
//   MONGODB_URI: 'mongodb+srv://inboxguaranteed:inboxguaranteed3237@inboxguaranteed.1sgkn8u.mongodb.net/?appName=inboxguaranteed',
//   NODE_ENV: 'development',
//   PORT: '5000',
//   RESEND_API_KEY: 're_VPRJGQsy_Cn7rhTkxoG6wbJopaFgGK6Hp',
//   EMAIL_FROM: 'notification@marketbooksolution.online',
//   CLOUDINARY_CLOUD_NAME: 'dwvfry8su',
//   CLOUDINARY_API_KEY: '787512164464772',
//   CLOUDINARY_API_SECRET: 'rXQOI4JcKb1YXIsymZwUxN97_5c'
// };

// // populate process.env for backward compatibility and local fallback
// Object.assign(process.env, CONFIG);

// const express = require('express');
// const cors = require('cors');
// const mongoose = require('mongoose');
// const { createServer } = require('http');
// const { Server } = require('socket.io');
// const helmet = require('helmet');
// const rateLimit = require('express-rate-limit');
// const jwt = require('jsonwebtoken');

// // Import routes
// const authRoutes = require('./routes/auth.js');
// // removed route modules for items, notifications, tickets, advertisements, escrow
// const userRoutes = require('./routes/users.js');
// const globalAdminRoutes = require('./routes/globalAdmin.js');
// // globalAdminEscrow route removed along with escrow ticket model
// const notesRoutes = require('./routes/notes.js')
// const smsRoutes = require('./routes/sms.js');

// // Import middleware
// const { authenticateToken } = require('./middleware/auth.js');

// const app = express();
// const server = createServer(app);

// const allowedOrigins = new Set([
//   process.env.FRONTEND_URL,
//   'http://localhost:5173',
//   'http://127.0.0.1:5173',
//   'http://localhost:5500',
//   'http://127.0.0.1:5500',
// ].filter(Boolean));

// const isAllowedOrigin = (origin) => {
//   if (!origin) return true;
//   if (origin === 'null') return true;
//   if (origin.startsWith('file://')) return true;
//   return allowedOrigins.has(origin);
// };

// const io = new Server(server, {
//   cors: {
//     origin: (origin, callback) => {
//       if (isAllowedOrigin(origin)) return callback(null, true);
//       return callback(new Error('CORS origin not allowed'));
//     },
//     methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//     credentials: true,
//   },
// });

// // ✅ Trust proxy for secure deployments (supports Render/Vercel and other proxies)
// app.set('trust proxy', 1);

// // Middleware
// app.use(
//   helmet({
//     crossOriginResourcePolicy: { policy: "cross-origin" }
//   })
// );

// // ✅ IP handling is now managed through GlobalAdmin authorized IP system
// // Use real client IPs - no longer using hardcoded TEST_PUBLIC_IP mock

// const corsOptions = {
//   origin: (origin, callback) => {
//     if (isAllowedOrigin(origin)) return callback(null, true);
//     return callback(new Error('CORS origin not allowed'));
//   },
//   methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
//   credentials: true,
//   optionsSuccessStatus: 200,
// };

// app.use(cors(corsOptions));
// app.options('*', cors(corsOptions));

// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 1000, // limit each IP
//   // Disable trust proxy for rate limiting to prevent bypass
//   trustProxy: false,
//   standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
//   legacyHeaders: false,  // Disable the `X-RateLimit-*` headers
//   handler: (req, res /*, next */) => {
//     return res.status(429).json({
//       message: 'Too many requests from this IP, please try again later.'
//     })
//   }
// });
// app.use('/api/', limiter);

// app.use(express.json({ limit: '50mb' }));
// app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// // Serve static files from uploads directory with CORS headers
// app.use('/uploads', (req, res, next) => {
//   // Allow all origins to access static files (logos, images, etc.)
//   res.header('Access-Control-Allow-Origin', '*');
//   res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
//   res.header('Access-Control-Allow-Headers', 'Content-Type');
//   res.removeHeader('Access-Control-Allow-Credentials');
//   if (req.method === 'OPTIONS') {
//     return res.sendStatus(200);
//   }
//   next();
// });
// app.use('/uploads', express.static('uploads', {
//   maxAge: '1d',
//   etag: false
// }));

// // ---------------------
// // Socket.IO with JWT auth
// // ---------------------
// io.use((socket, next) => {
//   try {
//     const token = socket.handshake.auth?.token;
//     if (!token) return next(new Error('No token provided'));

//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     socket.user = decoded; // attach user info
//     next();
//   } catch (err) {
//     console.error('Socket auth error:', err.message);
//     return next(new Error('Invalid token'));
//   }
// });

// io.on('connection', (socket) => {
//   console.log('User connected:', socket.id, 'UserID:', socket.user?.userId || socket.user?._id || 'unknown');

//   socket.on('join-room', (userId) => {
//     socket.join(userId);
//     console.log(`User ${userId} joined room`);
//   });

//   socket.on('disconnect', () => {
//     console.log('User disconnected:', socket.id);
//   });
// });

// // Make io available in routes
// app.set('io', io);

// // ---------------------
// // Routes
// // ---------------------
// app.use('/api/auth', authRoutes);

// // Users routes contain public endpoints (register, verify) and protected endpoints.
// // Protect protected endpoints inside users.js
// app.use('/api/users', userRoutes);

// // Register email routes
// app.use('/api/email', emailRoutes);
// app.use('/api/sms', smsRoutes);
// app.use('/api/notes', authenticateToken, notesRoutes);

// // Global admin routes (must appear after /api/users since auth middleware uses it)
// app.use('/api/global-admin', globalAdminRoutes);

// // ---------------------
// // Health check
// // ---------------------
// app.get('/api/health', (req, res) => {
//   res.json({
//     status: 'OK',
//     timestamp: new Date().toISOString(),
//     uptime: process.uptime(),
//   });
// });

// // Email configuration diagnostic endpoint
// // ---------------------
// app.get('/api/admin/email-config', authenticateToken, (req, res) => {
//   // Only admins can check email config
//   if (!req.user?.adminConfig?.isAdmin) {
//     return res.status(403).json({ message: 'Admin access required' })
//   }

//   const emailConfig = {
//     hasResendApiKey: !!process.env.RESEND_API_KEY,
//     resendApiKeyLength: process.env.RESEND_API_KEY?.length || 0,
//     emailFrom: process.env.EMAIL_FROM,
//     frontendUrl: process.env.FRONTEND_URL,
//     nodeEnv: process.env.NODE_ENV,
//     timestamp: new Date().toISOString()
//   }
  
//   res.json(emailConfig)
// });

// // Test email endpoint for debugging
// // ---------------------
// app.post('/api/admin/test-email', authenticateToken, async (req, res) => {
//   // Only admins can test emails
//   if (!req.user?.adminConfig?.isAdmin) {
//     return res.status(403).json({ message: 'Admin access required' })
//   }

//   try {
//     const { testEmail } = req.body
    
//     if (!testEmail) {
//       return res.status(400).json({ message: 'Test email address required' })
//     }

//     const { sendNoteReminderEmail } = require('./utils/email.js')
    
//     console.log(`\n📧 [TEST] Sending test reminder email to: ${testEmail}`)
//     console.log(`📧 [TEST] Using EMAIL_FROM: ${process.env.EMAIL_FROM}`)
//     console.log(`📧 [TEST] Resend API Key configured: ${!!process.env.RESEND_API_KEY}`)

//     const result = await sendNoteReminderEmail(
//       testEmail,
//       'Test User',
//       'Test Scheduled Note',
//       'This is a test note to verify email delivery is working correctly.',
//       'Jan 31, 2026',
//       '14:30',
//       req.user.preferredTimezone || 'UTC'
//     )

//     console.log(`✅ [TEST] Email test successful. Response:`, result)

//     return res.json({
//       success: true,
//       message: 'Test email sent successfully',
//       emailTo: testEmail,
//       resendResponse: result,
//       timestamp: new Date().toISOString()
//     })
//   } catch (error) {
//     console.error(`❌ [TEST] Email test failed:`, error)
    
//     return res.status(500).json({
//       success: false,
//       message: 'Test email failed',
//       error: error.message,
//       fullError: error.toString(),
//       timestamp: new Date().toISOString()
//     })
//   }
// });

// // ---------------------
// // Error handling
// // ---------------------
// app.use((err, req, res, next) => {
//   console.error(err.stack);
//   res.status(500).json({
//     message: 'Something went wrong!',
//     error: process.env.NODE_ENV === 'development' ? err.message : undefined,
//   });
// });

// // 404 handler
// app.use('*', (req, res) => {
//   res.status(404).json({ message: 'Route not found' });
// });

// const PORT = process.env.PORT || 5000;

// // Bank encryption support has been retired. The old validation function
// // is kept for reference but no longer performs any checks or requires
// // an environment variable. The application will function without
// // a BANK_ENCRYPTION_KEY.
// function validateEncryptionKeyOnStartup() {
//   // no-op
// }

// // ---------------------
// // Start server
// // ---------------------
// async function startServer() {
//   try {
//     validateEncryptionKeyOnStartup()

//     console.log('Connecting to MongoDB...');
//     await mongoose.connect(
//       process.env.MONGODB_URI || 'mongodb://localhost:27017/marketbook-solution'
//     );
//     console.log('Connected to MongoDB successfully');

//     // Start the email reminder job
//     // email reminder job removed

//     server.listen(PORT, () => {
//       console.log(`Server running on port ${PORT}`);
//       console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
//     });
//   } catch (error) {
//     console.error('Failed to start server:', error.message);
//     console.error('Error details:', error);
//     process.exit(1);
//   }
// }

// // ---------------------
// // MongoDB events
// // ---------------------
// mongoose.connection.on('error', (error) => {
//   console.error('MongoDB connection error:', error);
// });

// mongoose.connection.on('disconnected', () => {
//   console.log('MongoDB disconnected');
// });

// // Graceful shutdown
// process.on('SIGINT', async () => {
//   console.log('Shutting down gracefully...');
//   try {
//     await mongoose.connection.close();
//     console.log('MongoDB connection closed');
//     server.close(() => {
//       console.log('Server closed');
//       process.exit(0);
//     });
//   } catch (error) {
//     console.error('Error during shutdown:', error);
//     process.exit(1);
//   }
// });

// startServer();

// module.exports = { io };




