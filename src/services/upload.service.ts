// ============================================
// FILE: src/services/upload.service.ts
// File upload with Cloudinary & Local storage
// ============================================
import sharp from "sharp";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import { v2 as cloudinary } from "cloudinary";
import { config } from "../config/config";
import { AppError } from "../middleware/errorHandler";

export interface PresignedUrlData {
  uploadUrl: string;
  fileKey: string;
  expiresIn: number;
}

export class UploadService {
  private static instance: UploadService;
  private uploadDir: string = "";
  private baseUrl: string = "";
  private initialized: boolean = false;
  private useCloudStorage: boolean = false;

  private constructor() {
    const isProduction = process.env.NODE_ENV === "production";

    // Check if Cloudinary is configured
    this.useCloudStorage = !!(
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    );

    if (this.useCloudStorage) {
      // Configure Cloudinary
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true,
      });
      console.log("☁️  Using Cloudinary for file storage");
    } else {
      this.uploadDir =
        process.env.UPLOAD_PATH ||
        (isProduction ? "/app/uploads" : path.join(process.cwd(), "uploads"));
      console.log("💾 Using local storage for files");
    }

    this.baseUrl =
      process.env.BASE_URL ||
      config.app?.baseUrl ||
      `http://localhost:${process.env.PORT || 3000}`;
  }

  // Singleton instance
  public static getInstance(): UploadService {
    if (!UploadService.instance) {
      UploadService.instance = new UploadService();
      UploadService.instance.initialize();
    }
    return UploadService.instance;
  }

  // Initialize only once
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log("📁 Upload Service Configuration:", {
      environment: process.env.NODE_ENV,
      storageType: this.useCloudStorage ? "cloudinary" : "local",
      uploadDir: this.useCloudStorage ? "cloudinary" : this.uploadDir,
      baseUrl: this.baseUrl,
    });

    if (!this.useCloudStorage) {
      await this.ensureUploadDirExists();
    }

    this.initialized = true;
  }

  // ==========================================
  // ENSURE UPLOAD DIRECTORY EXISTS (Local only)
  // ==========================================
  private async ensureUploadDirExists(): Promise<void> {
    try {
      await fs.mkdir(this.uploadDir, { recursive: true });
      const projectsDir = path.join(this.uploadDir, "projects");
      await fs.mkdir(projectsDir, { recursive: true });
      await fs.access(this.uploadDir, fs.constants.W_OK);

      console.log(`✅ Upload directory ready: ${this.uploadDir}`);

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
  // SAVE FILE (Cloud or Local)
  // ==========================================
  async saveFile(fileKey: string, buffer: Buffer): Promise<void> {
    if (this.useCloudStorage) {
      await this.saveToCloudinary(fileKey, buffer);
    } else {
      await this.saveLocally(fileKey, buffer);
    }
  }

  // ==========================================
  // SAVE TO LOCAL STORAGE
  // ==========================================
  private async saveLocally(fileKey: string, buffer: Buffer): Promise<void> {
    const filePath = path.join(this.uploadDir, fileKey);
    const directory = path.dirname(filePath);

    try {
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(filePath, buffer);

      const stats = await fs.stat(filePath);
      console.log(`✅ Saved file locally: ${fileKey}`, {
        size: stats.size,
        url: this.getFileUrl(fileKey),
      });

      await fs.access(filePath, fs.constants.R_OK);
    } catch (error) {
      console.error("❌ Error saving file locally:", error);
      throw new AppError(500, "SAVE_FAILED", `Failed to save file: ${error}`);
    }
  }

  // ==========================================
  // SAVE TO CLOUDINARY
  // ==========================================
  private async saveToCloudinary(
    fileKey: string,
    buffer: Buffer
  ): Promise<void> {
    try {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: "ar-backend",
            public_id: fileKey.replace(/\//g, "_").replace(/\.[^/.]+$/, ""),
            resource_type: "auto",
            overwrite: true,
          },
          (error, result) => {
            if (error) {
              console.error("❌ Cloudinary upload error:", error);
              reject(
                new AppError(500, "UPLOAD_FAILED", "Failed to upload to cloud")
              );
            } else {
              console.log(`✅ Saved file to Cloudinary: ${fileKey}`, {
                url: result?.secure_url,
                size: result?.bytes,
              });
              resolve();
            }
          }
        );

        uploadStream.end(buffer);
      });
    } catch (error) {
      console.error("❌ Error saving to Cloudinary:", error);
      throw new AppError(500, "SAVE_FAILED", `Failed to save file: ${error}`);
    }
  }

  // ==========================================
  // VERIFY FILE EXISTS
  // ==========================================
  async verifyFileExists(fileKey: string): Promise<boolean> {
    if (this.useCloudStorage) {
      try {
        const publicId = `ar-backend/${fileKey
          .replace(/\//g, "_")
          .replace(/\.[^/.]+$/, "")}`;
        await cloudinary.api.resource(publicId, { resource_type: "image" });
        return true;
      } catch (error) {
        // Try video if image fails
        try {
          const publicId = `ar-backend/${fileKey
            .replace(/\//g, "_")
            .replace(/\.[^/.]+$/, "")}`;
          await cloudinary.api.resource(publicId, { resource_type: "video" });
          return true;
        } catch {
          return false;
        }
      }
    } else {
      try {
        const filePath = path.join(this.uploadDir, fileKey);
        await fs.access(filePath, fs.constants.R_OK);
        return true;
      } catch (error) {
        return false;
      }
    }
  }

  // ==========================================
  // GET FILE URL
  // ==========================================
  getFileUrl(fileKey: string): string {
    if (this.useCloudStorage) {
      const publicId = `ar-backend/${fileKey
        .replace(/\//g, "_")
        .replace(/\.[^/.]+$/, "")}`;

      // Determine resource type from file extension
      const ext = path.extname(fileKey).toLowerCase();
      const resourceType = [".mp4", ".mov", ".avi"].includes(ext)
        ? "video"
        : "image";

      return cloudinary.url(publicId, {
        resource_type: resourceType,
        secure: true,
        quality: "auto",
        fetch_format: "auto",
      });
    } else {
      return `/uploads/${fileKey}`;
    }
  }

  // ==========================================
  // GET ABSOLUTE FILE URL
  // ==========================================
  getAbsoluteFileUrl(fileKey: string): string {
    if (this.useCloudStorage) {
      return this.getFileUrl(fileKey); // Cloudinary returns full URL
    } else {
      return `${this.baseUrl}/uploads/${fileKey}`;
    }
  }

  // ==========================================
  // GET FILE PATH (Local only)
  // ==========================================
  getFilePath(fileKey: string): string {
    if (this.useCloudStorage) {
      throw new Error("File path not available for cloud storage");
    }
    return path.join(this.uploadDir, fileKey);
  }

  // ==========================================
  // DELETE FILE
  // ==========================================
  async deleteFile(fileKey: string): Promise<void> {
    if (this.useCloudStorage) {
      try {
        const publicId = `ar-backend/${fileKey
          .replace(/\//g, "_")
          .replace(/\.[^/.]+$/, "")}`;
        await cloudinary.uploader.destroy(publicId, { invalidate: true });
        console.log(`✅ Deleted file from Cloudinary: ${fileKey}`);
      } catch (error) {
        console.error("❌ Error deleting from Cloudinary:", error);
        throw new AppError(500, "DELETE_FAILED", "Failed to delete file");
      }
    } else {
      try {
        const filePath = path.join(this.uploadDir, fileKey);
        const exists = await this.verifyFileExists(fileKey);

        if (!exists) {
          console.log(`⚠️  File already deleted or not found: ${fileKey}`);
          return;
        }

        await fs.unlink(filePath);
        console.log(`✅ Deleted file locally: ${fileKey}`);
      } catch (error) {
        console.error("❌ Error deleting file:", error);
        throw new AppError(500, "DELETE_FAILED", "Failed to delete file");
      }
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

    this.validateMimeType(fileType, mimeType);
    const fileKey = this.generateFileKey(userId, fileType, mimeType);
    const uploadUrl = `/api/v1/upload/file?fileKey=${encodeURIComponent(
      fileKey
    )}`;

    return {
      uploadUrl,
      fileKey,
      expiresIn: 3600,
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
        `File type ${mimeType} is not allowed`
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
  // OPTIMIZE TARGET IMAGE
  // ==========================================
  async optimizeTargetImage(fileKey: string): Promise<void> {
    try {
      if (this.useCloudStorage) {
        console.log(
          `ℹ️  Skipping optimization for cloud storage (handled by Cloudinary): ${fileKey}`
        );
        return;
      }

      const filePath = this.getFilePath(fileKey);
      const buffer = await fs.readFile(filePath);

      const optimized = await sharp(buffer)
        .resize(2048, 2048, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer();

      await fs.writeFile(filePath, optimized);
      console.log(`✅ Optimized image: ${fileKey}`);
    } catch (error) {
      console.error("Error optimizing image:", error);
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

      console.log(`✅ Image dimensions: ${metadata.width}x${metadata.height}`);

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
  // READ FILE (Local only)
  // ==========================================
  async readFile(fileKey: string): Promise<Buffer> {
    if (this.useCloudStorage) {
      throw new Error(
        "Reading files directly not supported for cloud storage. Use getFileUrl() instead."
      );
    }

    try {
      const filePath = this.getFilePath(fileKey);
      return await fs.readFile(filePath);
    } catch (error) {
      throw new AppError(404, "FILE_NOT_FOUND", "File not found");
    }
  }
}

// Export singleton instance
export default UploadService.getInstance();
