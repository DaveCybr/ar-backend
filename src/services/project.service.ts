// ============================================
// FILE: src/services/project.service.ts
// AR Project management business logic
// ============================================
import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import crypto from "crypto";
import { DatabaseService } from "./database.service";
import { UploadService } from "./upload.service";
import { RedisService } from "./redis.service";
import { AppError } from "../middleware/errorHandler";
import { config } from "../config/config";

export interface CreateProjectDTO {
  name: string;
  description?: string;
  targetImageKey: string;
  targetImageSize: number;
  contentKey: string;
  contentType: "image" | "video" | "3d_model";
  contentSize: number;
  contentMimeType: string;
  contentDuration?: number; // for videos
  trackingQuality?: "low" | "medium" | "high";
  autoPlay?: boolean;
  loopContent?: boolean;
}

export interface UpdateProjectDTO {
  name?: string;
  description?: string;
  trackingQuality?: "low" | "medium" | "high";
  autoPlay?: boolean;
  loopContent?: boolean;
  status?: "active" | "disabled";
}

export interface ProjectFilters {
  status?: string;
  contentType?: string;
  search?: string;
  sortBy?: "created_at" | "view_count" | "name";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export class ProjectService {
  private uploadService: UploadService;

  constructor() {
    this.uploadService = new UploadService();
  }

  // ==========================================
  // CREATE PROJECT
  // ==========================================
  async createProject(userId: string, data: CreateProjectDTO): Promise<any> {
    // Check user's project limit
    await this.checkProjectLimit(userId);

    // Verify files exist in S3
    const targetExists = await this.uploadService.verifyFileExists(
      data.targetImageKey
    );
    const contentExists = await this.uploadService.verifyFileExists(
      data.contentKey
    );

    if (!targetExists || !contentExists) {
      throw new AppError(404, "FILES_NOT_FOUND", "Uploaded files not found");
    }

    // Generate URLs
    const targetImageUrl = this.uploadService.getFileUrl(data.targetImageKey);
    const contentUrl = this.uploadService.getFileUrl(data.contentKey);

    // Generate short code for QR
    const shortCode = this.generateShortCode();

    // Calculate hashes (for integrity check)
    const targetImageHash = crypto.randomBytes(32).toString("hex"); // TODO: Calculate real hash

    // Insert project
    const result = await DatabaseService.query(
      `INSERT INTO ar_projects (
        user_id, name, description,
        target_image_url, target_image_key, target_image_hash, target_image_size,
        content_url, content_key, content_type, content_size, content_mime_type, content_duration,
        tracking_quality, auto_play, loop_content, short_code, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *`,
      [
        userId,
        data.name,
        data.description || null,
        targetImageUrl,
        data.targetImageKey,
        targetImageHash,
        data.targetImageSize,
        contentUrl,
        data.contentKey,
        data.contentType,
        data.contentSize,
        data.contentMimeType,
        data.contentDuration || null,
        data.trackingQuality || "medium",
        data.autoPlay !== undefined ? data.autoPlay : true,
        data.loopContent !== undefined ? data.loopContent : true,
        shortCode,
        "active",
      ]
    );

    const project = result.rows[0];

    // Generate QR code
    const qrCodeUrl = await this.generateQRCode(project.id, shortCode);

    // Update project with QR URL
    await DatabaseService.query(
      "UPDATE ar_projects SET qr_code_url = $1, published_at = NOW() WHERE id = $2",
      [qrCodeUrl, project.id]
    );

    project.qr_code_url = qrCodeUrl;

    console.log(`✅ Project created: ${project.id}`);

    return this.formatProject(project);
  }

  // ==========================================
  // GET PROJECT BY ID
  // ==========================================
  async getProjectById(projectId: string, userId?: string): Promise<any> {
    const cacheKey = `project:${projectId}`;

    // Try cache first (public projects only)
    if (!userId) {
      const cached = await RedisService.getJSON(cacheKey);
      if (cached) return cached;
    }

    let query = "SELECT * FROM ar_projects WHERE id = $1";
    const params: any[] = [projectId];

    // If user specified, check ownership
    if (userId) {
      query += " AND user_id = $2";
      params.push(userId);
    }

    const result = await DatabaseService.query(query, params);

    if (result.rows.length === 0) {
      throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    }

    const project = this.formatProject(result.rows[0]);

    // Cache public projects
    if (!userId && project.is_public) {
      await RedisService.setJSON(cacheKey, project, 300); // 5 minutes
    }

    return project;
  }

  // ==========================================
  // GET PROJECT BY SHORT CODE (for AR app)
  // ==========================================
  async getProjectByShortCode(shortCode: string): Promise<any> {
    const cacheKey = `project:short:${shortCode}`;

    // Try cache
    const cached = await RedisService.getJSON(cacheKey);
    if (cached) {
      console.log(`📦 Cache hit for short code: ${shortCode}`);
      return cached;
    }

    const result = await DatabaseService.query(
      "SELECT * FROM ar_projects WHERE short_code = $1 AND status = $2",
      [shortCode, "active"]
    );

    if (result.rows.length === 0) {
      throw new AppError(
        404,
        "PROJECT_NOT_FOUND",
        "Project not found or inactive"
      );
    }

    const project = this.formatProject(result.rows[0]);

    // Cache for 10 minutes
    await RedisService.setJSON(cacheKey, project, 600);

    // Increment scan count (async, don't wait)
    this.incrementScanCount(project.id).catch((err) =>
      console.error("Error incrementing scan count:", err)
    );

    return project;
  }

  // ==========================================
  // LIST USER PROJECTS
  // ==========================================
  async listUserProjects(
    userId: string,
    filters: ProjectFilters = {}
  ): Promise<any> {
    const {
      status,
      contentType,
      search,
      sortBy = "created_at",
      sortOrder = "desc",
      limit = 20,
      offset = 0,
    } = filters;

    let query = "SELECT * FROM ar_projects WHERE user_id = $1";
    const params: any[] = [userId];
    let paramIndex = 2;

    // Apply filters
    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (contentType) {
      query += ` AND content_type = $${paramIndex}`;
      params.push(contentType);
      paramIndex++;
    }

    if (search) {
      query += ` AND (name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Sorting
    const allowedSortColumns = ["created_at", "view_count", "name"];
    const sortColumn = allowedSortColumns.includes(sortBy)
      ? sortBy
      : "created_at";
    const order = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

    query += ` ORDER BY ${sortColumn} ${order}`;

    // Pagination
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    // Execute query
    const result = await DatabaseService.query(query, params);

    // Get total count
    const countResult = await DatabaseService.query(
      "SELECT COUNT(*) FROM ar_projects WHERE user_id = $1",
      [userId]
    );

    const total = parseInt(countResult.rows[0].count);

    return {
      projects: result.rows.map((p) => this.formatProject(p)),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  }

  // ==========================================
  // UPDATE PROJECT
  // ==========================================
  async updateProject(
    projectId: string,
    userId: string,
    data: UpdateProjectDTO
  ): Promise<any> {
    // Check ownership
    await this.verifyProjectOwnership(projectId, userId);

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Build dynamic update query
    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex}`);
      params.push(data.name);
      paramIndex++;
    }

    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      params.push(data.description);
      paramIndex++;
    }

