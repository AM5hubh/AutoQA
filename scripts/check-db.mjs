import 'dotenv/config';
import pg from 'pg';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
try { await client.connect(); const result = await client.query('SELECT version()'); console.log(result.rows[0].version); }
catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await client.end(); }
