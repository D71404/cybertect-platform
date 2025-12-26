import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

export type IdType = 'UA' | 'GA4' | 'GTM' | 'FBP' | 'AW' | 'OTHER';
export type SourceType = 'html' | 'script' | 'gtm_js' | 'network';

export interface AnalyticsOccurrence {
  id_type: IdType;
  id_value: string;
  domain: string;
  url: string;
  source: SourceType;
  evidence: string;
  first_seen_at: string;
  last_seen_at: string;
  seen_count: number;
  confidence: number;
}

export interface UpsertParams {
  id_type: IdType;
  id_value: string;
  domain: string;
  url: string;
  source: SourceType;
  evidence: string;
  confidence?: number;
}

const DB_PATH = path.join(process.cwd(), 'data', 'analytics-index.db');

// Ensure data directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initializeSchema(db);
  }
  return db;
}

function initializeSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS analytics_id_occurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      id_type TEXT NOT NULL CHECK(id_type IN ('UA', 'GA4', 'GTM', 'FBP', 'AW', 'OTHER')),
      id_value TEXT NOT NULL,
      domain TEXT NOT NULL,
      url TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('html', 'script', 'gtm_js', 'network')),
      evidence TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      seen_count INTEGER NOT NULL DEFAULT 1,
      confidence REAL NOT NULL DEFAULT 0.9,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(id_type, id_value, domain, source)
    );

    CREATE INDEX IF NOT EXISTS idx_id_lookup ON analytics_id_occurrences(id_type, id_value);
    CREATE INDEX IF NOT EXISTS idx_domain ON analytics_id_occurrences(domain);
    CREATE INDEX IF NOT EXISTS idx_last_seen ON analytics_id_occurrences(last_seen_at DESC);
  `);
}

export function upsertOccurrence(params: UpsertParams): void {
  const database = getDb();
  const now = new Date().toISOString();
  const confidence = params.confidence ?? (params.source === 'network' ? 0.95 : params.source === 'html' ? 0.8 : 0.9);

  // Truncate evidence to safe length (500 chars)
  const evidence = params.evidence.length > 500 
    ? params.evidence.substring(0, 497) + '...' 
    : params.evidence;

  const stmt = database.prepare(`
    INSERT INTO analytics_id_occurrences 
      (id_type, id_value, domain, url, source, evidence, first_seen_at, last_seen_at, seen_count, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(id_type, id_value, domain, source) 
    DO UPDATE SET
      last_seen_at = ?,
      seen_count = seen_count + 1,
      url = CASE WHEN ? > last_seen_at THEN ? ELSE url END,
      evidence = CASE WHEN ? > last_seen_at THEN ? ELSE evidence END
  `);

  stmt.run(
    params.id_type,
    params.id_value,
    params.domain,
    params.url,
    params.source,
    evidence,
    now,
    now,
    confidence,
    now,
    now,
    params.url,
    now,
    evidence
  );
}

export function queryById(idType: IdType, idValue: string): AnalyticsOccurrence[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM analytics_id_occurrences
    WHERE id_type = ? AND id_value = ?
    ORDER BY last_seen_at DESC
  `);
  return stmt.all(idType, idValue) as AnalyticsOccurrence[];
}

export function queryByDomain(domain: string, limit: number = 10): AnalyticsOccurrence[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM analytics_id_occurrences
    WHERE domain = ?
    ORDER BY last_seen_at DESC
    LIMIT ?
  `);
  return stmt.all(domain, limit) as AnalyticsOccurrence[];
}

export function getDistinctDomains(idType: IdType, idValue: string): string[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT DISTINCT domain FROM analytics_id_occurrences
    WHERE id_type = ? AND id_value = ?
    ORDER BY domain
  `);
  const rows = stmt.all(idType, idValue) as { domain: string }[];
  return rows.map(r => r.domain);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

