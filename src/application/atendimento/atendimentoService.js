// ============================================================
// CLARA — Application: Motor de Atendimento
// Orquestra: paciente → contexto → Claude (com ferramentas) → resposta.
// ============================================================
const { clientDaClinica } = require('../../infrastructure/supabase');
const { enviarTexto } = require('../../infrastructure/whatsapp');
const { montarSystemPrompt } = require('../../domain/atendimento/persona');
const { FERRAMENTAS, executar } = require('../../domain/atendimento/ferramentas');

const MODELO = process.env.CLARA_MODEL || 'claude-sonnet-4-6';
const MAX_RODADAS_FERRAMENTA = 6;
const HISTORICO_MAX_MSGS = 30;

// ------------------------------------------------------------
// Entrada principal: processa mensagem(ns) recebida(s)
// ------------------------------------------------------------
async function processarMensagem({ clinicaId, telefone, texto, msgExternaId, nomePush }) {
  console.log(`[atendimento] processando: clinica=${clinicaId} telefone=${telefone} texto="${texto.slice(0, 80)}"`);
  const db = clientDaClinica(clinicaId);

  // 1. Idempotência: webhook duplicado é ignorado
  if (msgExternaId) {
    const dup = await db.from('mensagens').select('id').eq('msg_externa_id', msgExternaId).limit(1);
    if (!dup.error && dup.data.length) {
      console.log('[atendimento] parou: mensagem duplicada (idempotência)');
      return { ignorada: 'duplicada' };
    }
  }

  // 2. Paciente: busca ou cria pelo telefone
  const paciente = await obterOuCriarPaciente(db, clinicaId, telefone, nomePush);
  if (paciente.erro) {
    console.error('[atendimento] parou: erro ao obter/criar paciente:', paciente.erro);
    return paciente;
  }

  // 3. Conversa ativa: busca ou cria
  const conversa = await obterOuCriarConversa(db, clinicaId, paciente.id);
  if (conversa.erro) {
    console.error('[atendimento] parou: erro ao obter/criar conversa:', conversa.erro);
    return conversa;
  }

  // 4. Salva a mensagem de entrada (histórico completo, sempre)
  const insMsg = await db.from('mensagens').insert({
    clinica_id: clinicaId,
    conversa_id: conversa.id,
    direcao: 'entrada',
    autor: 'paciente',
    conteudo: texto,
    msg_externa_id: msgExternaId || null,
  });
  if (insMsg.error) {
    console.error('[atendimento] parou: erro ao salvar mensagem de entrada:', insMsg.error.message);
    return { erro: insMsg.error.message };
  }

  // 5. Conversa nas mãos da equipe humana → Clara silencia
  if (conversa.status === 'transferida_humano') {
    console.log('[atendimento] parou: conversa transferida para humano, Clara não responde');
    return { silenciada: 'conversa com equipe humana' };
  }

  // 6. Monta contexto e chama a IA
  const contexto = await montarContexto(db, clinicaId, paciente, conversa.id);
  if (contexto.erro) {
    console.error('[atendimento] parou: erro ao montar contexto:', contexto.erro);
    return contexto;
  }

  console.log('[atendimento] contexto montado, chamando Claude API...');
  const resposta = await conversarComClaude(contexto, {
    clinicaId,
    pacienteId: paciente.id,
    conversaId: conversa.id,
    db,
  });
  if (resposta.erro) {
    console.error(`[atendimento] IA falhou: ${resposta.erro}`);
    // Falha da IA nunca deixa paciente sem resposta
    const fallback = 'Desculpe, tive um probleminha técnico aqui. Já avisei a equipe e alguém te responde em instantes! 🙏';
    await registrarESviar(db, clinicaId, conversa.id, telefone, fallback, 'clara');
    await db.from('conversas')
      .update({ status: 'transferida_humano', transferida_em: new Date().toISOString() })
      .eq('id', conversa.id);
    return resposta;
  }

  // 7. Salva e envia a resposta da Clara
  if (resposta.texto) {
    await registrarESviar(db, clinicaId, conversa.id, telefone, resposta.texto, 'clara');
  }
  if (resposta.ferramentasUsadas && resposta.ferramentasUsadas.length) {
    await db.from('mensagens').insert({
      clinica_id: clinicaId,
      conversa_id: conversa.id,
      direcao: 'saida',
      autor: 'sistema',
      conteudo: '[registro interno de ferramentas] ' + JSON.stringify(resposta.ferramentasUsadas),
    });
  }

  console.log(`[atendimento] concluído: telefone=${telefone} respondeu=${!!resposta.texto}`);
  return { ok: true };
}

