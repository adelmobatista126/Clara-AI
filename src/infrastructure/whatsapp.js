// ============================================================
// CLARA — Infraestrutura: WhatsApp Cloud API (Meta, oficial)
// Envio de mensagens de texto livre. Válido apenas dentro da
// janela de 24h após a última mensagem do paciente (mensagem
// de "serviço"). Fora dessa janela, a Meta exige um template
// pré-aprovado — não coberto por esta função.
// ============================================================

const GRAPH_VERSION = 'v25.0';

/**
 * Envia texto via WhatsApp Cloud API.
 * @param {string} telefone - número do paciente, com ou sem símbolos (será normalizado)
 * @param {string} texto
 * @param {string} [phoneNumberId] - Identificação do número de telefone na Meta (default: variável de ambiente)
 */
async function enviarTexto(telefone, texto, phoneNumberId = process.env.META_PHONE_NUMBER_ID) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error('META_ACCESS_TOKEN não configurado');
  if (!phoneNumberId) throw new Error('META_PHONE_NUMBER_ID não configurado');

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: normalizarTelefone(telefone),
      type: 'text',
      text: { body: texto },
    }),
  });

  if (!resp.ok) {
    const corpo = await resp.text();
    throw new Error(`WhatsApp Cloud API ${resp.status}: ${corpo}`);
  }
  return resp.json();
}

/**
 * Envia um template pré-aprovado (obrigatório fora da janela de 24h:
 * confirmações, lembretes, recuperação, aniversário, pesquisa).
 * @param {string} telefone
 * @param {string} nomeTemplate - nome exato do template aprovado no Gerenciador do WhatsApp
 * @param {string[]} parametros - valores para preencher as variáveis {{1}}, {{2}}... do template
 * @param {string} [phoneNumberId]
 */
async function enviarTemplate(telefone, nomeTemplate, parametros = [], phoneNumberId = process.env.META_PHONE_NUMBER_ID) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error('META_ACCESS_TOKEN não configurado');
  if (!phoneNumberId) throw new Error('META_PHONE_NUMBER_ID não configurado');

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: normalizarTelefone(telefone),
      type: 'template',
      template: {
        name: nomeTemplate,
        language: { code: 'pt_BR' },
        components: parametros.length
          ? [{ type: 'body', parameters: parametros.map((p) => ({ type: 'text', text: String(p) })) }]
          : undefined,
      },
    }),
  });

  if (!resp.ok) {
    const corpo = await resp.text();
    throw new Error(`WhatsApp Cloud API (template) ${resp.status}: ${corpo}`);
  }
  return resp.json();
}

function normalizarTelefone(telefone) {
  return String(telefone).replace(/\D/g, '');
}

module.exports = { enviarTexto, enviarTemplate, normalizarTelefone };
