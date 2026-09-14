-- ==============================================================================
-- Enterprise Objection Playbooks & Rules Engine 2.0 Schema
-- ==============================================================================

CREATE TABLE IF NOT EXISTS playbooks (
  id VARCHAR(64) PRIMARY KEY,
  trigger_regex TEXT NOT NULL,
  playbook_name VARCHAR(128) NOT NULL,
  priority VARCHAR(16) NOT NULL DEFAULT 'CONTEXTUAL', -- 'URGENT', 'CONTEXTUAL', 'FYI'
  action_bullets JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playbooks_active ON playbooks(active);

-- Seed Default Rules
INSERT INTO playbooks (id, trigger_regex, playbook_name, priority, action_bullets)
VALUES
  ('playbook-roi-pricing', '\b(expensive|too much|pricey|costs? too|out of (our )?budget|cheaper|discount|lower price|can''?t afford|high price)\b', 'PRICE OBJECTION: ROI ANCHOR', 'URGENT', '["Acknowledge & pivot: Understood. Compared to the $25k monthly manual overhead, our $5k tier delivers 5x ROI in Q1.", "Ask: What specific deliverables would make this an obvious commercial decision for your board?"]'),
  ('playbook-competitor-diff', '\b(hubspot|salesloft|outreach|gong|another vendor|competitor|other quote|someone else quoted|alternative)\b', 'COMPETITOR COMPARISON: ENTERPRISE POD', 'URGENT', '["Ask: What specific capability stood out when evaluating their platform?", "Differentiate: Unlike static recording tools, our real-time copilot runs in-browser with zero latency and custom CRM auto-sync."]'),
  ('playbook-security-compliance', '\b(security|compliance|soc2|gdpr|hipaa|data privacy|where is (the )?data stored|encryption)\b', 'SECURITY & COMPLIANCE ASSURANCE', 'URGENT', '["State: Audio is processed ephemerally in-memory with TLS 1.3 encryption and zero data retention for training.", "Offer: I can send our SOC2 Type II report and Security Whitepaper right after this call."]'),
  ('playbook-timeline-acceleration', '\b(deadline|timeline|asap|q[1-4]\b|next month|next quarter|how fast|kick ?off|launch date)\b', 'TIMELINE ACCELERATION', 'CONTEXTUAL', '["Anchor: Our standard enterprise deployment takes under 10 business days with turnkey onboarding.", "Propose: If we finalize the pilot scope this Friday, your team can be live by the 1st of next month."]'),
  ('playbook-stakeholder-approval', '\b(my (boss|partner|team)|the board|our cto|ceo|need to (check|ask|run it by)|procurement|finance team)\b', 'EXECUTIVE STAKEHOLDER MAPPING', 'URGENT', '["Offer: Would it be helpful if I prepared a 1-page executive summary ROI deck for your CEO?", "Ask: What primary metrics does your finance team evaluate when reviewing new software tools?"]')
ON CONFLICT (id) DO NOTHING;
