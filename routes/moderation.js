import express from 'express'
import ContentReport from '../models/ContentReport.js'
import ModerationAction from '../models/ModerationAction.js'
import Website from '../models/Website.js'
import User from '../models/User.js'
import { verifyToken } from '../middleware/auth.js'
import { generateReportId } from '../utils/websiteUtils.js'

const router = express.Router()

/**
 * POST /moderation/report
 * Create a content report
 */
router.post('/report', async (req, res) => {
  try {
    const { websiteId, contentType, contentId, violationType, violationDescription, reporterEmail, reporterName } = req.body

    if (!websiteId || !contentType || !violationType || !violationDescription) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const report = new ContentReport({
      reportId: generateReportId(),
      websiteId,
      contentType,
      contentId,
      violationType,
      description: violationDescription,
      reporterEmail,
      reporterName,
      status: 'new',
      priority: violationType === 'hate-speech' || violationType === 'explicit-content' ? 'high' : 'medium'
    })

    await report.save()

    res.status(201).json({
      success: true,
      reportId: report.reportId,
      message: 'Report submitted successfully'
    })
  } catch (error) {
    console.error('Error creating report:', error)
    res.status(500).json({ error: 'Failed to create report' })
  }
})

/**
 * GET /moderation/reports/:websiteId
 * Get reports for a website (owner only)
 */
