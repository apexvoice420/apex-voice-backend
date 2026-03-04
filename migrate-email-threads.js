/**
 * Migration: Email Threads Table
 * For tracking email conversations with leads via AgentMail
 */

const { pool } = require('./index');

async function up() {
    console.log('Creating email_threads table...');
    
    await pool.query(`
        CREATE TABLE IF NOT EXISTS email_threads (
            id SERIAL PRIMARY KEY,
            lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
            thread_id VARCHAR(255),
            message_id VARCHAR(255) UNIQUE,
            direction VARCHAR(20) NOT NULL, -- 'inbound' or 'outbound'
            subject VARCHAR(500),
            preview TEXT,
            body TEXT,
            from_email VARCHAR(255),
            to_email VARCHAR(255),
            labels TEXT[],
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_email_threads_lead_id ON email_threads(lead_id);
        CREATE INDEX IF NOT EXISTS idx_email_threads_thread_id ON email_threads(thread_id);
        CREATE INDEX IF NOT EXISTS idx_email_threads_direction ON email_threads(direction);
        CREATE INDEX IF NOT EXISTS idx_email_threads_created_at ON email_threads(created_at);
    `);
    
    console.log('✅ email_threads table created');
}

async function down() {
    await pool.query('DROP TABLE IF EXISTS email_threads');
    console.log('✅ email_threads table dropped');
}

module.exports = { up, down };

// Run if called directly
if (require.main === module) {
    up().then(() => process.exit(0)).catch(e => {
        console.error(e);
        process.exit(1);
    });
}
