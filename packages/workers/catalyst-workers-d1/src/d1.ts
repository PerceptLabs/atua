/**
 * CatalystD1 — Cloudflare Workers D1 emulation backed by wa-sqlite + IndexedDB.
 *
 * API shape matches Cloudflare's published D1 binding.
 * Uses wa-sqlite with IDBBatchAtomicVFS for persistent SQLite in the browser.
 *
 * wa-sqlite async build is used for compatibility with IndexedDB-based VFS.
 */
/** D1 query result */
export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

/** D1 query metadata */
export interface D1Meta {
  duration: number;
  changes: number;
  last_row_id: number;
  served_by?: string;
}

/** D1 exec result */
export interface D1ExecResult {
  count: number;
  duration: number;
}

// wa-sqlite types (the package doesn't export TypeScript types for these)
type SQLiteAPI = any;
type SQLiteDB = number;

/** Singleton module cache — wa-sqlite WASM loads once per page */
let modulePromise: Promise<SQLiteAPI> | null = null;

/**
 * Initialize wa-sqlite (lazy, singleton).
 * Loads the async WASM build and registers IDBBatchAtomicVFS.
 */
async function getSQLite3(): Promise<SQLiteAPI> {
  if (!modulePromise) {
    modulePromise = (async () => {
      // Dynamic imports to keep wa-sqlite lazy-loadable
      const [{ default: SQLiteESMFactory }, SQLite, { IDBBatchAtomicVFS }] =
        await Promise.all([
          import('wa-sqlite/dist/wa-sqlite-async.mjs'),
          import('wa-sqlite/src/sqlite-api.js'),
          import('wa-sqlite/src/examples/IDBBatchAtomicVFS.js'),
        ]);

      const module = await SQLiteESMFactory();
      const sqlite3 = SQLite.Factory(module);

      // Register IDB-based VFS as default
      const vfs = new IDBBatchAtomicVFS();
      sqlite3.vfs_register(vfs, true);

      return sqlite3;
    })();
  }
  return modulePromise;
}

export class CatalystD1 {
  private readonly databaseName: string;
  private sqlite3: SQLiteAPI | null = null;
  private db: SQLiteDB | null = null;
  private _ready: Promise<void>;

  constructor(databaseName: string) {
    this.databaseName = databaseName;
    this._ready = this.init();
  }

  private async init(): Promise<void> {
    this.sqlite3 = await getSQLite3();
    this.db = await this.sqlite3.open_v2(this.databaseName);
  }

  /** Ensure the database is ready before operations */
  private async ready(): Promise<{ sqlite3: SQLiteAPI; db: SQLiteDB }> {
    await this._ready;
    if (!this.sqlite3 || this.db === null) {
      throw new Error('Database not initialized');
    }
    return { sqlite3: this.sqlite3, db: this.db };
  }

  /**
   * Prepare a SQL statement for execution.
   * Returns a CatalystD1PreparedStatement that can be bound and executed.
   */
  prepare(sql: string): CatalystD1PreparedStatement {
    return new CatalystD1PreparedStatement(this, sql);
  }

  /**
   * Execute raw DDL/DML SQL (CREATE TABLE, etc.).
   * Not for queries that return data — use prepare() for those.
   */
  async exec(sql: string): Promise<D1ExecResult> {
    const { sqlite3, db } = await this.ready();
    const start = performance.now();
    await sqlite3.exec(db, sql);
    const duration = performance.now() - start;
    return { count: 1, duration };
  }

  /**
   * Execute multiple prepared statements atomically in a transaction.
   * If any statement fails, ALL are rolled back.
   */
  async batch<T = Record<string, unknown>>(
    statements: CatalystD1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    const { sqlite3, db } = await this.ready();
    const results: D1Result<T>[] = [];

    // Begin transaction
    await sqlite3.exec(db, 'BEGIN TRANSACTION');

    try {
      for (const stmt of statements) {
        const result = await stmt._executeInTransaction<T>(sqlite3, db);
        results.push(result);
      }
      await sqlite3.exec(db, 'COMMIT');
    } catch (err) {
      await sqlite3.exec(db, 'ROLLBACK');
      throw err;
    }

    return results;
  }

  /**
   * Export the database as a SQLite binary dump.
   */
  async dump(): Promise<ArrayBuffer> {
    const { sqlite3, db } = await this.ready();

    // Collect all data via serialization
    // wa-sqlite doesn't have a direct serialize, so we use .dump-style approach
    const tables: string[] = [];
    await sqlite3.exec(db, "SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL", (row: any[]) => {
      tables.push(row[0]);
    });

    // Build the SQL dump as text, then encode
    const dumpParts: string[] = [];
    for (const createSql of tables) {
      dumpParts.push(createSql + ';');

      // Get table name from CREATE TABLE statement
      const match = createSql.match(/CREATE TABLE\s+(?:"([^"]+)"|(\w+))/i);
      const tableName = match?.[1] ?? match?.[2];
      if (!tableName) continue;

      await sqlite3.exec(
        db,
        `SELECT * FROM "${tableName}"`,
        (row: any[], columns: string[]) => {
          const values = row.map((v) => {
            if (v === null) return 'NULL';
            if (typeof v === 'number') return String(v);
            if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
            if (v instanceof Uint8Array) return `X'${Array.from(v).map((b: number) => b.toString(16).padStart(2, '0')).join('')}'`;
            return String(v);
          });
          dumpParts.push(`INSERT INTO "${tableName}" VALUES(${values.join(',')});`);
        },
      );
    }

    const dumpText = dumpParts.join('\n');
    return new TextEncoder().encode(dumpText).buffer;
  }

