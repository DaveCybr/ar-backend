// ============================================
// FILE: src/services/upload.service.ts
// File upload & Local storage management
// ============================================
// src/services/upload.service.ts
import sharp from "sharp";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import { config } from "../config/config";
import { AppError } from "../middleware/errorHandler";

export interface PresignedUrlData {
  uploadUrl: string;
  fileKey: string;
  expiresIn: number;
}

export class UploadService {
  private uploadDir: string;
  private baseUrl: string;

  constructor() {
    // Use UPLOAD_PATH from env if exists, otherwise use default
    const isProduction = process.env.NODE_ENV === "production";

    this.uploadDir =
      process.env.UPLOAD_PATH ||
      (isProduction ? "/app/uploads" : path.join(process.cwd(), "uploads"));

    this.baseUrl =
      process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

    console.log("📁 Upload Service Configuration:", {
      environment: process.env.NODE_ENV,
      uploadDir: this.uploadDir,
      absolutePath: path.resolve(this.uploadDir),
      baseUrl: this.baseUrl,
    });

    this.ensureUploadDirExists();
  }

  // ==========================================
  // ENSURE UPLOAD DIRECTORY EXISTS
  // ==========================================
  private async ensureUploadDirExists(): Promise<void> {
    try {
      // Create base directory
      await fs.mkdir(this.uploadDir, { recursive: true });

      // Create projects subdirectory
      const projectsDir = path.join(this.uploadDir, "projects");
      await fs.mkdir(projectsDir, { recursive: true });

      // Verify directory is writable
      await fs.access(this.uploadDir, fs.constants.W_OK);

      console.log(`✅ Upload directory ready: ${this.uploadDir}`);

      // List existing contents for debugging
      const contents = await fs.readdir(this.uploadDir);
      if (contents.length > 0) {
        console.log(`📂 Existing files/folders: ${contents.length}`);
      }
    } catch (error) {
      console.error("❌ Error creating upload directory:", error);
      throw new Error(`Failed to initialize upload directory: ${error}`);
    }
  }

  // ==========================================
  // SAVE FILE TO LOCAL STORAGE
  // ==========================================
  async saveFile(fileKey: string, buffer: Buffer): Promise<void> {
    const filePath = path.join(this.uploadDir, fileKey);
    const directory = path.dirname(filePath);

    try {
      // Ensure directory exists
      await fs.mkdir(directory, { recursive: true });

      // Save file
      await fs.writeFile(filePath, buffer);

      // Verify file was saved correctly
      const stats = await fs.stat(filePath);

      console.log(`✅ Saved file: ${fileKey}`, {
        size: stats.size,
        path: filePath,
        url: this.getFileUrl(fileKey),
      });

      // Verify file is readable
      await fs.access(filePath, fs.constants.R_OK);
    } catch (error) {
      console.error("❌ Error saving file:", error);
      throw new AppError(500, "SAVE_FAILED", `Failed to save file: ${error}`);
    }
  }

  // ==========================================
  // VERIFY FILE EXISTS
  // ==========================================
  async verifyFileExists(fileKey: string): Promise<boolean> {
    try {
      const filePath = path.join(this.uploadDir, fileKey);
      await fs.access(filePath, fs.constants.R_OK);

      const stats = await fs.stat(filePath);
      console.log(`✅ File verified: ${fileKey}`, {
        size: stats.size,
        exists: true,
      });

      return true;
    } catch (error) {
      console.log(`❌ File not found: ${fileKey}`);
      return false;
    }
  }

  // ==========================================
  // GET FILE URL (Public accessible URL)
  // ==========================================
  getFileUrl(fileKey: string): string {
    // Return relative URL that matches static file serving
    return `/uploads/${fileKey}`;
  }

  // ==========================================
  // GET ABSOLUTE FILE URL
  // ==========================================
  getAbsoluteFileUrl(fileKey: string): string {
    return `${this.baseUrl}/uploads/${fileKey}`;
  }

  // ==========================================
  // GET FILE PATH (Server file system path)
  // ==========================================
  getFilePath(fileKey: string): string {
    return path.join(this.uploadDir, fileKey);
  }

  // ==========================================
  // DELETE FILE
  // ==========================================
  async deleteFile(fileKey: string): Promise<void> {
    try {
      const filePath = path.join(this.uploadDir, fileKey);

      // Check if file exists first
      const exists = await this.verifyFileExists(fileKey);
      if (!exists) {
        console.log(`⚠️ File already deleted or not found: ${fileKey}`);
        return;
      }

      await fs.unlink(filePath);
      console.log(`✅ Deleted file: ${fileKey}`);
    } catch (error) {
      console.error("❌ Error deleting file:", error);
      throw new AppError(500, "DELETE_FAILED", "Failed to delete file");
    }
  }

