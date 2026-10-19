import { readFile, writeFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
// Run with the service's DATABASE_URL in the environment, before deploying the new server.
// Neon HTTP transaction() executes all statements in one database transaction.
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql=neon(process.env.DATABASE_URL);
const backupPath=`/tmp/victron-user-designs-before-revisions-${Date.now()}.json`;
const designs=await sql`SELECT * FROM user_designs`;
await writeFile(backupPath,JSON.stringify({createdAt:new Date().toISOString(),table:"user_designs",rows:designs}),{mode:0o600,flag:"wx"});
console.log(`Protected pre-migration backup: ${backupPath}`);
const migration=await readFile(new URL("../migrations/0004_design_revisions.sql",import.meta.url),"utf8");
const statements=migration.replace(/^--.*$/gm,"").split(";").map(s=>s.trim()).filter(s=>s&&s!=="BEGIN"&&s!=="COMMIT");
await sql.transaction(statements.map(statement=>sql(statement)));
console.log("Design version and revision migration completed.");
