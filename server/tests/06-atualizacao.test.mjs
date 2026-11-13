import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { chamar, entrar, contas } from './apoio.mjs';

// Atualização pelo botão. ATENÇÃO: nunca chamar POST /atualizacao/aplicar com dados válidos aqui,
// porque isso reinicia o sistema. Só testamos a leitura do estado e a recusa de dados inválidos.

describe('atualização pelo botão (só leitura e recusas)', () => {
  test('gestor vê o estado do atualizador (200), com o campo ativo', async () => {
    const gestor = await entrar(contas.gestor.email, contas.gestor.senha);
    const r = await chamar('GET', '/atualizacao', gestor);
    assert.equal(r.status, 200);
    assert.equal(typeof r.dados.ativo, 'boolean');
  });

  test('garçom não vê a atualização (403)', async () => {
    const garcom = await entrar(contas.garcom.email, contas.garcom.senha);
    assert.equal((await chamar('GET', '/atualizacao', garcom)).status, 403);
  });

  test('aplicar com "forçar" em texto é recusado (400), sem reiniciar nada', async () => {
    const gestor = await entrar(contas.gestor.email, contas.gestor.senha);
    const r = await chamar('POST', '/atualizacao/aplicar', gestor, { forcar: 'sim' });
    assert.equal(r.status, 400);
  });
});
