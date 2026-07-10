// ============================================================
// CLARA — Testes do domínio: geração de slots
// Rodar com: node --test tests/
// Sem dependências externas — usa o test runner nativo do Node.
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert');
const { gerarSlots, sobrepoe } = require('../src/domain/agenda/slots');

const DIA = new Date('2026-07-13T00:00:00'); // segunda-feira
const AGORA = new Date('2026-07-12T08:00:00'); // véspera (nada é "passado")

const GRADE_MANHA = [{ hora_inicio: '08:00', hora_fim: '12:00', duracao_slot_min: 30 }];

test('grade de 4h com slots de 30min gera 8 slots', () => {
  const slots = gerarSlots({ data: DIA, grade: GRADE_MANHA, agora: AGORA });
  assert.strictEqual(slots.length, 8);
  assert.strictEqual(slots[0].inicio.getHours(), 8);
  assert.strictEqual(slots[7].fim.getHours(), 12);
});

test('agendamento existente remove o slot correspondente', () => {
  const ocupados = [{
    inicio: new Date('2026-07-13T09:00:00'),
    fim: new Date('2026-07-13T09:30:00'),
  }];
  const slots = gerarSlots({ data: DIA, grade: GRADE_MANHA, ocupados, agora: AGORA });
  assert.strictEqual(slots.length, 7);
  assert.ok(!slots.some((s) => s.inicio.getHours() === 9 && s.inicio.getMinutes() === 0));
});

test('bloqueio de período remove todos os slots afetados', () => {
  const bloqueios = [{
    inicio: new Date('2026-07-13T08:00:00'),
    fim: new Date('2026-07-13T10:00:00'),
  }];
  const slots = gerarSlots({ data: DIA, grade: GRADE_MANHA, bloqueios, agora: AGORA });
  assert.strictEqual(slots.length, 4); // sobram 10:00–12:00
});

test('slots no passado (ou dentro da antecedência mínima) não são oferecidos', () => {
  const agora = new Date('2026-07-13T09:15:00'); // já é o dia, 9h15
  const slots = gerarSlots({ data: DIA, grade: GRADE_MANHA, agora, antecedenciaMin: 60 });
  // Com antecedência de 60min, primeiro slot possível é 10:30
  assert.ok(slots.every((s) => s.inicio >= new Date('2026-07-13T10:15:00')));
});

test('agendamento parcialmente sobreposto também bloqueia o slot', () => {
  const ocupados = [{
    inicio: new Date('2026-07-13T08:45:00'),
    fim: new Date('2026-07-13T09:15:00'),
  }];
  const slots = gerarSlots({ data: DIA, grade: GRADE_MANHA, ocupados, agora: AGORA });
  // Derruba 08:30 e 09:00
  assert.strictEqual(slots.length, 6);
});

test('sobrepoe: intervalos encostados NÃO sobrepõem', () => {
  const a = [new Date('2026-07-13T08:00'), new Date('2026-07-13T08:30')];
  const b = [new Date('2026-07-13T08:30'), new Date('2026-07-13T09:00')];
  assert.strictEqual(sobrepoe(a[0], a[1], b[0], b[1]), false);
});
