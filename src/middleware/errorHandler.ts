// ============================================
// FILE: src/middleware/errorHandler.ts
// Global error handler
// ============================================
import { Request, Response, NextFunction } from "express";
import { config } from "../config/config";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error("❌ Error:", err);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  }

  // Unhandled errors
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message:
        config.app.env === "production"
          ? "An unexpected error occurred"
          : err.message,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
};
