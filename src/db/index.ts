import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://cards:cards@localhost:5432/cards';

// next dev hot-reloads modules; keep one pool across reloads
const g = globalThis as { __pg?: ReturnType<typeof postgres> };
export const client = (g.__pg ??= postgres(DATABASE_URL, { max: 4, onnotice: () => {} }));
export const db = drizzle(client);
