import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

function createSql() {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  });

  pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error", error);
  });

  return async (strings, ...values) => {
    if (typeof strings === "string") {
      const result = await pool.query(strings);
      return result.rows;
    }

    const text = strings.reduce(
      (query, string, index) =>
        query + string + (index < values.length ? `$${index + 1}` : ""),
      ""
    );

    const result = await pool.query(text, values);
    return result.rows;
  };
}

export const sql = createSql();