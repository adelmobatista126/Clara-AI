// ============================================================
// CLARA — Interfaces: Webhook WhatsApp (Meta Cloud API, oficial)
// Debounce de 6s: paciente manda 3 mensagens picadas,
// a Clara lê tudo e responde UMA vez — como uma pessoa faria.
// ============================================================
const { Router } = require('express');
const { processarMensagem } = require('../../application/atendimento/atendimentoService');
const { transcreverAudioMeta } = require('../../infrastructure/audio');
const { marcarLidaEDigitando } = require('../../infrastructure/whatsapp');

const router = Router();

const DEBOUNCE_MS = Number(process.env.CLARA_DEBOUNCE_MS || 6000);
const buffers = new Map(); // `${clinicaId}:${telefone}` -> { textos, ids, timer, nomePush }

// Mapeia phone_number_id da Meta -> clínica (CLARA_INSTANCIAS: { "phone_number_id": "clinica_uuid" })
function clinicaDoNumero(phoneNumberId) {
  const mapa = JSON.parse(process.env.CLARA_INSTANCIAS || '{}');
  return mapa[phoneNumberId];
}

// GET /webhook/whatsapp — verificação exigida pela Meta ao cadastrar o webhook
router.get('/whatsapp', (req, res) => {
  const modo = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const desafio = req.query['hub.challenge'];

  if (modo === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(desafio);
  }
  return res.sendStatus(403);
});

// POST /webhook/whatsapp — mensagens recebidas + status de entrega
router.post('/whatsapp', async (req, res) => {
  // Responde IMEDIATAMENTE — a Meta exige resposta em menos de 5s
  res.status(200).json({ ok: true });

  try {
    const entradas = req.body?.entry || [];
    console.log(`[webhook] POST recebido: ${entradas.length} entrada(s)`);

    for (const entrada of entradas) {
      for (const mudanca of entrada.changes || []) {
        const valor = mudanca.value;
        const phoneNumberId = valor?.metadata?.phone_number_id;

        // Eventos de status (enviada/entregue/lida/falhou) — só logamos por enquanto
        if (valor?.statuses) {
          for (const st of valor.statuses) {
            console.log(`[webhook] status de mensagem: ${st.status}`);
            if (st.status === 'failed') {
              console.error('[whatsapp] falha na entrega:', JSON.stringify(st.errors));
            }
          }
        }

        if (!valor?.messages) {
          console.log('[webhook] change sem "messages" (provavelmente só status) — ignorando');
          continue;
        }

        console.log(`[webhook] ${valor.messages.length} mensagem(ns) recebida(s) de phone_number_id=${phoneNumberId}`);

        const clinicaId = clinicaDoNumero(phoneNumberId);
        if (!clinicaId) {
          console.error(`[webhook] phone_number_id desconhecido: ${phoneNumberId} — confira CLARA_INSTANCIAS`);
          continue;
        }

        const nomePush = valor.contacts?.[0]?.profile?.name;

        for (const msg of valor.messages) {
          const telefone = msg.from;
          if (msg.type !== 'reaction') marcarLidaEDigitando(msg.id, phoneNumberId); // sem await: dispara e segue
          let texto = msg.text?.body || null;

          if (!texto && msg.type === 'reaction') {
            const emoji = msg.reaction?.emoji;
            if (!emoji) continue; // reação removida — ignorar
            texto = `[o paciente reagiu com ${emoji} à sua última mensagem]`;
          }

          if (!texto && msg.type === 'audio' && msg.audio?.id) {
            console.log('[webhook] audio recebido, transcrevendo...');
            const t = await transcreverAudioMeta(msg.audio.id);
            if (t.texto) { texto = t.texto; console.log('[webhook] transcrito: ' + texto.slice(0, 80)); }
            else {
              console.error('[webhook] falha na transcricao: ' + t.erro);
              agendarProcessamento({ clinicaId, telefone, texto: '[paciente enviou um áudio mas a transcrição falhou — peça desculpas e peça para escrever em texto]', msgExternaId: msg.id, nomePush });
              continue;
            }
          }

          if (!texto) {
            agendarProcessamento({
              clinicaId,
              telefone,
              texto: '[paciente enviou uma mídia que não consigo abrir — peça gentilmente para escrever em texto ou transfira]',
              msgExternaId: msg.id,
              nomePush,
            });
            continue;
          }

          agendarProcessamento({ clinicaId, telefone, texto, msgExternaId: msg.id, nomePush });
        }
      }
    }
  } catch (e) {
    console.error('[webhook] erro:', e.message);
  }
});

// ---------- Debounce ----------
function agendarProcessamento({ clinicaId, telefone, texto, msgExternaId, nomePush }) {
  const chave = `${clinicaId}:${telefone}`;
  const atual = buffers.get(chave) || { textos: [], ids: [] };

  atual.textos.push(texto);
  atual.ids.push(msgExternaId);
  atual.nomePush = nomePush;

  if (atual.timer) clearTimeout(atual.timer);
  atual.timer = setTimeout(async () => {
    buffers.delete(chave);
    try {
      await processarMensagem({
        clinicaId,
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
