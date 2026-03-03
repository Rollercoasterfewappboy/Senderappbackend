import emailRoutes from './routes/email.js';
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { Server } from 'socket.io';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';

// Import routes
import authRoutes from './routes/auth.js';
// removed route modules for items, notifications, tickets, advertisements, escrow
import userRoutes from './routes/users.js';
import globalAdminRoutes from './routes/globalAdmin.js';
// globalAdminEscrow route removed along with escrow ticket model
import notesRoutes from './routes/notes.js'
import smsRoutes from './routes/sms.js';

// Import middleware
import { authenticateToken } from './middleware/auth.js';

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

// ✅ Trust proxy for secure deployments
app.set('trust proxy', 1);

// Middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);


app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  })
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP
});
app.use('/api/', limiter);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from uploads directory with CORS headers
app.use('/uploads', (req, res, next) => {
  // Allow all origins to access static files (logos, images, etc.)
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.removeHeader('Access-Control-Allow-Credentials');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
app.use('/uploads', express.static('uploads', {
  maxAge: '1d',
  etag: false
}));

// ---------------------
// Socket.IO with JWT auth
// ---------------------
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token provided'));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded; // attach user info
    next();
  } catch (err) {
    console.error('Socket auth error:', err.message);
    return next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id, 'UserID:', socket.user?._id);

  socket.on('join-room', (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined room`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Make io available in routes
app.set('io', io);

// ---------------------
// Routes
// ---------------------
app.use('/api/auth', authRoutes);

// Users routes contain public endpoints (register, verify) and protected endpoints.
// Protect protected endpoints inside users.js
app.use('/api/users', userRoutes);

// Register email routes
app.use('/api/email', emailRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/notes', authenticateToken, notesRoutes);

// Global admin routes (must appear after /api/users since auth middleware uses it)
app.use('/api/global-admin', globalAdminRoutes);

// ---------------------
// Health check
// ---------------------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Email configuration diagnostic endpoint
// ---------------------
app.get('/api/admin/email-config', authenticateToken, (req, res) => {
  // Only admins can check email config
  if (!req.user?.adminConfig?.isAdmin) {
    return res.status(403).json({ message: 'Admin access required' })
  }

  const emailConfig = {
    hasResendApiKey: !!process.env.RESEND_API_KEY,
    resendApiKeyLength: process.env.RESEND_API_KEY?.length || 0,
    emailFrom: process.env.EMAIL_FROM,
    frontendUrl: process.env.FRONTEND_URL,
    nodeEnv: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  }
  
  res.json(emailConfig)
});

// Test email endpoint for debugging
// ---------------------
app.post('/api/admin/test-email', authenticateToken, async (req, res) => {
  // Only admins can test emails
  if (!req.user?.adminConfig?.isAdmin) {
    return res.status(403).json({ message: 'Admin access required' })
  }

  try {
    const { testEmail } = req.body
    
    if (!testEmail) {
      return res.status(400).json({ message: 'Test email address required' })
    }

    const { sendNoteReminderEmail } = await import('./utils/email.js')
    
    console.log(`\n📧 [TEST] Sending test reminder email to: ${testEmail}`)
    console.log(`📧 [TEST] Using EMAIL_FROM: ${process.env.EMAIL_FROM}`)
    console.log(`📧 [TEST] Resend API Key configured: ${!!process.env.RESEND_API_KEY}`)

    const result = await sendNoteReminderEmail(
      testEmail,
      'Test User',
      'Test Scheduled Note',
      'This is a test note to verify email delivery is working correctly.',
      'Jan 31, 2026',
      '14:30',
      req.user.preferredTimezone || 'UTC'
    )

    console.log(`✅ [TEST] Email test successful. Response:`, result)

    return res.json({
      success: true,
      message: 'Test email sent successfully',
      emailTo: testEmail,
      resendResponse: result,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error(`❌ [TEST] Email test failed:`, error)
    
    return res.status(500).json({
      success: false,
      message: 'Test email failed',
      error: error.message,
      fullError: error.toString(),
      timestamp: new Date().toISOString()
    })
  }
});

// ---------------------
// Error handling
// ---------------------
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

// Bank encryption support has been retired. The old validation function
// is kept for reference but no longer performs any checks or requires
// an environment variable. The application will function without
// a BANK_ENCRYPTION_KEY.
function validateEncryptionKeyOnStartup() {
  // no-op
}

// ---------------------
// Start server
// ---------------------
async function startServer() {
  try {
    validateEncryptionKeyOnStartup()

    console.log('Connecting to MongoDB...');
    await mongoose.connect(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/marketbook-solution',
      {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      }
    );
    console.log('Connected to MongoDB successfully');

    // Start the email reminder job
    console.log('Initializing scheduled note reminder job...')
    // email reminder job removed

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  }
}

// ---------------------
// MongoDB events
// ---------------------
mongoose.connection.on('error', (error) => {
  console.error('MongoDB connection error:', error);
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
});

// Graceful shutdown
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

startServer();

export { io };









// import emailRoutes from './routes/email.js';
// import dotenv from 'dotenv';
// dotenv.config();

// import express from 'express';
// import cors from 'cors';
// import mongoose from 'mongoose';
// import { createServer } from 'http';
// import { Server } from 'socket.io';
// import helmet from 'helmet';
// import rateLimit from 'express-rate-limit';
// import jwt from 'jsonwebtoken';

// // Import routes
// import authRoutes from './routes/auth.js';
// // removed route modules for items, notifications, tickets, advertisements, escrow
// import userRoutes from './routes/users.js';
// import globalAdminRoutes from './routes/globalAdmin.js';
// // globalAdminEscrow route removed along with escrow ticket model
// import notesRoutes from './routes/notes.js'
// import smsRoutes from './routes/sms.js';

// // Import middleware
// import { authenticateToken } from './middleware/auth.js';

// const app = express();
// const server = createServer(app);

// const io = new Server(server, {
//   cors: {
//     origin: process.env.FRONTEND_URL || 'http://localhost:5173',
//     methods: ['GET', 'POST', 'PUT', 'DELETE'],
//     credentials: true,
//   },
// });

// // ✅ Trust proxy for secure deployments
// app.set('trust proxy', 1);

// // Middleware
// app.use(
//   helmet({
//     crossOriginResourcePolicy: { policy: "cross-origin" }
//   })
// );


// app.use(
//   cors({
//     origin: process.env.FRONTEND_URL || 'http://localhost:5173',
//     credentials: true,
//   })
// );

// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 1000, // limit each IP
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
//   console.log('User connected:', socket.id, 'UserID:', socket.user?._id);

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

//     const { sendNoteReminderEmail } = await import('./utils/email.js')
    
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

// // Validate encryption configuration on startup
// function validateEncryptionKeyOnStartup() {
//   const raw = process.env.BANK_ENCRYPTION_KEY
//   if (!raw) {
//     console.warn('⚠️ Warning: BANK_ENCRYPTION_KEY not set. Bank detail encryption will be unavailable.')
//     return
//   }

//   // Attempt base64 decode
//   let buf
//   try {
//     buf = Buffer.from(raw, 'base64')
//   } catch (err) {
//     console.error('Invalid BANK_ENCRYPTION_KEY: not valid base64')
//     process.exit(1)
//   }

//   if (buf.length !== 32) {
//     console.warn(`⚠️ Warning: BANK_ENCRYPTION_KEY is ${buf.length} bytes instead of 32. Using as-is.`)
//     return
//   }

//   console.log('✅ Bank encryption key validated')
// }

// // ---------------------
// // Start server
// // ---------------------
// async function startServer() {
//   try {
//     validateEncryptionKeyOnStartup()

//     console.log('Connecting to MongoDB...');
//     await mongoose.connect(
//       process.env.MONGODB_URI || 'mongodb://localhost:27017/marketbook-solution',
//       {
//         useNewUrlParser: true,
//         useUnifiedTopology: true,
//       }
//     );
//     console.log('Connected to MongoDB successfully');

//     // Start the email reminder job
//     console.log('Initializing scheduled note reminder job...')
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

// export { io };







// import emailRoutes from './routes/email.js';
// import dotenv from 'dotenv';
// dotenv.config();

// import express from 'express';
// import cors from 'cors';
// import mongoose from 'mongoose';
// import { createServer } from 'http';
// import { Server } from 'socket.io';
// import helmet from 'helmet';
// import rateLimit from 'express-rate-limit';
// import jwt from 'jsonwebtoken';

// // Import routes
// import authRoutes from './routes/auth.js';
// // removed route modules for items, notifications, tickets, advertisements, escrow
// import userRoutes from './routes/users.js';
// import globalAdminRoutes from './routes/globalAdmin.js';
// // globalAdminEscrow route removed along with escrow ticket model
// import notesRoutes from './routes/notes.js'
// import smsRoutes from './routes/sms.js';

// // Import middleware
// import { authenticateToken } from './middleware/auth.js';

// const app = express();
// const server = createServer(app);

// const io = new Server(server, {
//   cors: {
//     origin: process.env.FRONTEND_URL || 'http://localhost:5173',
//     methods: ['GET', 'POST', 'PUT', 'DELETE'],
//     credentials: true,
//   },
// });

// // ✅ Trust proxy for secure deployments
// app.set('trust proxy', 1);

// // Middleware
// app.use(
//   helmet({
//     crossOriginResourcePolicy: { policy: "cross-origin" }
//   })
// );


// app.use(
//   cors({
//     origin: process.env.FRONTEND_URL || 'http://localhost:5173',
//     credentials: true,
//   })
// );

// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 1000, // limit each IP
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
//   console.log('User connected:', socket.id, 'UserID:', socket.user?._id);

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

//     const { sendNoteReminderEmail } = await import('./utils/email.js')
    
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

// // Validate encryption configuration on startup
// function validateEncryptionKeyOnStartup() {
//   const raw = process.env.BANK_ENCRYPTION_KEY
//   if (!raw) {
//     console.warn('⚠️ Warning: BANK_ENCRYPTION_KEY not set. Bank detail encryption will be unavailable.')
//     return
//   }

//   // Attempt base64 decode
//   let buf
//   try {
//     buf = Buffer.from(raw, 'base64')
//   } catch (err) {
//     console.error('Invalid BANK_ENCRYPTION_KEY: not valid base64')
//     process.exit(1)
//   }

//   if (buf.length !== 32) {
//     console.warn(`⚠️ Warning: BANK_ENCRYPTION_KEY is ${buf.length} bytes instead of 32. Using as-is.`)
//     return
//   }

//   console.log('✅ Bank encryption key validated')
// }

// // ---------------------
// // Start server
// // ---------------------
// async function startServer() {
//   try {
//     validateEncryptionKeyOnStartup()

//     console.log('Connecting to MongoDB...');
//     await mongoose.connect(
//       process.env.MONGODB_URI || 'mongodb://localhost:27017/marketbook-solution',
//       {
//         useNewUrlParser: true,
//         useUnifiedTopology: true,
//       }
//     );
//     console.log('Connected to MongoDB successfully');

//     // Start the email reminder job
//     console.log('Initializing scheduled note reminder job...')
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

// export { io };












// import dotenv from 'dotenv';
// dotenv.config();

// import express from 'express';
// import cors from 'cors';
// import mongoose from 'mongoose';
// import { createServer } from 'http';
// import { Server } from 'socket.io';
// import helmet from 'helmet';
// import rateLimit from 'express-rate-limit';
// import jwt from 'jsonwebtoken';

// // Import routes
// import authRoutes from './routes/auth.js';
// import itemRoutes from './routes/items.js';
// import userRoutes from './routes/users.js';
// import adminRoutes from './routes/admin.js';
// import globalAdminRoutes from './routes/globalAdmin.js';
// import notificationRoutes from './routes/notifications.js';
// import ticketRoutes from './routes/tickets.js';
// import advertisementRoutes from './routes/advertisements.js';
// import escrowRoutes from './routes/escrow.js';
// import globalAdminEscrowRoutes from './routes/globalAdminEscrow.js';
// import notesRoutes from './routes/notes.js'
// import remindersRoutes from './routes/reminders.js'
// import websiteRoutes from './routes/websites.js';
// import websiteSectionRoutes from './routes/websiteSections.js';
// import publicWebsiteRoutes from './routes/publicWebsites.js';
// import globalAdminWebsiteRoutes from './routes/globalAdminWebsites.js';
// import paymentsRoutes from './routes/payments.js';
// import publicWebsitePaymentsRoutes from './routes/publicWebsitePayments.js';
// import productsRoutes from './routes/products.js';
// import websitePaymentConfigRoutes from './routes/websitePaymentConfig.js';
// import contactMessagesRoutes from './routes/contactMessages.js';
// import reviewsRoutes from './routes/reviews.js';
// import fixturesRoutes from './routes/fixtures.js';
// import resumesRoutes from './routes/resumes.js';
// import { scheduleEmailReminderJob } from './jobs/emailReminderJob.js';

// // Import middleware
// import { authenticateToken } from './middleware/auth.js';

// const app = express();
// const server = createServer(app);

// const io = new Server(server, {
//   cors: {
//     origin: process.env.FRONTEND_URL || 'http://localhost:5173',
//     methods: ['GET', 'POST', 'PUT', 'DELETE'],
//     credentials: true,
//   },
// });

// // ✅ Trust proxy for secure deployments
// app.set('trust proxy', 1);

// // Middleware
// app.use(helmet());
// app.use(
//   cors({
//     origin: process.env.FRONTEND_URL || 'http://localhost:5173',
//     credentials: true,
//   })
// );

// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 1000, // limit each IP
// });
// app.use('/api/', limiter);

// app.use(express.json({ limit: '50mb' }));
// app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// // Serve static files from uploads directory with CORS headers
// app.use('/uploads', (req, res, next) => {
//   res.header('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'http://localhost:5173');
//   res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
//   res.header('Access-Control-Allow-Headers', 'Content-Type');
//   res.header('Access-Control-Allow-Credentials', 'true');
//   if (req.method === 'OPTIONS') {
//     return res.sendStatus(200);
//   }
//   next();
// });
// app.use('/uploads', express.static('uploads'));

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
//   console.log('User connected:', socket.id, 'UserID:', socket.user?._id);

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
// app.use('/api/items', authenticateToken, itemRoutes);

// // Users routes contain public endpoints (register, verify) and protected endpoints.
// // Protect protected endpoints inside users.js
// app.use('/api/users', userRoutes);

// app.use('/api/admin', authenticateToken, adminRoutes);
// app.use('/api/global-admin', globalAdminRoutes);
// app.use('/api/notifications', authenticateToken, notificationRoutes);
// app.use('/api/tickets', authenticateToken, ticketRoutes);
// app.use('/api/notes', authenticateToken, notesRoutes);
// app.use('/api/reminders', authenticateToken, remindersRoutes);
// app.use('/api/websites', authenticateToken, websiteRoutes);
// app.use('/api/website-sections', authenticateToken, websiteSectionRoutes);
// app.use('/api/websites-public', publicWebsiteRoutes);
// app.use('/api/payments', paymentsRoutes);
// app.use('/api/store-payments', publicWebsitePaymentsRoutes);
// app.use('/api/products', authenticateToken, productsRoutes);
// app.use('/api/website-payment-config', authenticateToken, websitePaymentConfigRoutes);
// app.use('/api/contact-messages', contactMessagesRoutes);
// app.use('/api/reviews', reviewsRoutes);
// app.use('/api/fixtures', fixturesRoutes);
// app.use('/api/resumes', resumesRoutes);
// app.use('/api/global-admin/websites', globalAdminWebsiteRoutes);
// app.use('/api/advertisements', advertisementRoutes);
// app.use('/api/escrow', authenticateToken, escrowRoutes);
// app.use('/api/global-admin/escrow', globalAdminEscrowRoutes);

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

//     const { sendNoteReminderEmail } = await import('./utils/email.js')
    
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

// // Validate encryption configuration on startup
// function validateEncryptionKeyOnStartup() {
//   const raw = process.env.BANK_ENCRYPTION_KEY
//   if (!raw) {
//     console.warn('⚠️ Warning: BANK_ENCRYPTION_KEY not set. Bank detail encryption will be unavailable.')
//     return
//   }

//   // Attempt base64 decode
//   let buf
//   try {
//     buf = Buffer.from(raw, 'base64')
//   } catch (err) {
//     console.error('Invalid BANK_ENCRYPTION_KEY: not valid base64')
//     process.exit(1)
//   }

//   if (buf.length !== 32) {
//     console.warn(`⚠️ Warning: BANK_ENCRYPTION_KEY is ${buf.length} bytes instead of 32. Using as-is.`)
//     return
//   }

//   console.log('✅ Bank encryption key validated')
// }

// // ---------------------
// // Start server
// // ---------------------
// async function startServer() {
//   try {
//     validateEncryptionKeyOnStartup()

//     console.log('Connecting to MongoDB...');
//     await mongoose.connect(
//       process.env.MONGODB_URI || 'mongodb://localhost:27017/marketbook-solution',
//       {
//         useNewUrlParser: true,
//         useUnifiedTopology: true,
//       }
//     );
//     console.log('Connected to MongoDB successfully');

//     // Start the email reminder job
//     console.log('Initializing scheduled note reminder job...')
//     scheduleEmailReminderJob(5 * 60 * 1000) // Run every 5 minutes

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

// export { io };


















// import dotenv from 'dotenv';
// dotenv.config();

// import express from 'express';
// import cors from 'cors';
// import mongoose from 'mongoose';
// import { createServer } from 'http';
// import { Server } from 'socket.io';
// import helmet from 'helmet';
// import rateLimit from 'express-rate-limit';
// import jwt from 'jsonwebtoken';

// // Import routes
// import authRoutes from './routes/auth.js';
// import itemRoutes from './routes/items.js';
// import userRoutes from './routes/users.js';
// import adminRoutes from './routes/admin.js';
// import globalAdminRoutes from './routes/globalAdmin.js';
// import notificationRoutes from './routes/notifications.js';
// import ticketRoutes from './routes/tickets.js';
// import advertisementRoutes from './routes/advertisements.js';
// import escrowRoutes from './routes/escrow.js';
// import globalAdminEscrowRoutes from './routes/globalAdminEscrow.js';
// import notesRoutes from './routes/notes.js'
// import remindersRoutes from './routes/reminders.js'
// import websiteRoutes from './routes/websites.js';
// import websiteSectionRoutes from './routes/websiteSections.js';
// import publicWebsiteRoutes from './routes/publicWebsites.js';
// import globalAdminWebsiteRoutes from './routes/globalAdminWebsites.js';
// import paymentsRoutes from './routes/payments.js';
// import publicWebsitePaymentsRoutes from './routes/publicWebsitePayments.js';
// import productsRoutes from './routes/products.js';
// import websitePaymentConfigRoutes from './routes/websitePaymentConfig.js';
// import contactMessagesRoutes from './routes/contactMessages.js';
// import reviewsRoutes from './routes/reviews.js';
// import fixturesRoutes from './routes/fixtures.js';
// import resumesRoutes from './routes/resumes.js';
// import { scheduleEmailReminderJob } from './jobs/emailReminderJob.js';

// // Import middleware
// import { authenticateToken } from './middleware/auth.js';

// const app = express();
// const server = createServer(app);

// const io = new Server(server, {
//   cors: {
//     origin: process.env.FRONTEND_URL || 'http://localhost:5173',
//     methods: ['GET', 'POST', 'PUT', 'DELETE'],
//     credentials: true,
//   },
// });

// // ✅ Trust proxy for secure deployments
// app.set('trust proxy', 1);

// // Middleware
// app.use(helmet());
// app.use(
//   cors({
//     origin: process.env.FRONTEND_URL || 'http://localhost:5173',
//     credentials: true,
//   })
// );

// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 1000, // limit each IP
// });
// app.use('/api/', limiter);

// app.use(express.json({ limit: '50mb' }));
// app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// // Serve static files from uploads directory
// app.use('/uploads', express.static('uploads'));

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
//   console.log('User connected:', socket.id, 'UserID:', socket.user?._id);

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
// app.use('/api/items', authenticateToken, itemRoutes);

// // Users routes contain public endpoints (register, verify) and protected endpoints.
// // Protect protected endpoints inside users.js
// app.use('/api/users', userRoutes);

// app.use('/api/admin', authenticateToken, adminRoutes);
// app.use('/api/global-admin', globalAdminRoutes);
// app.use('/api/notifications', authenticateToken, notificationRoutes);
// app.use('/api/tickets', authenticateToken, ticketRoutes);
// app.use('/api/notes', authenticateToken, notesRoutes);
// app.use('/api/reminders', authenticateToken, remindersRoutes);
// app.use('/api/websites', authenticateToken, websiteRoutes);
// app.use('/api/website-sections', authenticateToken, websiteSectionRoutes);
// app.use('/api/websites-public', publicWebsiteRoutes);
// app.use('/api/payments', paymentsRoutes);
// app.use('/api/store-payments', publicWebsitePaymentsRoutes);
// app.use('/api/products', authenticateToken, productsRoutes);
// app.use('/api/website-payment-config', authenticateToken, websitePaymentConfigRoutes);
// app.use('/api/contact-messages', contactMessagesRoutes);
// app.use('/api/reviews', reviewsRoutes);
// app.use('/api/fixtures', fixturesRoutes);
// app.use('/api/resumes', resumesRoutes);
// app.use('/api/global-admin/websites', globalAdminWebsiteRoutes);
// app.use('/api/advertisements', advertisementRoutes);
// app.use('/api/escrow', authenticateToken, escrowRoutes);
// app.use('/api/global-admin/escrow', globalAdminEscrowRoutes);

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

//     const { sendNoteReminderEmail } = await import('./utils/email.js')
    
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

// // Validate encryption configuration on startup
// function validateEncryptionKeyOnStartup() {
//   const raw = process.env.BANK_ENCRYPTION_KEY
//   if (!raw) {
//     console.warn('⚠️ Warning: BANK_ENCRYPTION_KEY not set. Bank detail encryption will be unavailable.')
//     return
//   }

//   // Attempt base64 decode
//   let buf
//   try {
//     buf = Buffer.from(raw, 'base64')
//   } catch (err) {
//     console.error('Invalid BANK_ENCRYPTION_KEY: not valid base64')
//     process.exit(1)
//   }

//   if (buf.length !== 32) {
//     console.warn(`⚠️ Warning: BANK_ENCRYPTION_KEY is ${buf.length} bytes instead of 32. Using as-is.`)
//     return
//   }

//   console.log('✅ Bank encryption key validated')
// }

// // ---------------------
// // Start server
// // ---------------------
// async function startServer() {
//   try {
//     validateEncryptionKeyOnStartup()

//     console.log('Connecting to MongoDB...');
//     await mongoose.connect(
//       process.env.MONGODB_URI || 'mongodb://localhost:27017/marketbook-solution',
//       {
//         useNewUrlParser: true,
//         useUnifiedTopology: true,
//       }
//     );
//     console.log('Connected to MongoDB successfully');

//     // Start the email reminder job
//     console.log('Initializing scheduled note reminder job...')
//     scheduleEmailReminderJob(5 * 60 * 1000) // Run every 5 minutes

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

// export { io };


// import dotenv from 'dotenv';
// dotenv.config();

// import express from 'express'
// import cors from 'cors'
// import mongoose from 'mongoose'
// import { createServer } from 'http'
// import { Server } from 'socket.io'
// import helmet from 'helmet'
// import rateLimit from 'express-rate-limit'

// // Import routes
// import authRoutes from './routes/auth.js'
// import itemRoutes from './routes/items.js'
// import userRoutes from './routes/users.js'
// import adminRoutes from './routes/admin.js'
// import globalAdminRoutes from './routes/globalAdmin.js'
// import notificationRoutes from './routes/notifications.js'
// import ticketRoutes from './routes/tickets.js'
// import advertisementRoutes from './routes/advertisements.js'
// import escrowRoutes from './routes/escrow.js'
// import globalAdminEscrowRoutes from './routes/globalAdminEscrow.js'

// // Import middleware
// import { authenticateToken } from './middleware/auth.js'

// const app = express()
// const server = createServer(app)
// const io = new Server(server, {
//   cors: {
//     origin: process.env.FRONTEND_URL || 'http://localhost:5173',
//     methods: ["GET", "POST", "PUT", "DELETE"],
//     credentials: true
//   }
// })

// // ✅ Secure fix: trust only one proxy (Render, Heroku, NGINX, etc.)
// app.set('trust proxy', 1)

// // Middleware
// app.use(helmet())
// app.use(cors({
//   origin: process.env.FRONTEND_URL || 'http://localhost:5173',
//   credentials: true
// }))

// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 1000 // limit each IP to 1000 requests per window
// })
// app.use('/api/', limiter)

// app.use(express.json({ limit: '50mb' }))
// app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// // Socket.io setup
// io.on('connection', (socket) => {
//   console.log('User connected:', socket.id)

//   socket.on('join-room', (userId) => {
//     socket.join(userId)
//     console.log(`User ${userId} joined room`)
//   })

//   socket.on('disconnect', () => {
//     console.log('User disconnected:', socket.id)
//   })
// })

// // Make io available to routes
// app.set('io', io)

// // Routes
// app.use('/api/auth', authRoutes)
// app.use('/api/items', authenticateToken, itemRoutes)

// // IMPORTANT: users routes contain public endpoints (register, verify) and protected endpoints.
// // Mount WITHOUT global authenticateToken. Protect protected endpoints inside routes/users.js
// app.use('/api/users', userRoutes)

// app.use('/api/admin', authenticateToken, adminRoutes)
// app.use('/api/global-admin', globalAdminRoutes)
// app.use('/api/notifications', authenticateToken, notificationRoutes)
// app.use('/api/tickets', authenticateToken, ticketRoutes)
// app.use('/api/advertisements', advertisementRoutes)
// app.use('/api/escrow', authenticateToken, escrowRoutes)
// app.use('/api/global-admin/escrow', globalAdminEscrowRoutes)

// // Health check endpoint
// app.get('/api/health', (req, res) => {
//   res.json({
//     status: 'OK',
//     timestamp: new Date().toISOString(),
//     uptime: process.uptime()
//   })
// })

// // Error handling middleware
// app.use((err, req, res, next) => {
//   console.error(err.stack)
//   res.status(500).json({
//     message: 'Something went wrong!',
//     error: process.env.NODE_ENV === 'development' ? err.message : undefined
//   })
// })

// // 404 handler
// app.use('*', (req, res) => {
//   res.status(404).json({ message: 'Route not found' })
// })

// const PORT = process.env.PORT || 5000

// // Async function to start the server
// async function startServer() {
//   try {
//     console.log('Connecting to MongoDB...')
//     await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/marketbook-solution', {
//       useNewUrlParser: true,
//       useUnifiedTopology: true
//     })

//     console.log('Connected to MongoDB successfully')

//     server.listen(PORT, () => {
//       console.log(`Server running on port ${PORT}`)
//       console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`)
//     })

//   } catch (error) {
//     console.error('Failed to start server:', error.message)
//     console.error('Error details:', error)
//     process.exit(1)
//   }
// }

// mongoose.connection.on('error', (error) => {
//   console.error('MongoDB connection error:', error)
// })

// mongoose.connection.on('disconnected', () => {
//   console.log('MongoDB disconnected')
// })

// process.on('SIGINT', async () => {
//   console.log('Shutting down gracefully...')
//   try {
//     await mongoose.connection.close()
//     console.log('MongoDB connection closed')
//     server.close(() => {
//       console.log('Server closed')
//       process.exit(0)
//     })
//   } catch (error) {
//     console.error('Error during shutdown:', error)
//     process.exit(1)
//   }
// })

// startServer()

// export { io }















// import dotenv from 'dotenv';
// dotenv.config();

// import express from 'express'
// import cors from 'cors'
// // import dotenv from 'dotenv'
// import mongoose from 'mongoose'
// import { createServer } from 'http'
// import { Server } from 'socket.io'
// import helmet from 'helmet'
// import rateLimit from 'express-rate-limit'

// // Import routes
// import authRoutes from './routes/auth.js'
// import itemRoutes from './routes/items.js'
// import userRoutes from './routes/users.js'
// import adminRoutes from './routes/admin.js'
// import globalAdminRoutes from './routes/globalAdmin.js'
// import notificationRoutes from './routes/notifications.js'
// import ticketRoutes from './routes/tickets.js'
// import advertisementRoutes from './routes/advertisements.js'
// import escrowRoutes from './routes/escrow.js'
// import globalAdminEscrowRoutes from './routes/globalAdminEscrow.js'

// // Import middleware
// import { authenticateToken } from './middleware/auth.js'

// // dotenv.config()

// const app = express()
// const server = createServer(app)
// const io = new Server(server, {
//   cors: {
//     origin: "http://localhost:5173",
//     methods: ["GET", "POST"]
//   }
// })

// // ✅ Secure fix: trust only one proxy (Render, Heroku, NGINX, etc.)
// app.set('trust proxy', 1)

// // Middleware
// app.use(helmet())
// app.use(cors({
//   origin: process.env.FRONTEND_URL || 'http://localhost:5173',
//   credentials: true
// }))

// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 1000 // limit each IP to 1000 requests per window
// })
// app.use('/api/', limiter)

// app.use(express.json({ limit: '50mb' }))
// app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// // Socket.io setup
// io.on('connection', (socket) => {
//   console.log('User connected:', socket.id)

//   socket.on('join-room', (userId) => {
//     socket.join(userId)
//     console.log(`User ${userId} joined room`)
//   })

//   socket.on('disconnect', () => {
//     console.log('User disconnected:', socket.id)
//   })
// })

// // Make io available to routes
// app.set('io', io)

// // Routes
// app.use('/api/auth', authRoutes)
// app.use('/api/items', authenticateToken, itemRoutes)
// app.use('/api/users', authenticateToken, userRoutes)
// app.use('/api/admin', authenticateToken, adminRoutes)
// app.use('/api/global-admin', globalAdminRoutes)
// app.use('/api/notifications', authenticateToken, notificationRoutes)
// app.use('/api/tickets', authenticateToken, ticketRoutes)
// app.use('/api/advertisements', advertisementRoutes)
// app.use('/api/escrow', authenticateToken, escrowRoutes)
// app.use('/api/global-admin/escrow', globalAdminEscrowRoutes)

// // Health check endpoint
// app.get('/api/health', (req, res) => {
//   res.json({ 
//     status: 'OK', 
//     timestamp: new Date().toISOString(),
//     uptime: process.uptime()
//   })
// })

// // Error handling middleware
// app.use((err, req, res, next) => {
//   console.error(err.stack)
//   res.status(500).json({ 
//     message: 'Something went wrong!',
//     error: process.env.NODE_ENV === 'development' ? err.message : undefined
//   })
// })

// // 404 handler
// app.use('*', (req, res) => {
//   res.status(404).json({ message: 'Route not found' })
// })

// const PORT = process.env.PORT || 5000

// // Async function to start the server
// async function startServer() {
//   try {
//     console.log('Connecting to MongoDB...')
//     await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/marketbook-solution')
    
//     console.log('Connected to MongoDB successfully')
    
//     server.listen(PORT, () => {
//       console.log(`Server running on port ${PORT}`)
//       console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`)
//     })
    
//   } catch (error) {
//     console.error('Failed to start server:', error.message)
//     console.error('Error details:', error)
//     process.exit(1)
//   }
// }

// mongoose.connection.on('error', (error) => {
//   console.error('MongoDB connection error:', error)
// })

// mongoose.connection.on('disconnected', () => {
//   console.log('MongoDB disconnected')
// })

// process.on('SIGINT', async () => {
//   console.log('Shutting down gracefully...')
//   try {
//     await mongoose.connection.close()
//     console.log('MongoDB connection closed')
//     server.close(() => {
//       console.log('Server closed')
//       process.exit(0)
//     })
//   } catch (error) {
//     console.error('Error during shutdown:', error)
//     process.exit(1)
//   }
// })

// startServer()

// export { io }
