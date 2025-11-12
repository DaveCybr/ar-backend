// ============================================
// FILE: src/services/auth.service.ts
// Authentication business logic
// ============================================
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config/config";
import { DatabaseService } from "./database.service";
import { AppError } from "../middleware/errorHandler";

export interface RegisterDTO {
  email: string;
  password: string;
  fullName?: string;
}

export interface LoginDTO {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export class AuthService {
  // ==========================================
  // REGISTER NEW USER
  // ==========================================
  static async register(data: RegisterDTO): Promise<AuthTokens> {
    const { email, password, fullName } = data;

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new AppError(400, "INVALID_EMAIL", "Invalid email format");
    }

    // Validate password strength
    if (password.length < 8) {
      throw new AppError(
        400,
        "WEAK_PASSWORD",
        "Password must be at least 8 characters"
      );
    }

    // Check if user exists
    const existingUser = await DatabaseService.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      throw new AppError(409, "USER_EXISTS", "Email already registered");
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const result = await DatabaseService.query(
      `INSERT INTO users (email, password_hash, full_name, is_verified)
       VALUES ($1, $2, $3, false)
       RETURNING id, email, full_name, created_at`,
      [email, passwordHash, fullName || null]
    );

    const user = result.rows[0];

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.email);

    console.log(`✅ User registered: ${email}`);

    return tokens;
  }

  // ==========================================
  // LOGIN
  // ==========================================
  static async login(
    data: LoginDTO,
    deviceInfo?: string,
    ipAddress?: string
  ): Promise<AuthTokens> {
    const { email, password } = data;

    // Get user
    const result = await DatabaseService.query(
      `SELECT id, email, password_hash, is_active, failed_login_attempts, locked_until
       FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Invalid email or password"
      );
    }

    const user = result.rows[0];

    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new AppError(
        423,
        "ACCOUNT_LOCKED",
        "Account temporarily locked. Try again later."
      );
    }

    // Check if account is active
    if (!user.is_active) {
      throw new AppError(403, "ACCOUNT_DISABLED", "Account has been disabled");
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      // Increment failed attempts
      await this.handleFailedLogin(user.id, user.failed_login_attempts);
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Invalid email or password"
      );
    }

    // Reset failed attempts on successful login
    await DatabaseService.query(
      `UPDATE users 
       SET failed_login_attempts = 0, 
           locked_until = NULL, 
           last_login = NOW()
       WHERE id = $1`,
      [user.id]
    );

    // Generate tokens
    const tokens = await this.generateTokens(
      user.id,
      user.email,
      deviceInfo,
      ipAddress
    );

    console.log(`✅ User logged in: ${email}`);

    return tokens;
  }

  // ==========================================
  // REFRESH TOKEN
  // ==========================================
  static async refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as {
        userId: string;
        email: string;
        tokenId: string;
      };

      // Check if token exists in database
      const result = await DatabaseService.query(
        `SELECT user_id, is_revoked, expires_at 
         FROM refresh_tokens 
         WHERE id = $1`,
        [decoded.tokenId]
      );

      if (result.rows.length === 0 || result.rows[0].is_revoked) {
        throw new AppError(401, "INVALID_TOKEN", "Invalid refresh token");
      }

      const tokenData = result.rows[0];

      if (new Date(tokenData.expires_at) < new Date()) {
        throw new AppError(401, "TOKEN_EXPIRED", "Refresh token expired");
      }

      // Update last used
      await DatabaseService.query(
        "UPDATE refresh_tokens SET last_used_at = NOW() WHERE id = $1",
        [decoded.tokenId]
      );

      // Generate new tokens
      return this.generateTokens(decoded.userId, decoded.email);
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AppError(401, "INVALID_TOKEN", "Invalid refresh token");
      }
      throw error;
    }
  }

  // ==========================================
  // LOGOUT
  // ==========================================
  static async logout(refreshToken: string): Promise<void> {
    try {
      const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as {
        tokenId: string;
      };

      // Revoke token
      await DatabaseService.query(
        "UPDATE refresh_tokens SET is_revoked = true WHERE id = $1",
        [decoded.tokenId]
      );

      console.log("✅ User logged out");
    } catch (error) {
      // Silent fail - token already invalid
    }
  }

  // ==========================================
  // HELPER: Generate Tokens
  // ==========================================
  private static async generateTokens(
    userId: string,
    email: string,
    deviceInfo?: string,
    ipAddress?: string
  ): Promise<AuthTokens> {
    // Generate access token
    const accessToken = jwt.sign(
      { payload: { userId, email } },
      config.jwt.secret || ""
    );
    // Create refresh token record
    const tokenId = uuidv4();
    const refreshTokenExpiry = new Date();
    refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 7); // 7 days

    const refreshToken = jwt.sign(
      { payload: { userId, email, tokenId } },
      config.jwt.refreshSecret
    );

    // Store refresh token in database
    await DatabaseService.query(
      `INSERT INTO refresh_tokens (id, user_id, token, device_info, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tokenId, userId, refreshToken, deviceInfo, ipAddress, refreshTokenExpiry]
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes in seconds
    };
  }

  // ==========================================
  // HELPER: Handle Failed Login
  // ==========================================
  private static async handleFailedLogin(
    userId: string,
    currentAttempts: number
  ): Promise<void> {
    const newAttempts = currentAttempts + 1;

    // Lock account after 5 failed attempts
    if (newAttempts >= 5) {
      const lockUntil = new Date();
      lockUntil.setMinutes(lockUntil.getMinutes() + 30); // Lock for 30 minutes

      await DatabaseService.query(
        `UPDATE users 
         SET failed_login_attempts = $1, locked_until = $2
         WHERE id = $3`,
        [newAttempts, lockUntil, userId]
      );

      console.log(`⚠️ Account locked due to failed login attempts: ${userId}`);
    } else {
      await DatabaseService.query(
        "UPDATE users SET failed_login_attempts = $1 WHERE id = $2",
        [newAttempts, userId]
      );
    }
  }

  // ==========================================
  // GET USER PROFILE
  // ==========================================
  static async getUserProfile(userId: string) {
    const result = await DatabaseService.query(
      `SELECT 
        id, email, full_name, plan_type, 
        storage_used, storage_limit, project_limit,
        is_verified, created_at, last_login
       FROM users 
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }

    return result.rows[0];
  }

  // ==========================================
  // CHANGE PASSWORD
  // ==========================================
  static async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<void> {
    // Get current password hash
    const result = await DatabaseService.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }

    // Verify old password
    const isValid = await bcrypt.compare(
      oldPassword,
      result.rows[0].password_hash
    );
    if (!isValid) {
      throw new AppError(
        401,
        "INVALID_PASSWORD",
        "Current password is incorrect"
      );
    }

    // Validate new password
    if (newPassword.length < 8) {
      throw new AppError(
        400,
        "WEAK_PASSWORD",
        "New password must be at least 8 characters"
      );
    }

    // Hash and update
    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    await DatabaseService.query(
      "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
      [newPasswordHash, userId]
    );

    // Revoke all refresh tokens (force re-login)
    await DatabaseService.query(
      "UPDATE refresh_tokens SET is_revoked = true WHERE user_id = $1",
      [userId]
    );

    console.log(`✅ Password changed for user: ${userId}`);
  }
}
