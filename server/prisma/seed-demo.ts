// Dados de exemplo (só para conhecer o sistema). Entram com SEED_DEMO=true em banco novo.
// Cria uma conta de cada perfil, os itens do cardápio e o salão (planta, duas áreas e as mesas
// posicionadas). Sem pedidos nem vendas: o painel começa zerado. As maquinetas o gestor cadastra.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Perfil, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Uma conta de exemplo por perfil. O gestor é criado pelo seed padrão (seed.ts).
const CONTAS: { nome: string; email: string; perfil: Perfil; senha: string }[] = [
  { nome: 'Ana Souza', email: 'garcom@restaurante.demo', perfil: 'GARCOM', senha: 'garcom1234' },
  { nome: 'Carlos Mendes', email: 'cozinha@restaurante.demo', perfil: 'COZINHA', senha: 'cozinha1234' },
  { nome: 'Dona Lúcia', email: 'limpeza@restaurante.demo', perfil: 'LIMPEZA', senha: 'limpeza1234' },
  { nome: 'Rafael Costa', email: 'recepcao@restaurante.demo', perfil: 'RECEPCAO', senha: 'recepcao1234' },
];

// Cardápio de exemplo: categorias e produtos com foto (client/public/cardapio/<foto>.jpg) e ficha.
// Os valores nutricionais são estimativas, só para o exemplo.
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

const TOTAL_DE_MESAS = 10;

export async function carregarDemonstracao(prisma: PrismaClient): Promise<void> {
  for (const conta of CONTAS) {
    await prisma.usuario.create({
      data: {
        nome: conta.nome,
        email: conta.email,
        perfil: conta.perfil,
        senhaHash: bcrypt.hashSync(conta.senha, 10),
      },
    });
  }

  let produtos = 0;
  for (const [ordem, grupo] of CARDAPIO.entries()) {
    const categoria = await prisma.categoria.create({ data: { nome: grupo.categoria, ordem } });
    for (const item of grupo.produtos) {
      await prisma.produto.create({
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
      produtos += 1;
    }
  }

  // Salão de exemplo: planta, duas áreas com o garçom de exemplo e as mesas já posicionadas.
  // As posições batem com o desenho de demo-planta.jpg (frações de 0 a 1).
  const arquivoPlanta = path.join(__dirname, 'demo-planta.jpg');
  if (fs.existsSync(arquivoPlanta)) {
    await prisma.planta.create({
      data: {
        id: 1,
        imagem: `data:image/jpeg;base64,${fs.readFileSync(arquivoPlanta).toString('base64')}`,
        largura: 1400,
        altura: 875,
      },
    });
  }
  const garcom = await prisma.usuario.findFirstOrThrow({ where: { perfil: 'GARCOM' }, select: { id: true } });
  const salaoPrincipal = await prisma.area.create({
    data: {
      nome: 'Salão principal',
      cor: '#2563eb',
      x: 0.04,
      y: 0.2,
      largura: 0.6,
      altura: 0.72,
      garcons: { connect: [{ id: garcom.id }] },
    },
  });
  const varanda = await prisma.area.create({
    data: {
      nome: 'Varanda',
      cor: '#10b981',
      x: 0.69,
      y: 0.2,
      largura: 0.27,
      altura: 0.72,
      garcons: { connect: [{ id: garcom.id }] },
    },
  });
  const POSICOES: Record<number, [number, number]> = {
    1: [0.13, 0.36],
    2: [0.27, 0.36],
    3: [0.41, 0.36],
    4: [0.55, 0.36],
    5: [0.13, 0.72],
    6: [0.27, 0.72],
    7: [0.41, 0.72],
    8: [0.55, 0.72],
    9: [0.82, 0.36],
    10: [0.82, 0.72],
  };

  // Mesas livres, cada uma já com o seu QR code.
  for (let numero = 1; numero <= TOTAL_DE_MESAS; numero += 1) {
    await prisma.mesa.create({
      data: {
        numero,
        nome: numero >= 9 ? 'Varanda' : null,
        lugares: numero % 3 === 0 ? 6 : 4,
        codigo: crypto.randomBytes(9).toString('base64url'),
        areaId: numero >= 9 ? varanda.id : salaoPrincipal.id,
        posX: POSICOES[numero][0],
        posY: POSICOES[numero][1],
      },
    });
  }

  console.log('==== DADOS DE EXEMPLO CARREGADOS ====');
  for (const conta of CONTAS) {
    console.log(`${conta.perfil}: ${conta.email} (senha ${conta.senha})`);
  }
  console.log(`${produtos} produtos no cardápio, ${TOTAL_DE_MESAS} mesas e o salão de exemplo (planta e 2 áreas).`);
  console.log('=====================================');
}
