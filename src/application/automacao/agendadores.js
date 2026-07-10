// ============================================================
// CLARA — Application: Agendadores de automação
// Olham o banco e ENFILEIRAM na outbox (não enviam nada direto).
// Cada um é idempotente: nunca enfileira duplicado.
// ============================================================
const { clientDaClinica } = require('../../infrastructure/supabase');

const LIMITE_RECUPERACAO_DIA = 20; // anti-spam / anti-banimento WhatsApp

// ------------------------------------------------------------
// Confirmação 24h antes: agendamentos de amanhã ainda não confirmados
// ------------------------------------------------------------
async function gerarConfirmacoes24h(clinicaId) {
  const db = clientDaClinica(clinicaId);
  const inicio = new Date(Date.now() + 20 * 3_600_000).toISOString(); // 20h a 28h à frente
  const fim = new Date(Date.now() + 28 * 3_600_000).toISOString();

  const { data: ags, error } = await db
    .from('agendamentos')
    .select('id, paciente_id, inicio, procedimento, profissionais(nome)')
    .eq('status', 'agendado')
    .gte('inicio', inicio)
    .lte('inicio', fim);
  if (error) return log('confirmacoes24h', error.message);

  for (const a of ags) {
    if (await jaEnfileirado(db, 'confirmacao_24h', a.id)) continue;
    await enfileirar(db, clinicaId, a.paciente_id, 'confirmacao_24h', {
      agendamento_id: a.id,
      inicio: a.inicio,
      procedimento: a.procedimento,
      dentista: a.profissionais?.nome,
    });
  }
}

// ------------------------------------------------------------
// Lembrete 2h antes: agendados ou confirmados
// ------------------------------------------------------------
async function gerarLembretes2h(clinicaId) {
  const db = clientDaClinica(clinicaId);
  const inicio = new Date(Date.now() + 90 * 60_000).toISOString(); // 1h30 a 2h30 à frente
  const fim = new Date(Date.now() + 150 * 60_000).toISOString();

  const { data: ags, error } = await db
    .from('agendamentos')
    .select('id, paciente_id, inicio')
    .in('status', ['agendado', 'confirmado'])
    .gte('inicio', inicio)
    .lte('inicio', fim);
  if (error) return log('lembretes2h', error.message);

  for (const a of ags) {
    if (await jaEnfileirado(db, 'lembrete_2h', a.id)) continue;
    await enfileirar(db, clinicaId, a.paciente_id, 'lembrete_2h', {
      agendamento_id: a.id,
      inicio: a.inicio,
    });
  }
}

// ------------------------------------------------------------
// Recuperação de inativos (respeita opt-out de campanhas + limite diário)
// ------------------------------------------------------------
async function recuperarInativos(clinicaId) {
  const db = clientDaClinica(clinicaId);

  const hoje = new Date().toISOString().slice(0, 10);
  const { count } = await db
    .from('outbox')
    .select('id', { count: 'exact', head: true })
    .eq('template', 'recuperacao')
    .gte('criado_em', `${hoje}T00:00:00Z`);
  const restante = LIMITE_RECUPERACAO_DIA - (count || 0);
  if (restante <= 0) return;

  const { data: inativos, error } = await db
    .from('v_pacientes_inativos')
    .select('*')
    .limit(restante);
  if (error) return log('recuperacao', error.message);

  for (const p of inativos) {
    if (await optOutCampanhas(db, p.paciente_id)) continue;
    if (await contatadoRecentemente(db, p.paciente_id, 'recuperacao', 60)) continue;
    await enfileirar(db, clinicaId, p.paciente_id, 'recuperacao', {
      ultima_consulta: p.ultima_consulta,
    });
  }
}

// ------------------------------------------------------------
// Aniversariantes do dia
// ------------------------------------------------------------
async function felicitarAniversariantes(clinicaId) {
  const db = clientDaClinica(clinicaId);
  const { data: nivers, error } = await db.from('v_aniversariantes_hoje').select('*');
  if (error) return log('aniversario', error.message);

  for (const p of nivers) {
    if (await optOutCampanhas(db, p.paciente_id)) continue;
    if (await contatadoRecentemente(db, p.paciente_id, 'aniversario', 300)) continue; // 1x/ano
    await enfileirar(db, clinicaId, p.paciente_id, 'aniversario', {});
  }
}

// ------------------------------------------------------------
// Pesquisa de satisfação: consultas concluídas nas últimas 24h
// ------------------------------------------------------------
async function gerarPesquisas(clinicaId) {
  const db = clientDaClinica(clinicaId);
  const ontem = new Date(Date.now() - 24 * 3_600_000).toISOString();

  const { data: ags, error } = await db
    .from('agendamentos')
    .select('id, paciente_id, procedimento')
    .eq('status', 'concluido')
    .gte('atualizado_em', ontem);
  if (error) return log('pesquisa', error.message);

  for (const a of ags) {
    if (await jaEnfileirado(db, 'pesquisa_satisfacao', a.id)) continue;
    await enfileirar(db, clinicaId, a.paciente_id, 'pesquisa_satisfacao', {
      agendamento_id: a.id,
      procedimento: a.procedimento,
    });
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
async function jaEnfileirado(db, template, agendamentoId) {
  const { data, error } = await db
    .from('outbox')
    .select('id')
    .eq('template', template)
    .eq('payload->>agendamento_id', agendamentoId)
    .limit(1);
  if (error) { log('dedup', error.message); return true; } // na dúvida, não duplica
  return data.length > 0;
}

async function optOutCampanhas(db, pacienteId) {
  const { data } = await db
    .from('consentimentos_lgpd')
    .select('concedido')
    .eq('paciente_id', pacienteId)
    .eq('finalidade', 'campanhas')
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? data.concedido === false : false; // sem registro = pode (opt-out)
}

async function contatadoRecentemente(db, pacienteId, template, dias) {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const { data } = await db
    .from('outbox')
    .select('id')
    .eq('paciente_id', pacienteId)
    .eq('template', template)
    .gte('criado_em', desde)
    .limit(1);
  return (data || []).length > 0;
}

async function enfileirar(db, clinicaId, pacienteId, template, payload) {
  const { error } = await db.from('outbox').insert({
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    template,
    payload,
  });
  if (error) log(template, error.message);
}

function log(origem, msg) {
  console.error(`[agendadores:${origem}]`, msg);
}

module.exports = {
  gerarConfirmacoes24h,
  gerarLembretes2h,
  recuperarInativos,
  felicitarAniversariantes,
  gerarPesquisas,
};
