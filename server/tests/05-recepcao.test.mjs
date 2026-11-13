import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chamar, entrar, obter, mesaPorNumero, limparMesa, contas } from './apoio.mjs';

// Recepção: fila de espera e reservas. Usa as mesas 6 e 7. Horários são sempre relativos a "agora".

const daquiA = (horas) => new Date(Date.now() + horas * 3600000).toISOString();

describe('recepção: fila de espera e reservas', () => {
  let gestor;
  let garcom;
  let recepcao;
  let limpeza;
  let m6;
  let m7;
  let pessoa1;
  let pessoa2;
  let reserva;

  before(async () => {
    gestor = await entrar(contas.gestor.email, contas.gestor.senha);
    garcom = await entrar(contas.garcom.email, contas.garcom.senha);
    recepcao = await entrar(contas.recepcao.email, contas.recepcao.senha);
    limpeza = await entrar(contas.limpeza.email, contas.limpeza.senha);
    m6 = await mesaPorNumero(gestor, 6);
    m7 = await mesaPorNumero(gestor, 7);
    // Cancela reservas ativas que tenham sobrado de uma execução anterior nestas mesas.
    const proximas = await obter('/reservas?proximas=1', recepcao);
    for (const r of proximas) {
      if ((r.mesaId === m6.id || r.mesaId === m7.id) && r.status === 'ATIVA') {
        await chamar('PUT', `/reservas/${r.id}/status`, recepcao, { status: 'CANCELADA' });
      }
    }
    await limparMesa(gestor, m6);
    await limparMesa(gestor, m7);
  });

  after(async () => {
    if (!gestor) return;
    // Tira da fila as pessoas de teste que ainda estiverem esperando (as acomodadas já saíram).
    for (const pessoa of [pessoa1, pessoa2]) {
      if (pessoa?.dados?.id) {
        await chamar('PUT', `/espera/${pessoa.dados.id}/status`, recepcao, { status: 'DESISTIU' });
      }
    }
    if (m6) await limparMesa(gestor, m6);
    if (m7) await limparMesa(gestor, m7);
  });

  test('garçom não vê a fila de espera (403)', async () => {
    assert.equal((await chamar('GET', '/espera', garcom)).status, 403);
  });

  test('duas pessoas entram na fila, por ordem de chegada', async () => {
    pessoa1 = await chamar('POST', '/espera', recepcao, {
      nome: 'Família Silva (teste)',
      pessoas: 4,
      telefone: '11 99999-0000',
    });
    pessoa2 = await chamar('POST', '/espera', recepcao, { nome: 'Casal Souza (teste)', pessoas: 2 });
    assert.equal(pessoa1.status, 201);
    assert.equal(pessoa2.status, 201);
    const ids = (await obter('/espera', recepcao)).fila.map((e) => e.id);
    const posicao1 = ids.indexOf(pessoa1.dados.id);
    const posicao2 = ids.indexOf(pessoa2.dados.id);
    assert.ok(posicao1 >= 0 && posicao2 > posicao1, 'a fila precisa manter a ordem de chegada');
  });

  test('chamar a pessoa muda a situação para CHAMADO', async () => {
    const r = await chamar('PUT', `/espera/${pessoa1.dados.id}/status`, recepcao, { status: 'CHAMADO' });
    assert.equal(r.status, 200);
    assert.equal(r.dados.status, 'CHAMADO');
  });

  test('acomodar sem informar a mesa é recusado (400)', async () => {
    const r = await chamar('PUT', `/espera/${pessoa1.dados.id}/status`, recepcao, { status: 'ACOMODADO' });
    assert.equal(r.status, 400);
  });

  test('não acomoda numa mesa ocupada nem numa mesa em limpeza (400)', async () => {
    assert.equal((await chamar('POST', `/mesas/${m7.id}/ocupar`, recepcao)).status, 204);
    assert.equal((await mesaPorNumero(gestor, 7)).situacao, 'OCUPADA');
    const ocupada = await chamar('PUT', `/espera/${pessoa1.dados.id}/status`, recepcao, {
      status: 'ACOMODADO',
      mesaId: m7.id,
    });
    assert.equal(ocupada.status, 400);

    assert.equal((await chamar('POST', `/mesas/${m7.id}/liberar`, gestor)).status, 204);
    assert.equal((await mesaPorNumero(gestor, 7)).situacao, 'LIMPEZA');
    const emLimpeza = await chamar('PUT', `/espera/${pessoa1.dados.id}/status`, recepcao, {
      status: 'ACOMODADO',
      mesaId: m7.id,
    });
    assert.equal(emLimpeza.status, 400);

    assert.equal((await chamar('POST', `/mesas/${m7.id}/limpa`, gestor)).status, 204);
    assert.equal((await mesaPorNumero(gestor, 7)).situacao, 'LIVRE');
  });

  test('acomodar numa mesa livre ocupa a mesa e tira a pessoa da fila', async () => {
    const r = await chamar('PUT', `/espera/${pessoa1.dados.id}/status`, recepcao, {
      status: 'ACOMODADO',
      mesaId: m6.id,
    });
    assert.equal(r.status, 200);
    assert.equal(r.dados.status, 'ACOMODADO');
    assert.equal((await mesaPorNumero(gestor, 6)).situacao, 'OCUPADA');
    const fila = (await obter('/espera', recepcao)).fila;
    assert.equal(fila.some((e) => e.id === pessoa1.dados.id), false);
  });

  test('desistência tira a pessoa da fila', async () => {
    const r = await chamar('PUT', `/espera/${pessoa2.dados.id}/status`, recepcao, { status: 'DESISTIU' });
    assert.equal(r.status, 200);
    const fila = (await obter('/espera', recepcao)).fila;
    assert.equal(fila.some((e) => e.id === pessoa2.dados.id), false);
  });

  test('reserva criada para a mesa 7 num horário futuro', async () => {
    await limparMesa(gestor, m7);
    const r = await chamar('POST', '/reservas', recepcao, {
      nome: 'Aniversário da Júlia (teste)',
      pessoas: 4,
      dataHora: daquiA(1),
      mesaId: m7.id,
    });
    assert.equal(r.status, 201);
    assert.equal(r.dados.mesa.numero, 7);
    reserva = r.dados;
  });

  test('mesma mesa em horário próximo é recusada (409)', async () => {
    const r = await chamar('POST', '/reservas', recepcao, {
      nome: 'Outro cliente (teste)',
      pessoas: 2,
      dataHora: daquiA(2),
      mesaId: m7.id,
    });
    assert.equal(r.status, 409);
  });

  test('reserva com horário que já passou é recusada (400)', async () => {
    const r = await chamar('POST', '/reservas', recepcao, {
      nome: 'Ontem (teste)',
      pessoas: 2,
      dataHora: daquiA(-5),
    });
    assert.equal(r.status, 400);
  });

  test('a reserva aparece na lista das próximas', async () => {
    const proximas = await obter('/reservas?proximas=1', recepcao);
    assert.ok(proximas.some((r) => r.id === reserva.id));
  });

  test('cliente chegou: a mesa da reserva fica ocupada', async () => {
    const r = await chamar('PUT', `/reservas/${reserva.id}/status`, recepcao, { status: 'CHEGOU' });
    assert.equal(r.status, 200);
    assert.equal(r.dados.status, 'CHEGOU');
    assert.equal((await mesaPorNumero(gestor, 7)).situacao, 'OCUPADA');
  });

  test('limpeza não vê as reservas (403)', async () => {
    assert.equal((await chamar('GET', '/reservas', limpeza)).status, 403);
  });
});
