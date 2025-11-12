// ============================================
// FILE: src/middleware/cache.ts
// Caching middleware for routes
// ============================================
import { Request, Response, NextFunction } from "express";
import { RedisService } from "../services/redis.service";

export const cacheMiddleware = (ttl: number = 300) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== "GET") {
      return next();
    }

    const cacheKey = `cache:${req.originalUrl}`;

    try {
      const cached = await RedisService.get(cacheKey);

      if (cached) {
        console.log(`📦 Serving from cache: ${req.originalUrl}`);
        return res.json(JSON.parse(cached));
      }

      // Store original send function
      const originalSend = res.json;

      // Override send to cache response
      res.json = function (data: any) {
        // Cache successful responses only
        if (res.statusCode >= 200 && res.statusCode < 300) {
          RedisService.set(cacheKey, JSON.stringify(data), ttl).catch((err) => {
            console.error("Cache set error:", err);
          });
        }

        // Call original send
        return originalSend.call(this, data);
      };

      next();
    } catch (error) {
      console.error("Cache middleware error:", error);
      next();
    }
  };
};
