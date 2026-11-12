import { Painel } from '../../layout/Painel';
import type { RotaModulo } from '../../lib/rotas';

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor',
    rotulo: 'Início',
    icone: 'inicio',
    perfis: ['GESTOR'],
    elemento: <Painel />,
    ordem: 0,
  },
  {
    caminho: '/garcom',
    rotulo: 'Início',
    icone: 'inicio',
    perfis: ['GARCOM'],
    elemento: <Painel />,
    ordem: 0,
  },
];
