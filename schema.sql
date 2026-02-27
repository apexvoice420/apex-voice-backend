-- Run this in Railway Query Tool

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Clients table (your customers)
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

-- Leads table
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
  address TEXT,
  website TEXT,
  industry TEXT,
  source TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Calls table for VAPI webhooks
CREATE TABLE IF NOT EXISTS calls (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER REFERENCES leads(id),
  phone TEXT,
  vapi_call_id TEXT,
  transcript TEXT,
  outcome TEXT,
  duration INTEGER,
  raw_data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Client documents table for onboarding uploads
CREATE TABLE IF NOT EXISTS client_documents (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL, -- 'services_pdf', 'pricing_sheet', 'faq_document', 'custom_script', 'other'
  file_name TEXT NOT NULL,
  file_data TEXT, -- Base64 encoded file data
  file_size INTEGER,
  mime_type TEXT,
  uploaded_at TIMESTAMP DEFAULT NOW()
);

-- Campaigns table for email outreach
CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'draft', -- 'draft', 'active', 'paused', 'completed'
  emails_sent INTEGER DEFAULT 0,
  open_rate DECIMAL,
  reply_rate DECIMAL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP
);

-- Campaign leads junction table
CREATE TABLE IF NOT EXISTS campaign_leads (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'opened', 'replied'
  added_at TIMESTAMP DEFAULT NOW(),
  sent_at TIMESTAMP,
  opened_at TIMESTAMP,
  UNIQUE(campaign_id, lead_id)
);

-- Email logs for Agent E tracking
CREATE TABLE IF NOT EXISTS email_logs (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  status TEXT DEFAULT 'sent', -- 'sent', 'delivered', 'opened', 'clicked', 'bounced'
  resend_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMP DEFAULT NOW(),
  opened_at TIMESTAMP
);

-- Add email tracking columns to leads if not exists
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_type TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP;

-- Workflow tables for Agent E sequences
CREATE TABLE IF NOT EXISTS lead_workflows (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  workflow_type TEXT NOT NULL, -- 'NEW_LEAD', 'DEMO_REQUESTED', 'NO_ANSWER', 'COLD_LEAD'
  workflow_name TEXT,
  status TEXT DEFAULT 'active', -- 'active', 'completed', 'cancelled'
  current_step INTEGER DEFAULT 0,
  total_steps INTEGER DEFAULT 4,
  started_at TIMESTAMP DEFAULT NOW(),
  last_executed_at TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id SERIAL PRIMARY KEY,
  workflow_id INTEGER REFERENCES lead_workflows(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  step_type TEXT NOT NULL, -- 'email', 'sms', 'wait'
  step_data JSONB, -- email template, sms message, wait duration
  status TEXT DEFAULT 'pending', -- 'pending', 'executing', 'completed', 'failed'
  scheduled_at TIMESTAMP,
  executed_at TIMESTAMP,
  result JSONB
);
