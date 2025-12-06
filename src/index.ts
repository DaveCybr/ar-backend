// ============================================
// FILE: src/index.ts
// Main entry point
// ============================================
import express, { Application, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
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
// SECURITY MIDDLEWARE
// ============================================
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
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
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
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
app.use(requestLogger);

// ============================================
// SERVE UPLOADED FILES (BEFORE API ROUTES!)
// ============================================
app.use(
  "/uploads",
  express.static(path.join(__dirname, "../uploads"), {
    maxAge: "1d", // Cache for 1 day
    etag: true,
    lastModified: true,
  })
);

// ============================================
// HEALTH CHECK
// ============================================
app.get("/health", async (req: Request, res: Response) => {
  const dbHealthy = await DatabaseService.checkConnection();
  const redisHealthy = await RedisService.ping();

  const health = {
    status: dbHealthy && redisHealthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: dbHealthy ? "up" : "down",
      redis: redisHealthy ? "up" : "down",
    },
    version: config.app.version,
    environment: config.app.env,
  };

  res.status(health.status === "healthy" ? 200 : 503).json(health);
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
    },
  });
});

// ============================================
// ERROR HANDLER
// ============================================
// ============================================
// GRACEFUL SHUTDOWN
// ============================================
const gracefulShutdown = async (signal: string) => {
  console.log(`\n${signal} received, shutting down gracefully...`);

  if (server) {
    server.close(async () => {
      console.log("HTTP server closed");

      await DatabaseService.disconnect();
      await RedisService.disconnect();

      console.log("All connections closed");
      process.exit(0);
    });

    setTimeout(() => {
      console.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  } else {
    console.log("No HTTP server to close, exiting");
    await DatabaseService.disconnect();
    await RedisService.disconnect();
    process.exit(0);
  }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ============================================
// START SERVER
// ============================================
const PORT = config.app.port;

const startServer = async () => {
  try {
    // Initialize database connection
    await DatabaseService.connect();
    console.log("✅ Database connected");

    // Initialize Redis
    await RedisService.connect();
    console.log("✅ Redis connected");

    // Start server
    server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 Environment: ${config.app.env}`);
      console.log(`📍 Health check: http://localhost:${PORT}/health`);
      console.log(`📁 Static files: http://localhost:${PORT}/uploads`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
