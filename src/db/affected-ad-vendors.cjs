const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'affected-ad-vendors.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = null;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initializeSchema(db);
  }
  return db;
}

function initializeSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS affected_ad_vendors_hosts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id TEXT NOT NULL,
      publisher_id TEXT NOT NULL,
      vendor_host TEXT NOT NULL,
      ad_slot_id TEXT NOT NULL,
      impressions INTEGER NOT NULL DEFAULT 0,
      first_seen_ts TEXT,
      last_seen_ts TEXT,
      unique_event_fingerprints INTEGER NOT NULL DEFAULT 0,
      duplicate_event_count INTEGER NOT NULL DEFAULT 0,
      duplication_rate REAL NOT NULL DEFAULT 0,
      max_impressions_per_second REAL NOT NULL DEFAULT 0,
      median_inter_event_ms REAL,
      burst_events_1s INTEGER NOT NULL DEFAULT 0,
      tiny_frame_count INTEGER,
      stacking_suspected INTEGER NOT NULL DEFAULT 0,
      brand_guess TEXT,
      brand_confidence REAL,
      brand_method TEXT NOT NULL DEFAULT 'none',
      ai_verdict_status TEXT,
      ai_rationale TEXT,
      ai_validator_model TEXT,
      ai_verdict_at TEXT,
      ai_job_id TEXT,
      UNIQUE(scan_id, publisher_id, vendor_host, ad_slot_id)
    );

    CREATE INDEX IF NOT EXISTS idx_affected_scan_pub ON affected_ad_vendors_hosts(scan_id, publisher_id);
    CREATE INDEX IF NOT EXISTS idx_affected_impressions ON affected_ad_vendors_hosts(impressions DESC);
  `);
}

function persistAggregates(scanId, publisherId, aggregates) {
  const database = getDb();
  const insert = database.prepare(`
    INSERT INTO affected_ad_vendors_hosts (
      scan_id, publisher_id, vendor_host, ad_slot_id, impressions, first_seen_ts, last_seen_ts,
      unique_event_fingerprints, duplicate_event_count, duplication_rate,
      max_impressions_per_second, median_inter_event_ms, burst_events_1s,
      tiny_frame_count, stacking_suspected,
      brand_guess, brand_confidence, brand_method
    ) VALUES (
      @scan_id, @publisher_id, @vendor_host, @ad_slot_id, @impressions, @first_seen_ts, @last_seen_ts,
      @unique_event_fingerprints, @duplicate_event_count, @duplication_rate,
      @max_impressions_per_second, @median_inter_event_ms, @burst_events_1s,
      @tiny_frame_count, @stacking_suspected,
      @brand_guess, @brand_confidence, @brand_method
    )
    ON CONFLICT(scan_id, publisher_id, vendor_host, ad_slot_id)
    DO UPDATE SET
      impressions = excluded.impressions,
      first_seen_ts = excluded.first_seen_ts,
      last_seen_ts = excluded.last_seen_ts,
      unique_event_fingerprints = excluded.unique_event_fingerprints,
      duplicate_event_count = excluded.duplicate_event_count,
      duplication_rate = excluded.duplication_rate,
      max_impressions_per_second = excluded.max_impressions_per_second,
      median_inter_event_ms = excluded.median_inter_event_ms,
      burst_events_1s = excluded.burst_events_1s,
      tiny_frame_count = excluded.tiny_frame_count,
      stacking_suspected = excluded.stacking_suspected,
      brand_guess = excluded.brand_guess,
      brand_confidence = excluded.brand_confidence,
      brand_method = excluded.brand_method
  `);

  const tx = database.transaction((rows) => {
    rows.forEach((row) => insert.run(row));
  });

  tx(aggregates.map((row) => ({
    ...row,
    scan_id: scanId,
    publisher_id: publisherId
  })));
}

function clearForScan(scanId, publisherId) {
  const database = getDb();
  database.prepare(`DELETE FROM affected_ad_vendors_hosts WHERE scan_id = ? AND publisher_id = ?`).run(scanId, publisherId);
}

function listAggregates(scanId, publisherId, sortBy = 'impressions', direction = 'DESC') {
  const database = getDb();
  const allowedSort = new Set(['impressions', 'duplication_rate', 'max_impressions_per_second', 'first_seen_ts', 'last_seen_ts']);
  const safeSort = allowedSort.has(sortBy) ? sortBy : 'impressions';
  const safeDirection = String(direction).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const stmt = database.prepare(`
    SELECT * FROM affected_ad_vendors_hosts
    WHERE scan_id = ? AND publisher_id = ? AND impressions > 0
    ORDER BY ${safeSort} ${safeDirection}
  `);
  return stmt.all(scanId, publisherId);
}

function updateVerdict(scanId, publisherId, verdict) {
  const database = getDb();
  const stmt = database.prepare(`
    UPDATE affected_ad_vendors_hosts
    SET ai_verdict_status = @ai_verdict_status,
        ai_rationale = @ai_rationale,
        ai_validator_model = @ai_validator_model,
        ai_verdict_at = @ai_verdict_at,
        ai_job_id = COALESCE(@ai_job_id, ai_job_id)
    WHERE scan_id = @scan_id AND publisher_id = @publisher_id
  `);
  stmt.run({
    scan_id: scanId,
    publisher_id: publisherId,
    ai_verdict_status: verdict.ai_verdict_status || null,
    ai_rationale: verdict.ai_rationale || null,
    ai_validator_model: verdict.ai_validator_model || null,
    ai_verdict_at: verdict.ai_verdict_at || new Date().toISOString(),
    ai_job_id: verdict.ai_job_id || null
  });
}

function getVerdict(scanId, publisherId) {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT ai_verdict_status, ai_rationale, ai_validator_model, ai_verdict_at, ai_job_id
    FROM affected_ad_vendors_hosts
    WHERE scan_id = ? AND publisher_id = ?
    LIMIT 1
  `);
  return stmt.get(scanId, publisherId) || null;
}

module.exports = {
  persistAggregates,
  clearForScan,
  listAggregates,
  updateVerdict,
  getVerdict
};

