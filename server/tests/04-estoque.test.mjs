import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  chamar,
  entrar,
  obter,
  mesaPorNumero,
  limparMesa,
  produtoPorNome,
  contas,
} from './apoio.mjs';

// Estoque: liga o controle num produto, lança movimentos, pedidos baixam e cancelamento devolve.
// Usa a mesa 5. No fim desliga o controle e devolve a disponibilidade que o produto tinha.

const NOME_PRODUTO = 'Mousse de maracujá';

describe('estoque: controle, pedidos e cancelamento', () => {
  let gestor;
  let garcom;
  let cozinha;
  let m5;
  let produto;
  let disponivelAntes;
  let pedidoQueZera;

  before(async () => {
    gestor = await entrar(contas.gestor.email, contas.gestor.senha);
    garcom = await entrar(contas.garcom.email, contas.garcom.senha);
    cozinha = await entrar(contas.cozinha.email, contas.cozinha.senha);
    m5 = await mesaPorNumero(gestor, 5);
    produto = await produtoPorNome(gestor, NOME_PRODUTO);
    disponivelAntes = produto.disponivel;
    await limparMesa(gestor, m5);
    // Começa sem controle de estoque, para o teste de "sem controle" fazer sentido.
    const r = await chamar('PUT', `/produtos/${produto.id}`, gestor, { controlaEstoque: false });
    assert.equal(r.status, 200);
  });

  after(async () => {
    if (!gestor || !produto) return;
    await chamar('PUT', `/produtos/${produto.id}`, gestor, { controlaEstoque: false });
    await chamar('PUT', `/produtos/${produto.id}/disponivel`, gestor, { disponivel: disponivelAntes });
    if (m5) await limparMesa(gestor, m5);
  });

  test('lançar movimento num produto sem controle é recusado (400)', async () => {
    const r = await chamar('POST', `/estoque/${produto.id}/movimentos`, gestor, { tipo: 'ENTRADA', quantidade: 5 });
    assert.equal(r.status, 400);
  });

  test('gestor liga o controle de estoque no produto', async () => {
    const r = await chamar('PUT', `/produtos/${produto.id}`, gestor, { controlaEstoque: true, estoqueMinimo: 2 });
    assert.equal(r.status, 200);
    assert.equal(r.dados.controlaEstoque, true);
    // Zera o saldo que sobrou de uma execução anterior. Assim o acerto para 3 (próximo teste) sempre grava.
    const zerou = await chamar('POST', `/estoque/${produto.id}/movimentos`, gestor, { tipo: 'AJUSTE', quantidade: 0, motivo: 'Início do teste' });
    assert.equal(zerou.status, 201);
    assert.equal(zerou.dados.saldo, 0);
  });

  test('garçom não lança movimento de estoque (403)', async () => {
    const r = await chamar('POST', `/estoque/${produto.id}/movimentos`, garcom, { tipo: 'ENTRADA', quantidade: 5 });
    assert.equal(r.status, 403);
  });

  test('acerto de contagem define o saldo em 3', async () => {
    const r = await chamar('POST', `/estoque/${produto.id}/movimentos`, gestor, {
      tipo: 'AJUSTE',
      quantidade: 3,
      motivo: 'Contagem',
    });
    assert.equal(r.status, 201);
    assert.equal(r.dados.saldo, 3);
  });

  test('pedido acima do saldo é recusado (400)', async () => {
    const r = await chamar('POST', `/cliente/mesas/${m5.codigo}/pedidos`, null, {
      itens: [{ produtoId: produto.id, quantidade: 4 }],
    });
    assert.equal(r.status, 400);
  });

  test('pedido que zera o estoque passa e o item esgota sozinho', async () => {
    const r = await chamar('POST', `/cliente/mesas/${m5.codigo}/pedidos`, null, {
      itens: [{ produtoId: produto.id, quantidade: 3 }],
    });
    assert.equal(r.status, 201);
    pedidoQueZera = r.dados.id;
    const atual = (await obter('/produtos', gestor)).find((p) => p.id === produto.id);
    assert.equal(atual.estoque, 0);
    assert.equal(atual.disponivel, false);
  });

  test('com estoque zero, o item sai do cardápio da mesa', async () => {
    const cardapio = await obter(`/cliente/mesas/${m5.codigo}`);
    const achado = cardapio.categorias.flatMap((c) => c.produtos).find((p) => p.id === produto.id);
    assert.ok(!achado || achado.disponivel === false, 'o item sem estoque não pode aparecer disponível');
  });

  test('garçom não marca como disponível um item com estoque zero (400)', async () => {
    const r = await chamar('PUT', `/produtos/${produto.id}/disponivel`, garcom, { disponivel: true });
    assert.equal(r.status, 400);
  });

  test('o sino do gestor avisa do estoque', async () => {
    const avisos = await obter('/notificacoes', gestor);
    assert.ok(avisos.some((a) => a.chave.startsWith('estoque-')));
  });

  test('a cozinha vê o estoque com situação ZERADO', async () => {
    const itens = await obter('/estoque', cozinha);
    assert.equal(itens.find((p) => p.id === produto.id)?.situacao, 'ZERADO');
  });

  test('cancelar o pedido devolve o estoque e o item volta a ficar disponível', async () => {
    const r = await chamar('PUT', `/pedidos/${pedidoQueZera}/status`, garcom, { status: 'CANCELADO' });
    assert.equal(r.status, 200);
    const atual = (await obter('/produtos', gestor)).find((p) => p.id === produto.id);
    assert.equal(atual.estoque, 3);
    assert.equal(atual.disponivel, true);
  });

  test('histórico de movimentos: devolução, venda e ajuste, nessa ordem (mais recente primeiro)', async () => {
    const movimentos = await obter(`/estoque/${produto.id}/movimentos`, gestor);
    assert.deepEqual(
      movimentos.slice(0, 3).map((m) => m.tipo),
      ['DEVOLUCAO', 'VENDA', 'AJUSTE']
    );
  });

  test('pedido cancelado não volta (400)', async () => {
    const r = await chamar('PUT', `/pedidos/${pedidoQueZera}/status`, gestor, { status: 'NOVO' });
    assert.equal(r.status, 400);
  });
});
