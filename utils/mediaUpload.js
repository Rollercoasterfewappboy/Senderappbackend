import multer from 'multer'
import { v2 as cloudinary } from 'cloudinary'
import { CloudinaryStorage } from 'multer-storage-cloudinary'

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})

// =====================
// SUPPORTED MEDIA TYPES
// =====================
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const ALLOWED_PDF_TYPES = ['application/pdf']
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_PDF_TYPES]

const FILE_SIZE_LIMITS = {
  image: 10 * 1024 * 1024,      // 10 MB for images
  video: 100 * 1024 * 1024,     // 100 MB for videos
  pdf: 25 * 1024 * 1024,        // 25 MB for PDFs
  total: 300 * 1024 * 1024      // 300 MB total per note
}

// =====================
// MULTER MEMORY STORAGE
// =====================
// Store files in memory before uploading to Cloudinary
const memoryStorage = multer.memoryStorage()

// =====================
// FILE FILTER
// =====================
const fileFilter = (req, file, cb) => {
  // Check if file type is allowed
  if (!ALLOWED_TYPES.includes(file.mimetype)) {
    cb(new Error(`File type not allowed. Supported: JPG, PNG, WEBP, MP4, MOV, WEBM, PDF`))
    return
  }

  // Check file size based on type
  const isImage = ALLOWED_IMAGE_TYPES.includes(file.mimetype)
  const isVideo = ALLOWED_VIDEO_TYPES.includes(file.mimetype)
  const isPDF = ALLOWED_PDF_TYPES.includes(file.mimetype)
  
  let maxSize = FILE_SIZE_LIMITS.total
  if (isImage) maxSize = FILE_SIZE_LIMITS.image
  else if (isVideo) maxSize = FILE_SIZE_LIMITS.video
  else if (isPDF) maxSize = FILE_SIZE_LIMITS.pdf

  if (file.size > maxSize) {
    const maxSizeMB = maxSize / (1024 * 1024)
    cb(new Error(`File too large. Max size: ${maxSizeMB}MB`))
    return
  }

  cb(null, true)
}

// =====================
// MULTER UPLOAD MIDDLEWARE
// =====================
export const uploadMulter = multer({
  storage: memoryStorage,
  fileFilter,
  limits: {
    fileSize: FILE_SIZE_LIMITS.video, // Max single file size
    files: 5 // Max 5 files per request
  }
})

// =====================
// UPLOAD IMAGES TO CLOUDINARY
// =====================
// Uploads images from memory to Cloudinary
// Returns array of uploaded image objects
export const uploadImagesToCloudinary = async (files) => {
  if (!files || files.length === 0) return []

  const imageFiles = files.filter(f => ALLOWED_IMAGE_TYPES.includes(f.mimetype))
  if (imageFiles.length === 0) return []

  try {
    const uploadPromises = imageFiles.map(file =>
      new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'marketbook/notes/images',
            resource_type: 'image',
            quality: 'auto', // Auto quality optimization
            fetch_format: 'auto', // Auto format optimization
            flags: 'progressive' // Progressive encoding for JPG
          },
          (error, result) => {
            if (error) reject(error)
            else resolve({
              publicId: result.public_id,
              url: result.secure_url,
              format: result.format,
              width: result.width,
              height: result.height,
              fileSize: result.bytes,
              type: 'image'
            })
          }
        )
        uploadStream.end(file.buffer)
      })
    )

    return await Promise.all(uploadPromises)
  } catch (error) {
    console.error('Error uploading images to Cloudinary:', error)
    throw new Error(`Failed to upload images: ${error.message}`)
  }
}

// =====================
// UPLOAD VIDEO TO CLOUDINARY
// =====================
// Uploads a single video from memory to Cloudinary
// Returns uploaded video object
export const uploadVideoToCloudinary = async (file) => {
  if (!file || !ALLOWED_VIDEO_TYPES.includes(file.mimetype)) {
    return null
  }

  try {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'marketbook/notes/videos',
          resource_type: 'video',
          eager: [
            { width: 300, height: 300, crop: 'fill', format: 'jpg' } // Thumbnail
          ]
        },
        (error, result) => {
          if (error) reject(error)
          else resolve({
            publicId: result.public_id,
            url: result.secure_url,
            format: result.format,
            duration: result.duration,
            fileSize: result.bytes,
            thumbnail: result.eager[0].secure_url,
            type: 'video'
          })
        }
      )
      uploadStream.end(file.buffer)
    })
  } catch (error) {
    console.error('Error uploading video to Cloudinary:', error)
    throw new Error(`Failed to upload video: ${error.message}`)
  }
}

