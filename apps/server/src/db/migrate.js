import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sql } from "./client.js";

const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
const schema = await fs.readFile(schemaPath, "utf8");

console.log("Applying LuxSyncspace database schema...");
const statements = schema
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

for (const statement of statements) {
  await sql(statement);
}

console.log("Database schema is ready.");