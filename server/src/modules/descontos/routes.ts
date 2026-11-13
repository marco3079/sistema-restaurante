import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { centavos, contaAberta } from '../../lib/contas';
import { carregarConta, fecharSeQuitada } from '../../lib/pagamentos';
import { lerConfiguracao } from '../../lib/email';

// Descontos da conta da mesa: cupom, cliente, pontos de fidelidade e desconto manual.
// Nenhuma destas rotas mexe em conta com cobrança em andamento. Todas devolvem a conta atualizada.

const router = Router();

const garcons = permitir('GESTOR', 'GARCOM');
const equipeComRecepcao = permitir('GESTOR', 'GARCOM', 'RECEPCAO');
const soGestor = permitir('GESTOR');

function reaisTexto(valor: number): string {
  return valor.toFixed(2).replace('.', ',');
}

// Cupom vale até o fim do dia da validade (dia no fuso do servidor, gravado ao meio-dia).
function cupomVencido(validade: Date): boolean {
  const fimDoDia = new Date(validade.getFullYear(), validade.getMonth(), validade.getDate(), 23, 59, 59, 999);
  return Date.now() > fimDoDia.getTime();
}

// Conta aberta da mesa, sem cobrança pendente. Sem conta ou com cobrança, recusa a mudança.
async function contaParaMudar(mesaId: number) {
  const conta = await contaAberta(mesaId);
  if (!conta) {
    throw new HttpError(400, 'Esta mesa não tem conta aberta.');
  }
  const pendente = await prisma.pagamento.findFirst({
    where: { contaId: conta.id, status: 'PENDENTE' },
    select: { id: true },
  });
  if (pendente) {
    throw new HttpError(409, 'Conclua ou cancele a cobrança em andamento antes de mudar a conta.');
  }
  return conta;
}

// Devolve ao cliente os pontos usados na conta e zera o uso. Não faz nada se não há pontos usados.
async function devolverPontos(contaId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const conta = await tx.conta.findUnique({
      where: { id: contaId },
      select: { clienteId: true, pontosUsados: true },
    });
    if (!conta || !conta.clienteId || conta.pontosUsados <= 0) return;
    // Zera antes de creditar: se outra requisição já devolveu, o count vem 0 e nada é creditado de novo.
    const zerou = await tx.conta.updateMany({
      where: { id: contaId, pontosUsados: conta.pontosUsados },
      data: { pontosUsados: 0 },
    });
    if (zerou.count === 0) return;
    await tx.cliente.update({
      where: { id: conta.clienteId },
      data: { pontos: { increment: conta.pontosUsados } },
    });
    await tx.movimentoPontos.create({
      data: {
        clienteId: conta.clienteId,
        contaId,
        pontos: conta.pontosUsados,
        motivo: `Devolvido da conta #${contaId}`,
      },
    });
  });
}

// ---------- Cupom ----------

const cupomSchema = z.object({
  codigo: z.string().trim().min(1, 'Informe o código do cupom').max(40, 'Código muito longo'),
});

router.post(
  '/mesas/:id/conta/cupom',
  garcons,
  asyncHandler(async (req, res) => {
    const mesaId = idParam(req);
    const dados = validar(cupomSchema, req.body);
    const conta = await contaParaMudar(mesaId);
    const cupom = await prisma.cupom.findUnique({ where: { codigo: dados.codigo.toUpperCase() } });
    if (!cupom || !cupom.ativo) {
      throw new HttpError(404, 'Cupom não encontrado');
    }
    if (cupom.validade && cupomVencido(cupom.validade)) {
      throw new HttpError(400, 'Este cupom venceu');
    }
    if (cupom.limiteUsos !== null && cupom.usos >= cupom.limiteUsos) {
      throw new HttpError(400, 'Este cupom já foi usado o número máximo de vezes');
    }
    const minimo = Number(cupom.minimo);
    const resumo = await carregarConta(mesaId);
    if (centavos(resumo.subtotal) < centavos(minimo)) {
      throw new HttpError(400, `Este cupom vale para consumo a partir de R$ ${reaisTexto(minimo)}`);
    }
    await prisma.conta.update({ where: { id: conta.id }, data: { cupomId: cupom.id } });
    // O desconto pode quitar a conta que já estava quase paga.
    await fecharSeQuitada(conta.id);
    res.json(await carregarConta(mesaId));
  })
);

router.delete(
  '/mesas/:id/conta/cupom',
  garcons,
  asyncHandler(async (req, res) => {
    const mesaId = idParam(req);
    const conta = await contaParaMudar(mesaId);
    await prisma.conta.update({ where: { id: conta.id }, data: { cupomId: null } });
    res.json(await carregarConta(mesaId));
  })
);

// ---------- Cliente da conta ----------

const clienteContaSchema = z.object({
  // Número de telefone do cliente, ou null para desligar o cliente da conta.
  telefone: z.string().max(40, 'Telefone inválido').nullable(),
  nome: z.string().trim().max(80, 'Nome muito longo').optional(),
});

