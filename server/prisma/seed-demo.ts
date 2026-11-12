// Dados de exemplo (só para conhecer o sistema). Entram com SEED_DEMO=true em banco novo.
// Cria uma conta de cada perfil, os itens do cardápio e as mesas. Sem pedidos nem vendas:
// o painel começa zerado e o restaurante cadastra o resto (planta, áreas, maquinetas).

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

  // Mesas livres, cada uma já com o seu QR code. Sem área e fora da planta.
  for (let numero = 1; numero <= TOTAL_DE_MESAS; numero += 1) {
    await prisma.mesa.create({
      data: {
        numero,
        lugares: numero % 3 === 0 ? 6 : 4,
        codigo: crypto.randomBytes(9).toString('base64url'),
      },
    });
  }

  console.log('==== DADOS DE EXEMPLO CARREGADOS ====');
  for (const conta of CONTAS) {
    console.log(`${conta.perfil}: ${conta.email} (senha ${conta.senha})`);
  }
  console.log(`${produtos} produtos no cardápio e ${TOTAL_DE_MESAS} mesas.`);
  console.log('=====================================');
}
