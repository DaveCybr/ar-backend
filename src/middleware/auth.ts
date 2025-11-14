// ============================================
// FILE: src/middleware/auth.ts
// Authentication middleware
// ============================================
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/config";
import { AppError } from "./errorHandler";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError(401, "UNAUTHORIZED", "No token provided");
    }

    const token = authHeader.substring(7);

    // ✅ FIX: Decode dengan struktur yang benar
    const decoded = jwt.verify(token, config.jwt.secret) as {
      payload: {
        userId: string;
        email: string;
      };
    };

    // ✅ FIX: Ambil dari decoded.payload
    req.user = {
      id: decoded.payload.userId, // ⬅️ Sekarang benar!
      email: decoded.payload.email,
    };

    console.log("🔐 Authenticated user:", req.user); // ⬅️ Debug log

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError(401, "INVALID_TOKEN", "Invalid token"));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new AppError(401, "TOKEN_EXPIRED", "Token expired"));
    } else {
      next(error);
    }
  }
};