router.put(
  '/mesas/:id/conta/cliente',
  equipeComRecepcao,
  asyncHandler(async (req, res) => {
    const mesaId = idParam(req);
    const dados = validar(clienteContaSchema, req.body);
    const conta = await contaParaMudar(mesaId);

    if (dados.telefone === null) {
      await devolverPontos(conta.id);
      await prisma.conta.update({ where: { id: conta.id }, data: { clienteId: null } });
      res.json(await carregarConta(mesaId));
      return;
    }

    const digitos = dados.telefone.replace(/\D/g, '');
    if (digitos.length !== 10 && digitos.length !== 11) {
      throw new HttpError(400, 'Informe o telefone com DDD (10 ou 11 dígitos)');
    }
    let cliente = await prisma.cliente.findUnique({ where: { telefone: digitos }, select: { id: true } });
    if (!cliente) {
      const nome = dados.nome ?? '';
      if (nome === '') {
        throw new HttpError(400, 'Informe o nome para cadastrar o cliente');
      }
      cliente = await prisma.cliente.create({ data: { nome, telefone: digitos }, select: { id: true } });
    }
    // Trocar de cliente devolve os pontos do cliente anterior antes de ligar o novo.
    if (conta.clienteId !== cliente.id) {
      await devolverPontos(conta.id);
      await prisma.conta.update({ where: { id: conta.id }, data: { clienteId: cliente.id } });
    }
    res.json(await carregarConta(mesaId));
  })
);

// ---------- Pontos de fidelidade ----------

const pontosSchema = z.object({
  pontos: z
    .number()
    .int('Use um número inteiro')
    .min(1, 'Informe pelo menos 1 ponto')
    .max(10000000, 'Quantidade inválida'),
});

router.post(
  '/mesas/:id/conta/pontos',
  garcons,
  asyncHandler(async (req, res) => {
    const mesaId = idParam(req);
    const dados = validar(pontosSchema, req.body);
    const conta = await contaParaMudar(mesaId);
    if (!conta.clienteId || !conta.cliente) {
      throw new HttpError(400, 'Ligue um cliente à conta para usar os pontos');
    }
    const clienteId = conta.clienteId;
    const configuracao = await lerConfiguracao();
    if (!configuracao.fidelidadeAtiva) {
      throw new HttpError(400, 'O programa de fidelidade está desligado');
    }
    const pontos = dados.pontos;
    const saldo = conta.cliente.pontos;
    if (pontos > saldo) {
      throw new HttpError(400, `Este cliente tem ${saldo} pontos`);
    }

    // O desconto total (cupom, pontos e manual) não pode passar do subtotal.
    const valorDoPonto = Number(configuracao.valorDoPonto);
    const resumo = await carregarConta(mesaId);
    const descontoPontos = Math.round((conta.pontosUsados + pontos) * valorDoPonto * 100);
    const outros = centavos(resumo.descontoCupom) + centavos(resumo.descontoManual);
    if (outros + descontoPontos > centavos(resumo.subtotal)) {
      throw new HttpError(400, 'Os pontos passam do valor da conta');
    }

    await prisma.$transaction(async (tx) => {
      // Cobrança pendente é conferida de novo dentro da transação (pode ter começado depois da leitura acima).
      const cobrando = await tx.pagamento.findFirst({
        where: { contaId: conta.id, status: 'PENDENTE' },
        select: { id: true },
      });
      if (cobrando) {
        throw new HttpError(409, 'Conclua ou cancele a cobrança em andamento antes de mudar a conta.');
      }
      // O saldo é conferido na própria transação: dois pedidos ao mesmo tempo não gastam o mesmo ponto.
      const debitado = await tx.cliente.updateMany({
        where: { id: clienteId, pontos: { gte: pontos } },
        data: { pontos: { decrement: pontos } },
      });
      if (debitado.count === 0) {
        throw new HttpError(400, 'Este cliente não tem pontos suficientes');
      }
      await tx.movimentoPontos.create({
        data: { clienteId, contaId: conta.id, pontos: -pontos, motivo: `Usado na conta #${conta.id}` },
      });
      await tx.conta.update({
        where: { id: conta.id },
        data: { pontosUsados: { increment: pontos }, valorDoPonto: valorDoPonto.toFixed(4) },
      });
    });
    await fecharSeQuitada(conta.id);
    res.json(await carregarConta(mesaId));
  })
);

router.delete(
  '/mesas/:id/conta/pontos',
  garcons,
  asyncHandler(async (req, res) => {
    const mesaId = idParam(req);
    const conta = await contaParaMudar(mesaId);
    await devolverPontos(conta.id);
    res.json(await carregarConta(mesaId));
  })
);

// ---------- Desconto manual ----------

const descontoSchema = z.object({
  valor: z.number().min(0, 'Valor inválido').max(999999, 'Valor inválido'),
  motivo: z.string().trim().max(120, 'Motivo muito longo').nullable().optional(),
});

router.put(
  '/mesas/:id/conta/desconto',
  soGestor,
  asyncHandler(async (req, res) => {
    const mesaId = idParam(req);
    const dados = validar(descontoSchema, req.body);
    const conta = await contaParaMudar(mesaId);
    const resumo = await carregarConta(mesaId);
    const valor = centavos(dados.valor);
    if (valor > centavos(resumo.subtotal)) {
      throw new HttpError(400, 'O desconto não pode ser maior que o total dos pedidos');
    }
    await prisma.conta.update({
      where: { id: conta.id },
      data: {
        descontoManual: (valor / 100).toFixed(2),
        // Valor zero limpa o desconto e o motivo.
        descontoMotivo: valor === 0 ? null : dados.motivo?.trim() || null,
      },
    });
    await fecharSeQuitada(conta.id);
    res.json(await carregarConta(mesaId));
  })
);

export default router;
