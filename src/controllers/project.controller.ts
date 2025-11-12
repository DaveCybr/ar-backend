// ============================================
// FILE: src/controllers/project.controller.ts
// Project HTTP handlers
// ============================================
import { Request, Response, NextFunction } from "express";
import { ProjectService } from "../services/project.service";
import { body, query, validationResult } from "express-validator";
import { AuthRequest } from "../middleware/auth";

export class ProjectController {
  private projectService: ProjectService;

  constructor() {
    this.projectService = new ProjectService();
  }

  // ==========================================
  // POST /api/v1/projects
  // ==========================================
  createProject = async (
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

      const userId = req.user!.id;
      const project = await this.projectService.createProject(userId, req.body);

      res.status(201).json({
        success: true,
        data: project,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // GET /api/v1/projects
  // ==========================================
  listProjects = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.user!.id;

      const filters = {
        status: req.query.status as string,
        contentType: req.query.contentType as string,
        search: req.query.search as string,
        sortBy: req.query.sortBy as any,
        sortOrder: req.query.sortOrder as any,
        limit: parseInt(req.query.limit as string) || 20,
        offset: parseInt(req.query.offset as string) || 0,
      };

      const result = await this.projectService.listUserProjects(
        userId,
        filters
      );

      res.json({
        success: true,
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // GET /api/v1/projects/:id
  // ==========================================
  getProject = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      const project = await this.projectService.getProjectById(id, userId);

      res.json({
        success: true,
        data: project,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // PUT /api/v1/projects/:id
  // ==========================================
  updateProject = async (
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

      const { id } = req.params;
      const userId = req.user!.id;

      const project = await this.projectService.updateProject(
        id,
        userId,
        req.body
      );

      res.json({
        success: true,
        data: project,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  // ==========================================
  // DELETE /api/v1/projects/:id
  // ==========================================
  deleteProject = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      await this.projectService.deleteProject(id, userId);

      res.json({
        success: true,
        data: {
          message: "Project deleted successfully",
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
  // GET /api/v1/projects/:id/analytics
  // ==========================================
  getAnalytics = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      const analytics = await this.projectService.getProjectAnalytics(
        id,
        userId
      );

      res.json({
        success: true,
        data: analytics,
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
  static createProjectValidation = [
    body("name").trim().isLength({ min: 3, max: 255 }),
    body("description").optional().trim().isLength({ max: 1000 }),
    body("targetImageKey").notEmpty(),
    body("targetImageSize").isInt({ min: 1 }),
    body("contentKey").notEmpty(),
    body("contentType").isIn(["image", "video", "3d_model"]),
    body("contentSize").isInt({ min: 1 }),
    body("contentMimeType").notEmpty(),
    body("contentDuration").optional().isInt({ min: 0 }),
    body("trackingQuality").optional().isIn(["low", "medium", "high"]),
    body("autoPlay").optional().isBoolean(),
    body("loopContent").optional().isBoolean(),
  ];

  static updateProjectValidation = [
    body("name").optional().trim().isLength({ min: 3, max: 255 }),
    body("description").optional().trim().isLength({ max: 1000 }),
    body("trackingQuality").optional().isIn(["low", "medium", "high"]),
    body("autoPlay").optional().isBoolean(),
    body("loopContent").optional().isBoolean(),
    body("status").optional().isIn(["active", "disabled"]),
  ];
}
