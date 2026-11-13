import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { HttpError } from './erros';
import { centavos, garantirConta, incluirConta, valoresDaConta } from './contas';
import { liberarParaLimpeza, ocuparMesa } from './mesas';

// Trocar de mesa, juntar contas e transferir itens. Cada operação roda em UMA transação e refaz
// as conferências dentro dela. O estado das mesas (ocupada, limpeza) é ajustado depois da transação.

type Tx = Prisma.TransactionClient;

type ItemComPedido = Prisma.ItemPedidoGetPayload<{ include: { pedido: { include: { setores: true } } } }>;

const SEM_CONTA = 'Esta mesa não tem conta aberta.';

async function contaAbertaDaMesa(tx: Tx, mesaId: number) {
  return tx.conta.findFirst({
    where: { mesaId, status: 'ABERTA' },
    orderBy: { id: 'desc' },
    include: incluirConta,
  });
}

async function semCobrancaPendente(tx: Tx, contaId: number, acao: string): Promise<void> {
  const pendentes = await tx.pagamento.count({ where: { contaId, status: 'PENDENTE' } });
  if (pendentes > 0) {
    throw new HttpError(409, `Conclua ou cancele a cobrança em andamento antes de ${acao}.`);
  }
}

// Mesa de destino da troca: ativa, com estado LIVRE e sem conta aberta.
async function confereMesaLivre(tx: Tx, mesaId: number): Promise<void> {
  const mesa = await tx.mesa.findUnique({
    where: { id: mesaId, tipo: 'SALAO' },
    select: { ativa: true, estado: true },
  });
  if (!mesa || !mesa.ativa) {
    throw new HttpError(404, 'Mesa de destino não encontrada ou desativada');
  }
  const aberta = await contaAbertaDaMesa(tx, mesaId);
  if (mesa.estado !== 'LIVRE' || aberta) {
    throw new HttpError(409, 'A mesa de destino não está livre');
  }
}

// Troca a conta de mesa: a conta inteira (pedidos e pagamentos) passa para a mesa de destino.
export async function trocarMesa(origemId: number, paraMesaId: number): Promise<void> {
  if (origemId === paraMesaId) {
    throw new HttpError(400, 'Escolha outra mesa de destino');
  }
  await prisma.$transaction(async (tx) => {
    const conta = await contaAbertaDaMesa(tx, origemId);
    if (!conta) {
      throw new HttpError(400, SEM_CONTA);
    }
    await semCobrancaPendente(tx, conta.id, 'trocar de mesa');
    await confereMesaLivre(tx, paraMesaId);
    await tx.conta.update({ where: { id: conta.id }, data: { mesaId: paraMesaId } });
    await tx.pedido.updateMany({ where: { contaId: conta.id }, data: { mesaId: paraMesaId } });
    await tx.pagamento.updateMany({ where: { contaId: conta.id }, data: { mesaId: paraMesaId } });
    await tx.mesa.update({ where: { id: origemId }, data: { chamandoDesde: null } });
  });
  await liberarParaLimpeza(origemId, false);
  await ocuparMesa(paraMesaId);
}

// Junta a conta da outra mesa na conta da mesa `id`. A conta de `id` fica com taxa, cupom,
// cliente e descontos; a outra conta é apagada e a outra mesa vai para a limpeza.
export async function juntarMesas(id: number, comMesaId: number): Promise<void> {
  if (id === comMesaId) {
    throw new HttpError(400, 'Escolha outra mesa para juntar');
  }
  await prisma.$transaction(async (tx) => {
    const contaA = await contaAbertaDaMesa(tx, id);
    if (!contaA) {
      throw new HttpError(400, SEM_CONTA);
    }
    const contaB = await contaAbertaDaMesa(tx, comMesaId);
    if (!contaB) {
      throw new HttpError(400, 'A outra mesa não tem conta aberta.');
    }
    await semCobrancaPendente(tx, contaA.id, 'juntar as mesas');
    await semCobrancaPendente(tx, contaB.id, 'juntar as mesas');

    const nota = await tx.notaFiscal.findUnique({ where: { contaId: contaB.id }, select: { id: true } });
    if (nota) {
      throw new HttpError(409, 'A conta da outra mesa já tem nota fiscal e não pode ser juntada.');
    }

    await tx.pedido.updateMany({ where: { contaId: contaB.id }, data: { contaId: contaA.id, mesaId: id } });
    await tx.pagamento.updateMany({ where: { contaId: contaB.id }, data: { contaId: contaA.id, mesaId: id } });

    // Pontos usados na conta que some voltam ao cliente dela.
    if (contaB.clienteId !== null && contaB.pontosUsados > 0) {
      await tx.cliente.update({
        where: { id: contaB.clienteId },
        data: { pontos: { increment: contaB.pontosUsados } },
      });
      await tx.movimentoPontos.create({
        data: {
          clienteId: contaB.clienteId,
          contaId: contaB.id,
          pontos: contaB.pontosUsados,
          motivo: `Devolvido da conta #${contaB.id}`,
        },
      });
    }

    await tx.conta.delete({ where: { id: contaB.id } });
  });
  await liberarParaLimpeza(comMesaId, false);
  await ocuparMesa(id);
}

