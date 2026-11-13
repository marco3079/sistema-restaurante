import { Router } from 'express';
import { z } from 'zod';
import type { Cliente, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { centavos, reais } from '../../lib/contas';
import { lerConfiguracao, limparCacheConfiguracao } from '../../lib/email';

// Clientes da casa: cadastro, histórico de contas e extrato de pontos. Também a configuração
// do programa de fidelidade. Os pontos ganhos ao fechar a conta são creditados em lib/pagamentos.

const router = Router();

const equipeDeAtendimento = permitir('GESTOR', 'GARCOM', 'RECEPCAO');
const gestorOuRecepcao = permitir('GESTOR', 'RECEPCAO');
const soGestor = permitir('GESTOR');

interface Resumo {
  visitas: number;
  ultimaVisita: Date | null;
  totalCentavos: number;
}

// Total de uma conta: o que foi pago (pagamentos aprovados, sem gorjeta).
function totalEmCentavos(pagamentos: { valor: unknown }[]): number {
  return pagamentos.reduce((soma, p) => soma + centavos(Number(p.valor)), 0);
}

// Visitas (contas fechadas), última visita e total gasto de cada cliente, em uma consulta.
async function resumoDosClientes(ids: number[]): Promise<Map<number, Resumo>> {
  const resumos = new Map<number, Resumo>();
  if (ids.length === 0) return resumos;
  const contas = await prisma.conta.findMany({
    where: { clienteId: { in: ids }, status: 'FECHADA' },
    select: {
      clienteId: true,
      fechadaEm: true,
      pagamentos: { where: { status: 'APROVADO' }, select: { valor: true } },
    },
  });
  for (const conta of contas) {
    if (conta.clienteId === null) continue;
    const resumo = resumos.get(conta.clienteId) ?? { visitas: 0, ultimaVisita: null, totalCentavos: 0 };
    resumo.visitas += 1;
    if (conta.fechadaEm && (!resumo.ultimaVisita || conta.fechadaEm > resumo.ultimaVisita)) {
      resumo.ultimaVisita = conta.fechadaEm;
    }
    resumo.totalCentavos += totalEmCentavos(conta.pagamentos);
    resumos.set(conta.clienteId, resumo);
  }
  return resumos;
}

// Total gasto só vai para o gestor; para os outros perfis fica zerado.
function paraClienteDTO(cliente: Cliente, resumo: Resumo | undefined, gestor: boolean) {
  return {
    id: cliente.id,
    nome: cliente.nome,
    telefone: cliente.telefone,
    email: cliente.email,
    nascimento: cliente.nascimento ? cliente.nascimento.toISOString().slice(0, 10) : null,
    pontos: cliente.pontos,
    observacao: cliente.observacao,
    criadoEm: cliente.criadoEm.toISOString(),
    visitas: resumo?.visitas ?? 0,
    ultimaVisita: resumo?.ultimaVisita ? resumo.ultimaVisita.toISOString() : null,
    totalGasto: gestor && resumo ? reais(resumo.totalCentavos) : 0,
  };
}

// Telefone é único. Se o banco recusar por repetição (dois cadastros ao mesmo tempo), vira 409.
function semRepeticao(erro: unknown): unknown {
  if (typeof erro === 'object' && erro !== null && (erro as { code?: unknown }).code === 'P2002') {
    return new HttpError(409, 'Já existe um cliente com este telefone');
  }
  return erro;
}

async function garantirTelefoneLivre(telefone: string, ignorarId?: number): Promise<void> {
  const existente = await prisma.cliente.findUnique({ where: { telefone }, select: { id: true } });
  if (existente && existente.id !== ignorarId) {
    throw new HttpError(409, 'Já existe um cliente com este telefone');
  }
}

// ---------- Listagem e ficha ----------

router.get(
  '/clientes',
  equipeDeAtendimento,
  asyncHandler(async (req, res) => {
    const busca = typeof req.query.busca === 'string' ? req.query.busca.trim().slice(0, 80) : '';
    const digitos = busca.replace(/\D/g, '');
    const filtro: Prisma.ClienteWhereInput =
      busca === ''
        ? {}
        : {
            OR: [
              { nome: { contains: busca, mode: 'insensitive' } },
              ...(digitos !== '' ? [{ telefone: { contains: digitos } }] : []),
            ],
          };
    const clientes = await prisma.cliente.findMany({ where: filtro, orderBy: { nome: 'asc' }, take: 200 });
    const resumos = await resumoDosClientes(clientes.map((c) => c.id));
    const gestor = req.usuario.perfil === 'GESTOR';
    res.json(clientes.map((c) => paraClienteDTO(c, resumos.get(c.id), gestor)));
  })
);

router.get(
  '/clientes/:id',
  soGestor,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const cliente = await prisma.cliente.findUnique({
      where: { id },
      include: { movimentos: { orderBy: { criadoEm: 'desc' }, take: 50 } },
    });
    if (!cliente) {
      throw new HttpError(404, 'Cliente não encontrado');
    }
    const resumos = await resumoDosClientes([id]);
    const contas = await prisma.conta.findMany({
      where: { clienteId: id, status: 'FECHADA' },
      orderBy: { fechadaEm: 'desc' },
      take: 20,
      select: {
        id: true,
        fechadaEm: true,
        pagamentos: { where: { status: 'APROVADO' }, select: { valor: true } },
      },
    });
    res.json({
      ...paraClienteDTO(cliente, resumos.get(id), true),
      movimentos: cliente.movimentos.map((m) => ({
        id: m.id,
        pontos: m.pontos,
        motivo: m.motivo,
        contaId: m.contaId,
        criadoEm: m.criadoEm.toISOString(),
      })),
      contas: contas.map((c) => ({
        id: c.id,
        fechadaEm: c.fechadaEm ? c.fechadaEm.toISOString() : null,
        total: reais(totalEmCentavos(c.pagamentos)),
      })),
    });
  })
);

