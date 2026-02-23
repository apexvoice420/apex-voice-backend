const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:XxkrpOVhoqHFYCoMenjWFskpieWPARsc@gondola.proxy.rlwy.net:20950/railway',
  ssl: { rejectUnauthorized: false }
});

const sql = `
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  business_name TEXT,
  phone TEXT UNIQUE,
  status TEXT DEFAULT 'New Lead',
  city TEXT,
  rating DECIMAL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  business_name TEXT NOT NULL,
  industry TEXT DEFAULT 'other',
  city TEXT,
  state TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  business_phone TEXT,
  escalation_phone TEXT,
  greeting TEXT,
  voice_style TEXT DEFAULT 'professional',
  services TEXT,
  faq TEXT,
  vapi_phone TEXT,
  vapi_agent_id TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calls (
  id SERIAL PRIMARY KEY,
  phone TEXT,
  transcript TEXT,
  outcome TEXT,
  duration INTEGER,
  raw_data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
`;

async function migrate() {
  try {
    await pool.query(sql);
    console.log('✅ Migration complete! Tables created.');
    
    const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log('Tables:', tables.rows.map(r => r.table_name).join(', '));
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

migrate();
