// ============================================================
// CLARA — Application: Lista de Espera Inteligente
// Quando uma vaga abre, o melhor candidato é contatado via outbox.
// ============================================================
const { clientDaClinica } = require('../../infrastructure/supabase');

// ------------------------------------------------------------
// Entrar na lista de espera
// ------------------------------------------------------------
async function entrar(clinicaId, { pacienteId, profissionalId = null, procedimento, periodoPreferido = 'qualquer', prioridade = 5 }) {
  const db = clientDaClinica(clinicaId);
  const { data, error } = await db
    .from('lista_espera')
    .insert({
      clinica_id: clinicaId,
      paciente_id: pacienteId,
      profissional_id: profissionalId,
      procedimento,
      periodo_preferido: periodoPreferido,
      prioridade,
    })
    .select()
    .single();
  if (error) return { erro: error.message };
  return { entrada: data };
}

// ------------------------------------------------------------
// Preencher vaga que abriu (chamado por cancelar/reagendar)
// Regras de match: mesmo profissional (ou "qualquer"),
// período compatível, ordenado por prioridade e antiguidade.
// ------------------------------------------------------------
async function preencherVaga(clinicaId, { profissionalId, inicio, fim }) {
  const db = clientDaClinica(clinicaId);
  const hora = new Date(inicio).getHours();
  const periodoDaVaga = hora < 12 ? 'manha' : 'tarde';

  const { data: candidatos, error } = await db
    .from('lista_espera')
    .select('*, pacientes(nome, telefone)')
    .eq('status', 'aguardando')
    .or(`profissional_id.eq.${profissionalId},profissional_id.is.null`)
    .in('periodo_preferido', [periodoDaVaga, 'qualquer'])
    .order('prioridade', { ascending: true })
    .order('criado_em', { ascending: true })
    .limit(1);

  if (error) return { erro: error.message };
  if (!candidatos.length) return { preenchida: false, motivo: 'lista de espera vazia' };

  const escolhido = candidatos[0];

  const upd = await db
    .from('lista_espera')
    .update({ status: 'contatado', contatado_em: new Date().toISOString() })
    .eq('id', escolhido.id)
    .eq('status', 'aguardando'); // proteção contra corrida
  if (upd.error) return { erro: upd.error.message };

  const enq = await db.from('outbox').insert({
    clinica_id: clinicaId,
    paciente_id: escolhido.paciente_id,
    template: 'vaga_disponivel',
    payload: {
      lista_espera_id: escolhido.id,
      profissional_id: profissionalId,
      inicio,
      fim,
      procedimento: escolhido.procedimento,
    },
  });
  if (enq.error) return { erro: enq.error.message };

  return { preenchida: true, candidato: escolhido.paciente_id };
}

module.exports = { entrar, preencherVaga };
