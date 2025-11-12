import { Pool, PoolClient, QueryResult } from "pg";
import { config } from "../config/config";

class Database {
  private pool: Pool | null = null;

  // ==========================================
  // CONNECT
  // ==========================================
  async connect(): Promise<void> {
    try {
      this.pool = new Pool({
        host: config.database.host,
        port: config.database.port,
        database: config.database.name,
        user: config.database.user,
        password: config.database.password,
        min: config.database.pool.min,
        max: config.database.pool.max,
        idleTimeoutMillis: config.database.pool.idleTimeoutMillis,
      });

      // Test connection
      const client = await this.pool.connect();
      await client.query("SELECT NOW()");
      client.release();

      console.log("✅ Database connected successfully");
    } catch (error) {
      console.error("❌ Database connection failed:", error);
      throw error;
    }
  }

  // ==========================================
  // QUERY
  // ==========================================
  async query(text: string, params?: any[]): Promise<QueryResult> {
    if (!this.pool) {
      throw new Error("Database not initialized. Call connect() first.");
    }

    const start = Date.now();

    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;

      // Log slow queries (> 1 second)
      if (duration > 1000) {
        console.warn(`⚠️ Slow query (${duration}ms):`, text);
      }

      return result;
    } catch (error) {
      console.error("❌ Query error:", error);
      console.error("Query:", text);
      console.error("Params:", params);
      throw error;
    }
  }

  // ==========================================
  // TRANSACTION
  // ==========================================
  async transaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    if (!this.pool) {
      throw new Error("Database not initialized");
    }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // ==========================================
  // CHECK CONNECTION
  // ==========================================
  async checkConnection(): Promise<boolean> {
    try {
      if (!this.pool) return false;
      const result = await this.pool.query("SELECT 1");
      return result.rows.length > 0;
    } catch (error) {
      return false;
    }
  }

  // ==========================================
  // DISCONNECT
  // ==========================================
  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      console.log("✅ Database disconnected");
    }
  }

  // ==========================================
  // GET CLIENT (for advanced usage)
  // ==========================================
  async getClient(): Promise<PoolClient> {
    if (!this.pool) {
      throw new Error("Database not initialized");
    }
    return this.pool.connect();
  }
}

export const DatabaseService = new Database();
