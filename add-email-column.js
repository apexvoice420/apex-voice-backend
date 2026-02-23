const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:XxkrpOVhoqHFYCoMenjWFskpieWPARsc@gondola.proxy.rlwy.net:20950/railway',
  ssl: { rejectUnauthorized: false }
});

async function addEmailColumn() {
  try {
    // Add email column if it doesn't exist
    await pool.query(`
      ALTER TABLE leads 
      ADD COLUMN IF NOT EXISTS email TEXT
    `);
    
    // Add other missing columns
    await pool.query(`
      ALTER TABLE leads 
      ADD COLUMN IF NOT EXISTS state TEXT,
      ADD COLUMN IF NOT EXISTS reviews INTEGER,
      ADD COLUMN IF NOT EXISTS address TEXT,
      ADD COLUMN IF NOT EXISTS website TEXT,
      ADD COLUMN IF NOT EXISTS industry TEXT,
      ADD COLUMN IF NOT EXISTS source TEXT
    `);
    
    console.log('✅ Email column and other columns added to leads table!');
    
    // Verify
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'leads'
    `);
    
    console.log('Current leads columns:');
    result.rows.forEach(row => console.log(`  - ${row.column_name}: ${row.data_type}`));
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

addEmailColumn();