  /**
   * Close the database and free resources.
   */
  async destroy(): Promise<void> {
    if (this.sqlite3 && this.db !== null) {
      await this.sqlite3.close(this.db);
      this.db = null;
    }
  }

  /**
   * Internal: execute a SQL statement and return results.
   * Used by CatalystD1PreparedStatement.
   */
  async _execute<T = Record<string, unknown>>(
    sql: string,
    bindings: unknown[],
  ): Promise<{ rows: T[]; columns: string[]; changes: number; duration: number; lastRowId: number }> {
    const { sqlite3, db } = await this.ready();
    return this._executeOnDb<T>(sqlite3, db, sql, bindings);
  }

  /** Internal: execute on a specific db handle (for transactions) */
  async _executeOnDb<T = Record<string, unknown>>(
    sqlite3: SQLiteAPI,
    db: SQLiteDB,
    sql: string,
    bindings: unknown[],
  ): Promise<{ rows: T[]; columns: string[]; changes: number; duration: number; lastRowId: number }> {
    const start = performance.now();
    const rows: T[] = [];
    let columns: string[] = [];

    for await (const stmt of sqlite3.statements(db, sql)) {
      if (bindings.length > 0) {
        sqlite3.bind_collection(stmt, bindings);
      }

      columns = sqlite3.column_names(stmt);

      let rc: number;
      while ((rc = await sqlite3.step(stmt)) === 100) {
        // SQLITE_ROW = 100
        const rowValues = sqlite3.row(stmt);
        const rowObj: Record<string, unknown> = {};
        for (let i = 0; i < columns.length; i++) {
          const val = rowValues[i];
          // Copy Uint8Array values since they reference WASM memory
          rowObj[columns[i]] = val instanceof Uint8Array ? val.slice() : val;
        }
        rows.push(rowObj as T);
      }
    }

    const changes = sqlite3.changes(db);
    const duration = performance.now() - start;

    return { rows, columns, changes, duration, lastRowId: 0 };
  }
}

export class CatalystD1PreparedStatement {
  private readonly d1: CatalystD1;
  private readonly sql: string;
  private bindings: unknown[] = [];

  constructor(d1: CatalystD1, sql: string) {
    this.d1 = d1;
    this.sql = sql;
  }

  /**
   * Bind parameters to the prepared statement.
   * Returns a new PreparedStatement (chainable).
   */
  bind(...values: unknown[]): CatalystD1PreparedStatement {
    const stmt = new CatalystD1PreparedStatement(this.d1, this.sql);
    stmt.bindings = values;
    return stmt;
  }

  /**
   * Execute and return the first row, or null if empty.
   * If column is specified, returns just that column's value.
   */
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const { rows } = await this.d1._execute<T>(this.sql, this.bindings);
    if (rows.length === 0) return null;
    if (column !== undefined) {
      return (rows[0] as Record<string, unknown>)[column] as T;
    }
    return rows[0];
  }

  /**
   * Execute and return all rows as D1Result.
   */
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const { rows, changes, duration } = await this.d1._execute<T>(
      this.sql,
      this.bindings,
    );
    return {
      results: rows,
      success: true,
      meta: {
        duration,
        changes,
        last_row_id: 0,
      },
    };
  }

  /**
   * Execute and return rows as arrays of arrays (no column names).
   */
  async raw<T = unknown[]>(): Promise<T[]> {
    const { rows, columns } = await this.d1._execute(this.sql, this.bindings);
    return rows.map((row) => {
      const values: unknown[] = [];
      for (const col of columns) {
        values.push((row as Record<string, unknown>)[col]);
      }
      return values as unknown as T;
    });
  }

  /**
   * Execute a mutation (INSERT, UPDATE, DELETE) and return the result.
   */
  async run(): Promise<D1Result> {
    const { changes, duration } = await this.d1._execute(
      this.sql,
      this.bindings,
    );
    return {
      results: [],
      success: true,
      meta: {
        duration,
        changes,
        last_row_id: 0,
      },
    };
  }

  /**
   * Internal: execute within an existing transaction context.
   */
  async _executeInTransaction<T = Record<string, unknown>>(
    sqlite3: SQLiteAPI,
    db: SQLiteDB,
  ): Promise<D1Result<T>> {
    const { rows, changes, duration } = await this.d1._executeOnDb<T>(
      sqlite3,
      db,
      this.sql,
      this.bindings,
    );
    return {
      results: rows,
      success: true,
      meta: {
        duration,
        changes,
        last_row_id: 0,
      },
    };
  }
}
