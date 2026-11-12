import type { RotaModulo } from '../../lib/rotas';
import { Configuracoes } from './Configuracoes';
import './configuracoes.css';

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/configuracoes',
    rotulo: 'Configurações',
    icone: 'engrenagem',
    perfis: ['GESTOR'],
    elemento: <Configuracoes />,
    ordem: 97,
  },
];