// Passa itens (ou parte da quantidade deles) da conta de origem para a conta do destino.
export async function transferirItens(
  origemId: number,
  paraMesaId: number,
  itens: { itemId: number; quantidade: number }[]
): Promise<void> {
  if (origemId === paraMesaId) {
    throw new HttpError(400, 'Escolha outra mesa de destino');
  }
  const ids = itens.map((i) => i.itemId);
  if (new Set(ids).size !== ids.length) {
    throw new HttpError(400, 'Um item aparece mais de uma vez na lista');
  }

  const origem = await prisma.mesa.findUnique({ where: { id: origemId }, select: { numero: true } });
  if (!origem) {
    throw new HttpError(404, 'Mesa não encontrada');
  }
  const destino = await prisma.mesa.findUnique({
    where: { id: paraMesaId, tipo: 'SALAO' },
    select: { ativa: true },
  });
  if (!destino || !destino.ativa) {
    throw new HttpError(404, 'Mesa de destino não encontrada ou desativada');
  }
  // Abre a conta do destino antes da transação, como em garantirConta.
  await garantirConta(paraMesaId);

  const origemLimpa = await prisma.$transaction(async (tx) => {
    const conta = await contaAbertaDaMesa(tx, origemId);
    if (!conta) {
      throw new HttpError(400, SEM_CONTA);
    }
    await semCobrancaPendente(tx, conta.id, 'transferir itens');
    const contaDestino = await contaAbertaDaMesa(tx, paraMesaId);
    if (!contaDestino) {
      throw new HttpError(409, 'Não foi possível abrir a conta da mesa de destino');
    }
    await semCobrancaPendente(tx, contaDestino.id, 'transferir itens');

    const registros: ItemComPedido[] = await tx.itemPedido.findMany({
      where: { id: { in: ids } },
      include: { pedido: { include: { setores: true } } },
    });
    const porId = new Map(registros.map((r) => [r.id, r]));

    // Agrupa os itens movidos pelo pedido de origem de cada um.
    const grupos = new Map<number, { pedido: ItemComPedido['pedido']; movidos: { item: ItemComPedido; quantidade: number }[] }>();
    for (const { itemId, quantidade } of itens) {
      const registro = porId.get(itemId);
      if (!registro || registro.pedido.contaId !== conta.id || registro.pedido.status === 'CANCELADO') {
        throw new HttpError(400, 'Um dos itens não está mais nesta conta. Atualize a tela.');
      }
      if (quantidade > registro.quantidade) {
        throw new HttpError(400, 'A quantidade passa do que tem no item');
      }
      const grupo = grupos.get(registro.pedidoId) ?? { pedido: registro.pedido, movidos: [] };
      grupo.movidos.push({ item: registro, quantidade });
      grupos.set(registro.pedidoId, grupo);
    }

    for (const { pedido, movidos } of grupos.values()) {
      // Um pedido novo no destino, com os itens movidos, no mesmo estado do pedido de origem.
      const linhas = movidos.map(({ item, quantidade }) => ({
        produtoId: item.produtoId,
        nomeProduto: item.nomeProduto,
        precoUnitario: item.precoUnitario,
        precoOriginal: item.precoOriginal,
        quantidade,
        observacao: item.observacao,
        opcoes: item.opcoes === null ? Prisma.DbNull : (item.opcoes as Prisma.InputJsonValue),
        setorId: item.setorId,
      }));
      const totalNovo = movidos.reduce((soma, m) => soma + centavos(Number(m.item.precoUnitario)) * m.quantidade, 0);
      const setorIdsNovo = [...new Set(movidos.map((m) => m.item.setorId).filter((s): s is number => s !== null))];
      const setoresNovo = setorIdsNovo.map((setorId) => ({
        setorId,
        status: pedido.setores.find((s) => s.setorId === setorId)?.status ?? pedido.status,
      }));
      await tx.pedido.create({
        data: {
          mesaId: paraMesaId,
          contaId: contaDestino.id,
          status: pedido.status,
          origem: pedido.origem,
          nomeCliente: pedido.nomeCliente,
          observacao: `Transferido da mesa ${origem.numero}`,
          garcomId: pedido.garcomId,
          total: (totalNovo / 100).toFixed(2),
          criadoEm: pedido.criadoEm,
          preparoIniciadoEm: pedido.preparoIniciadoEm,
          prontoEm: pedido.prontoEm,
          entregueEm: pedido.entregueEm,
          itens: { create: linhas },
          setores: { create: setoresNovo },
        },
      });

      // Tira a quantidade do pedido de origem; item que zera é apagado.
      for (const { item, quantidade } of movidos) {
        const sobra = item.quantidade - quantidade;
        if (sobra === 0) {
          await tx.itemPedido.delete({ where: { id: item.id } });
        } else {
          await tx.itemPedido.update({ where: { id: item.id }, data: { quantidade: sobra } });
        }
      }

      const restam = await tx.itemPedido.findMany({ where: { pedidoId: pedido.id } });
      if (restam.length === 0) {
        await tx.pedido.delete({ where: { id: pedido.id } });
      } else {
        const totalSobra = restam.reduce((soma, i) => soma + centavos(Number(i.precoUnitario)) * i.quantidade, 0);
        const setoresRestantes = [...new Set(restam.map((i) => i.setorId).filter((s): s is number => s !== null))];
        await tx.pedido.update({ where: { id: pedido.id }, data: { total: (totalSobra / 100).toFixed(2) } });
        // Parte de setor que ficou sem itens no pedido de origem sai da fila.
        await tx.pedidoSetor.deleteMany({
          where: { pedidoId: pedido.id, setorId: { notIn: setoresRestantes } },
        });
      }
    }

    // Confere o que já foi pago contra o novo total da conta de origem.
    const contaAtual = await tx.conta.findUnique({ where: { id: conta.id }, include: incluirConta });
    const pedidosAtivos = await tx.pedido.findMany({
      where: { contaId: conta.id, status: { not: 'CANCELADO' } },
      select: { total: true },
    });
    const subtotal = pedidosAtivos.reduce((soma, p) => soma + centavos(Number(p.total)), 0) / 100;
    const aprovados = await tx.pagamento.findMany({
      where: { contaId: conta.id, status: 'APROVADO' },
      select: { valor: true },
    });
    const pago = aprovados.reduce((soma, p) => soma + centavos(Number(p.valor)), 0) / 100;
    const valores = valoresDaConta(contaAtual, subtotal, pago);
    if (centavos(pago) > centavos(valores.total)) {
      throw new HttpError(409, 'Esta mesa já pagou mais do que sobraria. Transfira menos itens.');
    }

    // Conta de origem sem pedido ativo e sem pagamento aprovado: não pode continuar ocupando a mesa.
    if (pedidosAtivos.length === 0 && aprovados.length === 0) {
      const pedidosNaConta = await tx.pedido.count({ where: { contaId: conta.id } });
      if (pedidosNaConta === 0) {
        // Nenhum pedido sobrou (nem cancelado): a conta é apagada e os pagamentos recusados vão para o destino.
        const nota = await tx.notaFiscal.findUnique({ where: { contaId: conta.id }, select: { id: true } });
        if (nota) {
          throw new HttpError(409, 'Esta conta já tem nota fiscal');
        }
        await tx.pagamento.updateMany({
          where: { contaId: conta.id },
          data: { contaId: contaDestino.id, mesaId: paraMesaId },
        });
        await tx.conta.delete({ where: { id: conta.id } });
      } else {
        // Só sobraram pedidos cancelados: o histórico fica, a conta é fechada.
        await tx.conta.update({
          where: { id: conta.id },
          data: { status: 'FECHADA', fechadaEm: new Date() },
        });
      }
      return true;
    }
    return false;
  });

  if (origemLimpa) {
    await liberarParaLimpeza(origemId, false);
  }
  await ocuparMesa(paraMesaId);
}
