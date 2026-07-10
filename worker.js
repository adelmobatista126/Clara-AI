// ============================================================
// CLARA — Worker de Automação
// Ciclos:
//   outbox        -> a cada 30s
//   confirmações + lembretes -> a cada 15min
//   recuperação + aniversário + pesquisa -> 1x/dia (~08h Brasília)
//
// Lista de clínicas: ÚNICA operação com service_role (leitura de
// clinicas ativas). Todo o resto roda com JWT por clínica + RLS.
// ============================================================
const { clientDaClinica } = require('./src/infrastructure/supabase');
const { processarFila } = require('./src/application/automacao/outboxWorker');
const agendadores = require('./src/application/automacao/agendadores');

const CICLO_OUTBOX_MS = 30_000;
const CICLO_CURTO_MS = 15 * 60_000;
const HORA_DIARIA = 8; // horário de Brasília

let clinicasCache = { lista: [], em: 0 };

async function listarClinicas() {
  if (Date.now() - clinicasCache.em < 10 * 60_000) return clinicasCache.lista;
  const db = clientDaClinica();
  const { data, error } = await db.from('clinicas').select('id, nome, config').eq('ativo', true);
  if (error) {
    console.error('[worker] erro ao listar clínicas:', error.message);
    return clinicasCache.lista; // usa cache antigo em caso de falha
  }
  clinicasCache = { lista: data, em: Date.now() };
  return data;
}

// ---------- Ciclo 1: outbox (30s) ----------
async function cicloOutbox() {
  const clinicas = await listarClinicas();
  for (const c of clinicas) {
    try {
      const r = await processarFila(c);
      if (r.enviadas) console.log(`[outbox] ${c.nome}: ${r.enviadas} enviada(s)`);
    } catch (e) {
      console.error(`[outbox] ${c.nome}:`, e.message);
    }
  }
}

// ---------- Ciclo 2: confirmações + lembretes (15min) ----------
async function cicloCurto() {
  const clinicas = await listarClinicas();
  for (const c of clinicas) {
    try {
      await agendadores.gerarConfirmacoes24h(c.id);
      await agendadores.gerarLembretes2h(c.id);
    } catch (e) {
      console.error(`[ciclo-curto] ${c.nome}:`, e.message);
    }
  }
}

// ---------- Ciclo 3: diário (recuperação, aniversário, pesquisa) ----------
let ultimoDiaExecutado = null;
async function cicloDiario() {
  const agoraBr = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
  );
  const hoje = agoraBr.toISOString().slice(0, 10);
  if (agoraBr.getHours() < HORA_DIARIA || ultimoDiaExecutado === hoje) return;
  ultimoDiaExecutado = hoje;

  const clinicas = await listarClinicas();
  for (const c of clinicas) {
    try {
      await agendadores.felicitarAniversariantes(c.id);
      await agendadores.gerarPesquisas(c.id);
      await agendadores.recuperarInativos(c.id);
      console.log(`[ciclo-diario] ${c.nome}: ok`);
    } catch (e) {
      console.error(`[ciclo-diario] ${c.nome}:`, e.message);
    }
  }
}

function iniciar() {
  console.log('Worker de automação da Clara iniciado ⚙️');
  setInterval(cicloOutbox, CICLO_OUTBOX_MS);
  setInterval(cicloCurto, CICLO_CURTO_MS);
  setInterval(cicloDiario, 5 * 60_000); // checa a cada 5min se já é hora do diário
  cicloOutbox();
  cicloCurto();
}

if (require.main === module) {
  require('dotenv').config();
  iniciar();
}

module.exports = { iniciar };
