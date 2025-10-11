import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const file = path.resolve(__dirname, '..', 'data', 'db.json');
const adapter = new JSONFile(file);
export const db = new Low(adapter, { users: [] });

export async function initDb() {
  await db.read();
  db.data ||= { users: [] };
  await db.write();
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
