import dotenv from "dotenv";

dotenv.config();

export const config = {
  app: {
    env: process.env.NODE_ENV || "development",
    port: parseInt(process.env.PORT || "3000"),
    version: process.env.APP_VERSION || "1.0.0",
    baseUrl: process.env.BASE_URL || "http://localhost:3000",
  },

  database: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    name: process.env.DB_NAME || "ar_system",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    pool: {
      min: 2,
      max: 10,
      idleTimeoutMillis: 30000,
    },
  },

  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    ttl: 3600,
    url: process.env.REDIS_URL || "",
  },

  jwt: {
    secret: process.env.JWT_SECRET || "change-this-secret",
    expiresIn: process.env.JWT_EXPIRES_IN || "15m",
    refreshSecret:
      process.env.JWT_REFRESH_SECRET || "change-this-refresh-secret",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },

  aws: {
    region: process.env.AWS_REGION || "us-east-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    s3: {
      bucket: process.env.S3_BUCKET || "ar-projects-bucket",
      uploadExpiry: 3600,
    },
  },

  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || "104857600"), // 100MB
    maxTargetImageSize: parseInt(
      process.env.MAX_TARGET_IMAGE_SIZE || "10485760"
    ), // 10MB
    allowedImageTypes: ["image/jpeg", "image/png"],
    allowedVideoTypes: ["video/mp4", "video/quicktime"],
    allowed3DTypes: ["model/gltf-binary", "model/gltf+json"],
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000"), // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100"),
  },

  cors: {
    allowedOrigins: (
      process.env.ALLOWED_ORIGINS || "http://localhost:3000"
    ).split(","),
  },
};
