// ============================================
// FILE: src/routes/auth.routes.ts
// Auth routes
// ============================================
import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

// Public routes
router.post(
  "/register",
  AuthController.registerValidation,
  AuthController.register
);
router.post("/login", AuthController.loginValidation, AuthController.login);
router.post("/refresh", AuthController.refresh);
router.post("/logout", AuthController.logout);

// Protected routes
router.get("/me", authenticate, AuthController.getProfile);
router.put(
  "/change-password",
  authenticate,
  AuthController.changePasswordValidation,
  AuthController.changePassword
);

export default router;
