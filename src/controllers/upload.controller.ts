// ============================================
// FILE: src/controllers/upload.controller.ts
// Upload endpoints for local storage
// ============================================
import { Request, Response, NextFunction } from "express";
import uploadService from "../services/upload.service"; // Import singleton instance
import { body, validationResult } from "express-validator";
import { AuthRequest } from "../middleware/auth";
import multer from "multer";
import path from "path";

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
  },
});

export class UploadController {
  // Remove private uploadService property and constructor
  // Use the singleton instance directly

  // ==========================================
  // POST /api/v1/upload/presigned-url
  // ==========================================
  getPresignedUrl = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid input",
            details: errors.array(),
          },
        });
      }

      const { fileType, mimeType, fileSize } = req.body;
      const userId = req.user!.id;

      // Use singleton instance
      const presignedData = await uploadService.getPresignedUploadUrl(
        userId,
        fileType,
        mimeType,
        fileSize
      );

      res.json({
        success: true,
        data: presignedData,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // POST /api/v1/upload/file
  // Upload file directly to storage
  // ==========================================
  uploadFile = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { fileKey } = req.query;

      if (!fileKey || typeof fileKey !== "string") {
        return res.status(400).json({
          success: false,
          error: {
            code: "MISSING_FILE_KEY",
            message: "File key is required",
          },
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: {
            code: "NO_FILE",
            message: "No file uploaded",
          },
        });
      }

      // Save file (will use cloud or local based on config)
      await uploadService.saveFile(fileKey, req.file.buffer);

      // If it's a target image, validate dimensions
      if (fileKey.includes("/target/")) {
        try {
          const dimensions = await uploadService.validateImageDimensions(
            req.file.buffer
          );
          console.log(
            `✅ Image dimensions: ${dimensions.width}x${dimensions.height}`
          );
        } catch (error) {
          // Delete the file if validation fails
          await uploadService.deleteFile(fileKey);
          throw error;
        }
      }

      const fileUrl = uploadService.getFileUrl(fileKey);

      res.json({
        success: true,
        data: {
          fileKey,
          fileUrl,
          uploaded: true,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // POST /api/v1/upload/confirm
  // ==========================================
  confirmUpload = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { fileKey } = req.body;

      if (!fileKey) {
        return res.status(400).json({
          success: false,
          error: {
            code: "MISSING_FILE_KEY",
            message: "File key is required",
          },
        });
      }

      // Verify file exists in storage
      const exists = await uploadService.verifyFileExists(fileKey);

      if (!exists) {
        return res.status(404).json({
          success: false,
          error: {
            code: "FILE_NOT_FOUND",
            message: "Uploaded file not found",
          },
        });
      }

      const fileUrl = uploadService.getFileUrl(fileKey);

      res.json({
        success: true,
        data: {
          fileKey,
          fileUrl,
          verified: true,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // GET /uploads/:path*
  // Serve uploaded files (only for local storage)
  // ==========================================
  serveFile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const fileKey = req.params.path;

      if (!fileKey) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_PATH",
            message: "Invalid file path",
          },
        });
      }

      const exists = await uploadService.verifyFileExists(fileKey);

      if (!exists) {
        return res.status(404).json({
          success: false,
          error: {
            code: "FILE_NOT_FOUND",
            message: "File not found",
          },
        });
      }

      // For cloud storage, redirect to the URL
      const fileUrl = uploadService.getFileUrl(fileKey);
      if (fileUrl.startsWith("http")) {
        return res.redirect(fileUrl);
      }

      // For local storage, serve the file
      const filePath = uploadService.getFilePath(fileKey);

      // Set appropriate content type
      const ext = path.extname(fileKey).toLowerCase();
      const contentTypes: { [key: string]: string } = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".glb": "model/gltf-binary",
        ".gltf": "application/json",
      };

      const contentType = contentTypes[ext] || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=31536000");

      // Send file
      res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // MULTER MIDDLEWARE
  // ==========================================
  static uploadMiddleware = upload.single("file");

  // ==========================================
  // VALIDATION RULES
  // ==========================================
  static presignedUrlValidation = [
    body("fileType").isIn(["target", "content"]),
    body("mimeType").notEmpty(),
    body("fileSize").isInt({ min: 1 }),
  ];
}
