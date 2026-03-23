import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import GlobalAdmin from '../models/GlobalAdmin.js'

const normalizeIpRaw = (ip) => {
  if (!ip) return ''
  let value = String(ip).trim().toLowerCase()

  if (value === '::1' || value === '::ffff:127.0.0.1') {
    return '127.0.0.1'
  }

  if (value.startsWith('::ffff:')) {
    return value.replace('::ffff:', '')
  }

  return value
}

const parseProxyIps = (req) => {
  const forwards = []

  if (req.headers['x-forwarded-for']) {
    const headerValue = String(req.headers['x-forwarded-for'])
    headerValue.split(',').forEach((entry) => {
      const normalized = normalizeIpRaw(entry)
      if (normalized) forwards.push(normalized)
    })
  }

  if (req.headers['x-real-ip']) {
    const normalized = normalizeIpRaw(req.headers['x-real-ip'])
    if (normalized) forwards.push(normalized)
  }

  if (req.headers['cf-connecting-ip']) {
    const normalized = normalizeIpRaw(req.headers['cf-connecting-ip'])
    if (normalized) forwards.push(normalized)
  }

  if (req.ip) {
    const normalized = normalizeIpRaw(req.ip)
    if (normalized) forwards.push(normalized)
  }

  if (req.connection?.remoteAddress) {
    const normalized = normalizeIpRaw(req.connection.remoteAddress)
    if (normalized) forwards.push(normalized)
  }

  if (req.socket?.remoteAddress) {
    const normalized = normalizeIpRaw(req.socket.remoteAddress)
    if (normalized) forwards.push(normalized)
  }

  // Deduplicate multiple writes
  return [...new Set(forwards)]
}

export const getRequestIp = (req) => {
  try {
    const ips = parseProxyIps(req)
    const ip = ips.length ? ips[0] : null

    if (!ip) {
      console.warn('[getRequestIp] No IP found in any header or socket')
      return null
    }

    console.log('Extracted IP:', ip)
    console.log('x-forwarded-for:', req.headers['x-forwarded-for'])
    console.log('req.ip:', req.ip)
    console.log('[getRequestIp] Parsed IPs:', ips)

    return ip
  } catch (error) {
    console.error('[getRequestIp] Error extracting IP:', error.message)
    return null
  }
}
export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]

    if (!token) {
      return res.status(401).json({ message: 'Access token required' })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // ===== GLOBAL ADMIN TOKEN =====
    if (decoded.type === 'global-admin') {
      // No DB lookup: only accept env-configured global admin tokens.
      const envEmail = process.env.GLOBAL_ADMIN_EMAIL && process.env.GLOBAL_ADMIN_EMAIL.toLowerCase()
      const tokenEmail = (decoded.email || '').toLowerCase()

      if (envEmail && tokenEmail && tokenEmail !== envEmail) {
        return res.status(401).json({ message: 'Invalid token' })
      }

      // Set a lightweight req.globalAdmin object based on token/env
      req.globalAdmin = {
        _id: null,
        email: tokenEmail || envEmail || null,
        isOriginal: decoded.isOriginal === true,
        appPremiumMode: false
      }

      req.userType = 'global-admin'
      req.userId = null

      console.log('Global admin authenticated (env):', {
        adminId: decoded.adminId,
        email: req.globalAdmin.email,
        isOriginal: decoded.isOriginal
      })
    }
    // ===== REGULAR USER TOKEN =====
    else {
      const user = await User.findById(decoded.userId).select('-password')

      if (!user || user.isDeleted || !user.isActive) {
        return res.status(401).json({ message: 'Invalid token or account disabled' })
      }

      req.user = user
      // Provide legacy `req.userId` for older route handlers
      req.userId = user._id
      req.userType = 'user'
    }

    next()
  } catch (error) {
    console.error('JWT AUTH FAILED:', {
      name: error.name,
      message: error.message
    })
    return res.status(401).json({ message: 'Invalid token' })
  }
}

// =======================
// ROLE GUARDS
// =======================

export const requireUser = (req, res, next) => {
  if (!req.user) {
    return res.status(403).json({ message: 'User access required' })
  }
  next()
}

