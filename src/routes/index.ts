// ============================================
// FILE: src/routes/index.ts
// Main routes aggregator
// ============================================
import { Router } from "express";
import authRoutes from "./auth.routes";
import uploadRoutes from "./upload.routes";
import projectRoutes from "./project.routes";
import arRoutes from "./ar.routes";

const router = Router();

// Mount routes
router.use("/auth", authRoutes);
router.use("/upload", uploadRoutes);
router.use("/projects", projectRoutes);
router.use("/ar", arRoutes);

// API info endpoint
router.get("/", (req, res) => {
  res.json({
    name: "AR System API",
    version: "1.0.0",
    status: "operational",
  });
});

export default router;
