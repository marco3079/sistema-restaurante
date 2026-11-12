import type { RotaModulo } from '../../lib/rotas';
import { Usuarios } from './usuarios';
import { MeuPerfil } from './perfil';

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/usuarios',
    rotulo: 'Equipe',
    icone: 'usuarios',
    perfis: ['GESTOR'],
    elemento: <Usuarios />,
    ordem: 40,
  },
  {
    caminho: '/gestor/perfil',
    rotulo: 'Meu perfil',
    icone: 'perfil',
    perfis: ['GESTOR'],
    elemento: <MeuPerfil />,
    ordem: 90,
  },
  {
    caminho: '/garcom/perfil',
    rotulo: 'Meu perfil',
    icone: 'perfil',
    perfis: ['GARCOM'],
    elemento: <MeuPerfil />,
    ordem: 90,
  },
  {
    caminho: '/cozinha/perfil',
    rotulo: 'Meu perfil',
    icone: 'perfil',
    perfis: ['COZINHA'],
    elemento: <MeuPerfil />,
    ordem: 90,
  },
  {
    caminho: '/limpeza/perfil',
    rotulo: 'Meu perfil',
    icone: 'perfil',
    perfis: ['LIMPEZA'],
    elemento: <MeuPerfil />,
    ordem: 90,
  },
  {
    caminho: '/recepcao/perfil',
    rotulo: 'Meu perfil',
    icone: 'perfil',
    perfis: ['RECEPCAO'],
    elemento: <MeuPerfil />,
    ordem: 90,
  },
];
