import type { RotaModulo } from '../../lib/rotas';
import { Atividades } from './Atividades';
import { LogSistema } from './LogSistema';
import './logs.css';

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/atividades',
    rotulo: 'Atividades',
    icone: 'atividade',
    perfis: ['GESTOR'],
    elemento: <Atividades />,
    ordem: 95,
  },
  {
    caminho: '/gestor/logs',
    rotulo: 'Log do sistema',
    icone: 'log',
    perfis: ['GESTOR'],
    elemento: <LogSistema />,
    ordem: 96,
  },
];
