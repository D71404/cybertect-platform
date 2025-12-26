// Fix for missing type definitions for 'better-sqlite3'
declare module 'better-sqlite3';

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

export type ItemType = 'channel' | 'video' | 'other';
export type ItemStatus = 'new' | 'reviewed' | 'excluded';

export interface VideotectImport {
  id: number;
  filename: string;
  row_count: number;
  created_at: string;
}

export interface VideotectItem {
  id: number;
  import_id: number | null;
  type: ItemType;
  canonical_url: string;
  original_url: string;
  score: number;
  reasons: string;
  metrics: string;
  aggregated_from_count: number;
  status: ItemStatus;
  excluded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateImportParams {
  filename: string;
  row_count: number;
}

export interface CreateItemParams {
  import_id: number | null;
  type: ItemType;
  canonical_url: string;
  original_url: string;
  score: number;
  reasons: string[];
  metrics: Record<string, any>;
  aggregated_from_count: number;
}

export interface UpdateItemStatusParams {
  id: number;
  status: ItemStatus;
}

export interface QueryItemsParams {
  importId?: number;
  status?: ItemStatus;
  minScore?: number;
  type?: ItemType;
  q?: string;
  sort?: 'score_desc' | 'score_asc' | 'date_desc' | 'date_asc';
  limit?: number;
  offset?: number;
}

const DB_PATH = path.join(process.cwd(), 'data', 'videotect.db');

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
    CREATE TABLE IF NOT EXISTS videotect_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS videotect_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER,
      type TEXT NOT NULL CHECK(type IN ('channel', 'video', 'other')),
      canonical_url TEXT NOT NULL,
      original_url TEXT NOT NULL,
      score INTEGER NOT NULL,
      reasons TEXT NOT NULL,
      metrics TEXT NOT NULL,
      aggregated_from_count INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'reviewed', 'excluded')),
      excluded_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(canonical_url, type, import_id)
    );

    CREATE INDEX IF NOT EXISTS idx_canonical_url ON videotect_items(canonical_url);
    CREATE INDEX IF NOT EXISTS idx_type ON videotect_items(type);
    CREATE INDEX IF NOT EXISTS idx_score ON videotect_items(score DESC);
    CREATE INDEX IF NOT EXISTS idx_status ON videotect_items(status);
    CREATE INDEX IF NOT EXISTS idx_import_id ON videotect_items(import_id);
    CREATE INDEX IF NOT EXISTS idx_created_at ON videotect_items(created_at DESC);
  `);
}

export function createImport(params: CreateImportParams): number {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO videotect_imports (filename, row_count)
    VALUES (?, ?)
  `);
  const result = stmt.run(params.filename, params.row_count);
  return result.lastInsertRowid as number;
}

export function createItem(params: CreateItemParams): number {
  const database = getDb();
  const now = new Date().toISOString();
  const reasonsJson = JSON.stringify(params.reasons);
  const metricsJson = JSON.stringify(params.metrics);

  const stmt = database.prepare(`
    INSERT INTO videotect_items 
      (import_id, type, canonical_url, original_url, score, reasons, metrics, aggregated_from_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_url, type, import_id) 
    DO UPDATE SET
      score = ?,
      reasons = ?,
      metrics = ?,
      aggregated_from_count = aggregated_from_count + ?,
      updated_at = ?
  `);

  const result = stmt.run(
    params.import_id,
    params.type,
    params.canonical_url,
    params.original_url,
    params.score,
    reasonsJson,
    metricsJson,
    params.aggregated_from_count,
    now,
    now,
    params.score,
    reasonsJson,
    metricsJson,
    params.aggregated_from_count,
    now
  );

  return result.lastInsertRowid as number;
}

export function updateItemStatus(params: UpdateItemStatusParams): void {
  const database = getDb();
  const now = new Date().toISOString();
  const excludedAt = params.status === 'excluded' ? now : null;

  const stmt = database.prepare(`
    UPDATE videotect_items
    SET status = ?, excluded_at = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(params.status, excludedAt, now, params.id);
}

export function queryItems(params: QueryItemsParams = {}): VideotectItem[] {
  const database = getDb();
  const conditions: string[] = [];
  const values: any[] = [];

  if (params.importId !== undefined) {
    conditions.push('import_id = ?');
    values.push(params.importId);
  }

  if (params.status) {
    conditions.push('status = ?');
    values.push(params.status);
  }

  if (params.minScore !== undefined) {
    conditions.push('score >= ?');
    values.push(params.minScore);
  }

  if (params.type) {
    conditions.push('type = ?');
    values.push(params.type);
  }

  if (params.q) {
    conditions.push('(canonical_url LIKE ? OR original_url LIKE ?)');
    const searchTerm = `%${params.q}%`;
    values.push(searchTerm, searchTerm);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  let orderBy = 'ORDER BY score DESC, created_at DESC';
  if (params.sort === 'score_asc') {
    orderBy = 'ORDER BY score ASC, created_at DESC';
  } else if (params.sort === 'date_desc') {
    orderBy = 'ORDER BY created_at DESC, score DESC';
  } else if (params.sort === 'date_asc') {
    orderBy = 'ORDER BY created_at ASC, score DESC';
  }

  const limit = params.limit || 1000;
  const offset = params.offset || 0;

  const stmt = database.prepare(`
    SELECT * FROM videotect_items
    ${whereClause}
    ${orderBy}
    LIMIT ? OFFSET ?
  `);

  const rows = stmt.all(...values, limit, offset) as any[];
  return rows.map(row => ({
    ...row,
    reasons: JSON.parse(row.reasons || '[]'),
    metrics: JSON.parse(row.metrics || '{}')
  }));
}

export function getImport(id: number): VideotectImport | null {
  const database = getDb();
  const stmt = database.prepare('SELECT * FROM videotect_imports WHERE id = ?');
  const row = stmt.get(id) as any;
  return row || null;
}

export function getItem(id: number): VideotectItem | null {
  const database = getDb();
  const stmt = database.prepare('SELECT * FROM videotect_items WHERE id = ?');
  const row = stmt.get(id) as any;
  if (!row) return null;

  return {
    ...row,
    reasons: JSON.parse(row.reasons || '[]'),
    metrics: JSON.parse(row.metrics || '{}')
  };
}

export function getItemsForExport(type: ItemType, minScore: number): string[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT canonical_url FROM videotect_items
    WHERE type = ? AND score >= ?
    ORDER BY score DESC
  `);
  const rows = stmt.all(type, minScore) as { canonical_url: string }[];
  return rows.map(r => r.canonical_url);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

