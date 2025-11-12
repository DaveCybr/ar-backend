// ============================================
// FILE: src/middleware/rateLimit.ts
// Advanced rate limiting with Redis
// ============================================
import { Request, Response, NextFunction } from "express";
import { RedisService } from "../services/redis.service";
import { AppError } from "./errorHandler";

export const rateLimitMiddleware = (
  maxRequests: number = 100,
  windowSeconds: number = 900 // 15 minutes
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Use IP address as key (or user ID if authenticated)
      const identifier = req.ip || "unknown";
      const key = `ratelimit:${identifier}`;

      const { allowed, remaining } = await RedisService.checkRateLimit(
        key,
        maxRequests,
        windowSeconds
      );

      // Set rate limit headers
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", remaining);
      res.setHeader("X-RateLimit-Reset", Date.now() + windowSeconds * 1000);

      if (!allowed) {
        throw new AppError(
          429,
          "RATE_LIMIT_EXCEEDED",
          `Too many requests. Please try again in ${windowSeconds} seconds.`
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
