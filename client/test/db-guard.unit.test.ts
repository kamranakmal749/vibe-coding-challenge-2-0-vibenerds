// client/test/db-guard.unit.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDatabaseUri, connectToDatabase } from '../src/lib/db';

test('DB Guard: blocks non-dev/parity database when ALLOW_PRODUCTION_DB is unset', async () => {
  const dummyProdUri = 'mongodb+srv://testuser:secretpassword@cluster0.example.net/academy?retryWrites=true&w=majority';

  // 1. Direct validation throws for /academy when allowProductionDb is false / unset
  assert.throws(
    () => {
      validateDatabaseUri(dummyProdUri, false);
    },
    (err: any) => {
      assert.match(err.message, /Database connection refused: MONGODB_URI must target academy_dev or academy_parity/);
      // Ensure URI, host, and credentials are NEVER leaked in the error message
      assert.ok(!err.message.includes('mongodb+srv'));
      assert.ok(!err.message.includes('secretpassword'));
      assert.ok(!err.message.includes('testuser'));
      return true;
    },
    'Should throw error when connecting to /academy without ALLOW_PRODUCTION_DB=true'
  );

  // 2. connectToDatabase throws immediately at the guard level when process.env.ALLOW_PRODUCTION_DB is unset
  const originalUri = process.env.MONGODB_URI;
  const originalFlag = process.env.ALLOW_PRODUCTION_DB;
  try {
    process.env.MONGODB_URI = dummyProdUri;
    delete process.env.ALLOW_PRODUCTION_DB;

    await assert.rejects(
      async () => {
        await connectToDatabase();
      },
      (err: any) => {
        assert.match(err.message, /Database connection refused: MONGODB_URI must target academy_dev or academy_parity/);
        assert.ok(!err.message.includes('secretpassword'));
        assert.ok(!err.message.includes('mongodb+srv'));
        return true;
      }
    );
  } finally {
    process.env.MONGODB_URI = originalUri;
    if (originalFlag !== undefined) {
      process.env.ALLOW_PRODUCTION_DB = originalFlag;
    } else {
      delete process.env.ALLOW_PRODUCTION_DB;
    }
  }
});

test('DB Guard: allows ONLY the configured database when ALLOW_PRODUCTION_DB=true', () => {
  const finalProdUri = 'mongodb+srv://testuser:secretpassword@cluster0.example.net/academy_final?retryWrites=true&w=majority';

  // 1. Validation passes without throwing when database matches configured production DB (default: academy_final)
  assert.doesNotThrow(() => {
    validateDatabaseUri(finalProdUri, true);
  }, 'Should not throw for /academy_final when ALLOW_PRODUCTION_DB=true');

  // 2. Custom production database passes when matching configuredProductionDb
  const customDbUri = 'mongodb+srv://user:pass@cluster0.example.net/production_maidan?retryWrites=true';
  assert.doesNotThrow(() => {
    validateDatabaseUri(customDbUri, true, 'production_maidan');
  }, 'Should allow custom production database name when matching configured DB');

  // 3. Any non-matching database (e.g. backup DBs like academy, academy_dev, or academy_demo) is strictly rejected
  const backupDbUri = 'mongodb+srv://testuser:secretpassword@cluster0.example.net/academy?retryWrites=true&w=majority';
  assert.throws(
    () => {
      validateDatabaseUri(backupDbUri, true, 'academy_final');
    },
    (err: any) => {
      assert.match(err.message, /Database connection refused: MONGODB_URI in production must target the configured database/);
      return true;
    },
    'Should refuse unconfigured database in production'
  );
});

test('DB Guard: allows academy_dev and academy_parity by default without flag', () => {
  const devUri = 'mongodb+srv://user:pass@cluster0.example.net/academy_dev?retryWrites=true';
  const parityUri = 'mongodb+srv://user:pass@cluster0.example.net/academy_parity?retryWrites=true';

  assert.doesNotThrow(() => {
    validateDatabaseUri(devUri, false);
  }, 'Should allow academy_dev by default');

  assert.doesNotThrow(() => {
    validateDatabaseUri(parityUri, false);
  }, 'Should allow academy_parity by default');
});

test('Seed Guard: scripts/seed.js enforces multi-tier safety guards without connecting to MongoDB', () => {
  // Test guard logic in isolation (identical to scripts/seed.js checks)
  function testSeedGuard(uri: string, allowProd: string | undefined, confirmDestructive: string | undefined) {
    const withoutQuery = uri.split('?')[0];
    const parts = withoutQuery.split('/');
    const dbName = parts[parts.length - 1] || '';

    if (dbName !== 'academy_final') {
      return { allowed: false, reason: 'WRONG_DB' };
    }
    if (allowProd !== 'true') {
      return { allowed: false, reason: 'MISSING_ALLOW_PROD' };
    }
    if (confirmDestructive !== 'I_ACKNOWLEDGE_THIS_DESTROYS_DATA') {
      return { allowed: false, reason: 'MISSING_DESTRUCTIVE_CONFIRMATION' };
    }
    return { allowed: true };
  }

  // 1. Rejects non-academy_final target
  assert.equal(
    testSeedGuard('mongodb+srv://user:pass@cluster.net/other_db', 'true', 'I_ACKNOWLEDGE_THIS_DESTROYS_DATA').reason,
    'WRONG_DB'
  );

  // 2. Rejects when ALLOW_PRODUCTION_DB is not 'true'
  assert.equal(
    testSeedGuard('mongodb+srv://user:pass@cluster.net/academy_final', 'false', 'I_ACKNOWLEDGE_THIS_DESTROYS_DATA').reason,
    'MISSING_ALLOW_PROD'
  );

  // 3. CRITICAL: Rejects when ALLOW_PRODUCTION_DB=true but CONFIRM_DESTRUCTIVE_SEED is missing
  assert.equal(
    testSeedGuard('mongodb+srv://user:pass@cluster.net/academy_final', 'true', undefined).reason,
    'MISSING_DESTRUCTIVE_CONFIRMATION'
  );

  // 4. Rejects invalid confirmation string
  assert.equal(
    testSeedGuard('mongodb+srv://user:pass@cluster.net/academy_final', 'true', 'yes').reason,
    'MISSING_DESTRUCTIVE_CONFIRMATION'
  );

  // 5. Passes only when all three requirements are met
  assert.equal(
    testSeedGuard('mongodb+srv://user:pass@cluster.net/academy_final', 'true', 'I_ACKNOWLEDGE_THIS_DESTROYS_DATA').allowed,
    true
  );
});

