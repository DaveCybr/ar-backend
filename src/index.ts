// ============================================
// FILE: src/index.ts
// Main entry point
// ============================================
import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import { config } from "./config/config";
import { DatabaseService } from "./services/database.service";
import { RedisService } from "./services/redis.service";
import routes from "./routes";
import { requestLogger } from "./middleware/logger";
import { Server } from "http";

const app: Application = express();
let server: Server | null = null;
app.set("trust proxy", 1);

// ============================================
// ENVIRONMENT DETECTION
// ============================================
const isProduction = config.app.env === "production";
const uploadsPath =
  process.env.UPLOAD_PATH ||
  (isProduction ? "/app/uploads" : path.join(__dirname, "../uploads"));

console.log("📁 Environment Configuration:", {
  environment: config.app.env,
  uploadsPath,
  absolutePath: path.resolve(uploadsPath),
  exists: fs.existsSync(uploadsPath),
  baseUrl: process.env.BASE_URL || config.app.baseUrl,
});

// Ensure uploads directory exists
try {
  if (!fs.existsSync(uploadsPath)) {
    fs.mkdirSync(uploadsPath, { recursive: true });
    fs.mkdirSync(path.join(uploadsPath, "projects"), { recursive: true });
    console.log("✅ Created uploads directory");
  } else {
    // Verify it's writable
    fs.accessSync(uploadsPath, fs.constants.W_OK);
    console.log("✅ Upload directory accessible and writable");
  }
} catch (error) {
  console.error("❌ Upload directory error:", error);
  process.exit(1);
}

// ============================================
// SECURITY MIDDLEWARE
// ============================================
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  })
);

app.use(
  cors({
    origin: config.cors.allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", limiter);

// ============================================
// PARSING & LOGGING
// ============================================
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ============================================
// DEBUG MIDDLEWARE FOR STATIC FILES (Development only)
// ============================================
if (!isProduction) {
  // Custom middleware untuk log static file requests
  // HARUS sebelum express.static
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/uploads/")) {
      const requestedPath = req.path.replace("/uploads/", "");
      const fullPath = path.join(uploadsPath, requestedPath);
      const exists = fs.existsSync(fullPath);

      console.log("📁 Static file request:", {
        url: req.url,
        requestedPath,
        fullPath,
        exists,
      });

      if (!exists) {
        console.error("❌ File not found:", fullPath);

        // Try to find similar files in directory
        const dir = path.dirname(fullPath);
        if (fs.existsSync(dir)) {
          try {
            const files = fs.readdirSync(dir);
            console.log("📂 Available files in directory:", files.slice(0, 10));
          } catch (error) {
            console.error("Cannot read directory:", error);
          }
        } else {
          console.log("📂 Directory does not exist:", dir);
        }
      }
    }
    next();
  });
}

// Request logger (setelah debug middleware)
app.use(requestLogger);

// ============================================
// SERVE UPLOADED FILES
// ============================================
app.use(
  "/uploads",
  express.static(uploadsPath, {
    dotfiles: "ignore",
    etag: true,
    extensions: ["png", "jpg", "jpeg", "gif", "mp4", "mov", "glb", "gltf"],
    index: false,
    maxAge: isProduction ? "7d" : "1h",
    lastModified: true,
    redirect: false,
    setHeaders: (res, filePath) => {
      // Set proper content type
      const ext = path.extname(filePath).toLowerCase();
      const contentTypes: { [key: string]: string } = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
      };

      if (contentTypes[ext]) {
        res.setHeader("Content-Type", contentTypes[ext]);
      }

      // CORS headers for media files
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

      // Cache control
      const cacheMaxAge = isProduction ? 604800 : 3600; // 7 days : 1 hour
      res.setHeader("Cache-Control", `public, max-age=${cacheMaxAge}`);
    },
  })
);

// ============================================
// HEALTH CHECK
// ============================================
app.get("/health", async (req: Request, res: Response) => {
  const dbHealthy = await DatabaseService.checkConnection();
  const redisHealthy = await RedisService.ping();

  // Check storage
  let storageHealthy = false;
  try {
    await fs.promises.access(uploadsPath, fs.constants.W_OK);
    storageHealthy = true;
  } catch (error) {
    console.error("Storage not writable:", error);
  }

  const health = {
    status:
      dbHealthy && redisHealthy && storageHealthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: dbHealthy ? "up" : "down",
      redis: redisHealthy ? "up" : "down",
      storage: storageHealthy ? "up" : "down",
    },
    storage: {
      path: uploadsPath,
      writable: storageHealthy,
    },
    version: config.app.version,
    environment: config.app.env,
  };

  res.status(health.status === "healthy" ? 200 : 503).json(health);
});

