// ============================================
// FILE: src/services/upload.service.ts
// File upload & S3 management
// ============================================
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config/config";
import { AppError } from "../middleware/errorHandler";

export interface PresignedUrlData {
  uploadUrl: string;
  fileKey: string;
  expiresIn: number;
}

export class UploadService {
  private s3: S3Client;

  constructor() {
    this.s3 = new S3Client({
      region: config.aws.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
    });
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

    // Create presigned URL
    const command = new PutObjectCommand({
      Bucket: config.aws.s3.bucket,
      Key: fileKey,
      ContentType: mimeType,
      ContentLength: fileSize,
      Metadata: {
        userId,
        fileType,
        uploadedAt: new Date().toISOString(),
      },
    });

    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: config.aws.s3.uploadExpiry,
    });

    return {
      uploadUrl,
      fileKey,
      expiresIn: config.aws.s3.uploadExpiry,
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
  // VERIFY FILE EXISTS
  // ==========================================
  async verifyFileExists(fileKey: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: config.aws.s3.bucket,
        Key: fileKey,
      });

      await this.s3.send(command);
      return true;
    } catch (error: any) {
      if (error.name === "NotFound") {
        return false;
      }
      throw error;
    }
  }

  // ==========================================
  // GET FILE URL
  // ==========================================
  getFileUrl(fileKey: string): string {
    return `https://${config.aws.s3.bucket}.s3.${config.aws.region}.amazonaws.com/${fileKey}`;
  }

  // ==========================================
  // DELETE FILE
  // ==========================================
  async deleteFile(fileKey: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: config.aws.s3.bucket,
        Key: fileKey,
      });

      await this.s3.send(command);
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
    // Note: This would require downloading the image from S3,
    // processing it, and re-uploading. For MVP, we skip this
    // and do optimization client-side before upload.

    // TODO: Implement image optimization pipeline
    console.log(`⚠️ Image optimization not implemented yet for: ${fileKey}`);
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
}
