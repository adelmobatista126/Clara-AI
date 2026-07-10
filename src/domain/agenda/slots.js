// ============================================================
// CLARA — Domínio: geração de slots disponíveis
// Função PURA: sem banco, sem I/O. Totalmente testável.
// ============================================================

/**
 * Verifica sobreposição entre dois intervalos [aIni, aFim) e [bIni, bFim)
 */
function sobrepoe(aIni, aFim, bIni, bFim) {
  return aIni < bFim && bIni < aFim;
}

/**
 * Gera os slots livres de UM profissional em UMA data.
 *
 * @param {Object} p
 * @param {Date}   p.data           - dia alvo (qualquer horário; só a data importa)
 * @param {Array}  p.grade          - linhas de profissional_horarios do dia da semana
 *                                    [{ hora_inicio:'08:00', hora_fim:'12:00', duracao_slot_min:30 }]
 * @param {Array}  p.ocupados       - agendamentos ativos [{ inicio:Date, fim:Date }]
 * @param {Array}  p.bloqueios      - bloqueios [{ inicio:Date, fim:Date }]
 * @param {Date}   [p.agora]        - referência de "agora" (injetável p/ teste)
 * @param {number} [p.antecedenciaMin=60] - antecedência mínima p/ oferecer slot
 * @returns {Array<{inicio:Date, fim:Date}>}
 */
function gerarSlots({ data, grade, ocupados = [], bloqueios = [], agora = new Date(), antecedenciaMin = 60 }) {
  const slots = [];
  const limiteMinimo = new Date(agora.getTime() + antecedenciaMin * 60_000);

  for (const faixa of grade) {
    const dur = (faixa.duracao_slot_min || 30) * 60_000;
    let cursor = combinar(data, faixa.hora_inicio);
    const fimFaixa = combinar(data, faixa.hora_fim);

    while (cursor.getTime() + dur <= fimFaixa.getTime()) {
      const ini = new Date(cursor);
      const fim = new Date(cursor.getTime() + dur);

      const noPassado = ini < limiteMinimo;
      const conflita = [...ocupados, ...bloqueios].some((o) =>
        sobrepoe(ini, fim, new Date(o.inicio), new Date(o.fim))
      );

      if (!noPassado && !conflita) slots.push({ inicio: ini, fim });
      cursor = fim;
    }
  }
  return slots;
}

/** Combina a data (Y-M-D) com um horário 'HH:MM' ou 'HH:MM:SS' */
function combinar(data, hora) {
  const [h, m] = String(hora).split(':').map(Number);
  const d = new Date(data);
  d.setHours(h, m || 0, 0, 0);
  return d;
}

module.exports = { gerarSlots, sobrepoe, combinar };
