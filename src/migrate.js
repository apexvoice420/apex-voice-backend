const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function runMigration() {
    console.log('🔄 Running Agent E migration...');
    
    try {
        // Add email tracking columns to leads
        await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_sent BOOLEAN DEFAULT false`);
        await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_type VARCHAR(50)`);
        await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP`);
        
        console.log('✅ Added email columns to leads table');
        
        // Create workflow tracking tables
        await pool.query(`
            CREATE TABLE IF NOT EXISTS lead_workflows (
                id SERIAL PRIMARY KEY,
                lead_id INTEGER REFERENCES leads(id),
                workflow_type VARCHAR(50),
                workflow_name VARCHAR(100),
                status VARCHAR(20) DEFAULT 'active',
                current_step INTEGER DEFAULT 0,
                total_steps INTEGER,
                started_at TIMESTAMP,
                last_executed_at TIMESTAMP,
                completed_at TIMESTAMP
            )
        `);
        
        console.log('✅ Created lead_workflows table');
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS workflow_steps (
                id SERIAL PRIMARY KEY,
                workflow_id INTEGER REFERENCES lead_workflows(id),
                lead_id INTEGER,
                step_index INTEGER,
                step_type VARCHAR(20),
                template VARCHAR(50),
                scheduled_at TIMESTAMP,
                executed_at TIMESTAMP,
                status VARCHAR(20) DEFAULT 'pending',
                result JSONB
            )
        `);
        
        console.log('✅ Created workflow_steps table');
        
        // Verify tables exist
        const tables = await pool.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('leads', 'lead_workflows', 'workflow_steps')
        `);
        
        console.log('📊 Tables:', tables.rows.map(r => r.table_name).join(', '));
        
        // Check leads columns
        const columns = await pool.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'leads' AND column_name LIKE 'email%'
        `);
        
        console.log('📧 Email columns:', columns.rows.map(r => r.column_name).join(', '));
        
        return { 
            success: true, 
            message: 'Migration complete',
            tables: tables.rows.map(r => r.table_name),
            emailColumns: columns.rows.map(r => r.column_name)
        };
        
    } catch (error) {
        console.error('❌ Migration error:', error.message);
        return { success: false, error: error.message };
    }
}

module.exports = { runMigration };
