/**
 * Learning reports (Lessons Learned) for Retrospective Engine, persisted in Vercel Postgres.
 */

import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

export interface LearningReportRow {
  id: number;
  success_summary_he: string;
  key_lesson_he: string;
  action_taken_he: string;
  accuracy_pct: number;
  created_at: string;
}

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

export async function insertLearningReport(row: {
  success_summary_he: string;
  key_lesson_he: string;
  action_taken_he: string;
  accuracy_pct: number;
}): Promise<number> {
  if (!usePostgres()) return 0;
  try {
    const created = new Date().toISOString();
    const { rows } = await sql`
      INSERT INTO learning_reports (success_summary_he, key_lesson_he, action_taken_he, accuracy_pct, created_at)
      VALUES (${row.success_summary_he}, ${row.key_lesson_he}, ${row.action_taken_he}, ${row.accuracy_pct}, ${created})
      RETURNING id
    `;
    const id = (rows?.[0] as { id: number })?.id;
    return id != null ? Number(id) : 0;
  } catch (err) {
    console.error('insertLearningReport failed:', err);
    return 0;
  }
}

export async function getLatestLearningReports(limit = 10): Promise<LearningReportRow[]> {
  if (!usePostgres()) return [];
  try {
    const { rows } = await sql`
      SELECT id, success_summary_he, key_lesson_he, action_taken_he, accuracy_pct::float, created_at::text
      FROM learning_reports ORDER BY created_at DESC LIMIT ${limit}
    `;
    return (rows || []).map((r: Record<string, unknown>) => ({
      id: Number(r.id),
      success_summary_he: String(r.success_summary_he),
      key_lesson_he: String(r.key_lesson_he),
      action_taken_he: String(r.action_taken_he),
      accuracy_pct: Number(r.accuracy_pct),
      created_at: String(r.created_at),
    }));
  } catch (err) {
    console.error('getLatestLearningReports failed:', err);
    return [];
  }
}

/** Learning reports with created_at in the given range (inclusive). */
export async function getLearningReportsInRange(fromDate: string, toDate: string): Promise<LearningReportRow[]> {
  if (!usePostgres()) return [];
  try {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];
    const { rows } = await sql`
      SELECT id, success_summary_he, key_lesson_he, action_taken_he, accuracy_pct::float, created_at::text
      FROM learning_reports
      WHERE created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
      ORDER BY created_at DESC
    `;
    return (rows || []).map((r: Record<string, unknown>) => ({
      id: Number(r.id),
      success_summary_he: String(r.success_summary_he),
      key_lesson_he: String(r.key_lesson_he),
      action_taken_he: String(r.action_taken_he),
      accuracy_pct: Number(r.accuracy_pct),
      created_at: String(r.created_at),
    }));
  } catch (err) {
    console.error('getLearningReportsInRange failed:', err);
    return [];
  }
}
