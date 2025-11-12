// ============================================
// FILE: src/controllers/upload.controller.ts
// Upload endpoints
// ============================================
import { Request, Response, NextFunction } from "express";
import { UploadService } from "../services/upload.service";
import { body, validationResult } from "express-validator";
import { AuthRequest } from "../middleware/auth";

export class UploadController {
  private uploadService: UploadService;

  constructor() {
    this.uploadService = new UploadService();
  }

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

      const presignedData = await this.uploadService.getPresignedUploadUrl(
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

      // Verify file exists in S3
      const exists = await this.uploadService.verifyFileExists(fileKey);

      if (!exists) {
        return res.status(404).json({
          success: false,
          error: {
            code: "FILE_NOT_FOUND",
            message: "Uploaded file not found",
          },
        });
      }

      const fileUrl = this.uploadService.getFileUrl(fileKey);

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
  // VALIDATION RULES
  // ==========================================
  static presignedUrlValidation = [
    body("fileType").isIn(["target", "content"]),
    body("mimeType").notEmpty(),
    body("fileSize").isInt({ min: 1 }),
  ];
}
