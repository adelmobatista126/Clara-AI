// ============================================================
// CLARA — Interfaces: rotas do Dashboard
// KPIs, agenda do dia, conversas e ações da equipe.
// ============================================================
const { Router } = require('express');
const { clientDaClinica } = require('../../infrastructure/supabase');

const router = Router();

// GET /dashboard/resumo?dia=YYYY-MM-DD
router.get('/resumo', async (req, res) => {
  const db = clientDaClinica(req.clinicaId);
  const dia = req.query.dia || new Date().toISOString().slice(0, 10);
  const iniDia = `${dia}T00:00:00-03:00`;
  const fimDia = `${dia}T23:59:59-03:00`;
  const iniMes = `${dia.slice(0, 7)}-01T00:00:00-03:00`;

  const [ags, grade, novos, espera] = await Promise.all([
    db.from('agendamentos')
      .select('id, inicio, fim, status, origem, procedimento, pacientes(nome), profissionais(nome)')
      .gte('inicio', iniDia).lte('inicio', fimDia)
      .order('inicio'),
    db.from('profissional_horarios')
      .select('hora_inicio, hora_fim')
      .eq('dia_semana', new Date(`${dia}T12:00:00`).getDay()),
    db.from('pacientes')
      .select('id', { count: 'exact', head: true })
      .gte('criado_em', iniMes),
    db.from('lista_espera')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'aguardando'),
  ]);

  const erro = ags.error || grade.error || novos.error || espera.error;
  if (erro) return res.status(500).json({ erro: erro.message });

  // Ocupação: minutos agendados ativos / minutos de grade do dia
  const minGrade = grade.data.reduce((t, g) => {
    const [hi, mi] = g.hora_inicio.split(':').map(Number);
    const [hf, mf] = g.hora_fim.split(':').map(Number);
    return t + (hf * 60 + mf) - (hi * 60 + mi);
  }, 0);
  const ativos = ags.data.filter((a) => ['agendado', 'confirmado', 'concluido'].includes(a.status));
  const minOcupados = ativos.reduce(
    (t, a) => t + (new Date(a.fim) - new Date(a.inicio)) / 60_000, 0
  );

  const contar = (s) => ags.data.filter((a) => a.status === s).length;

  res.json({
    dia,
    ocupacao_pct: minGrade ? Math.round((minOcupados / minGrade) * 100) : 0,
    consultas: ativos.length,
    confirmadas: contar('confirmado'),
    canceladas: contar('cancelado'),
    faltas: contar('faltou'),
    concluidas: contar('concluido'),
    agendadas_pela_clara: ags.data.filter((a) => a.origem === 'clara' && a.status !== 'cancelado').length,
    novos_pacientes_mes: novos.count || 0,
    lista_espera: espera.count || 0,
    agenda: ags.data,
  });
});

// GET /dashboard/conversas — últimas conversas com última mensagem
router.get('/conversas', async (req, res) => {
  const db = clientDaClinica(req.clinicaId);
  const { data, error } = await db
    .from('conversas')
    .select('id, status, ultima_msg_em, canal, pacientes(nome, telefone)')
    .order('ultima_msg_em', { ascending: false })
    .limit(15);
  if (error) return res.status(500).json({ erro: error.message });
  res.json({ conversas: data });
});

// GET /dashboard/conversas/:id/mensagens — histórico completo
router.get('/conversas/:id/mensagens', async (req, res) => {
  const db = clientDaClinica(req.clinicaId);
  const { data, error } = await db
    .from('mensagens')
    .select('direcao, autor, conteudo, criado_em')
    .eq('conversa_id', req.params.id)
    .order('criado_em')
    .limit(200);
  if (error) return res.status(500).json({ erro: error.message });
  res.json({ mensagens: data });
});

// PATCH /dashboard/agendamentos/:id/status  { status: 'concluido' | 'faltou' }
// Ação da equipe ao fim do dia — fecha o ciclo (pesquisa, inativos).
router.patch('/agendamentos/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['concluido', 'faltou'].includes(status)) {
    return res.status(400).json({ erro: "status deve ser 'concluido' ou 'faltou'" });
  }
  const db = clientDaClinica(req.clinicaId);
  const { data, error } = await db
    .from('agendamentos')
    .update({ status })
    .eq('id', req.params.id)
    .in('status', ['agendado', 'confirmado'])
    .select()
    .single();
  if (error) return res.status(500).json({ erro: error.message });
  res.json({ agendamento: data });
});

// PATCH /dashboard/conversas/:id/encerrar — equipe devolve a conversa à Clara
router.patch('/conversas/:id/encerrar', async (req, res) => {
  const db = clientDaClinica(req.clinicaId);
  const { data, error } = await db
    .from('conversas')
    .update({ status: 'encerrada' })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ erro: error.message });
  res.json({ conversa: data });
});

module.exports = router;
