import type { PedidoDTO } from './restaurante';

// Situação de um pedido de delivery ou de retirada, como a API da equipe devolve.
export type SituacaoEntrega = 'RECEBIDO' | 'EM_PREPARO' | 'PRONTO' | 'SAIU' | 'CONCLUIDO' | 'CANCELADO';

// Pedido de delivery ou retirada para a equipe: o PedidoDTO mais a situação e os valores da conta.
export interface EntregaPedidoDTO extends PedidoDTO {
  situacao: SituacaoEntrega;
  conta: {
    subtotal: number;
    taxaEntrega: number;
    desconto: number;
    total: number;
    pago: number;
    restante: number;
  };
}

// Bairro de entrega com a taxa. Na configuração da equipe vem também o campo `ativo`.
export interface BairroDTO {
  id: number;
  nome: string;
  taxa: number;
  ativo: boolean;
}

// Configuração do delivery e da retirada (GET /delivery/configuracao).
export interface ConfiguracaoDeliveryDTO {
  deliveryAtivo: boolean;
  retiradaAtiva: boolean;
  pedidoMinimo: number;
  deliveryTempoMin: number;
  retiradaTempoMin: number;
  aviso: string | null;
  bairros: BairroDTO[];
}

export const SITUACAO_ENTREGA: Record<
  SituacaoEntrega,
  { rotulo: string; cor: 'azul' | 'amarelo' | 'verde' | 'cinza' | 'vermelho' }
> = {
  RECEBIDO: { rotulo: 'Recebido', cor: 'azul' },
  EM_PREPARO: { rotulo: 'Em preparo', cor: 'amarelo' },
  PRONTO: { rotulo: 'Pronto', cor: 'verde' },
  SAIU: { rotulo: 'A caminho', cor: 'azul' },
  CONCLUIDO: { rotulo: 'Concluído', cor: 'cinza' },
  CANCELADO: { rotulo: 'Cancelado', cor: 'vermelho' },
};
