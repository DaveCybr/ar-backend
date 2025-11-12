// ============================================
// FILE: src/services/analytics.service.ts
// Analytics tracking for AR app
// ============================================
import { DatabaseService } from "./database.service";
import { v4 as uuidv4 } from "uuid";

export interface TrackEventDTO {
  projectId: string;
  sessionId: string;
  deviceId?: string;
  eventType:
    | "qr_scan"
    | "project_load"
    | "ar_start"
    | "tracking_success"
    | "tracking_lost"
    | "content_play"
    | "content_pause"
    | "content_complete"
    | "ar_end";
  loadDuration?: number;
  trackingDuration?: number;
  trackingQualityAvg?: number;
  deviceModel?: string;
  osType?: string;
  osVersion?: string;
  appVersion?: string;
  countryCode?: string;
  city?: string;
  connectionType?: string;
  metadata?: any;
}

export class AnalyticsService {
  // ==========================================
  // TRACK EVENT
  // ==========================================
  static async trackEvent(data: TrackEventDTO): Promise<void> {
    try {
      await DatabaseService.query(
        `INSERT INTO ar_analytics (
          project_id, session_id, device_id, event_type,
          load_duration, tracking_duration, tracking_quality_avg,
          device_model, os_type, os_version, app_version,
          country_code, city, connection_type, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          data.projectId,
          data.sessionId,
          data.deviceId || null,
          data.eventType,
          data.loadDuration || null,
          data.trackingDuration || null,
          data.trackingQualityAvg || null,
          data.deviceModel || null,
          data.osType || null,
          data.osVersion || null,
          data.appVersion || null,
          data.countryCode || null,
          data.city || null,
          data.connectionType || null,
          data.metadata ? JSON.stringify(data.metadata) : null,
        ]
      );

      // Update project stats (async)
      this.updateProjectStats(
        data.projectId,
        data.eventType,
        data.sessionId
      ).catch((err) => console.error("Error updating project stats:", err));
    } catch (error) {
      console.error("Analytics tracking error:", error);
      // Don't throw - analytics shouldn't break app flow
    }
  }

  // ==========================================
  // UPDATE PROJECT STATS
  // ==========================================
  private static async updateProjectStats(
    projectId: string,
    eventType: string,
    sessionId: string
  ): Promise<void> {
    if (eventType === "ar_start") {
      // Increment view count
      await DatabaseService.query(
        `UPDATE ar_projects 
         SET view_count = view_count + 1, 
             last_viewed_at = NOW()
         WHERE id = $1`,
        [projectId]
      );

      // Update unique viewers (based on session)
      const uniqueCount = await DatabaseService.query(
        `SELECT COUNT(DISTINCT session_id) as count
         FROM ar_analytics
         WHERE project_id = $1 AND event_type = 'ar_start'`,
        [projectId]
      );

      await DatabaseService.query(
        "UPDATE ar_projects SET unique_viewers = $1 WHERE id = $2",
        [parseInt(uniqueCount.rows[0].count), projectId]
      );
    }
  }

  // ==========================================
  // TRACK BATCH EVENTS (for better performance)
  // ==========================================
  static async trackBatchEvents(events: TrackEventDTO[]): Promise<void> {
    if (events.length === 0) return;

    try {
      // Use transaction for batch insert
      await DatabaseService.transaction(async (client) => {
        for (const event of events) {
          await client.query(
            `INSERT INTO ar_analytics (
              project_id, session_id, device_id, event_type,
              load_duration, tracking_duration, tracking_quality_avg,
              device_model, os_type, os_version, app_version,
              country_code, city, connection_type, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              event.projectId,
              event.sessionId,
              event.deviceId || null,
              event.eventType,
              event.loadDuration || null,
              event.trackingDuration || null,
              event.trackingQualityAvg || null,
              event.deviceModel || null,
              event.osType || null,
              event.osVersion || null,
              event.appVersion || null,
              event.countryCode || null,
              event.city || null,
              event.connectionType || null,
              event.metadata ? JSON.stringify(event.metadata) : null,
            ]
          );
        }
      });

      console.log(`✅ Tracked ${events.length} events`);
    } catch (error) {
      console.error("Batch analytics error:", error);
    }
  }
}