// ============================================
// DEBUG ENDPOINT (Development only)
// ============================================
if (!isProduction) {
  app.get("/api/v1/debug/storage", (req: Request, res: Response) => {
    try {
      const listDirectory = (dir: string): any => {
        if (!fs.existsSync(dir)) {
          return { exists: false, path: dir };
        }

        const items = fs.readdirSync(dir, { withFileTypes: true });
        return {
          exists: true,
          path: dir,
          items: items.map((item) => ({
            name: item.name,
            type: item.isDirectory() ? "directory" : "file",
            size: item.isFile()
              ? fs.statSync(path.join(dir, item.name)).size
              : null,
          })),
        };
      };

      res.json({
        uploadsPath,
        absolutePath: path.resolve(uploadsPath),
        exists: fs.existsSync(uploadsPath),
        directories: {
          root: listDirectory(uploadsPath),
          projects: listDirectory(path.join(uploadsPath, "projects")),
        },
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
}

// ============================================
// DEBUG ENDPOINT (Temporarily enable in production)
// ============================================
app.get("/api/v1/debug/storage", async (req: Request, res: Response) => {
  try {
    const listDirectory = (dir: string): any => {
      if (!fs.existsSync(dir)) {
        return { exists: false, path: dir };
      }

      const items = fs.readdirSync(dir, { withFileTypes: true });
      return {
        exists: true,
        path: dir,
        items: items.slice(0, 20).map((item) => ({
          name: item.name,
          type: item.isDirectory() ? "directory" : "file",
          size: item.isFile()
            ? fs.statSync(path.join(dir, item.name)).size
            : null,
        })),
        totalItems: items.length,
      };
    };

    // Check specific user directory
    const userId = "ff8cdb53-250e-4294-8796-de90fd21a35d";
    const userTargetPath = path.join(uploadsPath, "projects", userId, "target");

    res.json({
      uploadsPath,
      absolutePath: path.resolve(uploadsPath),
      exists: fs.existsSync(uploadsPath),
      writable:
        fs.existsSync(uploadsPath) &&
        (() => {
          try {
            fs.accessSync(uploadsPath, fs.constants.W_OK);
            return true;
          } catch {
            return false;
          }
        })(),
      directories: {
        root: listDirectory(uploadsPath),
        projects: listDirectory(path.join(uploadsPath, "projects")),
        userDir: listDirectory(path.join(uploadsPath, "projects", userId)),
        targetDir: listDirectory(userTargetPath),
      },
      specificFile: {
        path: path.join(
          userTargetPath,
          "1765010450633_27e46030-3045-468d-af8a-ddf3554ca206.png"
        ),
        exists: fs.existsSync(
          path.join(
            userTargetPath,
            "1765010450633_27e46030-3045-468d-af8a-ddf3554ca206.png"
          )
        ),
      },
    });
  } catch (error) {
    res.status(500).json({
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
});

// Additional debug: list ALL files recursively
app.get("/api/v1/debug/storage/tree", async (req: Request, res: Response) => {
  try {
    const getAllFiles = (dir: string, fileList: string[] = []): string[] => {
      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
          getAllFiles(filePath, fileList);
        } else {
          fileList.push(filePath);
        }
      });
      return fileList;
    };

    const allFiles = getAllFiles(uploadsPath);

    res.json({
      totalFiles: allFiles.length,
      files: allFiles.map((f) => ({
        path: f,
        relativePath: f.replace(uploadsPath, ""),
        size: fs.statSync(f).size,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================
// API ROUTES
// ============================================
app.use("/api/v1", routes);

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: "Endpoint not found",
      path: req.path,
    },
  });
});

// ============================================
// ERROR HANDLER
// ============================================
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("❌ Error:", err);

  res.status(err.status || 500).json({
    success: false,
    error: {
      code: err.code || "INTERNAL_ERROR",
      message: err.message || "Internal server error",
      ...(config.app.env === "development" && { stack: err.stack }),
    },
  });
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
const gracefulShutdown = async (signal: string) => {
  console.log(`\n⚠️  ${signal} received, shutting down gracefully...`);

  if (server) {
    server.close(async () => {
      console.log("✅ HTTP server closed");

      try {
        await DatabaseService.disconnect();
        console.log("✅ Database disconnected");
      } catch (error) {
        console.error("❌ Database disconnect error:", error);
      }

      try {
        await RedisService.disconnect();
        console.log("✅ Redis disconnected");
      } catch (error) {
        console.error("❌ Redis disconnect error:", error);
      }

      console.log("👋 All connections closed. Goodbye!");
      process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      console.error("⚠️  Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  } else {
    console.log("No HTTP server to close, exiting...");
    await DatabaseService.disconnect();
    await RedisService.disconnect();
    process.exit(0);
  }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown("UNHANDLED_REJECTION");
});

// ============================================
// START SERVER
// ============================================
const PORT = config.app.port;

const startServer = async () => {
  try {
    console.log("\n" + "=".repeat(60));
    console.log("🚀 Starting AR Backend Server...");
    console.log("=".repeat(60));

    // Initialize database connection
    await DatabaseService.connect();
    console.log("✅ Database connected");

    // Initialize Redis
    await RedisService.connect();
    console.log("✅ Redis connected");

    // Start HTTP server
    server = app.listen(PORT, () => {
      console.log("-".repeat(60));
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 Environment: ${config.app.env}`);
      console.log(`📍 Version: ${config.app.version}`);
      console.log("-".repeat(60));
      console.log("📡 Endpoints:");
      console.log(`   Health:  http://localhost:${PORT}/health`);
      console.log(`   API:     http://localhost:${PORT}/api/v1`);
      console.log(`   Uploads: http://localhost:${PORT}/uploads`);
      if (!isProduction) {
        console.log(
          `   Debug:   http://localhost:${PORT}/api/v1/debug/storage`
        );
      }
      console.log("=".repeat(60) + "\n");
    });

    // Handle server errors
    server.on("error", (error: any) => {
      if (error.code === "EADDRINUSE") {
        console.error(`❌ Port ${PORT} is already in use`);
      } else {
        console.error("❌ Server error:", error);
      }
      process.exit(1);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

export default app;