export const requireAuthorizedIp = (req, res, next) => {
  if (req.globalAdmin) {
    return next()
  }

  if (!req.user) {
    return res.status(403).json({ message: 'User access required' })
  }

  const requestIp = getRequestIp(req)
  const requestIps = parseProxyIps(req)
  const allowedIps = (req.user.authorizedIps || []).map((item) => normalizeIpRaw(item.ip))

  console.log('[requireAuthorizedIp] requestIps:', requestIps)
  console.log('[requireAuthorizedIp] allowedIps:', allowedIps)

  if (!requestIps.length || allowedIps.length === 0) {
    return res.status(403).json({ message: 'Access Denied – Unauthorized IP' })
  }

  const hasAllowed = requestIps.some((ip) => allowedIps.includes(ip))

  if (!hasAllowed) {
    return res.status(403).json({ message: 'Access Denied – Unauthorized IP' })
  }

  // Save last request IP for visibility (optional)
  req.user.lastRequestIp = requestIp

  next()
}

export const requireGlobalAdmin = (req, res, next) => {
  if (!req.globalAdmin) {
    return res.status(403).json({ message: 'Global admin access required' })
  }
  next()
}

// Modified: allow all authenticated users (not just user-admins)
export const requireUserAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(403).json({ message: 'User access required' })
  }
  next();
}

export const requireNotepadPasswordVerified = (req, res, next) => {
  // Skip password check if user is global admin (they bypass all protections)
  if (req.globalAdmin) {
    return next()
  }

  // Check if user has notepad password set
  if (req.user && req.user.adminConfig && req.user.adminConfig.notepadPassword) {
    // If password is set, check if it's been verified in session
    // Note: This would require session support. For now, we'll just note that
    // the frontend should handle the password verification via sessionStorage
    // and the frontend will not send requests without verification
    return next()
  }

  // No password set, allow access
  next()
}

// Premium access check - for User Admin Dashboard and premium features
export const requirePremiumAccess = async (req, res, next) => {
  try {
    // Global admins always have access to all features
    if (req.globalAdmin) {
      return next()
    }

    // Regular users need to pass premium check
    if (!req.user) {
      return res.status(403).json({ message: 'User access required' })
    }

    // Get global admin settings to check app premium mode
    const globalAdmin = await GlobalAdmin.findOne()
    
    // If app is in Free Mode, all users have access
    if (!globalAdmin || !globalAdmin.appPremiumMode) {
      return next()
    }

    // App is in Premium Mode - check if user is premium
    if (req.user.isPremium) {
      return next()
    }

    // User is not premium and app is in premium mode
    return res.status(403).json({ 
      message: 'Premium access required. This feature requires a Premium account.',
      requiresPremium: true
    })
  } catch (error) {
    console.error('Premium access check error:', error)
    return res.status(500).json({ message: 'Error checking premium access' })
  }
}







// import jwt from 'jsonwebtoken'
// import User from '../models/User.js'
// import GlobalAdmin from '../models/GlobalAdmin.js'

// export const authenticateToken = async (req, res, next) => {
//   try {
//     const authHeader = req.headers['authorization']
//     const token = authHeader && authHeader.split(' ')[1]

//     if (!token) {
//       return res.status(401).json({ message: 'Access token required' })
//     }

//     const decoded = jwt.verify(token, process.env.JWT_SECRET)

//     // ===== GLOBAL ADMIN TOKEN =====
//     if (decoded.type === 'global-admin') {
//       const admin = await GlobalAdmin.findById(decoded.adminId)

//       if (!admin) {
//         return res.status(401).json({ message: 'Invalid token' })
//       }

//       req.globalAdmin = {
//         ...admin.toObject(),
//         isOriginal: decoded.isOriginal === true
//       }

//       req.userType = 'global-admin'
      
//       // For compatibility with routes that expect `req.userId`, set it to null for global admins
//       req.userId = null

//       console.log('Global admin authenticated:', {
//         adminId: admin._id,
//         email: admin.email,
//         isOriginal: decoded.isOriginal
//       })
//     } 
//     // ===== REGULAR USER TOKEN =====
//     else {
//       const user = await User.findById(decoded.userId).select('-password')

//       if (!user || user.isDeleted || !user.isActive) {
//         return res.status(401).json({ message: 'Invalid token or account disabled' })
//       }

//       req.user = user
//       // Provide legacy `req.userId` for older route handlers
//       req.userId = user._id
//       req.userType = 'user'
//     }

//     next()
//   } catch (error) {
//     console.error('JWT AUTH FAILED:', {
//       name: error.name,
//       message: error.message
//     })
//     return res.status(401).json({ message: 'Invalid token' })
//   }
// }

// // =======================
// // ROLE GUARDS
// // =======================