router.get('/reports/:websiteId', verifyToken, async (req, res) => {
  try {
    const { websiteId } = req.params
    const { page = 1, limit = 20, status } = req.query

    // Verify ownership
    const website = await Website.findById(websiteId)
    if (!website || website.userId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' })
    }

    const query = { websiteId }
    if (status) query.status = status

    const reports = await ContentReport.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)

    const total = await ContentReport.countDocuments(query)

    res.json({
      success: true,
      reports,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Error fetching reports:', error)
    res.status(500).json({ error: 'Failed to fetch reports' })
  }
})

/**
 * PUT /moderation/reports/:reportId
 * Update report status and take action
 */
router.put('/reports/:reportId', verifyToken, async (req, res) => {
  try {
    const { reportId } = req.params
    const { status, actionTaken, actionDescription, moderatorNotes } = req.body

    const report = await ContentReport.findById(reportId)
    if (!report) {
      return res.status(404).json({ error: 'Report not found' })
    }

    // Verify ownership of website
    const website = await Website.findById(report.websiteId)
    if (!website || website.userId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' })
    }

    // Update report
    if (status) report.status = status
    if (moderatorNotes) report.moderatorNotes = moderatorNotes
    if (actionTaken) report.actionTaken = actionTaken
    if (actionDescription) report.actionDescription = actionDescription

    if (status === 'resolved') {
      report.reviewedAt = new Date()
      report.resolutionDate = new Date()
    }

    await report.save()

    res.json({
      success: true,
      report,
      message: 'Report updated successfully'
    })
  } catch (error) {
    console.error('Error updating report:', error)
    res.status(500).json({ error: 'Failed to update report' })
  }
})

/**
 * GET /moderation/admin/reports
 * Get all reports for global admin (admin only)
 */
router.get('/admin/reports', verifyToken, async (req, res) => {
  try {
    // Check if user is global admin
    const user = await User.findById(req.user.id)
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }

    const { page = 1, limit = 50, status, priority, violationType } = req.query

    const query = {}
    if (status) query.status = status
    if (priority) query.priority = priority
    if (violationType) query.violationType = violationType

    const reports = await ContentReport.find(query)
      .populate('websiteId', 'name category userId')
      .sort({ priority: -1, createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)

    const total = await ContentReport.countDocuments(query)

    res.json({
      success: true,
      reports,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Error fetching admin reports:', error)
    res.status(500).json({ error: 'Failed to fetch reports' })
  }
})

/**
 * POST /moderation/admin/action
 * Execute moderation action (global admin only)
 */
router.post('/admin/action', verifyToken, async (req, res) => {
  try {
    // Check if user is global admin
    const user = await User.findById(req.user.id)
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }

    const { websiteId, contentReportId, actionType, severity, reason, description, expirationDays } = req.body

    if (!actionType || !reason) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const action = new ModerationAction({
      websiteId,
      contentReportId,
      actionType,
      severity,
      reason,
      description,
      moderatorId: req.user.id,
      status: 'pending'
    })

    // Set expiration date for temporary actions
    if (expirationDays && (actionType.includes('suspend') || actionType.includes('warn'))) {
      action.expirationDate = new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000)
    }

    await action.save()

    // Execute action
    if (websiteId) {
      const website = await Website.findById(websiteId)
      if (website) {
        if (actionType.includes('suspend') || actionType.includes('ban')) {
          website.status = 'suspended'
        } else if (actionType === 'payment-disabled') {
          website.paymentSettings = website.paymentSettings || {}
          website.paymentSettings.acceptPayments = false
        }
        await website.save()
      }
    }

    // Update related report if exists
    if (contentReportId) {
      await ContentReport.findByIdAndUpdate(
        contentReportId,
        {
          status: 'resolved',
          actionTaken: actionType,
          reviewedAt: new Date()
        }
      )
    }

    action.status = 'executed'
    action.effectiveDate = new Date()
    await action.save()

    res.status(201).json({
      success: true,
      actionId: action.actionId,
      message: 'Moderation action executed successfully'
    })
  } catch (error) {
    console.error('Error executing moderation action:', error)
    res.status(500).json({ error: 'Failed to execute action' })
  }
})

/**
 * GET /moderation/admin/actions
 * Get all moderation actions (global admin only)
 */
router.get('/admin/actions', verifyToken, async (req, res) => {
  try {
    // Check if user is global admin
    const user = await User.findById(req.user.id)
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }

    const { page = 1, limit = 50, status, actionType } = req.query

    const query = {}
    if (status) query.status = status
    if (actionType) query.actionType = actionType

    const actions = await ModerationAction.find(query)
      .populate('websiteId', 'name category')
      .populate('moderatorId', 'email firstName lastName')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)

    const total = await ModerationAction.countDocuments(query)

    res.json({
      success: true,
      actions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Error fetching moderation actions:', error)
    res.status(500).json({ error: 'Failed to fetch actions' })
  }
})

/**
 * POST /moderation/admin/action/:actionId/appeal
 * Submit appeal for moderation action
 */
router.post('/action/:actionId/appeal', verifyToken, async (req, res) => {
  try {
    const { actionId } = req.params
    const { appealReason } = req.body

    if (!appealReason) {
      return res.status(400).json({ error: 'Appeal reason required' })
    }

    const action = await ModerationAction.findById(actionId)
    if (!action) {
      return res.status(404).json({ error: 'Action not found' })
    }

    if (!action.userApealAllowed) {
      return res.status(400).json({ error: 'Appeal not allowed for this action' })
    }

    action.appeal.appealed = true
    action.appeal.appealDate = new Date()
    action.appeal.appealReason = appealReason
    action.appeal.appealStatus = 'pending'
    action.status = 'appealed'

    await action.save()

    res.json({
      success: true,
      message: 'Appeal submitted successfully'
    })
  } catch (error) {
    console.error('Error submitting appeal:', error)
    res.status(500).json({ error: 'Failed to submit appeal' })
  }
})

/**
 * GET /moderation/admin/dashboard
 * Global admin moderation dashboard
 */
router.get('/admin/dashboard', verifyToken, async (req, res) => {
  try {
    // Check if user is global admin
    const user = await User.findById(req.user.id)
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }

    // Get statistics
    const totalReports = await ContentReport.countDocuments()
    const newReports = await ContentReport.countDocuments({ status: 'new' })
    const reviewingReports = await ContentReport.countDocuments({ status: 'reviewing' })
    const resolvedReports = await ContentReport.countDocuments({ status: 'resolved' })

    const highPriorityReports = await ContentReport.countDocuments({ priority: 'high' })

    const totalActions = await ModerationAction.countDocuments()
    const suspendedAccounts = await ModerationAction.countDocuments({
      actionType: 'account-suspended',
      status: 'executed'
    })
    const bannedAccounts = await ModerationAction.countDocuments({
      actionType: 'account-banned',
      status: 'executed'
    })
    const pendingAppeals = await ModerationAction.countDocuments({
      'appeal.appealStatus': 'pending'
    })

    // Get recent reports
    const recentReports = await ContentReport.find()
      .populate('websiteId', 'name category')
      .sort({ createdAt: -1 })
      .limit(10)

    // Get recent actions
    const recentActions = await ModerationAction.find()
      .populate('websiteId', 'name category')
      .populate('moderatorId', 'email firstName lastName')
      .sort({ createdAt: -1 })
      .limit(10)

    // Get violation types breakdown
    const violationStats = await ContentReport.aggregate([
      {
        $group: {
          _id: '$violationType',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ])

    res.json({
      success: true,
      stats: {
        reports: {
          total: totalReports,
          new: newReports,
          reviewing: reviewingReports,
          resolved: resolvedReports,
          highPriority: highPriorityReports
        },
        actions: {
          total: totalActions,
          suspended: suspendedAccounts,
          banned: bannedAccounts,
          pendingAppeals
        }
      },
      recentReports,
      recentActions,
      violationStats
    })
  } catch (error) {
    console.error('Error fetching dashboard:', error)
    res.status(500).json({ error: 'Failed to fetch dashboard' })
  }
})

export default router










// import express from 'express'
// import ContentReport from '../models/ContentReport.js'
// import ModerationAction from '../models/ModerationAction.js'
// import Website from '../models/Website.js'
// import User from '../models/User.js'
// import { verifyToken } from '../middleware/auth.js'

// const router = express.Router()

// /**
//  * POST /moderation/report
//  * Create a content report
//  */
// router.post('/report', async (req, res) => {
//   try {
//     const { websiteId, contentType, contentId, violationType, violationDescription, reporterEmail, reporterName } = req.body

//     if (!websiteId || !contentType || !violationType || !violationDescription) {
//       return res.status(400).json({ error: 'Missing required fields' })
//     }

//     const report = new ContentReport({
//       websiteId,
//       contentType,
//       contentId,
//       violationType,
//       description: violationDescription,
//       reporterEmail,
//       reporterName,
//       status: 'new',
//       priority: violationType === 'hate-speech' || violationType === 'explicit-content' ? 'high' : 'medium'
//     })

//     await report.save()

//     res.status(201).json({
//       success: true,
//       reportId: report.reportId,
//       message: 'Report submitted successfully'
//     })
//   } catch (error) {
//     console.error('Error creating report:', error)
//     res.status(500).json({ error: 'Failed to create report' })
//   }
// })

// /**
//  * GET /moderation/reports/:websiteId
//  * Get reports for a website (owner only)
//  */
// router.get('/reports/:websiteId', verifyToken, async (req, res) => {
//   try {
//     const { websiteId } = req.params
//     const { page = 1, limit = 20, status } = req.query

//     // Verify ownership
//     const website = await Website.findById(websiteId)
//     if (!website || website.userId.toString() !== req.user.id) {
//       return res.status(403).json({ error: 'Unauthorized' })
//     }

//     const query = { websiteId }
//     if (status) query.status = status

//     const reports = await ContentReport.find(query)
//       .sort({ createdAt: -1 })
//       .limit(limit * 1)
//       .skip((page - 1) * limit)

//     const total = await ContentReport.countDocuments(query)

//     res.json({
//       success: true,
//       reports,
//       pagination: {
//         total,
//         page: parseInt(page),
//         limit: parseInt(limit),
//         pages: Math.ceil(total / limit)
//       }
//     })
//   } catch (error) {
//     console.error('Error fetching reports:', error)
//     res.status(500).json({ error: 'Failed to fetch reports' })
//   }
// })

// /**
//  * PUT /moderation/reports/:reportId
//  * Update report status and take action
//  */
// router.put('/reports/:reportId', verifyToken, async (req, res) => {
//   try {
//     const { reportId } = req.params
//     const { status, actionTaken, actionDescription, moderatorNotes } = req.body

//     const report = await ContentReport.findById(reportId)
//     if (!report) {
//       return res.status(404).json({ error: 'Report not found' })
//     }

//     // Verify ownership of website
//     const website = await Website.findById(report.websiteId)
//     if (!website || website.userId.toString() !== req.user.id) {
//       return res.status(403).json({ error: 'Unauthorized' })
//     }

//     // Update report
//     if (status) report.status = status
//     if (moderatorNotes) report.moderatorNotes = moderatorNotes
//     if (actionTaken) report.actionTaken = actionTaken
//     if (actionDescription) report.actionDescription = actionDescription

//     if (status === 'resolved') {
//       report.reviewedAt = new Date()
//       report.resolutionDate = new Date()
//     }

//     await report.save()

//     res.json({
//       success: true,
//       report,
//       message: 'Report updated successfully'
//     })
//   } catch (error) {
//     console.error('Error updating report:', error)
//     res.status(500).json({ error: 'Failed to update report' })
//   }
// })

// /**
//  * GET /moderation/admin/reports
//  * Get all reports for global admin (admin only)
//  */
// router.get('/admin/reports', verifyToken, async (req, res) => {
//   try {
//     // Check if user is global admin
//     const user = await User.findById(req.user.id)
//     if (!user || user.role !== 'admin') {
//       return res.status(403).json({ error: 'Admin access required' })
//     }

//     const { page = 1, limit = 50, status, priority, violationType } = req.query

//     const query = {}
//     if (status) query.status = status
//     if (priority) query.priority = priority
//     if (violationType) query.violationType = violationType

//     const reports = await ContentReport.find(query)
//       .populate('websiteId', 'name category userId')
//       .sort({ priority: -1, createdAt: -1 })
//       .limit(limit * 1)
//       .skip((page - 1) * limit)

//     const total = await ContentReport.countDocuments(query)

//     res.json({
//       success: true,
//       reports,
//       pagination: {
//         total,
//         page: parseInt(page),
//         limit: parseInt(limit),
//         pages: Math.ceil(total / limit)
//       }
//     })
//   } catch (error) {
//     console.error('Error fetching admin reports:', error)
//     res.status(500).json({ error: 'Failed to fetch reports' })
//   }
// })

// /**
//  * POST /moderation/admin/action
//  * Execute moderation action (global admin only)
//  */
// router.post('/admin/action', verifyToken, async (req, res) => {
//   try {
//     // Check if user is global admin
//     const user = await User.findById(req.user.id)
//     if (!user || user.role !== 'admin') {
//       return res.status(403).json({ error: 'Admin access required' })
//     }

//     const { websiteId, contentReportId, actionType, severity, reason, description, expirationDays } = req.body

//     if (!actionType || !reason) {
//       return res.status(400).json({ error: 'Missing required fields' })
//     }

//     const action = new ModerationAction({
//       websiteId,
//       contentReportId,
//       actionType,
//       severity,
//       reason,
//       description,
//       moderatorId: req.user.id,
//       status: 'pending'
//     })

//     // Set expiration date for temporary actions
//     if (expirationDays && (actionType.includes('suspend') || actionType.includes('warn'))) {
//       action.expirationDate = new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000)
//     }

//     await action.save()

//     // Execute action
//     if (websiteId) {
//       const website = await Website.findById(websiteId)
//       if (website) {
//         if (actionType.includes('suspend') || actionType.includes('ban')) {
//           website.status = 'suspended'
//         } else if (actionType === 'payment-disabled') {
//           website.paymentSettings = website.paymentSettings || {}
//           website.paymentSettings.acceptPayments = false
//         }
//         await website.save()
//       }
//     }

//     // Update related report if exists
//     if (contentReportId) {
//       await ContentReport.findByIdAndUpdate(
//         contentReportId,
//         {
//           status: 'resolved',
//           actionTaken: actionType,
//           reviewedAt: new Date()
//         }
//       )
//     }

//     action.status = 'executed'
//     action.effectiveDate = new Date()
//     await action.save()

//     res.status(201).json({
//       success: true,
//       actionId: action.actionId,
//       message: 'Moderation action executed successfully'
//     })
//   } catch (error) {
//     console.error('Error executing moderation action:', error)
//     res.status(500).json({ error: 'Failed to execute action' })
//   }
// })

// /**
//  * GET /moderation/admin/actions
//  * Get all moderation actions (global admin only)
//  */
// router.get('/admin/actions', verifyToken, async (req, res) => {
//   try {
//     // Check if user is global admin
//     const user = await User.findById(req.user.id)
//     if (!user || user.role !== 'admin') {
//       return res.status(403).json({ error: 'Admin access required' })
//     }

//     const { page = 1, limit = 50, status, actionType } = req.query

//     const query = {}
//     if (status) query.status = status
//     if (actionType) query.actionType = actionType

//     const actions = await ModerationAction.find(query)
//       .populate('websiteId', 'name category')
//       .populate('moderatorId', 'email firstName lastName')
//       .sort({ createdAt: -1 })
//       .limit(limit * 1)
//       .skip((page - 1) * limit)

//     const total = await ModerationAction.countDocuments(query)

//     res.json({
//       success: true,
//       actions,
//       pagination: {
//         total,
//         page: parseInt(page),
//         limit: parseInt(limit),
//         pages: Math.ceil(total / limit)
//       }
//     })
//   } catch (error) {
//     console.error('Error fetching moderation actions:', error)
//     res.status(500).json({ error: 'Failed to fetch actions' })
//   }
// })

// /**
//  * POST /moderation/admin/action/:actionId/appeal
//  * Submit appeal for moderation action
//  */
// router.post('/action/:actionId/appeal', verifyToken, async (req, res) => {
//   try {
//     const { actionId } = req.params
//     const { appealReason } = req.body

//     if (!appealReason) {
//       return res.status(400).json({ error: 'Appeal reason required' })
//     }

//     const action = await ModerationAction.findById(actionId)
//     if (!action) {
//       return res.status(404).json({ error: 'Action not found' })
//     }

//     if (!action.userApealAllowed) {
//       return res.status(400).json({ error: 'Appeal not allowed for this action' })
//     }

//     action.appeal.appealed = true
//     action.appeal.appealDate = new Date()
//     action.appeal.appealReason = appealReason
//     action.appeal.appealStatus = 'pending'
//     action.status = 'appealed'

//     await action.save()

//     res.json({
//       success: true,
//       message: 'Appeal submitted successfully'
//     })
//   } catch (error) {
//     console.error('Error submitting appeal:', error)
//     res.status(500).json({ error: 'Failed to submit appeal' })
//   }
// })

// /**
//  * GET /moderation/admin/dashboard
//  * Global admin moderation dashboard
//  */
// router.get('/admin/dashboard', verifyToken, async (req, res) => {
//   try {
//     // Check if user is global admin
//     const user = await User.findById(req.user.id)
//     if (!user || user.role !== 'admin') {
//       return res.status(403).json({ error: 'Admin access required' })
//     }

//     // Get statistics
//     const totalReports = await ContentReport.countDocuments()
//     const newReports = await ContentReport.countDocuments({ status: 'new' })
//     const reviewingReports = await ContentReport.countDocuments({ status: 'reviewing' })
//     const resolvedReports = await ContentReport.countDocuments({ status: 'resolved' })

//     const highPriorityReports = await ContentReport.countDocuments({ priority: 'high' })

//     const totalActions = await ModerationAction.countDocuments()
//     const suspendedAccounts = await ModerationAction.countDocuments({
//       actionType: 'account-suspended',
//       status: 'executed'
//     })
//     const bannedAccounts = await ModerationAction.countDocuments({
//       actionType: 'account-banned',
//       status: 'executed'
//     })
//     const pendingAppeals = await ModerationAction.countDocuments({
//       'appeal.appealStatus': 'pending'
//     })

//     // Get recent reports
//     const recentReports = await ContentReport.find()
//       .populate('websiteId', 'name category')
//       .sort({ createdAt: -1 })
//       .limit(10)

//     // Get recent actions
//     const recentActions = await ModerationAction.find()
//       .populate('websiteId', 'name category')
//       .populate('moderatorId', 'email firstName lastName')
//       .sort({ createdAt: -1 })
//       .limit(10)

//     // Get violation types breakdown
//     const violationStats = await ContentReport.aggregate([
//       {
//         $group: {
//           _id: '$violationType',
//           count: { $sum: 1 }
//         }
//       },
//       { $sort: { count: -1 } }
//     ])

//     res.json({
//       success: true,
//       stats: {
//         reports: {
//           total: totalReports,
//           new: newReports,
//           reviewing: reviewingReports,
//           resolved: resolvedReports,
//           highPriority: highPriorityReports
//         },
//         actions: {
//           total: totalActions,
//           suspended: suspendedAccounts,
//           banned: bannedAccounts,
//           pendingAppeals
//         }
//       },
//       recentReports,
//       recentActions,
//       violationStats
//     })
//   } catch (error) {
//     console.error('Error fetching dashboard:', error)
//     res.status(500).json({ error: 'Failed to fetch dashboard' })
//   }
// })

// export default router
