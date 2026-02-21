'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { list, del } = require('@vercel/blob');
const Database = require('better-sqlite3');
const path = require('path');

const RETENTION_DAYS = parseInt(process.env.BLOB_RETENTION_DAYS || '90');
const DB_PATH = path.resolve(__dirname, '../audits.db');

function log(data) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), service: 'blob-cleanup', ...data }) + '\n');
}

async function cleanupBlobs() {
  const token = process.env.VERCEL_BLOB_TOKEN;
  if (!token) throw new Error('VERCEL_BLOB_TOKEN not set');

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  let cursor;
  let total = 0, deleted = 0;

  do {
    const { blobs, cursor: next } = await list({ token, cursor, limit: 100 });
    cursor = next;
    total += blobs.length;

    for (const blob of blobs) {
      const uploaded = new Date(blob.uploadedAt);
      if (uploaded < cutoff) {
        await del(blob.url, { token });
        deleted++;
        log({ level: 'info', event: 'blob_deleted', url: blob.url,
              age_days: Math.floor((Date.now() - uploaded) / 86400000) });

        // Also null the URL in DB
        const db = new Database(DB_PATH);
        if (blob.pathname.includes('_full')) {
          db.prepare(`UPDATE scan_results SET screenshot_full_url = NULL
                      WHERE screenshot_full_url = ?`).run(blob.url);
        } else if (blob.pathname.includes('_banner')) {
          db.prepare(`UPDATE scan_results SET screenshot_banner_url = NULL
                      WHERE screenshot_banner_url = ?`).run(blob.url);
        }
        db.close();
      }
    }
  } while (cursor);

  log({ level: 'info', event: 'cleanup_complete', scanned: total, deleted });
}

cleanupBlobs().catch(err => {
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'cleanup_failed', error: err.message }) + '\n');
  process.exit(1);
});
