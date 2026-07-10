// ============================================================
// CLARA — Testes dos templates de automação
// Rodar: node --test tests/templates.test.js
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert');
const { renderizar, TEMPLATES } = require('../src/domain/automacao/templates');

const CTX = { pacienteNome: 'Maria Souza', clinicaNome: 'Sorriso Pleno' };
const PAYLOAD = {
  inicio: '2026-07-15T14:00:00-03:00',
  procedimento: 'limpeza',
  dentista: 'Dra. Ana',
  agendamento_id: 'abc',
};

test('todos os templates renderizam texto não-vazio', () => {
  for (const nome of Object.keys(TEMPLATES)) {
    const texto = renderizar(nome, PAYLOAD, CTX);
    assert.ok(typeof texto === 'string' && texto.length > 20, `template ${nome} vazio`);
  }
});

test('usa só o primeiro nome do paciente', () => {
  const texto = renderizar('confirmacao_24h', PAYLOAD, CTX);
  assert.ok(texto.includes('Maria'));
  assert.ok(!texto.includes('Souza'));
});

test('inclui hora formatada em pt-BR', () => {
  const texto = renderizar('lembrete_2h', PAYLOAD, CTX);
  assert.ok(texto.includes('14:00'));
});

test('template desconhecido retorna null', () => {
  assert.strictEqual(renderizar('nao_existe', {}, CTX), null);
});

test('paciente sem nome não quebra o template', () => {
  const texto = renderizar('confirmacao_24h', PAYLOAD, { clinicaNome: 'X' });
  assert.ok(typeof texto === 'string' && texto.length > 20);
});
