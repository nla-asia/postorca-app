import pg from "pg";
export type Database = pg.Pool;
export type Queryable = Pick<pg.Pool, "query">;
export function createDatabase(url: string) {
  return new pg.Pool({ connectionString: url, max: 10 });
}
export async function transaction<T>(
  db: Database,
  work: (client: pg.PoolClient) => Promise<T>,
) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function ping(db: Queryable) {
  await db.query("SELECT 1");
}