// ---------- Cadastro ----------

const clienteSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome').max(80, 'Nome muito longo'),
  telefone: z.string().max(40, 'Telefone inválido'),
  email: z.string().trim().max(120, 'E-mail muito longo').nullable().optional(),
  nascimento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de nascimento inválida')
    .nullable()
    .optional(),
  observacao: z.string().trim().max(500, 'Observação muito longa').nullable().optional(),
});

// Valida e normaliza o cadastro: telefone só com dígitos, e-mail e nascimento opcionais.
function dadosDoCliente(dados: z.infer<typeof clienteSchema>) {
  const telefone = dados.telefone.replace(/\D/g, '');
  if (telefone.length !== 10 && telefone.length !== 11) {
    throw new HttpError(400, 'Informe o telefone com DDD (10 ou 11 dígitos)');
  }
  const email = dados.email ? dados.email : null;
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'E-mail inválido');
  }
  let nascimento: Date | null = null;
  if (dados.nascimento) {
    nascimento = new Date(`${dados.nascimento}T00:00:00.000Z`);
    if (Number.isNaN(nascimento.getTime())) {
      throw new HttpError(400, 'Data de nascimento inválida');
    }
  }
  return {
    nome: dados.nome,
    telefone,
    email,
    nascimento,
    observacao: dados.observacao ? dados.observacao : null,
  };
}

router.post(
  '/clientes',
  gestorOuRecepcao,
  asyncHandler(async (req, res) => {
    const dados = dadosDoCliente(validar(clienteSchema, req.body));
    await garantirTelefoneLivre(dados.telefone);
    const cliente = await prisma.cliente.create({ data: dados }).catch((erro: unknown) => {
      throw semRepeticao(erro);
    });
    res.status(201).json(paraClienteDTO(cliente, undefined, req.usuario.perfil === 'GESTOR'));
  })
);

router.put(
  '/clientes/:id',
  gestorOuRecepcao,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = dadosDoCliente(validar(clienteSchema, req.body));
    const atual = await prisma.cliente.findUnique({ where: { id }, select: { id: true } });
    if (!atual) {
      throw new HttpError(404, 'Cliente não encontrado');
    }
    await garantirTelefoneLivre(dados.telefone, id);
    const cliente = await prisma.cliente.update({ where: { id }, data: dados }).catch((erro: unknown) => {
      throw semRepeticao(erro);
    });
    const resumos = await resumoDosClientes([id]);
    res.json(paraClienteDTO(cliente, resumos.get(id), req.usuario.perfil === 'GESTOR'));
  })
);

