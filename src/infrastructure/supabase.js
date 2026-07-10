// ============================================================
// CLARA — Infraestrutura: fábrica de clients Supabase
// Um JWT por clínica, assinado com o secret do projeto.
// RLS sempre ativo. NUNCA usar service_role neste fluxo.
// ============================================================
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const TTL_HORAS = 12;
const cache = new Map(); // clinicaId -> { client, expiraEm }

function clientDaClinica(clinicaId) {
  const agora = Date.now();
  const emCache = cache.get(clinicaId);
  if (emCache && emCache.expiraEm > agora + 60_000) return emCache.client;

  const token = jwt.sign(
    { role: 'authenticated', clinica_id: clinicaId },
    process.env.SUPABASE_JWT_SECRET,
    { expiresIn: `${TTL_HORAS}h` }
  );

  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );

  cache.set(clinicaId, {
    client,
    expiraEm: agora + TTL_HORAS * 3_600_000,
  });
  return client;
}

module.exports = { clientDaClinica };
