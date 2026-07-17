// ============================================================
// CLARA — Interfaces: rotas REST do Motor da Agenda
// Pressupõe middleware de auth que popula req.clinicaId.
// ============================================================
const { Router } = require('express');
const agenda = require('../../application/agenda/agendaService');
const listaEspera = require('../../application/agenda/listaEsperaService');

const router = Router();

// GET /agenda/horarios?profissionalId=&de=2026-07-10&ate=2026-07-15
router.get('/horarios', async (req, res) => {
  const { profissionalId, de, ate } = req.query;
  if (!profissionalId || !de || !ate) {
    return res.status(400).json({ erro: 'profissionalId, de e ate são obrigatórios' });
  }
  const r = await agenda.horariosDisponiveis(req.clinicaId, { profissionalId, de, ate });
  if (r.erro) return res.status(500).json(r);
  res.json(r);
});

// POST /agenda/agendamentos
router.post('/agendamentos', async (req, res) => {
  const r = await agenda.agendar(req.clinicaId, { ...req.body, origem: req.body.origem || 'painel' });
  if (r.conflito) return res.status(409).json(r);
  if (r.erro) return res.status(500).json(r);
  res.status(201).json(r);
});

// PATCH /agenda/agendamentos/:id/reagendar
router.patch('/agendamentos/:id/reagendar', async (req, res) => {
  const r = await agenda.reagendar(req.clinicaId, req.params.id, req.body);
  if (r.conflito) return res.status(409).json(r);
  if (r.erro) return res.status(500).json(r);
  res.json(r);
});

// PATCH /agenda/agendamentos/:id/cancelar
router.patch('/agendamentos/:id/cancelar', async (req, res) => {
  const r = await agenda.cancelar(req.clinicaId, req.params.id, req.body);
  if (r.erro) return res.status(500).json(r);
  res.json(r);
});

// PATCH /agenda/agendamentos/:id/confirmar
router.patch('/agendamentos/:id/confirmar', async (req, res) => {
  const r = await agenda.confirmar(req.clinicaId, req.params.id);
  if (r.erro) return res.status(500).json(r);
  res.json(r);
});

// POST /agenda/lista-espera
router.post('/lista-espera', async (req, res) => {
  const r = await listaEspera.entrar(req.clinicaId, req.body);
  if (r.erro) return res.status(500).json(r);
  res.status(201).json(r);
});

module.exports = router;
