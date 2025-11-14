// ============================================
// FILE: src/services/upload.service.ts
// File upload & Local storage management
// ============================================
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

  constructor() {
    // Base upload directory
    this.uploadDir = path.join(process.cwd(), "uploads");
    this.ensureUploadDirExists();
  }

  // ==========================================
  // ENSURE UPLOAD DIRECTORY EXISTS
  // ==========================================
  private async ensureUploadDirExists(): Promise<void> {
    try {
      await fs.mkdir(this.uploadDir, { recursive: true });
      await fs.mkdir(path.join(this.uploadDir, "projects"), {
        recursive: true,
      });
      console.log(`✅ Upload directory ready: ${this.uploadDir}`);
    } catch (error) {
      console.error("Error creating upload directory:", error);
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
      console.log(`✅ Saved file: ${fileKey}`);
    } catch (error) {
      console.error("Error saving file:", error);
      throw new AppError(500, "SAVE_FAILED", "Failed to save file");
    }
  }

  // ==========================================
  // VERIFY FILE EXISTS
  // ==========================================
  async verifyFileExists(fileKey: string): Promise<boolean> {
    try {
      const filePath = path.join(this.uploadDir, fileKey);
      await fs.access(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  // ==========================================
  // GET FILE URL
  // ==========================================
  getFileUrl(fileKey: string): string {
    // Return URL to serve the file
    return `/uploads/${fileKey}`;
  }

  // ==========================================
  // GET FILE PATH
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
      await fs.unlink(filePath);
      console.log(`✅ Deleted file: ${fileKey}`);
    } catch (error) {
      console.error("Error deleting file:", error);
      throw new AppError(500, "DELETE_FAILED", "Failed to delete file");
    }
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