    if (data.trackingQuality !== undefined) {
      updates.push(`tracking_quality = $${paramIndex}`);
      params.push(data.trackingQuality);
      paramIndex++;
    }

    if (data.autoPlay !== undefined) {
      updates.push(`auto_play = $${paramIndex}`);
      params.push(data.autoPlay);
      paramIndex++;
    }

    if (data.loopContent !== undefined) {
      updates.push(`loop_content = $${paramIndex}`);
      params.push(data.loopContent);
      paramIndex++;
    }

    if (data.status !== undefined) {
      updates.push(`status = $${paramIndex}`);
      params.push(data.status);
      paramIndex++;
    }

    if (updates.length === 0) {
      throw new AppError(400, "NO_UPDATES", "No fields to update");
    }

    // Always update updated_at
    updates.push("updated_at = NOW()");

    params.push(projectId);

    const query = `
      UPDATE ar_projects 
      SET ${updates.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await DatabaseService.query(query, params);

    // Clear cache
    await this.clearProjectCache(projectId);

    console.log(`✅ Project updated: ${projectId}`);

    return this.formatProject(result.rows[0]);
  }

  // ==========================================
  // DELETE PROJECT
  // ==========================================
  async deleteProject(projectId: string, userId: string): Promise<void> {
    // Check ownership
    const project = await this.verifyProjectOwnership(projectId, userId);

    // Delete files from S3
    try {
      await this.uploadService.deleteFile(project.target_image_key);
      await this.uploadService.deleteFile(project.content_key);
    } catch (error) {
      console.error("Error deleting files from S3:", error);
      // Continue with DB deletion even if S3 deletion fails
    }

    // Delete from database (CASCADE will delete analytics)
    await DatabaseService.query("DELETE FROM ar_projects WHERE id = $1", [
      projectId,
    ]);

    // Clear cache
    await this.clearProjectCache(projectId);

    console.log(`✅ Project deleted: ${projectId}`);
  }

  // ==========================================
  // GET PROJECT ANALYTICS
  // ==========================================
  async getProjectAnalytics(projectId: string, userId: string): Promise<any> {
    // Check ownership
    await this.verifyProjectOwnership(projectId, userId);

    // Get basic stats
    const statsResult = await DatabaseService.query(
      `SELECT 
        view_count, scan_count, unique_viewers, total_view_duration,
        created_at, last_viewed_at
       FROM ar_projects 
       WHERE id = $1`,
      [projectId]
    );

    if (statsResult.rows.length === 0) {
      throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    }

    const stats = statsResult.rows[0];

    // Get event breakdown
    const eventsResult = await DatabaseService.query(
      `SELECT 
        event_type,
        COUNT(*) as count
       FROM ar_analytics
       WHERE project_id = $1
       GROUP BY event_type
       ORDER BY count DESC`,
      [projectId]
    );

    // Get device breakdown
    const devicesResult = await DatabaseService.query(
      `SELECT 
        device_model,
        COUNT(DISTINCT session_id) as sessions
       FROM ar_analytics
       WHERE project_id = $1 AND device_model IS NOT NULL
       GROUP BY device_model
       ORDER BY sessions DESC
       LIMIT 10`,
      [projectId]
    );

    // Get daily views (last 30 days)
    const dailyResult = await DatabaseService.query(
      `SELECT 
        DATE(event_timestamp) as date,
        COUNT(DISTINCT session_id) as views
       FROM ar_analytics
       WHERE project_id = $1 
         AND event_type = 'ar_start'
         AND event_timestamp >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(event_timestamp)
       ORDER BY date DESC`,
      [projectId]
    );

    return {
      overview: {
        totalScans: parseInt(stats.scan_count),
        totalViews: parseInt(stats.view_count),
        uniqueViewers: parseInt(stats.unique_viewers),
        totalViewDuration: parseInt(stats.total_view_duration),
        avgViewDuration:
          stats.view_count > 0
            ? Math.round(stats.total_view_duration / stats.view_count)
            : 0,
        createdAt: stats.created_at,
        lastViewedAt: stats.last_viewed_at,
      },
      events: eventsResult.rows,
      topDevices: devicesResult.rows,
      dailyViews: dailyResult.rows,
    };
  }

  // ==========================================
  // HELPER: Generate QR Code
  // ==========================================
  private async generateQRCode(
    projectId: string,
    shortCode: string
  ): Promise<string> {
    const qrData = `${
      config.app.baseUrl || "https://ar.yourdomain.com"
    }/a/${shortCode}`;

    try {
      // Generate QR as buffer
      const qrBuffer = await QRCode.toBuffer(qrData, {
        errorCorrectionLevel: "H",
        type: "png",
        width: 512,
        margin: 2,
      });

      // Save QR to storage
      const qrKey = `projects/qr/${projectId}.png`;
      await this.uploadService.saveFile(qrKey, qrBuffer);

      // Return URL to access QR
      const qrUrl = this.uploadService.getFileUrl(qrKey);

      console.log(`✅ QR code saved: ${qrUrl}`);

      return qrUrl;
    } catch (error) {
      console.error("QR generation error:", error);
      throw new AppError(
        500,
        "QR_GENERATION_FAILED",
        "Failed to generate QR code"
      );
    }
  }

  // ==========================================
  // HELPER: Generate Short Code
  // ==========================================
  private generateShortCode(): string {
    // Generate 8-character alphanumeric code
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let code = "";

    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return code;
  }

  // ==========================================
  // HELPER: Format Project
  // ==========================================
  private formatProject(project: any): any {
    return {
      id: project.id,
      userId: project.user_id,
      name: project.name,
      description: project.description,
      targetImage: {
        url: project.target_image_url,
        key: project.target_image_key,
        hash: project.target_image_hash,
        size: parseInt(project.target_image_size),
        width: project.target_image_width,
        height: project.target_image_height,
      },
      content: {
        url: project.content_url,
        key: project.content_key,
        type: project.content_type,
        size: parseInt(project.content_size),
        mimeType: project.content_mime_type,
        duration: project.content_duration,
        thumbnailUrl: project.content_thumbnail_url,
      },
      settings: {
        trackingQuality: project.tracking_quality,
        autoPlay: project.auto_play,
        loopContent: project.loop_content,
        contentScale: parseFloat(project.content_scale),
      },
      qrCode: {
        url: project.qr_code_url,
        shortCode: project.short_code,
        shortUrl: `${config.app.baseUrl}/a/${project.short_code}`,
      },
      stats: {
        viewCount: parseInt(project.view_count),
        scanCount: parseInt(project.scan_count),
        uniqueViewers: parseInt(project.unique_viewers),
      },
      status: project.status,
      isPublic: project.is_public,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      publishedAt: project.published_at,
      lastViewedAt: project.last_viewed_at,
      expiresAt: project.expires_at,
    };
  }

  // ==========================================
  // HELPER: Check Project Limit
  // ==========================================
  private async checkProjectLimit(userId: string): Promise<void> {
    const result = await DatabaseService.query(
      `SELECT 
        (SELECT COUNT(*) FROM ar_projects WHERE user_id = $1 AND status != 'disabled') as current_count,
        project_limit
       FROM users 
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }

    const { current_count, project_limit } = result.rows[0];

    if (parseInt(current_count) >= project_limit) {
      throw new AppError(
        403,
        "PROJECT_LIMIT_REACHED",
        `Project limit reached (${project_limit}). Upgrade your plan for more projects.`
      );
    }
  }

  // ==========================================
  // HELPER: Verify Project Ownership
  // ==========================================
  private async verifyProjectOwnership(
    projectId: string,
    userId: string
  ): Promise<any> {
    const result = await DatabaseService.query(
      "SELECT * FROM ar_projects WHERE id = $1 AND user_id = $2",
      [projectId, userId]
    );

    if (result.rows.length === 0) {
      throw new AppError(
        404,
        "PROJECT_NOT_FOUND",
        "Project not found or access denied"
      );
    }

    return result.rows[0];
  }

  // ==========================================
  // HELPER: Increment Scan Count
  // ==========================================
  private async incrementScanCount(projectId: string): Promise<void> {
    await DatabaseService.query(
      "UPDATE ar_projects SET scan_count = scan_count + 1 WHERE id = $1",
      [projectId]
    );
  }

  // ==========================================
  // HELPER: Clear Project Cache
  // ==========================================
  private async clearProjectCache(projectId: string): Promise<void> {
    const result = await DatabaseService.query(
      "SELECT short_code FROM ar_projects WHERE id = $1",
      [projectId]
    );

    if (result.rows.length > 0) {
      const shortCode = result.rows[0].short_code;
      await RedisService.delete(`project:${projectId}`);
      await RedisService.delete(`project:short:${shortCode}`);
    }
  }
}
