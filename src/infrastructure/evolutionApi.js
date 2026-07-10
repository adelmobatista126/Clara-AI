// ============================================================
// CLARA — Infraestrutura: Evolution API (WhatsApp)
// Envio de mensagens de texto. Instância por clínica.
// ============================================================

/**
 * Envia texto via Evolution API.
 * @param {string} instancia - nome da instância Evolution da clínica
 * @param {string} telefone  - número do paciente (E.164, sem '+')
 * @param {string} texto
 */
async function enviarTexto(instancia, telefone, texto) {
  const url = `${process.env.EVOLUTION_API_URL}/message/sendText/${instancia}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.EVOLUTION_API_KEY,
    },
    body: JSON.stringify({
      number: telefone,
      text: texto,
      delay: 1200, // "digitando..." — parece humano
    }),
  });

  if (!resp.ok) {
    const corpo = await resp.text();
    throw new Error(`Evolution API ${resp.status}: ${corpo}`);
  }
  return resp.json();
}

module.exports = { enviarTexto };
