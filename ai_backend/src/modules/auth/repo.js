// auth repo: SQL for the users table.
import { query } from '../../db/pool.js';

const PUBLIC_COLUMNS = 'id, email, name';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns the public row, or null when the email is already taken.
export async function insertUser({ email, passwordHash, name }) {
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING
     RETURNING ${PUBLIC_COLUMNS}`,
    [email, passwordHash, name ?? null],
  );
  return rows[0] ?? null;
}

// Includes password_hash: for login only, never returned to a client.
export async function findCredentialsByEmail(email) {
  const { rows } = await query(`SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE email = $1`, [email]);
  return rows[0] ?? null;
}

export async function findById(id) {
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  const { rows } = await query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findByEmail(email) {
  const { rows } = await query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE email = $1`, [email]);
  return rows[0] ?? null;
}
