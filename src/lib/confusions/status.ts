import type { Db } from '../db/types';

/**
 * Set a Confused mark's status from its questions (design doc section 4): Resolved when
 * all its questions are retired, otherwise Explained. Marks with no active or retired
 * questions are left alone.
 */
export async function updateMarkResolution(db: Db, markId: number): Promise<void> {
  const r = await db.first<{ total: number; open: number }>(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN retired_at IS NULL THEN 1 ELSE 0 END) AS open
     FROM questions WHERE mark_id = ? AND removed_at IS NULL`,
    [markId],
  );
  if (!r?.total) return;
  await db.run("UPDATE marks SET status = ? WHERE id = ? AND kind = 'confused'", [
    r.open ? 'explained' : 'resolved',
    markId,
  ]);
}
