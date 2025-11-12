// ============================================
// FILE: src/controllers/auth.controller.ts
// HTTP request handlers
// ============================================
import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";
import { body, validationResult } from "express-validator";

export class AuthController {
  // ==========================================
  // POST /api/v1/auth/register
  // ==========================================
  static async register(req: Request, res: Response, next: NextFunction) {
    try {
      // Validate input
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

      const tokens = await AuthService.register(req.body);

      res.status(201).json({
        success: true,
        data: tokens,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==========================================
  // POST /api/v1/auth/login
  // ==========================================
  static async login(req: Request, res: Response, next: NextFunction) {
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

      const deviceInfo = req.headers["user-agent"];
      const ipAddress = req.ip;

      const tokens = await AuthService.login(req.body, deviceInfo, ipAddress);

      res.json({
        success: true,
        data: tokens,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==========================================
  // POST /api/v1/auth/refresh
  // ==========================================
  static async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          error: {
            code: "MISSING_TOKEN",
            message: "Refresh token is required",
          },
        });
      }

      const tokens = await AuthService.refreshAccessToken(refreshToken);

      res.json({
        success: true,
        data: tokens,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==========================================
  // POST /api/v1/auth/logout
  // ==========================================
  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;

      if (refreshToken) {
        await AuthService.logout(refreshToken);
      }

      res.json({
        success: true,
        data: {
          message: "Logged out successfully",
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==========================================
  // GET /api/v1/auth/me
  // ==========================================
  static async getProfile(req: any, res: Response, next: NextFunction) {
    try {
      const profile = await AuthService.getUserProfile(req.user.id);

      res.json({
        success: true,
        data: profile,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==========================================
  // PUT /api/v1/auth/change-password
  // ==========================================
  static async changePassword(req: any, res: Response, next: NextFunction) {
    try {
      const { oldPassword, newPassword } = req.body;

      await AuthService.changePassword(req.user.id, oldPassword, newPassword);

      res.json({
        success: true,
        data: {
          message: "Password changed successfully",
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==========================================
  // VALIDATION RULES
  // ==========================================
  static registerValidation = [
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 8 }),
    body("fullName").optional().trim().isLength({ min: 2, max: 255 }),
  ];

  static loginValidation = [
    body("email").isEmail().normalizeEmail(),
    body("password").notEmpty(),
  ];

  static changePasswordValidation = [
    body("oldPassword").notEmpty(),
    body("newPassword").isLength({ min: 8 }),
  ];
}
