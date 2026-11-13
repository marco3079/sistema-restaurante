import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError } from '../../lib/erros';
import { permitir } from '../../lib/auth';

// Avaliações que os clientes fazem pelo cardápio da mesa depois de pagar.
// Só o gestor vê: resumo, notas por garçom, distribuição das notas e a lista das mais recentes.

const router = Router();

interface DiaCivil {
  ano: number;
  mes: number;
  dia: number;
}

// Dia no formato AAAA-MM-DD. Outro texto ou uma data que não existe = null.
function diaCivil(texto: unknown): DiaCivil | null {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  const [ano, mes, dia] = texto.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia);
  if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) return null;
  return { ano, mes, dia };
}

// Período de `de` a `ate` (os dois incluídos). Sem eles: do dia 1 do mês atual até hoje.
// Máximo de 366 dias.
function periodoDaConsulta(query: { de?: unknown; ate?: unknown }): { inicio: Date; fim: Date } {
  const agora = new Date();
  const hoje: DiaCivil = { ano: agora.getFullYear(), mes: agora.getMonth() + 1, dia: agora.getDate() };
  const de = query.de === undefined || query.de === '' ? { ...hoje, dia: 1 } : diaCivil(query.de);
  const ate = query.ate === undefined || query.ate === '' ? hoje : diaCivil(query.ate);
  if (!de || !ate) {
    throw new HttpError(400, 'Data inválida. Use o formato AAAA-MM-DD.');
  }
  const dias =
    Math.round((Date.UTC(ate.ano, ate.mes - 1, ate.dia) - Date.UTC(de.ano, de.mes - 1, de.dia)) / 86400000) + 1;
  if (dias < 1) {
    throw new HttpError(400, 'A data final é anterior à data inicial.');
  }
  if (dias > 366) {
    throw new HttpError(400, 'O período máximo é de 366 dias.');
  }
  return {
    inicio: new Date(de.ano, de.mes - 1, de.dia, 0, 0, 0, 0),
    fim: new Date(ate.ano, ate.mes - 1, ate.dia, 23, 59, 59, 999),
  };
}

// Média com uma casa decimal. Sem avaliações = null.
function media(soma: number, total: number): number | null {
  return total === 0 ? null : Math.round((soma / total) * 10) / 10;
}

router.get(
  '/avaliacoes',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const { inicio, fim } = periodoDaConsulta(req.query);
    const onde = { criadoEm: { gte: inicio, lte: fim } };

    const [estatisticas, lista] = await Promise.all([
      prisma.avaliacao.findMany({
        where: onde,
        select: { notaComida: true, notaAtendimento: true, garcomId: true },
      }),
      prisma.avaliacao.findMany({
        where: onde,
        orderBy: { criadoEm: 'desc' },
        take: 300,
      }),
    ]);

    // Garçons e mesas citados (Avaliacao guarda só os números: não há relação no banco).
    const garcomIds = [
      ...new Set(estatisticas.map((a) => a.garcomId).filter((id): id is number => id !== null)),
    ];
    const mesaIds = [...new Set(lista.map((a) => a.mesaId))];
    const [usuarios, mesas] = await Promise.all([
      prisma.usuario.findMany({ where: { id: { in: garcomIds } }, select: { id: true, nome: true } }),
      prisma.mesa.findMany({ where: { id: { in: mesaIds } }, select: { id: true, numero: true, nome: true } }),
    ]);
    const garcomPorId = new Map(usuarios.map((u) => [u.id, u]));
    const mesaPorId = new Map(mesas.map((m) => [m.id, m]));

    const total = estatisticas.length;
    const somaComida = estatisticas.reduce((soma, a) => soma + a.notaComida, 0);
    const somaAtendimento = estatisticas.reduce((soma, a) => soma + a.notaAtendimento, 0);

    // Distribuição: as cinco notas, sempre.
    const distribuicao = [1, 2, 3, 4, 5].map((nota) => ({
      nota,
      comida: estatisticas.filter((a) => a.notaComida === nota).length,
      atendimento: estatisticas.filter((a) => a.notaAtendimento === nota).length,
    }));

    // Atendimento por garçom: só quem recebeu alguma avaliação no período.
    const acumulado = new Map<number, { total: number; soma: number }>();
    for (const a of estatisticas) {
      if (a.garcomId === null) continue;
      const atual = acumulado.get(a.garcomId) ?? { total: 0, soma: 0 };
      atual.total += 1;
      atual.soma += a.notaAtendimento;
      acumulado.set(a.garcomId, atual);
    }
    const porGarcom = [...acumulado.entries()]
      .map(([id, valor]) => ({
        garcom: { id, nome: garcomPorId.get(id)?.nome ?? 'Garçom removido' },
        total: valor.total,
        mediaAtendimento: media(valor.soma, valor.total) ?? 0,
      }))
      .sort((a, b) => b.total - a.total || a.garcom.nome.localeCompare(b.garcom.nome, 'pt-BR'));

    res.json({
      resumo: {
        total,
        mediaComida: media(somaComida, total),
        mediaAtendimento: media(somaAtendimento, total),
      },
      porGarcom,
      distribuicao,
      lista: lista.map((a) => {
        const garcom = a.garcomId === null ? undefined : garcomPorId.get(a.garcomId);
        const mesa = mesaPorId.get(a.mesaId);
        return {
          id: a.id,
          criadoEm: a.criadoEm.toISOString(),
          mesa: mesa ? { numero: mesa.numero, nome: mesa.nome } : { numero: 0, nome: null },
          garcom: garcom ? { id: garcom.id, nome: garcom.nome } : null,
          notaComida: a.notaComida,
          notaAtendimento: a.notaAtendimento,
          comentario: a.comentario,
        };
      }),
    });
  })
);

export default router;