// export const requireUser = (req, res, next) => {
//   if (!req.user) {
//     return res.status(403).json({ message: 'User access required' })
//   }
//   next()
// }

// export const requireGlobalAdmin = (req, res, next) => {
//   if (!req.globalAdmin) {
//     return res.status(403).json({ message: 'Global admin access required' })
//   }
//   next()
// }

// // Modified: allow all authenticated users (not just user-admins)
// export const requireUserAdmin = (req, res, next) => {
//   if (!req.user) {
//     return res.status(403).json({ message: 'User access required' })
//   }
//   next();
// }

// export const requireNotepadPasswordVerified = (req, res, next) => {
//   // Skip password check if user is global admin (they bypass all protections)
//   if (req.globalAdmin) {
//     return next()
//   }

//   // Check if user has notepad password set
//   if (req.user && req.user.adminConfig && req.user.adminConfig.notepadPassword) {
//     // If password is set, check if it's been verified in session
//     // Note: This would require session support. For now, we'll just note that
//     // the frontend should handle the password verification via sessionStorage
//     // and the frontend will not send requests without verification
//     return next()
//   }

//   // No password set, allow access
//   next()
// }

// // Premium access check - for User Admin Dashboard and premium features
// export const requirePremiumAccess = async (req, res, next) => {
//   try {
//     // Global admins always have access to all features
//     if (req.globalAdmin) {
//       return next()
//     }

//     // Regular users need to pass premium check
//     if (!req.user) {
//       return res.status(403).json({ message: 'User access required' })
//     }

//     // Get global admin settings to check app premium mode
//     const globalAdmin = await GlobalAdmin.findOne()
    
//     // If app is in Free Mode, all users have access
//     if (!globalAdmin || !globalAdmin.appPremiumMode) {
//       return next()
//     }

//     // App is in Premium Mode - check if user is premium
//     if (req.user.isPremium) {
//       return next()
//     }

//     // User is not premium and app is in premium mode
//     return res.status(403).json({ 
//       message: 'Premium access required. This feature requires a Premium account.',
//       requiresPremium: true
//     })
//   } catch (error) {
//     console.error('Premium access check error:', error)
//     return res.status(500).json({ message: 'Error checking premium access' })
//   }
// }




// import jwt from 'jsonwebtoken'
// import User from '../models/User.js'
// import GlobalAdmin from '../models/GlobalAdmin.js'

// export const authenticateToken = async (req, res, next) => {
//   try {
//     const authHeader = req.headers['authorization']
//     const token = authHeader && authHeader.split(' ')[1]

//     if (!token) {
//       return res.status(401).json({ message: 'Access token required' })
//     }

//     const decoded = jwt.verify(token, process.env.JWT_SECRET)
    
//     // Check if it's a global admin token
//     if (decoded.type === 'global-admin') {
//       const admin = await GlobalAdmin.findById(decoded.adminId)
//       if (!admin) {
//         return res.status(401).json({ message: 'Invalid token' })
//       }
//       req.globalAdmin = admin
//       req.userType = 'global-admin'
      
//       // CRITICAL: Set isOriginal from the token payload, not the database
//       req.globalAdmin.isOriginal = decoded.isOriginal
      
//       console.log('Global admin authenticated:', {
//         adminId: admin._id,
//         email: admin.email,
//         isOriginal: decoded.isOriginal,
//         tokenIsOriginal: decoded.isOriginal
//       })
//     } else {
//       // Regular user token
//       const user = await User.findById(decoded.userId).select('-password')
//       if (!user || user.isDeleted || !user.isActive) {
//         return res.status(401).json({ message: 'Invalid token or account disabled' })
//       }
//       req.user = user
//       req.userType = 'user'
//     }

//     next()
//   } catch (error) {
//     console.error('Authentication error:', error)
//     return res.status(401).json({ message: 'Invalid token' })
//   }
// }

// export const requireUser = (req, res, next) => {
//   if (!req.user) {
//     return res.status(403).json({ message: 'User access required' })
//   }
//   next()
// }

// export const requireGlobalAdmin = (req, res, next) => {
//   if (!req.globalAdmin) {
//     return res.status(403).json({ message: 'Global admin access required' })
//   }
//   next()
// }

// export const requireUserAdmin = async (req, res, next) => {
//   if (!req.user || !req.user.adminConfig.isAdmin) {
//     return res.status(403).json({ message: 'User admin access required' })
//   }
//   next()
// }