// ============================================
// FILE: src/routes/upload.routes.ts
// Upload routes
// ============================================
// import { Router } from "express";
// import { UploadController } from "../controllers/upload.controller";
// import { authenticate } from "../middleware/auth";

// const router = Router();
// const uploadController = new UploadController();

// // All upload routes require authentication
// router.use(authenticate);

// router.post(
//   "/presigned-url",
//   UploadController.presignedUrlValidation,
//   uploadController.getPresignedUrl
// );

// router.post("/confirm", uploadController.confirmUpload);

// export default router;

// ============================================
// FILE: src/routes/upload.routes.ts
// Upload routes for local storage
// ============================================
import express from "express";
import path from "path";
import { Router } from "express";
import { UploadController } from "../controllers/upload.controller";
import { authenticate } from "../middleware/auth";

const router = Router();
const uploadController = new UploadController();

// Get presigned URL (for compatibility, even though we upload directly)
router.post(
  "/presigned-url",
  authenticate,
  UploadController.presignedUrlValidation,
  uploadController.getPresignedUrl
);

// Upload file directly
router.post(
  "/file",
  authenticate,
  UploadController.uploadMiddleware,
  uploadController.uploadFile
);

// Confirm upload
router.post("/confirm", authenticate, uploadController.confirmUpload);

// Serve uploaded files (public access)
router.use("/", express.static(path.join(__dirname, "../../uploads")));

export default router;