router.delete(
  '/clientes/:id',
  soGestor,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.cliente.findUnique({ where: { id }, select: { id: true } });
    if (!atual) {
      throw new HttpError(404, 'Cliente não encontrado');
    }
    const contas = await prisma.conta.count({ where: { clienteId: id } });
    if (contas > 0) {
      throw new HttpError(409, 'Este cliente tem contas no histórico');
    }
    await prisma.cliente.delete({ where: { id } });
    res.status(204).end();
  })
);

// ---------- Ajuste manual de pontos ----------

const ajusteSchema = z.object({
  pontos: z
    .number()
    .int('Use um número inteiro')
    .min(-10000000, 'Quantidade inválida')
    .max(10000000, 'Quantidade inválida')
    .refine((n) => n !== 0, 'Informe uma quantidade de pontos diferente de zero'),
  motivo: z.string().trim().min(1, 'Informe o motivo').max(80, 'Motivo muito longo'),
});

router.post(
  '/clientes/:id/pontos',
  soGestor,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(ajusteSchema, req.body);
    const atual = await prisma.cliente.findUnique({ where: { id }, select: { id: true } });
    if (!atual) {
      throw new HttpError(404, 'Cliente não encontrado');
    }
    await prisma.$transaction(async (tx) => {
      if (dados.pontos < 0) {
        // O saldo não pode ficar negativo: a condição é conferida na própria transação.
        const debitado = await tx.cliente.updateMany({
          where: { id, pontos: { gte: -dados.pontos } },
          data: { pontos: { decrement: -dados.pontos } },
        });
        if (debitado.count === 0) {
          throw new HttpError(400, 'O saldo de pontos não pode ficar negativo');
        }
      } else {
        await tx.cliente.update({ where: { id }, data: { pontos: { increment: dados.pontos } } });
      }
      await tx.movimentoPontos.create({
        data: { clienteId: id, pontos: dados.pontos, motivo: dados.motivo },
      });
    });
    const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id } });
    const resumos = await resumoDosClientes([id]);
    res.status(201).json(paraClienteDTO(cliente, resumos.get(id), true));
  })
);

// ---------- Configuração do programa de fidelidade ----------

function paraFidelidadeDTO(configuracao: { fidelidadeAtiva: boolean; pontosPorReal: unknown; valorDoPonto: unknown }) {
  return {
    ativa: configuracao.fidelidadeAtiva,
    pontosPorReal: Number(configuracao.pontosPorReal),
    valorDoPonto: Number(configuracao.valorDoPonto),
  };
}

router.get(
  '/fidelidade/configuracao',
  equipeDeAtendimento,
  asyncHandler(async (_req, res) => {
    res.json(paraFidelidadeDTO(await lerConfiguracao()));
  })
);

const fidelidadeSchema = z.object({
  ativa: z.boolean(),
  pontosPorReal: z
    .number()
    .min(0.01, 'Informe quantos pontos o cliente ganha por real')
    .max(100, 'Informe quantos pontos o cliente ganha por real'),
  valorDoPonto: z
    .number()
    .min(0.0001, 'Informe quanto vale cada ponto')
    .max(100, 'Informe quanto vale cada ponto'),
});

router.put(
  '/fidelidade/configuracao',
  soGestor,
  asyncHandler(async (req, res) => {
    const dados = validar(fidelidadeSchema, req.body);
    const campos = {
      fidelidadeAtiva: dados.ativa,
      pontosPorReal: dados.pontosPorReal.toFixed(2),
      valorDoPonto: dados.valorDoPonto.toFixed(4),
    };
    const configuracao = await prisma.configuracaoPlataforma.upsert({
      where: { id: 1 },
      create: { id: 1, ...campos },
      update: campos,
    });
    limparCacheConfiguracao();
    res.json(paraFidelidadeDTO(configuracao));
  })
);

export default router;
