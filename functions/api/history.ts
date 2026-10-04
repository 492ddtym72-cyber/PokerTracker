import type { Env } from "../auth";
import {
  auditSummary,
  buildAuditChanges,
  parseSnapshot,
  type AuditEventType,
} from "../lib/audit";
import { json } from "../lib/http";

interface AuditRow {
  id: string;
  event_type: AuditEventType;
  entity_id: string;
  created_at: string;
  before_json: string | null;
  after_json: string | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") ?? 40);
  const requestedOffset = Number(url.searchParams.get("offset") ?? 0);

  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 40;
  const offset = Number.isInteger(requestedOffset)
    ? Math.max(requestedOffset, 0)
    : 0;

  const [eventsQuery, countRow] = await Promise.all([
    env.DB.prepare(
      `SELECT id, event_type, entity_id, created_at, before_json, after_json
       FROM audit_events
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    ).bind(limit, offset).all<AuditRow>(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM audit_events")
      .first<{ total: number }>(),
  ]);

  const events = eventsQuery.results.map((row) => {
    const before = parseSnapshot(row.before_json);
    const after = parseSnapshot(row.after_json);
    const reference = after ?? before;

    return {
      id: row.id,
      eventType: row.event_type,
      entityId: row.entity_id,
      createdAt: row.created_at,
      ...auditSummary(reference),
      changes: buildAuditChanges(before, after),
    };
  });

  const total = Number(countRow?.total ?? 0);

  return json({
    events,
    pagination: {
      offset,
      limit,
      total,
      hasMore: offset + events.length < total,
    },
  });
};
