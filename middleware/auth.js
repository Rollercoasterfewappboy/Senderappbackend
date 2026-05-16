const jwt = require('jsonwebtoken')
const User = require('../models/User.js')
const GlobalAdmin = require('../models/GlobalAdmin.js')

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

const isPrivateIP = (ip) => {
  if (!ip) return true
  const value = String(ip).trim().toLowerCase()
  // Check for private/loopback IPs
  return (
    value === '127.0.0.1' ||
    value === '::1' ||
    value === '::ffff:127.0.0.1' ||
    value.startsWith('192.168.') ||
    value.startsWith('10.') ||
    value.startsWith('172.16.') ||
    value.startsWith('172.17.') ||
    value.startsWith('172.18.') ||
    value.startsWith('172.19.') ||
    value.startsWith('172.20.') ||
    value.startsWith('172.21.') ||
    value.startsWith('172.22.') ||
    value.startsWith('172.23.') ||
    value.startsWith('172.24.') ||
    value.startsWith('172.25.') ||
    value.startsWith('172.26.') ||
    value.startsWith('172.27.') ||
    value.startsWith('172.28.') ||
    value.startsWith('172.29.') ||
    value.startsWith('172.30.') ||
    value.startsWith('172.31.')
  )
}

const parseProxyIps = (req) => {
  const forwardedIps = []

  // Priority 0: x-user-public-ip (custom header for frontend to send detected public IP)
  if (req.headers['x-user-public-ip']) {
    const customIp = String(req.headers['x-user-public-ip']).trim()
    if (customIp && !isPrivateIP(customIp)) {
      forwardedIps.push(customIp)
      console.log('[IP Parse] Using x-user-public-ip header:', customIp)
    }
  }

  // Priority 1: x-forwarded-for (most reliable from proxies)
  if (req.headers['x-forwarded-for']) {
    // x-forwarded-for may have a comma list of IPs, get each one
    const list = String(req.headers['x-forwarded-for']).split(',').map((ip) => ip.trim()).filter(Boolean)
    forwardedIps.push(...list)
  }

  // Priority 2: Other proxy headers (cf-connecting-ip, x-real-ip)
  const extraHeaders = ['cf-connecting-ip', 'x-real-ip', 'x-client-ip']
  for (const header of extraHeaders) {
    if (req.headers[header]) {
      forwardedIps.push(String(req.headers[header]).trim())
    }
  }

  // Priority 3: Socket/connection remoteAddress
  if (req.socket?.remoteAddress) {
    forwardedIps.push(String(req.socket.remoteAddress).trim())
  }

  if (req.connection?.remoteAddress) {
    forwardedIps.push(String(req.connection.remoteAddress).trim())
  }

  // Priority 4: req.ip (set by Express)
  if (req.ip) {
    forwardedIps.push(String(req.ip).trim())
  }

  // Normalize all IPs
  const normalizedIps = forwardedIps.map(normalizeIpRaw).filter(Boolean)
  
  // Remove duplicates while preserving order
  return [...new Set(normalizedIps)]
}

const getClientIP = (req) => {
  const ips = parseProxyIps(req)
  return ips.length ? ips[0] : ''
}

// Alias for legacy auto-add API use
const getHeaderIP = getClientIP;

