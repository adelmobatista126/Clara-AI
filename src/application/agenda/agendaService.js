// ============================================================
// CLARA — Application: Motor da Agenda
// Use cases: horários disponíveis, agendar, reagendar, cancelar.
// Padrão Supabase JS v2: SEMPRE { data, error }. Nunca .catch().
// ============================================================
const { clientDaClinica } = require('../../infrastructure/supabase');
const { gerarSlots } = require('../../domain/agenda/slots');
const listaEspera = require('./listaEsperaService');

const CODIGO_CONFLITO = '23P01'; // exclusion_violation (constraint sem_conflito)

// ------------------------------------------------------------
// Horários disponíveis de um profissional num intervalo de dias
// ------------------------------------------------------------
async function horariosDisponiveis(clinicaId, { profissionalId, de, ate }) {
  const db = clientDaClinica(clinicaId);
  const dtDe = new Date(de);
  const dtAte = new Date(ate);

  const [grade, ags, blqs] = await Promise.all([
    db.from('profissional_horarios').select('*').eq('profissional_id', profissionalId),
    db.from('agendamentos')
      .select('inicio, fim')
      .eq('profissional_id', profissionalId)
      .in('status', ['agendado', 'confirmado'])
      .gte('inicio', dtDe.toISOString())
      .lte('fim', new Date(dtAte.getTime() + 86_400_000).toISOString()),
    db.from('agenda_bloqueios')
      .select('inicio, fim, profissional_id')
      .gte('fim', dtDe.toISOString())
      .lte('inicio', new Date(dtAte.getTime() + 86_400_000).toISOString()),
  ]);

  const erro = grade.error || ags.error || blqs.error;
  if (erro) return { erro: erro.message };

  const bloqueiosProf = blqs.data.filter(
    (b) => !b.profissional_id || b.profissional_id === profissionalId
  );

  const resultado = [];
  for (let d = new Date(dtDe); d <= dtAte; d.setDate(d.getDate() + 1)) {
    const gradeDia = grade.data.filter((g) => g.dia_semana === d.getDay());
    if (!gradeDia.length) continue;
    const slots = gerarSlots({
      data: new Date(d),
      grade: gradeDia,
      ocupados: ags.data,
      bloqueios: bloqueiosProf,
    });
    if (slots.length) resultado.push({ dia: d.toISOString().slice(0, 10), slots });
  }
  return { dias: resultado };
}

// ------------------------------------------------------------
// Agendar — o banco garante que não há conflito (23P01)
// ------------------------------------------------------------
async function agendar(clinicaId, { pacienteId, profissionalId, procedimento, inicio, duracaoMin = 30, origem = 'clara' }) {
  const db = clientDaClinica(clinicaId);
  const ini = new Date(inicio);
  const fim = new Date(ini.getTime() + duracaoMin * 60_000);

  const { data, error } = await db
    .from('agendamentos')
    .insert({
      clinica_id: clinicaId,
      paciente_id: pacienteId,
      profissional_id: profissionalId,
      procedimento,
      inicio: ini.toISOString(),
      fim: fim.toISOString(),
      origem,
    })
    .select()
    .single();

  if (error) {
    if (error.code === CODIGO_CONFLITO) {
      // Vaga foi tomada por outra conversa: oferecer alternativas do mesmo dia
      const alt = await horariosDisponiveis(clinicaId, {
        profissionalId,
        de: ini.toISOString().slice(0, 10),
        ate: ini.toISOString().slice(0, 10),
      });
      return { conflito: true, alternativas: alt.dias || [] };
    }
    return { erro: error.message };
  }

  // Enfileira confirmação (o worker de automação envia)
  await enfileirar(db, clinicaId, pacienteId, 'confirmacao_agendamento', {
    agendamento_id: data.id,
    inicio: data.inicio,
    procedimento,
  });

  return { agendamento: data };
}

// ------------------------------------------------------------
// Reagendar — cancela o antigo e cria o novo com rastreio
// ------------------------------------------------------------
async function reagendar(clinicaId, agendamentoId, { novoInicio, duracaoMin = 30 }) {
  const db = clientDaClinica(clinicaId);

  const atual = await db.from('agendamentos').select('*').eq('id', agendamentoId).single();
  if (atual.error) return { erro: atual.error.message };

  const novo = await agendar(clinicaId, {
    pacienteId: atual.data.paciente_id,
    profissionalId: atual.data.profissional_id,
    procedimento: atual.data.procedimento,
    inicio: novoInicio,
    duracaoMin,
  });
  if (novo.conflito || novo.erro) return novo; // não cancela o antigo se o novo falhou

  const upd = await db
    .from('agendamentos')
    .update({ status: 'cancelado', cancelado_em: new Date().toISOString(), motivo_cancel: 'reagendado' })
    .eq('id', agendamentoId);
  if (upd.error) return { erro: upd.error.message };

  await db.from('agendamentos').update({ reagendado_de: agendamentoId }).eq('id', novo.agendamento.id);

  // A vaga antiga abriu: tenta preencher pela lista de espera
  await listaEspera.preencherVaga(clinicaId, {
    profissionalId: atual.data.profissional_id,
    inicio: atual.data.inicio,
    fim: atual.data.fim,
  });

  return novo;
}

// ------------------------------------------------------------
// Cancelar — e acionar preenchimento automático da vaga
// ------------------------------------------------------------
async function cancelar(clinicaId, agendamentoId, { motivo = 'paciente solicitou' } = {}) {
  const db = clientDaClinica(clinicaId);

  const { data, error } = await db
    .from('agendamentos')
    .update({ status: 'cancelado', cancelado_em: new Date().toISOString(), motivo_cancel: motivo })
    .eq('id', agendamentoId)
    .in('status', ['agendado', 'confirmado'])
    .select()
    .single();

  if (error) return { erro: error.message };
  if (!data) return { erro: 'Agendamento não encontrado ou já finalizado.' };

  const preenchimento = await listaEspera.preencherVaga(clinicaId, {
    profissionalId: data.profissional_id,
    inicio: data.inicio,
    fim: data.fim,
  });

  return { cancelado: data, vaga: preenchimento };
}

// ------------------------------------------------------------
// Confirmar presença (resposta do paciente ao lembrete)
// ------------------------------------------------------------
async function confirmar(clinicaId, agendamentoId) {
  const db = clientDaClinica(clinicaId);
  const { data, error } = await db
    .from('agendamentos')
    .update({ status: 'confirmado', confirmado_em: new Date().toISOString() })
    .eq('id', agendamentoId)
    .eq('status', 'agendado')
    .select()
    .single();
  if (error) return { erro: error.message };
  return { agendamento: data };
}

// ------------------------------------------------------------
async function enfileirar(db, clinicaId, pacienteId, template, payload) {
  const { error } = await db.from('outbox').insert({
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    template,
    payload,
  });
  if (error) console.error('[outbox] falha ao enfileirar:', error.message);
}

module.exports = { horariosDisponiveis, agendar, reagendar, cancelar, confirmar };
