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

    const decoded = jwt.verify(token, config.jwt.secret) as {
      userId: string;
      email: string;
    };

    req.user = {
      id: decoded.userId,
      email: decoded.email,
    };

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