const authenticateToken = async (req, res, next) => {
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
// DYNAMIC IP HANDLING
// =======================

/**
 * Handle dynamic IP changes - auto-add new IPs when user authenticates with valid token
 * @param {Object} user - User document from DB
 * @param {string} requestIp - The current request IP  
 * @returns {Object} { shouldAllow: boolean, ipWasAdded: boolean, reason: string }
 */
const handleDynamicIpChange = async (user, requestIp) => {
  if (!user || !requestIp) {
    return { shouldAllow: false, ipWasAdded: false, reason: 'Missing user or IP' }
  }

  try {
    const normalizedNewIp = normalizeIpRaw(requestIp)
    
    // Don't allow localhost IPs
    if (isPrivateIP(normalizedNewIp)) {
      return { shouldAllow: false, ipWasAdded: false, reason: 'Private IP not allowed' }
    }

    // Check if IP already exists in authorized list
    const ipExists = (user.authorizedIps || []).some(item => normalizeIpRaw(item.ip) === normalizedNewIp)
    
    if (ipExists) {
      return { shouldAllow: true, ipWasAdded: false, reason: 'IP already authorized' }
    }

    // Check if auto-add is enabled
    const ipConfig = user.ipAutoUpdateConfig || {}
    if (!ipConfig.autoAddNewIPs) {
      return { shouldAllow: false, ipWasAdded: false, reason: 'Auto-add disabled by user' }
    }

    // Check if we've hit the limit for auto-added IPs
    const autoAddedCount = (user.authorizedIps || []).filter(item => item.autoAdded).length
    if (autoAddedCount >= (ipConfig.maxAutoAddedIPs || 3)) {
      return { shouldAllow: false, ipWasAdded: false, reason: `Auto-add limit reached (${autoAddedCount}/${ipConfig.maxAutoAddedIPs})` }
    }

    // AUTO-ADD THE NEW IP
    console.log(`[Dynamic IP] Auto-adding new IP ${normalizedNewIp} for user ${user.email}`)
    
    // Add to authorized IPs
    user.authorizedIps.push({
      ip: normalizedNewIp,
      addedBy: 'system-auto-detect',
      addedAt: new Date(),
      autoAdded: true,
      status: 'approved'
    })

    // Record in IP history
    user.ipHistory = user.ipHistory || []
    user.ipHistory.push({
      oldIp: null,
      newIp: normalizedNewIp,
      changeType: 'auto_added',
      changedBy: 'system-auto-detect',
      reason: 'Dynamic IP change detected during authentication',
      changedAt: new Date()
    })

    // Update last auto-add timestamp
    if (!user.ipAutoUpdateConfig) {
      user.ipAutoUpdateConfig = {}
    }
    user.ipAutoUpdateConfig.lastAutoAddedAt = new Date()

    // Save changes
    await user.save()

    console.log(`[Dynamic IP] ✅ Auto-added IP ${normalizedNewIp} and saved to database`)
    
    return { shouldAllow: true, ipWasAdded: true, reason: 'IP auto-added and approved' }
  } catch (error) {
    console.error('[Dynamic IP] Error handling dynamic IP change:', error)
    return { shouldAllow: false, ipWasAdded: false, reason: `Error: ${error.message}` }
  }
}

// =======================
// ROLE GUARDS
// =======================

const requireUser = (req, res, next) => {
  if (!req.user) {
    return res.status(403).json({ message: 'User access required' })
  }
  next()
}

const requireAuthorizedIp = async (req, res, next) => {
  if (req.globalAdmin) {
    console.log("[IP Validation] ✅ BYPASSED for global admin")
    return next()
  }

  if (!req.user) {
    return res.status(403).json({ message: 'User access required' })
  }

  const requestIPs = parseProxyIps(req)
  const allowedIPs = (req.user.authorizedIps || []).map((item) => normalizeIpRaw(item.ip))

  // ❌ REMOVED: No development bypass - strict IP validation for all environments
  // All IPs (including localhost) must be manually authorized by global admin

  console.log("[IP Validation] User:", req.user.email)
  console.log("[IP Validation] Request Headers:", {
    'x-forwarded-for': req.headers['x-forwarded-for'],
    'x-real-ip': req.headers['x-real-ip'],
    'cf-connecting-ip': req.headers['cf-connecting-ip'],
    'socket.remoteAddress': req.socket?.remoteAddress,
    'req.ip': req.ip
  })
  console.log("[IP Validation] Parsed Request IPs:", requestIPs)
  console.log("[IP Validation] Allowed IPs:", allowedIPs)

  if (requestIPs.length === 0) {
    console.log("[IP Validation] ❌ DENIED: No IPs detected from any source")
    return res.status(403).json({ 
      message: 'Access Denied – Unauthorized IP', 
      error: 'Could not extract request IPs' 
    })
  }

  if (allowedIPs.length === 0) {
    console.log("[IP Validation] ❌ DENIED: User has no authorized IPs configured. Request from IP: ${requestIPs[0]}")
    return res.status(403).json({ 
      message: 'Access Denied – Unauthorized IP', 
      error: 'No authorized IPs configured for this user. Contact admin to configure your public IP.'
    })
  }

  // Extract the request IP - prefer public IPs, fallback to first detected
  const publicIp = requestIPs.find((ip) => !isPrivateIP(ip))
  const requestIp = publicIp || requestIPs[0]

  // ❌ STRICT: NEVER allow private/localhost IPs to send
  if (isPrivateIP(requestIp)) {
    console.log(`[IP Validation] ❌ DENIED: Private/local IP ${requestIp} detected. Public IP required. Hint: Your detected local IP is ${requestIp}. Use your actual public IP configured in Global Admin.`)
    return res.status(403).json({
      message: 'Access Denied – Private IP Not Allowed',
      detectedIp: requestIp,
      isPrivate: true,
      allowedIps: allowedIPs,
      reason: 'Private/local IP (127.0.0.1 or 192.168.x.x) cannot send. Your actual public IP must be registered with Global Admin first.'
    })
  }

  // ✅ Public IP: check strict match against authorized list
  const isAuthorized = allowedIPs.includes(requestIp)

  if (!isAuthorized) {
    console.log(`[IP Validation] ❌ DENIED: Public IP ${requestIp} not in authorized list ${JSON.stringify(allowedIPs)}`)
    return res.status(403).json({
      message: 'Access Denied – Unauthorized IP',
      detectedIp: requestIp,
      authorizedIps: allowedIPs,
      reason: `Current IP ${requestIp} not approved. Request Global Admin to authorize this IP.`
    })
  }

  // ✅ SUCCESS: Public IP matches authorized list
  console.log(`[IP Validation] ✅ ALLOWED: Public IP ${requestIp} is authorized`)
  next()
}

const requireGlobalAdmin = (req, res, next) => {
  if (!req.globalAdmin) {
    return res.status(403).json({ message: 'Global admin access required' })
  }
  next()
}

// Modified: allow all authenticated users (not just user-admins)
const requireUserAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(403).json({ message: 'User access required' })
  }
  next();
}

const requireNotepadPasswordVerified = (req, res, next) => {
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
const requirePremiumAccess = async (req, res, next) => {
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

module.exports = {
  authenticateToken,
  requireUser,
  requireAuthorizedIp,
  requireGlobalAdmin,
  requireUserAdmin,
  requireNotepadPasswordVerified,
  requirePremiumAccess,
  getClientIP,
  getHeaderIP,
  parseProxyIps,
  normalizeIpRaw,
  isPrivateIP,
  handleDynamicIpChange
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