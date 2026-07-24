// ============================================================
// CLARA — Infra: Google Calendar (bidirecional)
// Degrada com elegância: se não configurado, retorna vazio/null
// e nunca quebra o fluxo de agendamento.
// ============================================================
const { google } = require('googleapis');

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const TZ = process.env.GOOGLE_CALENDAR_TIMEZONE || 'America/Sao_Paulo';
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

let _client = null;

function ativo() {
  return Boolean(CALENDAR_ID && process.env.GOOGLE_CREDENTIALS_B64);
}

function cliente() {
  if (_client) return _client;
  const cred = JSON.parse(
    Buffer.from(process.env.GOOGLE_CREDENTIALS_B64, 'base64').toString('utf8')
  );
  const auth = new google.auth.JWT({
    email: cred.client_email,
    key: cred.private_key,
    scopes: SCOPES,
  });
  _client = google.calendar({ version: 'v3', auth });
  return _client;
}

/** Intervalos ocupados na agenda → [{ inicio:Date, fim:Date }] */
async function consultarOcupados({ de, ate }) {
  if (!ativo()) return [];
  try {
    const { data } = await cliente().freebusy.query({
      requestBody: {
        timeMin: new Date(de).toISOString(),
        timeMax: new Date(ate).toISOString(),
        timeZone: TZ,
        items: [{ id: CALENDAR_ID }],
      },
    });
    const busy = data.calendars?.[CALENDAR_ID]?.busy || [];
    return busy.map((b) => ({ inicio: new Date(b.start), fim: new Date(b.end) }));
  } catch (err) {
    console.error('[gcal] freebusy falhou:', err.message);
    return [];
  }
}

/** Cria evento → retorna eventId ou null */
async function criarEvento({ titulo, descricao, inicio, fim }) {
  if (!ativo()) return null;
  try {
    const { data } = await cliente().events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: titulo,
        description: descricao,
        start: { dateTime: new Date(inicio).toISOString(), timeZone: TZ },
        end: { dateTime: new Date(fim).toISOString(), timeZone: TZ },
      },
    });
    return data.id;
  } catch (err) {
    console.error('[gcal] criarEvento falhou:', err.message);
    return null;
  }
}

async function atualizarEvento(eventId, { inicio, fim }) {
  if (!ativo() || !eventId) return false;
  try {
    await cliente().events.patch({
      calendarId: CALENDAR_ID,
      eventId,
      requestBody: {
        start: { dateTime: new Date(inicio).toISOString(), timeZone: TZ },
        end: { dateTime: new Date(fim).toISOString(), timeZone: TZ },
      },
    });
    return true;
  } catch (err) {
    console.error('[gcal] atualizarEvento falhou:', err.message);
    return false;
  }
}

async function cancelarEvento(eventId) {
  if (!ativo() || !eventId) return false;
  try {
    await cliente().events.delete({ calendarId: CALENDAR_ID, eventId });
    return true;
  } catch (err) {
    if (err.code === 404 || err.code === 410) return true; // já removido
    console.error('[gcal] cancelarEvento falhou:', err.message);
    return false;
  }
}

module.exports = { ativo, consultarOcupados, criarEvento, atualizarEvento, cancelarEvento };
