-- ============================================================
-- CLARA — Cadastro: Clínica Sorriso Teste
-- Rode no SQL Editor do Supabase, de uma vez só.
-- ============================================================

-- 1. Clínica
insert into clinicas (id, nome, telefone, whatsapp, endereco, cidade, config, ativo)
values (
  '3dce4dd7-c22a-44f3-ae87-c75d9565be6b',
  'Clínica Sorriso Teste',
  '(34) 99929-0744',
  '5534999290744',  -- formato E.164 sem símbolos, com código do país (55) + DDD (34)
  'Rua Pedro Batista de Arvelos, 525',
  'Coromandel',
  '{}'::jsonb,
  true
);

-- 2. Dentista
insert into profissionais (id, clinica_id, nome, especialidades, ativo)
values (
  '19f8330d-48ee-4a90-971b-6be37885b4e5',
  '3dce4dd7-c22a-44f3-ae87-c75d9565be6b',
  'Dr. Adelmo Batista',
  array['Clínico Geral'],
  true
);

-- 3. Grade de horários: segunda (1) a sexta (5), 8h-11h e 13h-18h
--    (dia_semana: 0=domingo, 1=segunda, ..., 6=sábado)
insert into profissional_horarios (clinica_id, profissional_id, dia_semana, hora_inicio, hora_fim, duracao_slot_min)
select
  '3dce4dd7-c22a-44f3-ae87-c75d9565be6b',
  '19f8330d-48ee-4a90-971b-6be37885b4e5',
  dia,
  horario.inicio,
  horario.fim,
  30
from unnest(array[1,2,3,4,5]) as dia
cross join (values ('08:00'::time, '11:00'::time), ('13:00'::time, '18:00'::time)) as horario(inicio, fim);

-- ============================================================
-- FIM
-- ============================================================
