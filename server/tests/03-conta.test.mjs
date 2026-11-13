import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  chamar,
  entrar,
  obter,
  usuarioLogado,
  mesaPorNumero,
  limparMesa,
  produtoPorNome,
  contas,
} from './apoio.mjs';

// Conta: taxa de serviço, pagamento parcial com gorjeta, documento do cliente, Pix com copia e cola,
// fechamento e desempenho. Usa as mesas 3 e 4. Guarda a configuração do restaurante e a devolve no fim.

const round2 = (valor) => Math.round(valor * 100) / 100;

// CRC16-CCITT do código Pix (copia e cola), igual ao usado pelo roteiro antigo.
function crc16(texto) {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i += 1) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

async function linhaDoGarcom(gestor, garcomId) {
  const desempenho = await obter('/desempenho?dias=1', gestor);
  const linha = desempenho.garcons.find((g) => g.usuario.id === garcomId);
  return linha ?? { valorRecebido: 0, taxaServico: 0, gorjetas: 0, contasRecebidas: 0 };
}

describe('conta: taxa, pagamento parcial, documento, Pix e fechamento', () => {
  let gestor;
  let garcom;
  let limpeza;
  let garcomId;
  let m3;
  let m4;
  let configAnterior;
  let desempenhoAntes;
  let pedidoMesa3;

  before(async () => {
    gestor = await entrar(contas.gestor.email, contas.gestor.senha);
    garcom = await entrar(contas.garcom.email, contas.garcom.senha);
    limpeza = await entrar(contas.limpeza.email, contas.limpeza.senha);
    garcomId = (await usuarioLogado(garcom)).id;
    m3 = await mesaPorNumero(gestor, 3);
    m4 = await mesaPorNumero(gestor, 4);
    configAnterior = await obter('/maquinetas', gestor);
    await limparMesa(gestor, m3);
    await limparMesa(gestor, m4);
    // Taxa de 10% nas contas novas (esta mesa vai abrir conta agora).
    const cfg = await chamar('PUT', '/maquinetas/configuracao', gestor, { taxaServicoPercentual: 10 });
    assert.equal(cfg.status, 200);
    desempenhoAntes = await linhaDoGarcom(gestor, garcomId);
  });

  after(async () => {
    if (!gestor) return;
    if (configAnterior) {
      await chamar('PUT', '/maquinetas/configuracao', gestor, {
        taxaServicoPercentual: configAnterior.taxaServicoPercentual,
        pixChave: configAnterior.pixChave ?? '',
        pixNome: configAnterior.pixNome ?? '',
        pixCidade: configAnterior.pixCidade ?? '',
      });
    }
    await limparMesa(gestor, m3);
    await limparMesa(gestor, m4);
  });

  test('pedido com taxa de serviço de 10% no total', async () => {
    const filet = await produtoPorNome(gestor, 'Filé à parmegiana');
    const refri = await produtoPorNome(gestor, 'Refrigerante lata');
    // Filé (68) + Refrigerante (7,50) x2 = 83,00 -> taxa 8,30 -> total 91,30
    const r = await chamar('POST', '/pedidos', garcom, {
      mesaId: m3.id,
      itens: [
        { produtoId: filet.id, quantidade: 1 },
        { produtoId: refri.id, quantidade: 2 },
      ],
    });
    assert.equal(r.status, 201);
    pedidoMesa3 = r.dados.id;
    const conta = await obter(`/mesas/${m3.id}/conta`, garcom);
    assert.equal(conta.conta.taxaServico, true);
    assert.equal(conta.subtotal, 83);
    assert.equal(conta.taxa, 8.3);
    assert.equal(conta.total, 91.3);
    assert.equal(conta.restante, 91.3);
    const mesa = await mesaPorNumero(gestor, 3);
    assert.equal(mesa.totalAberto, 91.3);
  });

  test('cobrança maior que o que falta é recusada (400)', async () => {
    const r = await chamar('POST', `/mesas/${m3.id}/cobrar`, garcom, { formaPagamento: 'Dinheiro', valor: 100 });
    assert.equal(r.status, 400);
  });

  test('pagamento parcial em dinheiro com gorjeta; a conta continua aberta', async () => {
    const r = await chamar('POST', `/mesas/${m3.id}/cobrar`, garcom, {
      formaPagamento: 'Dinheiro',
      valor: 45.65,
      gorjeta: 5,
    });
    assert.equal(r.status, 201);
    assert.equal(r.dados.status, 'APROVADO');
    assert.equal(r.dados.valor, 45.65);
    assert.equal(r.dados.gorjeta, 5);
    assert.equal(r.dados.valorServico, 4.15);
    const conta = await obter(`/mesas/${m3.id}/conta`, garcom);
    assert.equal(conta.pago, 45.65);
    assert.equal(conta.restante, 45.65);
    assert.equal(conta.pagamentos.length, 1);
    assert.equal((await mesaPorNumero(gestor, 3)).situacao, 'OCUPADA');
  });

  test('tirar a taxa recalcula o que falta e aceita CPF', async () => {
    const r = await chamar('PUT', `/mesas/${m3.id}/conta`, garcom, {
      taxaServico: false,
      cpfCnpjCliente: '123.456.789-09',
    });
    assert.equal(r.status, 200);
    assert.equal(r.dados.total, 83);
    assert.equal(r.dados.restante, 37.35);
    assert.equal(r.dados.conta.cpfCnpjCliente, '12345678909');
  });

  test('CPF inválido é recusado (400)', async () => {
    const r = await chamar('PUT', `/mesas/${m3.id}/conta`, garcom, { cpfCnpjCliente: '123' });
    assert.equal(r.status, 400);
  });

  test('colocar a taxa de volta', async () => {
    const r = await chamar('PUT', `/mesas/${m3.id}/conta`, garcom, { taxaServico: true });
    assert.equal(r.status, 200);
    assert.equal(r.dados.total, 91.3);
    assert.equal(r.dados.restante, 45.65);
  });

  test('o que falta no crédito fecha a conta; a mesa vai para a limpeza', async () => {
    const r = await chamar('POST', `/mesas/${m3.id}/cobrar`, garcom, { formaPagamento: 'Cartão de crédito' });
    assert.equal(r.status, 201);
    assert.equal(r.dados.status, 'APROVADO');
    assert.equal(r.dados.valor, 45.65);
    const mesa = await mesaPorNumero(gestor, 3);
    assert.equal(mesa.situacao, 'LIMPEZA');
    assert.equal(mesa.pedidosAbertos, 0);
  });

  test('pedido pago em formas divididas fica como pago e entregue', async () => {
    const pedidos = await obter(`/pedidos?ver=todos&mesaId=${m3.id}`, gestor);
    const pedido = pedidos.find((p) => p.id === pedidoMesa3);
    assert.ok(pedido, 'pedido da mesa 3 não apareceu no histórico');
    assert.notEqual(pedido.pagoEm, null);
    assert.equal(pedido.formaPagamento, 'Dividido');
    assert.equal(pedido.status, 'ENTREGUE');
  });

  test('desempenho: taxa, gorjeta e valor recebido aparecem para quem recebeu', async () => {
    const depois = await linhaDoGarcom(gestor, garcomId);
    assert.equal(round2(depois.valorRecebido - desempenhoAntes.valorRecebido), 91.3);
    assert.equal(round2(depois.taxaServico - desempenhoAntes.taxaServico), 8.3);
    assert.equal(round2(depois.gorjetas - desempenhoAntes.gorjetas), 5);
    assert.equal(depois.contasRecebidas - desempenhoAntes.contasRecebidas, 2);
  });

  test('garçom não vê o desempenho (403)', async () => {
    assert.equal((await chamar('GET', '/desempenho', garcom)).status, 403);
  });

  test('Pix com a chave do restaurante: copia e cola válido, confirmado pelo garçom', async () => {
    const cfg = await chamar('PUT', '/maquinetas/configuracao', gestor, {
      pixChave: 'pix@restaurante.com.br',
      pixNome: 'Restaurante Exemplo',
      pixCidade: 'São Paulo',
    });
    assert.equal(cfg.status, 200);
    const cafe = await produtoPorNome(gestor, 'Café expresso');
    const pedido = await chamar('POST', '/pedidos', garcom, {
      mesaId: m4.id,
      itens: [{ produtoId: cafe.id, quantidade: 2 }],
    });
    assert.equal(pedido.status, 201);
    // 13,00 + 10% = 14,30
    const pix = await chamar('POST', `/mesas/${m4.id}/cobrar`, garcom, { formaPagamento: 'Pix' });
    assert.equal(pix.status, 201);
    assert.equal(pix.dados.status, 'PENDENTE');
    assert.equal(typeof pix.dados.pix, 'string');
    const codigo = pix.dados.pix;
    assert.ok(codigo.startsWith('000201'), 'o copia e cola deve começar com 000201');
    assert.ok(codigo.includes('br.gov.bcb.pix'));
    assert.ok(codigo.includes('pix@restaurante.com.br'));
    assert.ok(codigo.includes('540514.30'), 'o valor 14,30 deve estar no código');
    assert.ok(codigo.includes('RESTAURANTE EXEMPLO'));
    assert.ok(codigo.includes('SAO PAULO'));
    assert.match(codigo.slice(-4), /^[0-9A-F]{4}$/);
    assert.equal(crc16(codigo.slice(0, -4)), codigo.slice(-4), 'CRC do copia e cola não confere');
    const confirmado = await chamar('POST', `/pagamentos/${pix.dados.id}/confirmar`, garcom, {});
    assert.equal(confirmado.status, 200);
    assert.equal(confirmado.dados.status, 'APROVADO');
    assert.equal((await mesaPorNumero(gestor, 4)).situacao, 'LIMPEZA');
  });

  test('cozinha não vê a conta (403)', async () => {
    const cozinha = await entrar(contas.cozinha.email, contas.cozinha.senha);
    assert.equal((await chamar('GET', `/mesas/${m4.id}/conta`, cozinha)).status, 403);
  });

  test('limpeza marca a mesa como limpa e ela volta a ficar LIVRE', async () => {
    const r = await chamar('POST', `/mesas/${m3.id}/limpa`, limpeza);
    assert.equal(r.status, 204);
    assert.equal((await mesaPorNumero(gestor, 3)).situacao, 'LIVRE');
  });
});
