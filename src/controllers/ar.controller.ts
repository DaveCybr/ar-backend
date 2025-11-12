// ============================================
// FILE: src/controllers/ar.controller.ts
// Public AR endpoints (for Flutter app)
// ============================================
import { Request, Response, NextFunction } from "express";
import { ProjectService } from "../services/project.service";
import { AnalyticsService } from "../services/analytics.service";
import { body, validationResult } from "express-validator";

export class ARController {
  private projectService: ProjectService;

  constructor() {
    this.projectService = new ProjectService();
  }

  // ==========================================
  // GET /api/v1/ar/:id
  // Get project by ID (public, no auth)
  // ==========================================
  getProjectForAR = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const project = await this.projectService.getProjectById(id);

      // Return only necessary data for AR app
      res.json({
        success: true,
        data: {
          id: project.id,
          name: project.name,
          targetImage: project.targetImage,
          content: project.content,
          settings: project.settings,
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
  // GET /api/v1/ar/short/:shortCode
  // Get project by short code (QR scan)
  // ==========================================
  getProjectByShortCode = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { shortCode } = req.params;

      const project = await this.projectService.getProjectByShortCode(
        shortCode
      );

      res.json({
        success: true,
        data: {
          id: project.id,
          name: project.name,
          targetImage: project.targetImage,
          content: project.content,
          settings: project.settings,
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
  // POST /api/v1/ar/:id/track
  // Track analytics event
  // ==========================================
  trackEvent = async (req: Request, res: Response, next: NextFunction) => {
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

      const { id } = req.params;

      await AnalyticsService.trackEvent({
        projectId: id,
        ...req.body,
      });

      res.status(202).json({
        success: true,
        data: {
          message: "Event tracked",
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
  // VALIDATION
  // ==========================================
  static trackEventValidation = [
    body("sessionId").notEmpty(),
    body("eventType").isIn([
      "qr_scan",
      "project_load",
      "ar_start",
      "tracking_success",
      "tracking_lost",
      "content_play",
      "content_pause",
      "content_complete",
      "ar_end",
    ]),
    body("deviceId").optional(),
    body("loadDuration").optional().isInt(),
    body("trackingDuration").optional().isInt(),
    body("trackingQualityAvg").optional().isFloat({ min: 0, max: 1 }),
    body("deviceModel").optional(),
    body("osType").optional(),
    body("osVersion").optional(),
    body("appVersion").optional(),
  ];
}
