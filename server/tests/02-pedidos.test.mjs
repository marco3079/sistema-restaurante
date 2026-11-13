import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  chamar,
  entrar,
  obter,
  usuarioLogado,
  mesaPorNumero,
  limparMesa,
  produtosDisponiveis,
  contas,
} from './apoio.mjs';

// Pedidos: lançamento pelo garçom e pelo cliente (QR code), preparo pela cozinha, entrega, cancelamento.
// Usa as mesas 1 e 2. Deixa as duas livres no começo e no fim.

describe('pedidos: cozinha, garçom, cliente e cancelamento', () => {
  let gestor;
  let garcom;
  let cozinha;
  let garcomId;
  let mesa1;
  let mesa2;
  let produto;
  let pedidoDoCliente;
  let pedidoDoGarcom;

  before(async () => {
    gestor = await entrar(contas.gestor.email, contas.gestor.senha);
    garcom = await entrar(contas.garcom.email, contas.garcom.senha);
    cozinha = await entrar(contas.cozinha.email, contas.cozinha.senha);
    garcomId = (await usuarioLogado(garcom)).id;
    mesa1 = await mesaPorNumero(gestor, 1);
    mesa2 = await mesaPorNumero(gestor, 2);
    produto = (await produtosDisponiveis(gestor))[0];
    assert.ok(produto, 'Nenhum produto disponível no cardápio do banco de testes.');
    await limparMesa(gestor, mesa1);
    await limparMesa(gestor, mesa2);
  });

  after(async () => {
    if (gestor && mesa1 && mesa2) {
      await limparMesa(gestor, mesa1);
      await limparMesa(gestor, mesa2);
    }
  });

  test('cliente chama o garçom: a mesa fica ocupada e marcada como chamando', async () => {
    const chamou = await chamar('POST', `/cliente/mesas/${mesa2.codigo}/chamar`);
    assert.equal(chamou.status, 204);
    assert.equal((await mesaPorNumero(gestor, 2)).situacao, 'OCUPADA');
    const cardapio = await obter(`/cliente/mesas/${mesa2.codigo}`);
    assert.equal(cardapio.mesa.chamando, true);
  });

  test('código de mesa errado é 404 no pedido do cliente', async () => {
    const r = await chamar('POST', '/cliente/mesas/codigoinexistente/pedidos', null, {
      itens: [{ produtoId: produto.id, quantidade: 1 }],
    });
    assert.equal(r.status, 404);
  });

  test('cliente pede pelo código da mesa; o preço vem do servidor', async () => {
    const r = await chamar('POST', `/cliente/mesas/${mesa1.codigo}/pedidos`, null, {
      itens: [{ produtoId: produto.id, quantidade: 1, preco: 0.01 }],
    });
    assert.equal(r.status, 201);
    assert.equal(r.dados.itens[0].precoUnitario, produto.preco);
    pedidoDoCliente = r.dados.id;
  });

  test('garçom não inicia o preparo (403)', async () => {
    const r = await chamar('PUT', `/pedidos/${pedidoDoCliente}/status`, garcom, { status: 'EM_PREPARO' });
    assert.equal(r.status, 403);
  });

  test('cozinha não entrega (403)', async () => {
    const r = await chamar('PUT', `/pedidos/${pedidoDoCliente}/status`, cozinha, { status: 'ENTREGUE' });
    assert.equal(r.status, 403);
  });

  test('cozinha inicia o preparo', async () => {
    const r = await chamar('PUT', `/pedidos/${pedidoDoCliente}/status`, cozinha, { status: 'EM_PREPARO' });
    assert.equal(r.status, 200);
    assert.equal(r.dados.status, 'EM_PREPARO');
  });

  test('garçom não entrega antes de o pedido ficar pronto (403)', async () => {
    const r = await chamar('PUT', `/pedidos/${pedidoDoCliente}/status`, garcom, { status: 'ENTREGUE' });
    assert.equal(r.status, 403);
  });

  test('cozinha marca o pedido como pronto', async () => {
    const r = await chamar('PUT', `/pedidos/${pedidoDoCliente}/status`, cozinha, { status: 'PRONTO' });
    assert.equal(r.status, 200);
    assert.equal(r.dados.status, 'PRONTO');
  });

  test('garçom entrega; ele passa a responder pelo pedido', async () => {
    const r = await chamar('PUT', `/pedidos/${pedidoDoCliente}/status`, garcom, { status: 'ENTREGUE' });
    assert.equal(r.status, 200);
    assert.equal(r.dados.status, 'ENTREGUE');
    assert.equal(r.dados.garcom.id, garcomId);
  });

  test('garçom lança pedido direto na mesa 2', async () => {
    const r = await chamar('POST', '/pedidos', garcom, {
      mesaId: mesa2.id,
      itens: [{ produtoId: produto.id, quantidade: 1 }],
    });
    assert.equal(r.status, 201);
    pedidoDoGarcom = r.dados.id;
  });

  test('garçom cancela o pedido; pedido cancelado não volta', async () => {
    const cancelou = await chamar('PUT', `/pedidos/${pedidoDoGarcom}/status`, garcom, { status: 'CANCELADO' });
    assert.equal(cancelou.status, 200);
    assert.equal(cancelou.dados.status, 'CANCELADO');
    const volta = await chamar('PUT', `/pedidos/${pedidoDoGarcom}/status`, gestor, { status: 'NOVO' });
    assert.equal(volta.status, 400);
  });
});
