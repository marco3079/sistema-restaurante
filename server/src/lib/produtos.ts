import { z } from 'zod';
import type { Produto } from '@prisma/client';

// Ficha do prato: texto longo, ingredientes, porção, tempo de preparo, alergênicos e tabela nutricional.
// Usada no cadastro do gestor e no perfil do prato que o cliente abre no cardápio da mesa.

const NUTRIENTES = [
  'kcal',
  'carboidratosG',
  'proteinasG',
  'gordurasG',
  'gordurasSaturadasG',
  'fibrasG',
  'sodioMg',
] as const;

type Nutriente = (typeof NUTRIENTES)[number];

const valorNutricional = z.number().min(0, 'Valor inválido').max(100000, 'Valor inválido').nullable().optional();

export const fichaCampos = {
  detalhes: z.string().trim().max(1500, 'Texto muito longo').optional(),
  ingredientes: z.string().trim().max(1000, 'Lista de ingredientes muito longa').optional(),
  porcao: z.string().trim().max(80, 'Porção muito longa').nullable().optional(),
  tempoPreparoMin: z.number().int().min(0, 'Tempo inválido').max(600, 'Tempo inválido').nullable().optional(),
  alergenicos: z.string().trim().max(200, 'Texto muito longo').nullable().optional(),
  // null apaga a tabela inteira; um objeto altera só os valores enviados.
  nutricao: z
    .object({
      kcal: valorNutricional,
      carboidratosG: valorNutricional,
      proteinasG: valorNutricional,
      gordurasG: valorNutricional,
      gordurasSaturadasG: valorNutricional,
      fibrasG: valorNutricional,
      sodioMg: valorNutricional,
    })
    .nullable()
    .optional(),
};

type FichaEntrada = z.infer<z.ZodObject<typeof fichaCampos>>;

function textoOuNulo(valor: string | null | undefined): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  return valor === '' ? null : valor;
}

// Campos da ficha prontos para gravar. O que não veio (undefined) fica como está.
export function dadosDaFicha(dados: FichaEntrada): {
  detalhes?: string;
  ingredientes?: string;
  porcao?: string | null;
  tempoPreparoMin?: number | null;
  alergenicos?: string | null;
} & Partial<Record<Nutriente, number | null>> {
  const nutricao: Partial<Record<Nutriente, number | null | undefined>> = {};
  for (const chave of NUTRIENTES) {
    nutricao[chave] = dados.nutricao === null ? null : dados.nutricao?.[chave];
  }
  return {
    detalhes: dados.detalhes,
    ingredientes: dados.ingredientes,
    porcao: textoOuNulo(dados.porcao),
    tempoPreparoMin: dados.tempoPreparoMin,
    alergenicos: textoOuNulo(dados.alergenicos),
    ...nutricao,
  };
}

// Traduções do produto: só inglês (en) e espanhol (es), só os campos abaixo.
export type TraducaoProduto = {
  nome?: string;
  descricao?: string;
  detalhes?: string;
  ingredientes?: string;
  porcao?: string;
  alergenicos?: string;
};

export type TraducoesDoProduto = { en?: TraducaoProduto; es?: TraducaoProduto };

const CAMPOS_TRADUCAO = ['nome', 'descricao', 'detalhes', 'ingredientes', 'porcao', 'alergenicos'] as const;
const IDIOMAS_TRADUCAO = ['en', 'es'] as const;

const traducaoProdutoSchema = z.object({
  nome: z.string().trim().max(80, 'Nome muito longo').nullable().optional(),
  descricao: z.string().trim().max(400, 'Descrição muito longa').nullable().optional(),
  detalhes: z.string().trim().max(1500, 'Texto muito longo').nullable().optional(),
  ingredientes: z.string().trim().max(1000, 'Lista de ingredientes muito longa').nullable().optional(),
  porcao: z.string().trim().max(80, 'Porção muito longa').nullable().optional(),
  alergenicos: z.string().trim().max(200, 'Texto muito longo').nullable().optional(),
});

// Entrada da API para traduções. Chaves desconhecidas são descartadas pelo zod.
export const traducoesProdutoSchema = z
  .object({
    en: traducaoProdutoSchema.nullable().optional(),
    es: traducaoProdutoSchema.nullable().optional(),
  })
  .nullable()
  .optional();

function limparTraducao(valor: unknown): TraducaoProduto | null {
  if (typeof valor !== 'object' || valor === null) return null;
  const origem = valor as Record<string, unknown>;
  const limpa: TraducaoProduto = {};
  for (const campo of CAMPOS_TRADUCAO) {
    const texto = origem[campo];
    if (typeof texto === 'string' && texto.trim() !== '') {
      limpa[campo] = texto.trim();
    }
  }
  return Object.keys(limpa).length > 0 ? limpa : null;
}

// Só en e es, só as chaves conhecidas, sem espaços nas pontas e sem textos vazios.
// Nada sobrando = null.
export function limparTraducoes(valor: unknown): TraducoesDoProduto | null {
  if (typeof valor !== 'object' || valor === null) return null;
  const origem = valor as Record<string, unknown>;
  const saida: TraducoesDoProduto = {};
  for (const idioma of IDIOMAS_TRADUCAO) {
    const traducao = limparTraducao(origem[idioma]);
    if (traducao !== null) {
      saida[idioma] = traducao;
    }
  }
  return Object.keys(saida).length > 0 ? saida : null;
}

// Ficha no formato da API. `nutricao` é null quando nenhum valor foi informado.
export function fichaDoProduto(p: Produto) {
  const temNutricao = NUTRIENTES.some((chave) => p[chave] !== null);
  return {
    detalhes: p.detalhes,
    ingredientes: p.ingredientes,
    porcao: p.porcao,
    tempoPreparoMin: p.tempoPreparoMin,
    alergenicos: p.alergenicos,
    nutricao: temNutricao
      ? {
          kcal: p.kcal,
          carboidratosG: p.carboidratosG,
          proteinasG: p.proteinasG,
          gordurasG: p.gordurasG,
          gordurasSaturadasG: p.gordurasSaturadasG,
          fibrasG: p.fibrasG,
          sodioMg: p.sodioMg,
        }
      : null,
  };
}
