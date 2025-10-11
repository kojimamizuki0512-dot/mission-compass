import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Railway等の本番では /tmp を使用（書き込み可）。ローカルは ./data
const isRailway =
  !!process.env.RAILWAY_STATIC_URL ||
  !!process.env.RAILWAY_ENVIRONMENT ||
  !!process.env.PORT;

const dataDir = process.env.DATA_DIR || (isRailway
  ? '/tmp/mission-compass-data'
  : path.resolve(__dirname, '..', 'data')
);

const file = path.join(dataDir, 'db.json');
const adapter = new JSONFile(file);
export const db = new Low(adapter, { users: [] });

export async function initDb() {
  await fs.mkdir(dataDir, { recursive: true });

  // 初回は空ファイル生成
  try { await fs.access(file); }
  catch { await fs.writeFile(file, JSON.stringify({ users: [] }, null, 2), 'utf-8'); }

  await db.read();
  if (!db.data || !Array.isArray(db.data.users)) {
    db.data = { users: [] };
  }

  // 一度書いて tmp 作成を確認（stenoの一時ファイル対策）
  try {
    await db.write();
  } catch (e) {
    // ディレクトリ/権限に問題があれば早めに気づけるよう補助書き込み
    try { await fs.writeFile(path.join(dataDir, '.db.json.tmp'), JSON.stringify(db.data), 'utf-8'); } catch {}
    throw e;
  }
}

export async function getUserByEmail(email) {
  await db.read();
  return db.data.users.find(u => u.email === email) || null;
}

export async function createUser(user) {
  await db.read();
  db.data.users.push(user);
  await db.write();
  return user;
}
