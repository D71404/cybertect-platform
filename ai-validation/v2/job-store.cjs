const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'ai-validation.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS ai_validation_jobs (
    id TEXT PRIMARY KEY,
    userId TEXT,
    toolId TEXT NOT NULL,
    scanId TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT,
    promptNotes TEXT,
    evidenceRef TEXT NOT NULL,
    status TEXT NOT NULL,
    resultJson TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_validation_jobs(status);
  CREATE INDEX IF NOT EXISTS idx_ai_jobs_tool ON ai_validation_jobs(toolId);
  CREATE INDEX IF NOT EXISTS idx_ai_jobs_scan ON ai_validation_jobs(scanId);
`);

function createJob(payload) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO ai_validation_jobs 
    (id, userId, toolId, scanId, provider, model, promptNotes, evidenceRef, status, createdAt, updatedAt)
    VALUES (@id, @userId, @toolId, @scanId, @provider, @model, @promptNotes, @evidenceRef, @status, @createdAt, @updatedAt)
  `);
  stmt.run({
    id: payload.id,
    userId: payload.userId || null,
    toolId: payload.toolId,
    scanId: payload.scanId,
    provider: payload.provider,
    model: payload.model || null,
    promptNotes: payload.promptNotes || null,
    evidenceRef: payload.evidenceRef,
    status: payload.status || 'running',
    createdAt: now,
    updatedAt: now
  });
  return getJob(payload.id);
}

function updateJob(id, patch) {
  const existing = getJob(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const merged = { ...existing, ...patch, updatedAt: now };
  const stmt = db.prepare(`
    UPDATE ai_validation_jobs
    SET userId=@userId,
        toolId=@toolId,
        scanId=@scanId,
        provider=@provider,
        model=@model,
        promptNotes=@promptNotes,
        evidenceRef=@evidenceRef,
        status=@status,
        resultJson=@resultJson,
        updatedAt=@updatedAt
    WHERE id=@id
  `);
  stmt.run({
    ...merged,
    resultJson: merged.resultJson || null
  });
  return getJob(id);
}

function getJob(id) {
  const stmt = db.prepare(`SELECT * FROM ai_validation_jobs WHERE id = ?`);
  const row = stmt.get(id);
  return row || null;
}

module.exports = {
  createJob,
  updateJob,
  getJob,
};

