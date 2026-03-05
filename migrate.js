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
  email TEXT,
  status TEXT DEFAULT 'New Lead',
  city TEXT,
  state TEXT,
  rating DECIMAL,
  reviews INTEGER,
  website TEXT,
  industry TEXT,
  source TEXT,
  notes TEXT,
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

-- Email tracking table for Agent E
CREATE TABLE IF NOT EXISTS emails (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER REFERENCES leads(id),
  direction TEXT NOT NULL DEFAULT 'outbound', -- 'inbound' or 'outbound'
  from_email TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  body_html TEXT,
  message_id TEXT UNIQUE, -- Email Message-ID for threading
  in_reply_to TEXT, -- Parent message ID for threads
  thread_id TEXT, -- Thread identifier
  status TEXT DEFAULT 'sent', -- 'sent', 'delivered', 'opened', 'replied', 'bounced'
  ai_suggested_reply TEXT, -- AI-generated suggested response
  ai_reply_generated_at TIMESTAMP,
  auto_reply_sent BOOLEAN DEFAULT FALSE,
  auto_reply_rule TEXT, -- Which rule triggered auto-reply
  raw_data JSONB, -- Full email data
  created_at TIMESTAMP DEFAULT NOW()
);

-- Auto-reply rules configuration
CREATE TABLE IF NOT EXISTS email_auto_reply_rules (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  trigger_keywords TEXT[], -- Keywords that trigger this rule
  trigger_type TEXT DEFAULT 'contains', -- 'contains', 'exact', 'regex'
  reply_subject TEXT,
  reply_body TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 0, -- Higher priority rules checked first
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert default auto-reply rules
INSERT INTO email_auto_reply_rules (name, description, trigger_keywords, trigger_type, reply_subject, reply_body, priority)
VALUES 
(
  'Interested - Send Calendar',
  'When lead shows interest, send calendar link',
  ARRAY['interested', 'sounds good', 'tell me more', 'yes', 'sure', 'let''s talk', 'can you call', 'call me'],
  'contains',
  'Let''s schedule a call!',
  'Hey! Great to hear you''re interested. Let''s get a time on the calendar that works for you.\n\n📅 Pick a slot here: https://cal.com/maurice-pinnock-lrwndd\n\nOr just reply with your number and a good time to call.\n\n- Maurice',
  100
),
(
  'Pricing Request',
  'When lead asks about pricing, send info',
  ARRAY['price', 'cost', 'how much', 'pricing', 'fee', 'rate', 'charge'],
  'contains',
  'Pricing info for Apex Voice',
  'Great question! Pricing depends on your call volume and needs, but here''s the general breakdown:\n\n• Setup: $500-$3,500 (one-time)\n• Monthly: $250-$2,000 (includes AI receptionist + usage)\n\nMost clients see ROI within the first month from just 1-2 extra booked jobs.\n\nWant me to run the numbers for your specific business? Just reply with your average job value and I''ll show you exactly what you''re leaving on the table.\n\n- Maurice',
  90
),
(
  'Demo Request',
  'When lead wants a demo, send calendar',
  ARRAY['demo', 'see it', 'show me', 'how does it work', 'try it', 'hear it'],
  'contains',
  'Demo time! 🎉',
  'Awesome! Let''s get you a demo.\n\n📅 Pick a 15-min slot here: https://cal.com/maurice-pinnock-lrwndd\n\nDuring the demo I''ll show you:\n• How the AI handles real calls\n• Custom setup for your business\n• Pricing that fits your budget\n\nTalk soon!\n- Maurice',
  95
),
(
  'Not Interested - Soft Close',
  'When lead says no, leave door open',
  ARRAY['not interested', 'no thanks', 'not for me', 'don''t need', 'not right now'],
  'contains',
  'No worries!',
  'Totally understand. Timing is everything.\n\nIf anything changes and you want to stop missing those after-hours calls, you know where to find me.\n\nAll the best with your business!\n- Maurice\n\nP.S. If it''s just not the right time, reply "ping me in 30 days" and I''ll set a reminder.',
  50
)
ON CONFLICT DO NOTHING;
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
