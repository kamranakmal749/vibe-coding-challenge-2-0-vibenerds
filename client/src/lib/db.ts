// client/src/lib/db.ts
import mongoose from 'mongoose';

// Declare global cache on globalThis for serverless environments (e.g. Next.js App Router / Vercel)
declare global {
  // eslint-disable-next-line no-var
  var mongooseConnection: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  } | undefined;
}

let cached = (globalThis as any).mongooseConnection;

if (!cached) {
  cached = (globalThis as any).mongooseConnection = { conn: null, promise: null };
}

export function extractDbNameFromUri(uri: string): string {
  try {
    const withoutQuery = uri.split('?')[0];
    const slashIdx = withoutQuery.lastIndexOf('/');
    if (slashIdx !== -1) {
      return withoutQuery.slice(slashIdx + 1);
    }
  } catch (_) {}
  return '';
}

/**
 * Validates the MongoDB URI against database name safety invariants.
 * - When ALLOW_PRODUCTION_DB is unset or false:
 *   Allows only development/parity databases (academy_dev or academy_parity).
 * - When ALLOW_PRODUCTION_DB=true:
 *   Refuses any database other than the configured production database
 *   (process.env.PRODUCTION_DB_NAME || 'academy_final'). This prevents accidental
 *   writes to backup databases (academy, academy_dev, academy_demo).
 * Never logs credentials or full URI strings.
 */
export function validateDatabaseUri(
  uri: string,
  allowProductionDb: boolean = process.env.ALLOW_PRODUCTION_DB === 'true',
  configuredProductionDb: string = process.env.PRODUCTION_DB_NAME || 'academy_final'
): void {
  if (!uri) {
    throw new Error('Database connection failed: MONGODB_URI environment variable is not defined');
  }

  const dbName = extractDbNameFromUri(uri);

  if (allowProductionDb) {
    if (dbName !== configuredProductionDb) {
      throw new Error(
        `Database connection refused: MONGODB_URI in production must target the configured database (${configuredProductionDb})`
      );
    }
    return;
  }

  const isAllowedDb = dbName === 'academy_dev' || dbName === 'academy_parity';
  if (!isAllowedDb) {
    throw new Error(
      'Database connection refused: MONGODB_URI must target academy_dev or academy_parity unless ALLOW_PRODUCTION_DB=true is set'
    );
  }
}

export async function connectToDatabase(): Promise<typeof mongoose> {
  const uri = process.env.MONGODB_URI || '';

  validateDatabaseUri(uri);

  const activeCache = (globalThis as any).mongooseConnection || cached;

  if (activeCache.conn) {
    return activeCache.conn;
  }

  if (!activeCache.promise) {
    const opts: mongoose.ConnectOptions = {
      bufferCommands: false,
    };

    activeCache.promise = mongoose.connect(uri, opts).then((m: any) => {
      return m;
    });
  }

  try {
    activeCache.conn = await activeCache.promise;
  } catch (e) {
    activeCache.promise = null;
    throw e;
  }

  return activeCache.conn;
}

export default connectToDatabase;
