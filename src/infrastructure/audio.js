// ============================================================
// CLARA — Infra: transcrição de áudio (Meta media + Groq Whisper)
// ============================================================
const GRAPH_VERSION = 'v20.0';

async function transcreverAudioMeta(mediaId) {
  const token = process.env.META_ACCESS_TOKEN;
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return { erro: 'GROQ_API_KEY ausente' };

  // 1. Busca a URL temporária da mídia na Meta
  const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) return { erro: `Meta media ${metaRes.status}: ${await metaRes.text()}` };
  const { url, mime_type } = await metaRes.json();

  // 2. Baixa o arquivo de áudio
  const audioRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!audioRes.ok) return { erro: `download audio ${audioRes.status}` };
  const buffer = Buffer.from(await audioRes.arrayBuffer());

  // 3. Envia ao Whisper (Groq)
  const form = new FormData();
  const ext = (mime_type || 'audio/ogg').includes('mpeg') ? 'mp3' : 'ogg';
  form.append('file', new Blob([buffer], { type: mime_type || 'audio/ogg' }), `audio.${ext}`);
  form.append('model', 'whisper-large-v3');
  form.append('language', 'pt');

  const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey}` },
    body: form,
  });
  if (!groqRes.ok) return { erro: `Groq ${groqRes.status}: ${await groqRes.text()}` };
  const data = await groqRes.json();

  const texto = (data.text || '').trim();
  if (!texto) return { erro: 'transcricao vazia' };
  return { texto };
}

module.exports = { transcreverAudioMeta };
