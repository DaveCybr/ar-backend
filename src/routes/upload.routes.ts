// ============================================
// FILE: src/routes/upload.routes.ts
// Upload routes
// ============================================
import { Router } from "express";
import { UploadController } from "../controllers/upload.controller";
import { authenticate } from "../middleware/auth";

const router = Router();
const uploadController = new UploadController();

// All upload routes require authentication
router.use(authenticate);

router.post(
  "/presigned-url",
  UploadController.presignedUrlValidation,
  uploadController.getPresignedUrl
);

router.post("/confirm", uploadController.confirmUpload);

export default router;
