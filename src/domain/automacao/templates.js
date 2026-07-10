// ============================================================
// CLARA — Domínio: Templates de mensagens automáticas
// Funções puras: (payload, contexto) -> texto pronto p/ WhatsApp.
// Tom: recepcionista brasileira excelente. Curto, caloroso, com CTA.
// ============================================================

function hora(dt) {
  return new Date(dt).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

function dataCurta(dt) {
  return new Date(dt).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

function primeiroNome(nome) {
  return (nome || '').trim().split(' ')[0] || 'tudo bem';
}

const TEMPLATES = {
  confirmacao_agendamento: (p, ctx) =>
    `Prontinho, ${primeiroNome(ctx.pacienteNome)}! 😊 Sua consulta de ${p.procedimento} está agendada para ${dataCurta(p.inicio)} às ${hora(p.inicio)}. Qualquer coisa é só me chamar por aqui!`,

  confirmacao_24h: (p, ctx) =>
    `Oi, ${primeiroNome(ctx.pacienteNome)}! Aqui é a Clara, da ${ctx.clinicaNome}. 😊 Passando pra confirmar sua consulta de amanhã às ${hora(p.inicio)}${p.dentista ? ` com ${p.dentista}` : ''}. Você confirma? É só responder SIM. Se precisar remarcar, me avisa que resolvo pra você!`,

  lembrete_2h: (p, ctx) =>
    `${primeiroNome(ctx.pacienteNome)}, sua consulta na ${ctx.clinicaNome} é daqui a pouco, às ${hora(p.inicio)}! Já estamos te esperando. 🦷✨`,

  vaga_disponivel: (p, ctx) =>
    `Oi, ${primeiroNome(ctx.pacienteNome)}! Boa notícia: abriu uma vaga ${p.procedimento ? `para ${p.procedimento} ` : ''}no dia ${dataCurta(p.inicio)} às ${hora(p.inicio)}. Você estava na nossa lista de espera — quer aproveitar? Responda SIM que eu já garanto pra você! ⏰`,

  recuperacao: (p, ctx) =>
    `Oi, ${primeiroNome(ctx.pacienteNome)}! Aqui é a Clara, da ${ctx.clinicaNome}. 😊 Faz um tempinho que não te vemos por aqui e sentimos sua falta! Que tal agendar uma avaliação pra manter seu sorriso em dia? Se quiser, já te mando os horários disponíveis.`,

  aniversario: (p, ctx) =>
    `Feliz aniversário, ${primeiroNome(ctx.pacienteNome)}! 🎉🎂 Toda a equipe da ${ctx.clinicaNome} te deseja um dia incrível, com muitos motivos pra sorrir!`,

  pesquisa_satisfacao: (p, ctx) =>
    `Oi, ${primeiroNome(ctx.pacienteNome)}! Aqui é a Clara, da ${ctx.clinicaNome}. Como foi sua consulta${p.procedimento ? ` de ${p.procedimento}` : ''}? De 0 a 10, que nota você daria pro nosso atendimento? Sua opinião vale ouro pra gente! 💙`,
};

/**
 * Renderiza um template.
 * @returns {string|null} texto pronto, ou null se template desconhecido
 */
function renderizar(template, payload, contexto) {
  const fn = TEMPLATES[template];
  if (!fn) return null;
  return fn(payload || {}, contexto || {});
}

module.exports = { renderizar, TEMPLATES };
