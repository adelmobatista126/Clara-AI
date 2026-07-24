-- v1.2 — integração Google Calendar (bidirecional)
ALTER TABLE agendamentos
ADD COLUMN IF NOT EXISTS google_event_id TEXT;

CREATE INDEX IF NOT EXISTS idx_agendamentos_google_event
ON agendamentos (google_event_id)
WHERE google_event_id IS NOT NULL;
