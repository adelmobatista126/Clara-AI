// ============================================================
// CLARA — Servidor principal (Railway)
// ============================================================
require('dotenv').config();
const express = require('express');

const webhookRoutes = require('./src/interfaces/routes/webhook.routes');
const agendaRoutes = require('./src/interfaces/routes/agenda.routes');
const dashboardRoutes = require('./src/interfaces/routes/dashboard.routes');

const app = express();
app.use(express.json({ limit: '2mb' }));

// CORS (dashboard no Netlify chama a API no Railway)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CLARA_DASHBOARD_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, x-clinica-id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Log mínimo de requisições
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, servico: 'clara', versao: '1.0.0' }));

// Webhook do WhatsApp (sem auth — validar por instância conhecida)
app.use('/webhook', webhookRoutes);

// API interna (dashboard/admin) — auth por clínica
// MVP: header x-clinica-id validado por API key interna.
// v2: Supabase Auth do usuário da clínica.
function authClinica(req, res, next) {
  if (req.headers['x-api-key'] !== process.env.CLARA_INTERNAL_API_KEY) {
    return res.status(401).json({ erro: 'não autorizado' });
  }
  req.clinicaId = req.headers['x-clinica-id'];
  if (!req.clinicaId) return res.status(400).json({ erro: 'x-clinica-id obrigatório' });
  next();
}

app.use('/agenda', authClinica, agendaRoutes);
app.use('/dashboard', authClinica, dashboardRoutes);

const porta = process.env.PORT || 3000;
if (process.env.CLARA_WORKER !== 'off') require('./worker').iniciar();
app.listen(porta, () => console.log(`Clara no ar na porta ${porta} 🦷`));