  // ==========================================
  // VALIDATE IMAGE DIMENSIONS
  // ==========================================
  async validateImageDimensions(
    buffer: Buffer
  ): Promise<{ width: number; height: number }> {
    try {
      const metadata = await sharp(buffer).metadata();

      if (!metadata.width || !metadata.height) {
        throw new Error("Could not read image dimensions");
      }

      console.log(`✅ Image dimensions: ${metadata.width}x${metadata.height}`);

      // Check minimum dimensions for AR tracking
      if (metadata.width < 200 || metadata.height < 200) {
        throw new AppError(
          400,
          "IMAGE_TOO_SMALL",
          "Image must be at least 200x200 pixels for AR tracking"
        );
      }

      return {
        width: metadata.width,
        height: metadata.height,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(400, "INVALID_IMAGE", "Could not process image");
    }
  }

  // ==========================================
  // DEBUG: LIST DIRECTORY CONTENTS
  // ==========================================
  async debugListDirectory(dirPath: string = ""): Promise<string[]> {
    try {
      const fullPath = path.join(this.uploadDir, dirPath);
      const contents = await fs.readdir(fullPath, { withFileTypes: true });

      return contents.map((item) => {
        return item.isDirectory() ? `${item.name}/` : item.name;
      });
    } catch (error) {
      console.error("Error listing directory:", error);
      return [];
    }
  }

  // ==========================================
  // GENERATE PRESIGNED UPLOAD URL
  // ==========================================
  async getPresignedUploadUrl(
    userId: string,
    fileType: "target" | "content",
    mimeType: string,
    fileSize: number
  ): Promise<PresignedUrlData> {
    // Validate file size
    const maxSize =
      fileType === "target"
        ? config.upload.maxTargetImageSize
        : config.upload.maxFileSize;

    if (fileSize > maxSize) {
      throw new AppError(
        413,
        "FILE_TOO_LARGE",
        `File size exceeds limit of ${maxSize / 1024 / 1024}MB`
      );
    }

    // Validate MIME type
    this.validateMimeType(fileType, mimeType);

    // Generate unique file key
    const fileKey = this.generateFileKey(userId, fileType, mimeType);

    // For local storage, we return the upload endpoint
    const uploadUrl = `/api/v1/upload/file?fileKey=${encodeURIComponent(
      fileKey
    )}`;

    return {
      uploadUrl,
      fileKey,
      expiresIn: 3600, // 1 hour
    };
  }

  // ==========================================
  // VALIDATE MIME TYPE
  // ==========================================
  private validateMimeType(
    fileType: "target" | "content",
    mimeType: string
  ): void {
    let allowedTypes: string[];

    if (fileType === "target") {
      allowedTypes = config.upload.allowedImageTypes;
    } else {
      allowedTypes = [
        ...config.upload.allowedImageTypes,
        ...config.upload.allowedVideoTypes,
        ...config.upload.allowed3DTypes,
      ];
    }

    if (!allowedTypes.includes(mimeType)) {
      throw new AppError(
        400,
        "INVALID_FILE_TYPE",
        `File type ${mimeType} is not allowed. Allowed types: ${allowedTypes.join(
          ", "
        )}`
      );
    }
  }

  // ==========================================
  // GENERATE FILE KEY
  // ==========================================
  private generateFileKey(
    userId: string,
    fileType: string,
    mimeType: string
  ): string {
    const timestamp = Date.now();
    const randomId = uuidv4();
    const extension = this.getExtensionFromMimeType(mimeType);

    return `projects/${userId}/${fileType}/${timestamp}_${randomId}.${extension}`;
  }

  // ==========================================
  // GET EXTENSION FROM MIME TYPE
  // ==========================================
  private getExtensionFromMimeType(mimeType: string): string {
    const mimeToExt: { [key: string]: string } = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "video/mp4": "mp4",
      "video/quicktime": "mov",
      "model/gltf-binary": "glb",
      "model/gltf+json": "gltf",
    };

    return mimeToExt[mimeType] || "bin";
  }

  // ==========================================
  // OPTIMIZE TARGET IMAGE (post-upload)
  // ==========================================
  async optimizeTargetImage(fileKey: string): Promise<void> {
    try {
      const filePath = this.getFilePath(fileKey);
      const buffer = await fs.readFile(filePath);

      // Optimize image
      const optimized = await sharp(buffer)
        .resize(2048, 2048, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer();

      // Save optimized version
      await fs.writeFile(filePath, optimized);
      console.log(`✅ Optimized image: ${fileKey}`);
    } catch (error) {
      console.error("Error optimizing image:", error);
      // Don't throw error, just log it
    }
  }

  // ==========================================
  // CALCULATE FILE HASH
  // ==========================================
  calculateHash(buffer: Buffer): string {
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }
  // ==========================================
  // READ FILE
  // ==========================================
  async readFile(fileKey: string): Promise<Buffer> {
    try {
      const filePath = this.getFilePath(fileKey);
      return await fs.readFile(filePath);
    } catch (error) {
      throw new AppError(404, "FILE_NOT_FOUND", "File not found");
    }
  }
}
