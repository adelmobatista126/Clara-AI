// ============================================================
// CLARA — Domínio: Ferramentas do Atendimento
// A IA conversa; quem executa é o motor determinístico.
// ============================================================
const agenda = require('../../application/agenda/agendaService');
const listaEspera = require('../../application/agenda/listaEsperaService');

// ---------- Definições (JSON Schema p/ Claude API) ----------
const FERRAMENTAS = [
  {
    name: 'consultar_horarios',
    description: 'Consulta os horários disponíveis de um dentista em um intervalo de datas. Use SEMPRE antes de afirmar qualquer horário ao paciente.',
    input_schema: {
      type: 'object',
      properties: {
        profissional_id: { type: 'string', description: 'id do dentista (ver lista no contexto)' },
        de: { type: 'string', description: 'data inicial YYYY-MM-DD' },
        ate: { type: 'string', description: 'data final YYYY-MM-DD' },
      },
      required: ['profissional_id', 'de', 'ate'],
    },
  },
  {
    name: 'agendar_consulta',
    description: 'Agenda uma consulta APÓS o paciente confirmar procedimento, dentista, data e hora.',
    input_schema: {
      type: 'object',
      properties: {
        profissional_id: { type: 'string' },
        procedimento: { type: 'string' },
        inicio: { type: 'string', description: 'data/hora ISO 8601, ex: 2026-07-15T14:00:00-03:00' },
        duracao_min: { type: 'integer', default: 30 },
      },
      required: ['profissional_id', 'procedimento', 'inicio'],
    },
  },
  {
    name: 'reagendar_consulta',
    description: 'Reagenda uma consulta existente para novo horário confirmado pelo paciente.',
    input_schema: {
      type: 'object',
      properties: {
        agendamento_id: { type: 'string', description: 'id do agendamento (ver agendamentos futuros no contexto)' },
        novo_inicio: { type: 'string', description: 'data/hora ISO 8601' },
      },
      required: ['agendamento_id', 'novo_inicio'],
    },
  },
  {
    name: 'cancelar_consulta',
    description: 'Cancela uma consulta a pedido do paciente. Antes de cancelar, ofereça reagendar.',
    input_schema: {
      type: 'object',
      properties: {
        agendamento_id: { type: 'string' },
        motivo: { type: 'string' },
      },
      required: ['agendamento_id'],
    },
  },
  {
    name: 'confirmar_presenca',
    description: 'Confirma a presença do paciente em uma consulta agendada (ex: quando responde SIM a um lembrete).',
    input_schema: {
      type: 'object',
      properties: { agendamento_id: { type: 'string' } },
      required: ['agendamento_id'],
    },
  },
  {
    name: 'entrar_lista_espera',
    description: 'Coloca o paciente na lista de espera quando não há horário que o atenda. Avisaremos assim que abrir uma vaga.',
    input_schema: {
      type: 'object',
      properties: {
        profissional_id: { type: 'string', description: 'opcional; omitir = qualquer dentista' },
        procedimento: { type: 'string' },
        periodo_preferido: { type: 'string', enum: ['manha', 'tarde', 'qualquer'] },
      },
      required: ['procedimento'],
    },
  },
  {
    name: 'transferir_para_humano',
    description: 'Transfere a conversa para a equipe da clínica. Use quando: paciente pedir, houver urgência/dor/emergência, assunto clínico, reclamação séria, ou você não tiver a informação.',
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string' } },
      required: ['motivo'],
    },
  },
];

// ---------- Dispatcher ----------
/**
 * Executa a ferramenta pedida pela IA.
 * @returns {Promise<Object>} resultado serializável p/ tool_result
 */
async function executar(nome, input, ctx) {
  const { clinicaId, pacienteId, conversaId, db } = ctx;

  switch (nome) {
    case 'consultar_horarios':
      return agenda.horariosDisponiveis(clinicaId, {
        profissionalId: input.profissional_id,
        de: input.de,
        ate: input.ate,
      });

    case 'agendar_consulta':
      return agenda.agendar(clinicaId, {
        pacienteId,
        profissionalId: input.profissional_id,
        procedimento: input.procedimento,
        inicio: input.inicio,
        duracaoMin: input.duracao_min || 30,
        origem: 'clara',
      });

    case 'reagendar_consulta':
      return agenda.reagendar(clinicaId, input.agendamento_id, {
        novoInicio: input.novo_inicio,
      });

    case 'cancelar_consulta':
      return agenda.cancelar(clinicaId, input.agendamento_id, { motivo: input.motivo });

    case 'confirmar_presenca':
      return agenda.confirmar(clinicaId, input.agendamento_id);

    case 'entrar_lista_espera':
      return listaEspera.entrar(clinicaId, {
        pacienteId,
        profissionalId: input.profissional_id || null,
        procedimento: input.procedimento,
        periodoPreferido: input.periodo_preferido || 'qualquer',
      });

    case 'transferir_para_humano': {
      const { error } = await db
        .from('conversas')
        .update({ status: 'transferida_humano', transferida_em: new Date().toISOString() })
        .eq('id', conversaId);
      if (error) return { erro: error.message };
      return { transferida: true, motivo: input.motivo };
    }

    default:
      return { erro: `Ferramenta desconhecida: ${nome}` };
  }
}

module.exports = { FERRAMENTAS, executar };
