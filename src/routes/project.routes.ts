// ============================================
// FILE: src/routes/project.routes.ts
// Project routes
// ============================================
import { Router } from "express";
import { ProjectController } from "../controllers/project.controller";
import { authenticate } from "../middleware/auth";
import { cacheMiddleware } from "../middleware/cache";

const router = Router();
const projectController = new ProjectController();

// All routes require authentication
router.use(authenticate);

// CRUD operations
router.post(
  "/",
  ProjectController.createProjectValidation,
  projectController.createProject
);

router.get("/", projectController.listProjects);

router.get(
  "/:id",
  cacheMiddleware(60), // Cache for 1 minute
  projectController.getProject
);

router.put(
  "/:id",
  ProjectController.updateProjectValidation,
  projectController.updateProject
);

router.delete("/:id", projectController.deleteProject);

// Analytics
router.get("/:id/analytics", projectController.getAnalytics);

export default router;
