import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { chamar, entrar, contas, obter } from './apoio.mjs';

// Acesso: saúde, login, token e quem pode entrar em cada área. Não cria dados. Não usa mesas.

describe('acesso e permissões por perfil', () => {
  test('/saude responde sem login', async () => {
    const r = await chamar('GET', '/saude');
    assert.equal(r.status, 200);
    assert.equal(r.dados.ok, true);
  });

  test('login certo devolve token e usuário, sem a senha', async () => {
    const r = await chamar('POST', '/auth/login', null, { email: contas.gestor.email, senha: contas.gestor.senha });
    assert.equal(r.status, 200);
    assert.equal(typeof r.dados.token, 'string');
    assert.equal(r.dados.usuario.perfil, 'GESTOR');
    assert.equal('senha' in r.dados.usuario, false);
    assert.equal('senhaHash' in r.dados.usuario, false);
    assert.equal(JSON.stringify(r.dados).includes('senhaHash'), false);
  });

  test('login errado é recusado com 401', async () => {
    const r = await chamar('POST', '/auth/login', null, { email: contas.gestor.email, senha: 'senha-errada-123' });
    assert.equal(r.status, 401);
  });

  test('rota sem token é 401', async () => {
    assert.equal((await chamar('GET', '/pedidos')).status, 401);
    assert.equal((await chamar('GET', '/mesas')).status, 401);
  });

  test('token inválido é 401', async () => {
    assert.equal((await chamar('GET', '/mesas', 'token.invalido.aqui')).status, 401);
  });

  test('gestor vê a equipe (200)', async () => {
    const gestor = await entrar(contas.gestor.email, contas.gestor.senha);
    assert.equal((await chamar('GET', '/usuarios', gestor)).status, 200);
  });

  test('garçom não vê a equipe (403) e vê os pedidos (200)', async () => {
    const garcom = await entrar(contas.garcom.email, contas.garcom.senha);
    assert.equal((await chamar('GET', '/usuarios', garcom)).status, 403);
    assert.equal((await chamar('GET', '/pedidos', garcom)).status, 200);
  });

  test('limpeza não vê pedidos (403) e vê as mesas para limpar (200)', async () => {
    const limpeza = await entrar(contas.limpeza.email, contas.limpeza.senha);
    assert.equal((await chamar('GET', '/pedidos', limpeza)).status, 403);
    assert.equal((await chamar('GET', '/limpeza/mesas', limpeza)).status, 200);
  });

  test('cozinha não lança pedido (403), não vê as mesas (403) e vê o estoque (200)', async () => {
    const cozinha = await entrar(contas.cozinha.email, contas.cozinha.senha);
    assert.equal((await chamar('POST', '/pedidos', cozinha, {})).status, 403);
    assert.equal((await chamar('GET', '/mesas', cozinha)).status, 403);
    assert.equal((await chamar('GET', '/estoque', cozinha)).status, 200);
  });

  test('recepção vê as mesas da recepção (200) e não vê os pedidos (403)', async () => {
    const recepcao = await entrar(contas.recepcao.email, contas.recepcao.senha);
    assert.equal((await chamar('GET', '/recepcao/mesas', recepcao)).status, 200);
    assert.equal((await chamar('GET', '/pedidos', recepcao)).status, 403);
  });

  test('garçom não vê o estoque (403)', async () => {
    const garcom = await entrar(contas.garcom.email, contas.garcom.senha);
    assert.equal((await chamar('GET', '/estoque', garcom)).status, 403);
  });

  test('a lista de mesas da recepção não traz valores nem pedidos', async () => {
    const recepcao = await entrar(contas.recepcao.email, contas.recepcao.senha);
    const mesas = await obter('/recepcao/mesas', recepcao);
    assert.ok(Array.isArray(mesas) && mesas.length > 0);
    assert.ok(mesas.every((m) => m.totalAberto === undefined && m.codigo === undefined));
  });
});