// ------------------------------------------------------------
// Loop de conversa com a Claude API (tool use)
// ------------------------------------------------------------
async function conversarComClaude(contexto, ctxFerramentas) {
  const mensagens = contexto.historico;
  const ferramentasUsadas = [];

  for (let rodada = 0; rodada < MAX_RODADAS_FERRAMENTA; rodada++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 1024,
        system: contexto.system,
        tools: FERRAMENTAS,
        messages: mensagens,
      }),
    });

    if (!resp.ok) {
      const corpo = await resp.text();
      return { erro: `Claude API ${resp.status}: ${corpo}` };
    }

    const data = await resp.json();
    const usosDeFerramenta = data.content.filter((b) => b.type === 'tool_use');

    if (data.stop_reason !== 'tool_use' || !usosDeFerramenta.length) {
      const texto = data.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { texto, ferramentasUsadas };
    }

    // Executa cada ferramenta e devolve os resultados
    mensagens.push({ role: 'assistant', content: data.content });
    const resultados = [];
    for (const uso of usosDeFerramenta) {
      let resultado;
      try {
        resultado = await executar(uso.name, uso.input, ctxFerramentas);
      } catch (e) {
        resultado = { erro: e.message };
      }
      ferramentasUsadas.push({ ferramenta: uso.name, input: uso.input, resultado });
      resultados.push({
        type: 'tool_result',
        tool_use_id: uso.id,
        content: JSON.stringify(resultado),
      });
    }
    mensagens.push({ role: 'user', content: resultados });
  }

  return { erro: 'Limite de rodadas de ferramenta atingido' };
}

// ------------------------------------------------------------
// Contexto: system prompt + histórico da conversa
// ------------------------------------------------------------
async function montarContexto(db, clinicaId, paciente, conversaId) {
  const [clinica, conhecimento, profissionais, ags, hist] = await Promise.all([
    db.from('clinicas').select('*').eq('id', clinicaId).single(),
    db.from('base_conhecimento').select('*').eq('clinica_id', clinicaId).eq('ativo', true),
    db.from('profissionais').select('id, nome, especialidades').eq('clinica_id', clinicaId).eq('ativo', true),
    db.from('agendamentos')
      .select('id, inicio, procedimento, status')
      .eq('clinica_id', clinicaId)
      .eq('paciente_id', paciente.id)
      .in('status', ['agendado', 'confirmado'])
      .gte('inicio', new Date().toISOString())
      .order('inicio'),
    db.from('mensagens')
      .select('direcao, autor, conteudo')
      .eq('clinica_id', clinicaId)
      .eq('conversa_id', conversaId)
      .order('criado_em', { ascending: false })
      .limit(HISTORICO_MAX_MSGS),
  ]);

  const erro = clinica.error || conhecimento.error || profissionais.error || ags.error || hist.error;
  if (erro) return { erro: erro.message };

  const system = montarSystemPrompt({
    clinica: clinica.data,
    paciente,
    conhecimento: conhecimento.data,
    profissionais: profissionais.data,
    proximosAgendamentos: ags.data,
  });

  // Histórico → formato de mensagens da API (papéis alternados garantidos)
  const historico = [];
  for (const m of hist.data.reverse()) {
    const role = m.direcao === 'entrada' ? 'user' : 'assistant';
    const anterior = historico[historico.length - 1];
    if (anterior && anterior.role === role) {
      anterior.content += `\n${m.conteudo}`;
    } else {
      historico.push({ role, content: m.conteudo });
    }
  }
  if (!historico.length || historico[historico.length - 1].role !== 'user') {
    return { erro: 'Histórico sem mensagem do paciente ao final' };
  }

  return { system, historico };
}

// ------------------------------------------------------------
async function obterOuCriarPaciente(db, clinicaId, telefone, nomePush) {
  const busca = await db
    .from('pacientes')
    .select('*')
    .eq('clinica_id', clinicaId)
    .eq('telefone', telefone)
    .maybeSingle();
  if (busca.error) return { erro: busca.error.message };
  if (busca.data) return busca.data;

  const novo = await db
    .from('pacientes')
    .insert({ clinica_id: clinicaId, telefone, nome: nomePush || null, origem: 'whatsapp' })
    .select()
    .single();
  if (novo.error) return { erro: novo.error.message };
  return novo.data;
}

async function obterOuCriarConversa(db, clinicaId, pacienteId) {
  const busca = await db
    .from('conversas')
    .select('*')
    .eq('clinica_id', clinicaId)
    .eq('paciente_id', pacienteId)
    .in('status', ['ativa', 'transferida_humano'])
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (busca.error) return { erro: busca.error.message };
  if (busca.data) return busca.data;

  const nova = await db
    .from('conversas')
    .insert({ clinica_id: clinicaId, paciente_id: pacienteId, canal: 'whatsapp' })
    .select()
    .single();
  if (nova.error) return { erro: nova.error.message };
  return nova.data;
}

async function registrarESviar(db, clinicaId, conversaId, telefone, texto, autor) {
  const ins = await db.from('mensagens').insert({
    clinica_id: clinicaId,
    conversa_id: conversaId,
    direcao: 'saida',
    autor,
    conteudo: texto,
  });
  if (ins.error) console.error('[mensagens] falha ao salvar saída:', ins.error.message);

  try {
    await enviarTexto(telefone, texto);
    console.log(`[whatsapp] enviado com sucesso para ${telefone}`);
  } catch (e) {
    console.error('[whatsapp] falha no envio:', e.message);
  }
}

module.exports = { processarMensagem };
