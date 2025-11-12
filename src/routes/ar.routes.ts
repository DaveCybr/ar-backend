// ============================================
// FILE: src/routes/ar.routes.ts
// Public AR routes
// ============================================
import { Router } from "express";
import { ARController } from "../controllers/ar.controller";
import { cacheMiddleware } from "../middleware/cache";
import { rateLimitMiddleware } from "../middleware/rateLimit";

const router = Router();
const arController = new ARController();

// Public endpoints (no authentication required)
// But with rate limiting to prevent abuse

router.get(
  "/:id",
  rateLimitMiddleware(300, 3600), // 300 requests per hour
  cacheMiddleware(300), // Cache for 5 minutes
  arController.getProjectForAR
);

router.get(
  "/short/:shortCode",
  rateLimitMiddleware(300, 3600),
  cacheMiddleware(600), // Cache for 10 minutes
  arController.getProjectByShortCode
);

router.post(
  "/:id/track",
  rateLimitMiddleware(1000, 3600), // Allow more for analytics
  ARController.trackEventValidation,
  arController.trackEvent
);

export default router;
