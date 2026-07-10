// ============================================================
// CLARA — Interfaces: Webhook WhatsApp (Evolution API)
// Debounce de 6s: paciente manda 3 mensagens picadas,
// a Clara lê tudo e responde UMA vez — como uma pessoa faria.
// ============================================================
const { Router } = require('express');
const { clientDaClinica } = require('../../infrastructure/supabase');
const { processarMensagem } = require('../../application/atendimento/atendimentoService');

const router = Router();

const DEBOUNCE_MS = Number(process.env.CLARA_DEBOUNCE_MS || 6000);
const buffers = new Map(); // `${clinicaId}:${telefone}` -> { textos, timer, ... }

// Mapeia instância Evolution -> clínica (cache simples em memória)
const instanciaCache = new Map();
async function clinicaDaInstancia(instancia) {
  if (instanciaCache.has(instancia)) return instanciaCache.get(instancia);
  // Convenção: config.evolution_instancia na tabela clinicas.
  // Aqui varremos via variável de ambiente de bootstrap OU config:
  const mapa = JSON.parse(process.env.CLARA_INSTANCIAS || '{}'); // { "instancia": "clinica_uuid" }
  const clinicaId = mapa[instancia];
  if (clinicaId) instanciaCache.set(instancia, clinicaId);
  return clinicaId;
}

// POST /webhook/whatsapp  (configurar na Evolution: evento messages.upsert)
router.post('/whatsapp', async (req, res) => {
  // Responde IMEDIATAMENTE — Evolution reenvia se demorar
  res.status(200).json({ ok: true });

  try {
    const evento = req.body;
    const dados = evento?.data;
    if (!dados || evento.event !== 'messages.upsert') return;
    if (dados.key?.fromMe) return; // mensagem enviada pela própria clínica

    const instancia = evento.instance;
    const clinicaId = await clinicaDaInstancia(instancia);
    if (!clinicaId) {
      console.error(`[webhook] instância desconhecida: ${instancia}`);
      return;
    }

    const telefone = (dados.key?.remoteJid || '').replace('@s.whatsapp.net', '');
    if (!telefone || telefone.includes('@g.us')) return; // ignora grupos

    const texto =
      dados.message?.conversation ||
      dados.message?.extendedTextMessage?.text ||
      null;
    if (!texto) {
      // Áudio/imagem/documento: por ora, transfere educadamente (v2: transcrição)
      agendarProcessamento({
        clinicaId,
        instancia,
        telefone,
        texto: '[paciente enviou uma mídia que não consigo abrir — peça gentilmente para escrever em texto ou transfira]',
        msgExternaId: dados.key?.id,
        nomePush: dados.pushName,
      });
      return;
    }

    agendarProcessamento({
      clinicaId,
      instancia,
      telefone,
      texto,
      msgExternaId: dados.key?.id,
      nomePush: dados.pushName,
    });
  } catch (e) {
    console.error('[webhook] erro:', e.message);
  }
});

// ---------- Debounce ----------
function agendarProcessamento({ clinicaId, instancia, telefone, texto, msgExternaId, nomePush }) {
  const chave = `${clinicaId}:${telefone}`;
  const atual = buffers.get(chave) || { textos: [], ids: [] };

  atual.textos.push(texto);
  atual.ids.push(msgExternaId);
  atual.instancia = instancia;
  atual.nomePush = nomePush;

  if (atual.timer) clearTimeout(atual.timer);
  atual.timer = setTimeout(async () => {
    buffers.delete(chave);
    try {
      await processarMensagem({
        clinicaId,
        instancia: atual.instancia,
        telefone,
        texto: atual.textos.join('\n'),
        msgExternaId: atual.ids[atual.ids.length - 1], // idempotência pela última
        nomePush: atual.nomePush,
      });
    } catch (e) {
      console.error('[atendimento] erro no processamento:', e.message);
    }
  }, DEBOUNCE_MS);

  buffers.set(chave, atual);
}

module.exports = router;
