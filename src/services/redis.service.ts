// ============================================
// FILE: src/services/redis.service.ts
// Redis connection & caching
// ============================================
import Redis from "ioredis";
import { config } from "../config/config";

class RedisClient {
  private client: Redis | null = null;

  // ==========================================
  // CONNECT
  // ==========================================
  async connect(): Promise<void> {
    try {
      this.client = new Redis({
        // host: config.redis.host,
        // port: config.redis.port,
        url: config.redis.url || undefined,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 2,
      });

      this.client.on("error", (error) => {
        console.error("❌ Redis error:", error);
      });

      this.client.on("connect", () => {
        console.log("✅ Redis connected");
      });

      // Test connection
      await this.client.ping();
    } catch (error) {
      console.error("❌ Redis connection failed:", error);
      throw error;
    }
  }

  // ==========================================
  // GET
  // ==========================================
  async get(key: string): Promise<string | null> {
    if (!this.client) {
      throw new Error("Redis not initialized");
    }

    try {
      return await this.client.get(key);
    } catch (error) {
      console.error("Redis GET error:", error);
      return null;
    }
  }

  // ==========================================
  // SET
  // ==========================================
  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (!this.client) {
      throw new Error("Redis not initialized");
    }

    try {
      if (ttl) {
        await this.client.setex(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      console.error("Redis SET error:", error);
    }
  }

  // ==========================================
  // DELETE
  // ==========================================
  async delete(key: string): Promise<void> {
    if (!this.client) {
      throw new Error("Redis not initialized");
    }

    try {
      await this.client.del(key);
    } catch (error) {
      console.error("Redis DELETE error:", error);
    }
  }

  // ==========================================
  // EXISTS
  // ==========================================
  async exists(key: string): Promise<boolean> {
    if (!this.client) {
      throw new Error("Redis not initialized");
    }

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      console.error("Redis EXISTS error:", error);
      return false;
    }
  }

  // ==========================================
  // GET JSON
  // ==========================================
  async getJSON<T>(key: string): Promise<T | null> {
    const value = await this.get(key);
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch (error) {
      console.error("Redis JSON parse error:", error);
      return null;
    }
  }

  // ==========================================
  // SET JSON
  // ==========================================
  async setJSON(key: string, value: any, ttl?: number): Promise<void> {
    try {
      const jsonString = JSON.stringify(value);
      await this.set(key, jsonString, ttl);
    } catch (error) {
      console.error("Redis JSON stringify error:", error);
    }
  }

  // ==========================================
  // INCREMENT
  // ==========================================
  async increment(key: string, amount: number = 1): Promise<number> {
    if (!this.client) {
      throw new Error("Redis not initialized");
    }

    try {
      return await this.client.incrby(key, amount);
    } catch (error) {
      console.error("Redis INCREMENT error:", error);
      return 0;
    }
  }

  // ==========================================
  // EXPIRE (set TTL on existing key)
  // ==========================================
  async expire(key: string, seconds: number): Promise<void> {
    if (!this.client) {
      throw new Error("Redis not initialized");
    }

    try {
      await this.client.expire(key, seconds);
    } catch (error) {
      console.error("Redis EXPIRE error:", error);
    }
  }

  // ==========================================
  // PING (health check)
  // ==========================================
  async ping(): Promise<boolean> {
    if (!this.client) return false;

    try {
      const result = await this.client.ping();
      return result === "PONG";
    } catch (error) {
      return false;
    }
  }

  // ==========================================
  // DISCONNECT
  // ==========================================
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      console.log("✅ Redis disconnected");
    }
  }

  // ==========================================
  // CACHE WRAPPER
  // ==========================================
  async cache<T>(
    key: string,
    ttl: number,
    fetchFunction: () => Promise<T>
  ): Promise<T> {
    // Try to get from cache
    const cached = await this.getJSON<T>(key);
    if (cached !== null) {
      console.log(`📦 Cache hit: ${key}`);
      return cached;
    }

    // Cache miss - fetch data
    console.log(`📭 Cache miss: ${key}`);
    const data = await fetchFunction();

    // Store in cache
    await this.setJSON(key, data, ttl);

    return data;
  }

  // ==========================================
  // RATE LIMITING
  // ==========================================
  async checkRateLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number }> {
    if (!this.client) {
      throw new Error("Redis not initialized");
    }

    try {
      const current = await this.increment(key);

      if (current === 1) {
        // First request - set expiry
        await this.expire(key, windowSeconds);
      }

      const allowed = current <= maxRequests;
      const remaining = Math.max(0, maxRequests - current);

      return { allowed, remaining };
    } catch (error) {
      console.error("Rate limit check error:", error);
      // Fail open - allow request
      return { allowed: true, remaining: maxRequests };
    }
  }
}

export const RedisService = new RedisClient();