// =====================
// UPLOAD VIDEOS TO CLOUDINARY
// =====================
// Uploads multiple videos from memory to Cloudinary
// Returns array of uploaded video objects
export const uploadVideosToCloudinary = async (files) => {
  if (!files || files.length === 0) return []

  const videoFiles = files.filter(f => ALLOWED_VIDEO_TYPES.includes(f.mimetype))
  if (videoFiles.length === 0) return []

  try {
    const uploadPromises = videoFiles.map(file =>
      new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'marketbook/notes/videos',
            resource_type: 'video',
            eager: [
              { width: 300, height: 300, crop: 'fill', format: 'jpg' } // Thumbnail
            ]
          },
          (error, result) => {
            if (error) reject(error)
            else resolve({
              publicId: result.public_id,
              url: result.secure_url,
              format: result.format,
              duration: result.duration,
              fileSize: result.bytes,
              thumbnail: result.eager[0].secure_url,
              type: 'video'
            })
          }
        )
        uploadStream.end(file.buffer)
      })
    )

    return await Promise.all(uploadPromises)
  } catch (error) {
    console.error('Error uploading videos to Cloudinary:', error)
    throw new Error(`Failed to upload videos: ${error.message}`)
  }
}

// =====================
// UPLOAD PDFs TO CLOUDINARY
// =====================
// Uploads PDF files from memory to Cloudinary
// Returns array of uploaded PDF objects
export const uploadPDFsToCloudinary = async (files) => {
  if (!files || files.length === 0) return []

  const pdfFiles = files.filter(f => ALLOWED_PDF_TYPES.includes(f.mimetype))
  if (pdfFiles.length === 0) return []

  try {
    const uploadPromises = pdfFiles.map(file =>
      new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'marketbook/notes/attachments',
            resource_type: 'raw'
          },
          (error, result) => {
            if (error) reject(error)
            else resolve({
              publicId: result.public_id,
              url: result.secure_url,
              filename: file.originalname,
              fileSize: result.bytes,
              type: 'pdf'
            })
          }
        )
        uploadStream.end(file.buffer)
      })
    )

    return await Promise.all(uploadPromises)
  } catch (error) {
    console.error('Error uploading PDFs to Cloudinary:', error)
    throw new Error(`Failed to upload PDFs: ${error.message}`)
  }
}

// =====================
// DELETE MEDIA FROM CLOUDINARY
// =====================
// Deletes a single media file from Cloudinary
export const deleteMediaFromCloudinary = async (publicId) => {
  if (!publicId) return

  try {
    await cloudinary.uploader.destroy(publicId, {
      invalidate: true,
      resource_type: 'auto' // Auto-detect if image or video
    })
  } catch (error) {
    console.error('Error deleting media from Cloudinary:', error)
    // Don't throw - continue if deletion fails
  }
}

// =====================
// DELETE MULTIPLE MEDIA FILES
// =====================
// Deletes multiple media files from Cloudinary
export const deleteMediaArrayFromCloudinary = async (mediaArray) => {
  if (!mediaArray || mediaArray.length === 0) return

  const deletePromises = mediaArray.map(media =>
    deleteMediaFromCloudinary(media.publicId)
  )

  try {
    await Promise.all(deletePromises)
  } catch (error) {
    console.error('Error deleting multiple media files:', error)
    // Don't throw - continue if deletion fails
  }
}

// =====================
// VALIDATE MEDIA LIMITS
// =====================
// Validates media upload limits (images + optional video)
// Returns { valid: boolean, error?: string }
export const validateMediaLimits = (currentMedia, newImages, newVideo) => {
  let currentVideoSize = 0
  if (currentMedia?.video) {
    if (Array.isArray(currentMedia.video)) {
      currentVideoSize = (currentMedia.video).reduce((sum, vid) => sum + (vid.fileSize || 0), 0)
    } else {
      currentVideoSize = currentMedia.video.fileSize || 0
    }
  }

  const currentSize = (currentMedia?.images || []).reduce((sum, img) => sum + (img.fileSize || 0), 0) + currentVideoSize

  const newImageSize = (newImages || []).reduce((sum, img) => sum + (img.size || 0), 0)
  const newVideoSize = newVideo ? newVideo.size || 0 : 0
  const totalNewSize = newImageSize + newVideoSize

  // Check total size limit
  if (currentSize + totalNewSize > FILE_SIZE_LIMITS.total) {
    return {
      valid: false,
      error: `Total media size exceeds ${FILE_SIZE_LIMITS.total / (1024 * 1024)}MB limit`
    }
  }

  // No image count limit
  // No video count limit
  // Users can upload unlimited images and videos per note

  return { valid: true }
}

// =====================
// EXTRACT MEDIA FROM REQUEST
// =====================
// Extracts images, videos, and PDFs from multer request
// Returns { images: [], video: [], attachments: [] }
export const extractMediaFromRequest = (req) => {
  const result = {
    images: [],
    video: [],
    attachments: []
  }

  if (!req.files || req.files.length === 0) {
    return result
  }

  for (const file of req.files) {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      result.images.push(file)
    } else if (ALLOWED_VIDEO_TYPES.includes(file.mimetype)) {
      result.video.push(file)
    } else if (ALLOWED_PDF_TYPES.includes(file.mimetype)) {
      result.attachments.push(file)
    }
  }

  return result
}

export default {
  uploadMulter,
  uploadImagesToCloudinary,
  uploadVideoToCloudinary,
  uploadVideosToCloudinary,
  uploadPDFsToCloudinary,
  deleteMediaFromCloudinary,
  deleteMediaArrayFromCloudinary,
  validateMediaLimits,
  extractMediaFromRequest,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  ALLOWED_PDF_TYPES,
  FILE_SIZE_LIMITS
}
