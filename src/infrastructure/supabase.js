// ============================================================
// CLARA — Infraestrutura: client Supabase
// Backend confiável (roda só no Railway, nunca no navegador):
// usa a Secret Key do Supabase, que já tem acesso total ao banco.
//
// Projetos Supabase criados a partir de nov/2025 não têm mais
// as chaves legadas (anon / service_role / JWT Secret). Por isso,
// o isolamento entre clínicas passa a ser garantido explicitamente
// em cada consulta (.eq('clinica_id', ...)) em vez de RLS + JWT.
// ============================================================
const { createClient } = require('@supabase/supabase-js');

let client = null;

function clientDaClinica() {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

module.exports = { clientDaClinica };
