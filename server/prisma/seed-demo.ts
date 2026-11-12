// Dados de demonstração (fictícios, só para teste). Entram com SEED_DEMO=true em banco novo.
// Cria um garçom, o cardápio, as mesas e alguns meses de pedidos para o painel ter números.

import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const SENHA_DEMO = 'garcom1234';

const CARDAPIO: { categoria: string; produtos: [string, string, number][] }[] = [
  {
    categoria: 'Entradas',
    produtos: [
      ['Bruschetta de tomate', 'Pão italiano tostado, tomate, manjericão e azeite.', 24.9],
      ['Bolinho de bacalhau', 'Seis unidades, com molho de pimenta da casa.', 36],
      ['Batata frita', 'Porção para dividir, com maionese de alho.', 28],
      ['Salada caesar', 'Alface romana, frango grelhado, croutons e parmesão.', 32],
    ],
  },
  {
    categoria: 'Pratos principais',
    produtos: [
      ['Filé à parmegiana', 'Filé empanado, molho de tomate e queijo, com arroz e fritas.', 68],
      ['Risoto de cogumelos', 'Arroz arbóreo, mix de cogumelos e parmesão.', 58],
      ['Salmão grelhado', 'Com legumes na manteiga e purê de batata.', 79.9],
      ['Picanha na chapa', 'Para duas pessoas, com arroz, farofa e vinagrete.', 139],
      ['Espaguete à bolonhesa', 'Massa fresca com molho de carne.', 46],
      ['Moqueca de peixe', 'Peixe branco, leite de coco e dendê, com arroz e pirão.', 84],
    ],
  },
  {
    categoria: 'Lanches',
    produtos: [
      ['Hambúrguer da casa', 'Pão brioche, 160 g de carne, queijo, alface e tomate.', 38],
      ['Sanduíche de frango', 'Frango grelhado, queijo e maionese verde.', 32],
      ['Pizza marguerita', 'Individual, com molho de tomate, muçarela e manjericão.', 44],
    ],
  },
  {
    categoria: 'Sobremesas',
    produtos: [
      ['Pudim de leite', 'Fatia generosa com calda de caramelo.', 16],
      ['Petit gâteau', 'Bolo quente de chocolate com sorvete de creme.', 26],
      ['Mousse de maracujá', 'Leve, com calda da fruta.', 15],
    ],
  },
  {
    categoria: 'Bebidas',
    produtos: [
      ['Água mineral', 'Com ou sem gás, 500 ml.', 6],
      ['Refrigerante lata', '350 ml.', 7.5],
      ['Suco natural', 'Laranja, limão, abacaxi ou maracujá. 400 ml.', 12],
      ['Cerveja long neck', '330 ml.', 13],
      ['Caipirinha', 'Limão, cachaça e açúcar.', 22],
      ['Café expresso', 'Curto ou longo.', 6.5],
    ],
  },
];

// Foto de cada item da demonstração: arquivo em client/public/cardapio/<nome>.jpg, servido pelo site.
const FOTOS: Record<string, string> = {
  'Bruschetta de tomate': 'bruschetta',
  'Bolinho de bacalhau': 'bolinho-bacalhau',
  'Batata frita': 'batata-frita',
  'Salada caesar': 'salada-caesar',
  'Filé à parmegiana': 'file-parmegiana',
  'Risoto de cogumelos': 'risoto-cogumelos',
  'Salmão grelhado': 'salmao-grelhado',
  'Picanha na chapa': 'picanha-chapa',
  'Espaguete à bolonhesa': 'espaguete-bolonhesa',
  'Moqueca de peixe': 'moqueca-peixe',
  'Hambúrguer da casa': 'hamburguer',
  'Sanduíche de frango': 'sanduiche-frango',
  'Pizza marguerita': 'pizza-marguerita',
  'Pudim de leite': 'pudim-leite',
  'Petit gâteau': 'petit-gateau',
  'Mousse de maracujá': 'mousse-maracuja',
  'Água mineral': 'agua-mineral',
  'Refrigerante lata': 'refrigerante-lata',
  'Suco natural': 'suco-natural',
  'Cerveja long neck': 'cerveja-long-neck',
  Caipirinha: 'caipirinha',
  'Café expresso': 'cafe-expresso',
};

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
    for (const [nome, descricao, preco] of grupo.produtos) {
      const produto = await prisma.produto.create({
        data: {
          categoriaId: categoria.id,
          nome,
          descricao,
          preco: preco.toFixed(2),
          imagem: FOTOS[nome] ? `/cardapio/${FOTOS[nome]}.jpg` : null,
        },
      });
      produtos.push({ id: produto.id, nome, preco });
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
