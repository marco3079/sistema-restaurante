// Dados de demonstração (fictícios, só para teste). Entram com SEED_DEMO=true em banco novo.
// Cria um garçom, o cardápio, as mesas e alguns meses de pedidos para o painel ter números.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const SENHA_DEMO = 'garcom1234';

// Cardápio da demonstração: categorias e produtos com foto (client/public/cardapio/<foto>.jpg) e ficha.
// Os valores nutricionais são estimativas, só para a demonstração.
interface ProdutoDemo {
  nome: string;
  preco: number;
  foto: string;
  recomendado?: boolean;
  descricao: string;
  detalhes: string;
  ingredientes: string;
  porcao: string;
  tempoPreparoMin: number;
  alergenicos: string;
  nutricao: {
    kcal: number;
    carboidratosG: number;
    proteinasG: number;
    gordurasG: number;
    gordurasSaturadasG: number;
    fibrasG: number;
    sodioMg: number;
  };
}

const CARDAPIO = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'demo-cardapio.json'), 'utf8')
) as { categoria: string; produtos: ProdutoDemo[] }[];

const FORMAS = ['Dinheiro', 'Pix', 'Cartão de débito', 'Cartão de crédito'];

// Gerador simples e repetível, para a demonstração sair sempre igual.
function criarSorteio(semente: number): () => number {
  let estado = semente;
  return () => {
    estado = (estado * 1664525 + 1013904223) % 4294967296;
    return estado / 4294967296;
  };
}

export async function carregarDemonstracao(prisma: PrismaClient): Promise<void> {
  const sorteio = criarSorteio(2026);
  const inteiro = (min: number, max: number): number => min + Math.floor(sorteio() * (max - min + 1));

  const garcons = await Promise.all(
    [
      ['Ana Souza', 'ana@restaurante.demo'],
      ['Bruno Lima', 'bruno@restaurante.demo'],
    ].map(([nome, email]) =>
      prisma.usuario.create({
        data: { nome, email, perfil: 'GARCOM', senhaHash: bcrypt.hashSync(SENHA_DEMO, 10) },
      })
    )
  );

  const produtos: { id: number; nome: string; preco: number }[] = [];
  for (const [ordem, grupo] of CARDAPIO.entries()) {
    const categoria = await prisma.categoria.create({ data: { nome: grupo.categoria, ordem } });
    for (const item of grupo.produtos) {
      const produto = await prisma.produto.create({
        data: {
          categoriaId: categoria.id,
          nome: item.nome,
          descricao: item.descricao,
          preco: item.preco.toFixed(2),
          imagem: `/cardapio/${item.foto}.jpg`,
          detalhes: item.detalhes,
          ingredientes: item.ingredientes,
          porcao: item.porcao,
          tempoPreparoMin: item.tempoPreparoMin,
          alergenicos: item.alergenicos,
          recomendado: item.recomendado === true,
          ...item.nutricao,
        },
      });
      produtos.push({ id: produto.id, nome: item.nome, preco: item.preco });
    }
  }

  const mesas = [];
  for (let numero = 1; numero <= 10; numero += 1) {
    mesas.push(
      await prisma.mesa.create({
        data: {
          numero,
          nome: numero >= 9 ? 'Varanda' : null,
          lugares: numero % 3 === 0 ? 6 : 4,
          codigo: crypto.randomBytes(9).toString('base64url'),
        },
      })
    );
  }

  function itensSorteados() {
    const quantos = inteiro(1, 4);
    const escolhidos = new Map<number, number>();
    for (let i = 0; i < quantos; i += 1) {
      const produto = produtos[inteiro(0, produtos.length - 1)];
      escolhidos.set(produto.id, (escolhidos.get(produto.id) ?? 0) + inteiro(1, 2));
    }
    const linhas = [...escolhidos.entries()].map(([produtoId, quantidade]) => {
      const produto = produtos.find((p) => p.id === produtoId)!;
      return {
        produtoId,
        nomeProduto: produto.nome,
        precoUnitario: produto.preco.toFixed(2),
        quantidade,
      };
    });
    const total = linhas.reduce((soma, l) => soma + Number(l.precoUnitario) * l.quantidade, 0);
    return { linhas, total: total.toFixed(2) };
  }

  // Histórico pago: dos últimos 8 meses até ontem.
  const agora = new Date();
  const hoje = new Date(agora);
  hoje.setHours(0, 0, 0, 0);
  for (let dias = 240; dias >= 1; dias -= 1) {
    const dia = new Date(hoje.getTime() - dias * 24 * 60 * 60 * 1000);
    // O movimento cresce um pouco com o tempo e é maior de sexta a domingo.
    const fimDeSemana = [0, 5, 6].includes(dia.getDay());
    const pedidosNoDia = inteiro(1, 3) + (fimDeSemana ? 2 : 0) + (dias < 90 ? 1 : 0);
    for (let n = 0; n < pedidosNoDia; n += 1) {
      const quando = new Date(dia.getTime() + inteiro(11 * 60, 22 * 60) * 60 * 1000);
      const { linhas, total } = itensSorteados();
      await prisma.pedido.create({
        data: {
          mesaId: mesas[inteiro(0, mesas.length - 1)].id,
          status: 'ENTREGUE',
          origem: sorteio() < 0.6 ? 'CLIENTE' : 'GARCOM',
          garcomId: garcons[inteiro(0, garcons.length - 1)].id,
          total,
          criadoEm: quando,
          pagoEm: new Date(quando.getTime() + 50 * 60 * 1000),
          formaPagamento: FORMAS[inteiro(0, FORMAS.length - 1)],
          itens: { create: linhas },
        },
      });
    }
  }

  // Movimento de agora: três mesas com conta aberta, em situações diferentes.
  const abertos: { mesa: number; status: 'NOVO' | 'EM_PREPARO' | 'PRONTO' | 'ENTREGUE'; minutos: number }[] = [
    { mesa: 0, status: 'ENTREGUE', minutos: 40 },
    { mesa: 0, status: 'EM_PREPARO', minutos: 12 },
    { mesa: 3, status: 'PRONTO', minutos: 18 },
    { mesa: 6, status: 'NOVO', minutos: 2 },
  ];
  for (const aberto of abertos) {
    const { linhas, total } = itensSorteados();
    await prisma.pedido.create({
      data: {
        mesaId: mesas[aberto.mesa].id,
        status: aberto.status,
        origem: aberto.status === 'NOVO' ? 'CLIENTE' : 'GARCOM',
        garcomId: aberto.status === 'NOVO' ? null : garcons[0].id,
        nomeCliente: aberto.status === 'NOVO' ? 'Carla' : null,
        total,
        criadoEm: new Date(agora.getTime() - aberto.minutos * 60 * 1000),
        itens: { create: linhas },
      },
    });
  }

  console.log('==== DADOS DE DEMONSTRAÇÃO CARREGADOS ====');
  console.log(`Garçons: ${garcons.map((g) => g.email).join(', ')} (senha ${SENHA_DEMO})`);
  console.log(`${produtos.length} produtos, ${mesas.length} mesas e pedidos dos últimos meses.`);
  console.log('==========================================');
}
