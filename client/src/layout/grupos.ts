import type { RotaModulo } from '../lib/rotas';
import type { NomeIcone } from '../ui/icones';

export interface GrupoMenu {
  titulo: string;
  icones: NomeIcone[];
}

// Seções da barra lateral e da gaveta. A rota entra no grupo pelo `grupo` dela (título);
// sem `grupo`, entra pelo ícone.
export const GRUPOS: GrupoMenu[] = [
  { titulo: '', icones: ['inicio'] },
  { titulo: 'Atendimento', icones: ['pedidos', 'mesas', 'grade', 'calendario'] },
  { titulo: 'Cardápio', icones: ['cardapio'] },
  { titulo: 'Estoque e compras', icones: ['lista'] },
  { titulo: 'Equipe', icones: ['usuarios', 'grafico'] },
  { titulo: 'Financeiro', icones: ['financeiro', 'documento'] },
  { titulo: 'Sistema', icones: ['atividade', 'log', 'engrenagem'] },
  { titulo: 'Conta', icones: ['perfil'] },
];

const TITULO_OUTROS = 'Outros';

// Quando a rota tem `grupo`, ela entra SÓ no grupo de mesmo título (nunca pelo ícone).
// Sem `grupo`, vale o ícone.
function pertenceAoGrupo(rota: RotaModulo, grupo: GrupoMenu): boolean {
  if (rota.grupo !== undefined) return grupo.titulo === rota.grupo;
  return grupo.icones.includes(rota.icone);
}

// Distribui as rotas do menu pelos grupos (pelo `grupo` ou pelo ícone). Mantém a ordem de `ordem` dentro de cada grupo,
// descarta grupos vazios e põe num grupo final "Outros" as rotas que não caem em nenhum grupo.
export function agrupar(rotas: RotaModulo[]): { titulo: string; rotas: RotaModulo[] }[] {
  const ordenadas = [...rotas].sort((a, b) => (a.ordem ?? 100) - (b.ordem ?? 100));
  const usadas = new Set<RotaModulo>();
  const resultado: { titulo: string; rotas: RotaModulo[] }[] = [];

  for (const grupo of GRUPOS) {
    const doGrupo = ordenadas.filter((r) => !usadas.has(r) && pertenceAoGrupo(r, grupo));
    doGrupo.forEach((r) => usadas.add(r));
    if (doGrupo.length > 0) resultado.push({ titulo: grupo.titulo, rotas: doGrupo });
  }

  const outros = ordenadas.filter((r) => !usadas.has(r));
  if (outros.length > 0) resultado.push({ titulo: TITULO_OUTROS, rotas: outros });

  return resultado;
}
