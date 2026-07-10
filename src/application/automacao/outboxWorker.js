// ============================================================
// CLARA — Application: Worker da Outbox
// A cada ciclo: pega pendentes vencidos, renderiza, envia,
// marca enviado/erro. Retry com backoff. Nada se perde.
// ============================================================
const { clientDaClinica } = require('../../infrastructure/supabase');
const { enviarTexto } = require('../../infrastructure/evolutionApi');
const { renderizar } = require('../../domain/automacao/templates');

const MAX_TENTATIVAS = 3;
const BACKOFF_MIN = 5; // minutos * nº da tentativa

/**
 * Processa a fila de UMA clínica.
 * @param {Object} clinica - { id, nome, config }
 */
async function processarFila(clinica) {
  const db = clientDaClinica(clinica.id);
  const instancia = clinica.config?.evolution_instancia;
  if (!instancia) {
    console.error(`[outbox] clínica ${clinica.nome} sem config.evolution_instancia`);
    return { enviadas: 0 };
  }

  const { data: pendentes, error } = await db
    .from('outbox')
    .select('*, pacientes(nome, telefone)')
    .eq('clinica_id', clinica.id)
    .eq('status', 'pendente')
    .lte('agendado_para', new Date().toISOString())
    .order('agendado_para')
    .limit(25);

  if (error) {
    console.error('[outbox] erro ao ler fila:', error.message);
    return { enviadas: 0 };
  }

  let enviadas = 0;
  for (const item of pendentes) {
    const texto = renderizar(item.template, item.payload, {
      pacienteNome: item.pacientes?.nome,
      clinicaNome: clinica.nome,
    });

    if (!texto) {
      await db.from('outbox')
        .update({ status: 'erro', ultimo_erro: `template desconhecido: ${item.template}` })
        .eq('id', item.id);
      continue;
    }

    try {
      await enviarTexto(instancia, item.pacientes.telefone, texto);
      await db.from('outbox')
        .update({ status: 'enviado', enviado_em: new Date().toISOString() })
        .eq('id', item.id);

      // Registra no histórico da conversa ativa do paciente (se houver)
      await registrarNoHistorico(db, clinica.id, item.paciente_id, texto);
      enviadas++;
    } catch (e) {
      const tentativas = item.tentativas + 1;
      const esgotou = tentativas >= MAX_TENTATIVAS;
      await db.from('outbox')
        .update({
          tentativas,
          ultimo_erro: e.message,
          status: esgotou ? 'erro' : 'pendente',
          agendado_para: esgotou
            ? item.agendado_para
            : new Date(Date.now() + BACKOFF_MIN * tentativas * 60_000).toISOString(),
        })
        .eq('id', item.id);
      console.error(`[outbox] falha (${tentativas}/${MAX_TENTATIVAS}) item ${item.id}:`, e.message);
    }
  }

  return { enviadas };
}

async function registrarNoHistorico(db, clinicaId, pacienteId, texto) {
  const { data: conversa } = await db
    .from('conversas')
    .select('id')
    .eq('clinica_id', clinicaId)
    .eq('paciente_id', pacienteId)
    .eq('status', 'ativa')
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conversa) return;

  const { error } = await db.from('mensagens').insert({
    clinica_id: clinicaId,
    conversa_id: conversa.id,
    direcao: 'saida',
    autor: 'clara',
    conteudo: texto,
  });
  if (error) console.error('[outbox] falha ao registrar histórico:', error.message);
}

module.exports = { processarFila };
