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

test('DB Guard: allows any database name when ALLOW_PRODUCTION_DB=true', () => {
  const dummyProdUri = 'mongodb+srv://testuser:secretpassword@cluster0.example.net/academy?retryWrites=true&w=majority';

  // Validation passes without throwing when allowProductionDb is true
  assert.doesNotThrow(() => {
    validateDatabaseUri(dummyProdUri, true);
  }, 'Should not throw for /academy when ALLOW_PRODUCTION_DB=true');

  const customDbUri = 'mongodb+srv://user:pass@cluster0.example.net/production_maidan?retryWrites=true';
  assert.doesNotThrow(() => {
    validateDatabaseUri(customDbUri, true);
  }, 'Should allow any custom production database name when ALLOW_PRODUCTION_DB=true');
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

