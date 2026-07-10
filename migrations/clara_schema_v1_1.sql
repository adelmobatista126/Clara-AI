-- ============================================================
-- CLARA — Migração v1.1: views de automação
-- Executar no SQL Editor do Supabase (uma vez).
-- ============================================================

-- Pacientes inativos: última consulta concluída há mais de 6 meses
-- e nenhum agendamento futuro ativo.
create or replace view v_pacientes_inativos
with (security_invoker = true) as
select
  p.id            as paciente_id,
  p.clinica_id,
  p.nome,
  p.telefone,
  max(a.inicio)   as ultima_consulta
from pacientes p
join agendamentos a
  on a.paciente_id = p.id and a.status = 'concluido'
where not exists (
  select 1 from agendamentos f
  where f.paciente_id = p.id
    and f.status in ('agendado', 'confirmado')
    and f.inicio > now()
)
group by p.id, p.clinica_id, p.nome, p.telefone
having max(a.inicio) < now() - interval '6 months';

-- Aniversariantes do dia
create or replace view v_aniversariantes_hoje
with (security_invoker = true) as
select id as paciente_id, clinica_id, nome, telefone, data_nascimento
from pacientes
where data_nascimento is not null
  and extract(month from data_nascimento) = extract(month from now())
  and extract(day   from data_nascimento) = extract(day   from now());

-- ============================================================
-- FIM — Migração v1.1
-- ============================================================
