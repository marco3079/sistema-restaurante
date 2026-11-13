// Formatos da API do restaurante e rótulos comuns às telas.

export type StatusPedido = 'NOVO' | 'EM_PREPARO' | 'PRONTO' | 'ENTREGUE' | 'CANCELADO';

export interface CategoriaDTO {
  id: number;
  nome: string;
  ordem: number;
  ativa: boolean;
  produtos: number;
  // Setor de preparo da categoria (cozinha, bar, sobremesas); null = sem setor.
  setorId: number | null;
  traducoes: Traducoes<{ nome?: string }> | null;
}

// Textos do produto em outro idioma (en, es). Campo vazio = usa o português.
export type TraducaoProduto = {
  nome?: string;
  descricao?: string;
  detalhes?: string;
  ingredientes?: string;
  porcao?: string;
  alergenicos?: string;
};

export type Traducoes<T> = { en?: T; es?: T };

// Opção de um grupo (ex.: "Bacon", "Mal passado") e o acréscimo no preço.
export interface OpcaoDTO {
  id: number;
  nome: string;
  precoExtra: number;
  ativa: boolean;
}

// Grupo de opções do prato: quantas o cliente precisa escolher (mínimo) e quantas pode (máximo).
export interface GrupoOpcaoDTO {
  id: number;
  nome: string;
  minimo: number;
  maximo: number;
  opcoes: OpcaoDTO[];
}

// Opção escolhida que vai no item do pedido.
export interface OpcaoEscolhidaDTO {
  grupo: string;
  opcao: string;
  precoExtra: number;
}

// Setor de preparo (cozinha, bar, sobremesas).
export interface SetorDTO {
  id: number;
  nome: string;
  cor: string;
  ativo: boolean;
  ordem: number;
  categorias: number;
  usuarios: { id: number; nome: string }[];
}

export interface Nutricao {
  kcal: number | null;
  carboidratosG: number | null;
  proteinasG: number | null;
  gordurasG: number | null;
  gordurasSaturadasG: number | null;
  fibrasG: number | null;
  sodioMg: number | null;
}

// Ficha do prato (perfil que o cliente abre no cardápio).
export interface FichaProduto {
  detalhes: string;
  ingredientes: string;
  porcao: string | null;
  tempoPreparoMin: number | null;
  alergenicos: string | null;
  nutricao: Nutricao | null;
}

// Linhas da tabela nutricional, na ordem em que aparecem. `sub` é detalhe da linha de cima.
export const NUTRIENTES: { chave: keyof Nutricao; rotulo: string; unidade: string; sub?: boolean }[] = [
  { chave: 'kcal', rotulo: 'Valor energético', unidade: 'kcal' },
  { chave: 'carboidratosG', rotulo: 'Carboidratos', unidade: 'g' },
  { chave: 'proteinasG', rotulo: 'Proteínas', unidade: 'g' },
  { chave: 'gordurasG', rotulo: 'Gorduras totais', unidade: 'g' },
  { chave: 'gordurasSaturadasG', rotulo: 'Gorduras saturadas', unidade: 'g', sub: true },
  { chave: 'fibrasG', rotulo: 'Fibras', unidade: 'g' },
  { chave: 'sodioMg', rotulo: 'Sódio', unidade: 'mg' },
];

// "Tomate, alho\nazeite" -> ['Tomate', 'Alho', 'Azeite']. Vírgula dentro de parênteses não separa.
export function listaDeIngredientes(texto: string): string[] {
  const itens: string[] = [];
  let atual = '';
  let nivel = 0;
  for (const letra of texto) {
    if (letra === '(') nivel += 1;
    if (letra === ')') nivel = Math.max(0, nivel - 1);
    if ((letra === ',' || letra === ';' || letra === '\n') && nivel === 0) {
      itens.push(atual);
      atual = '';
    } else {
      atual += letra;
    }
  }
  itens.push(atual);
  return [...new Set(itens.map((i) => i.trim()).filter(Boolean))].map(
    (i) => i.charAt(0).toUpperCase() + i.slice(1),
  );
}

export interface ProdutoDTO extends FichaProduto {
  id: number;
  categoriaId: number;
  categoria: { id: number; nome: string };
  nome: string;
  descricao: string;
  preco: number;
  imagem: string | null;
  disponivel: boolean;
  recomendado: boolean;
  // Estoque (só com o controle ligado) e dados fiscais do item.
  controlaEstoque: boolean;
  estoque: number;
  estoqueMinimo: number;
  ncm: string | null;
  cfop: string | null;
  // Preço de venda agora (com promoção) e o nome da promoção que vale.
  precoAtual: number;
  promocao: string | null;
  // Combo: os produtos que vêm nele.
  combo: boolean;
  comboItens: { produtoId: number; nome: string; quantidade: number }[];
  // Adicionais e opções do prato.
  grupos: GrupoOpcaoDTO[];
  traducoes: Traducoes<TraducaoProduto> | null;
}

export interface MesaDTO {
  id: number;
  numero: number;
  nome: string | null;
  lugares: number;
  codigo: string;
  ativa: boolean;
  chamandoDesde: string | null;
  situacao: 'LIVRE' | 'OCUPADA' | 'LIMPEZA';
  estadoDesde: string;
  totalAberto: number;
  pedidosAbertos: number;
  pedidosPendentes: number;
  abertaDesde: string | null;
  area: { id: number; nome: string; cor: string } | null;
  // Centro da mesa na planta, de 0 a 1. null = fora da planta.
  posX: number | null;
  posY: number | null;
  // Garçons que respondem pela mesa: os da área ou, sem área, o do pedido em aberto.
  responsaveis: { id: number; nome: string }[];
  origemResponsaveis: 'AREA' | 'PEDIDO' | null;
}

export interface AreaDTO {
  id: number;
  nome: string;
  cor: string;
  // Retângulo da área na planta, em frações de 0 a 1. null = sem desenho.
  x: number | null;
  y: number | null;
  largura: number | null;
  altura: number | null;
  garcons: { id: number; nome: string; ativo: boolean }[];
  mesas: number;
}

export interface PlantaDTO {
  imagem: string;
  largura: number;
  altura: number;
  atualizadaEm: string;
}

export interface ItemPedidoDTO {
  id?: number;
  produtoId?: number;
  nomeProduto: string;
  precoUnitario: number;
  quantidade: number;
  observacao: string | null;
  // Opções escolhidas, preço de tabela quando havia promoção e setor do item.
  opcoes?: OpcaoEscolhidaDTO[];
  precoOriginal?: number | null;
  setorId?: number | null;
}

export interface PedidoDTO {
  id: number;
  mesa: { id: number; numero: number; nome: string | null };
  status: StatusPedido;
  origem: 'CLIENTE' | 'GARCOM';
  nomeCliente: string | null;
  observacao: string | null;
  garcom: { id: number; nome: string } | null;
  total: number;
  pagoEm: string | null;
  formaPagamento: string | null;
  criadoEm: string;
  atualizadoEm: string;
  itens: ItemPedidoDTO[];
  // Partes do pedido por setor (cozinha, bar...) e a situação de cada uma.
  setores?: { setorId: number; nome: string; cor: string; status: StatusPedido }[];
}

// Conta aberta da mesa. Pode ser paga em partes: `restante` é o que ainda falta.
export interface ContaDTO {
  mesa: { id: number; numero: number; nome: string | null };
  conta: {
    id: number;
    taxaServico: boolean;
    taxaPercentual: number;
    cpfCnpjCliente: string | null;
    abertaEm: string;
    descontoMotivo: string | null;
    pontosUsados: number;
    cupom: { id: number; codigo: string; descricao: string | null } | null;
    cliente: { id: number; nome: string; telefone: string; pontos: number } | null;
  } | null;
  pedidos: PedidoDTO[];
  subtotal: number;
  // Descontos: total e de cada origem (cupom, pontos e manual).
  desconto: number;
  descontoCupom: number;
  descontoPontos: number;
  descontoManual: number;
  taxa: number;
  total: number;
  pago: number;
  restante: number;
  gorjetas: number;
  pagamentos: PagamentoDTO[];
  pagamentoPendente: PagamentoDTO | null;
}

export const STATUS_PEDIDO: Record<
  StatusPedido,
  { rotulo: string; cor: 'azul' | 'amarelo' | 'verde' | 'cinza' | 'vermelho' }
> = {
  NOVO: { rotulo: 'Novo', cor: 'azul' },
  EM_PREPARO: { rotulo: 'Em preparo', cor: 'amarelo' },
  PRONTO: { rotulo: 'Pronto', cor: 'verde' },
  ENTREGUE: { rotulo: 'Entregue', cor: 'cinza' },
  CANCELADO: { rotulo: 'Cancelado', cor: 'vermelho' },
};

export const FORMAS_PAGAMENTO = ['Dinheiro', 'Pix', 'Cartão de débito', 'Cartão de crédito'];

export function nomeDaMesa(mesa: { numero: number; nome: string | null }): string {
  return mesa.nome ? `Mesa ${mesa.numero} · ${mesa.nome}` : `Mesa ${mesa.numero}`;
}

export function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

// "há 5 min", "há 2 h". Para pedidos e chamados recentes.
export function tempoDesde(iso: string, agora: Date = new Date()): string {
  const minutos = Math.floor((agora.getTime() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(minutos)) return '';
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

export function horaCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Endereço do cardápio da mesa, a partir do endereço em que o sistema está aberto.
export function enderecoDaMesa(codigo: string): string {
  return `${window.location.origin}/mesa/${codigo}`;
}

// Texto de preço digitado ("12,50") para número. Devolve null se não for um valor válido.
export function lerPreco(texto: string): number | null {
  const limpo = texto.trim().replace(/\./g, '').replace(',', '.');
  if (limpo === '' || !/^\d+(\.\d{1,2})?$/.test(limpo)) return null;
  return Number(limpo);
}

// Número digitado ("12,5") para número. Vazio vira null; inválido vira undefined.
export function lerNumero(texto: string): number | null | undefined {
  const limpo = texto.trim().replace(',', '.');
  if (limpo === '') return null;
  if (!/^\d+(\.\d+)?$/.test(limpo)) return undefined;
  return Number(limpo);
}

export function precoParaCampo(valor: number): string {
  return valor.toFixed(2).replace('.', ',');
}

// ---------- Maquinetas, pagamentos e desempenho ----------

export type OperadoraMaquineta = 'SIMULADA' | 'MERCADO_PAGO' | 'STONE' | 'PAGBANK' | 'CIELO' | 'OUTRA';
export type IntegracaoMaquineta = 'MANUAL' | 'AUTOMATICA';
export type VinculoMaquineta = 'POR_GARCOM' | 'COMPARTILHADA';

export const OPERADORAS: { valor: OperadoraMaquineta; rotulo: string; automatica: boolean }[] = [
  { valor: 'MERCADO_PAGO', rotulo: 'Mercado Pago Point', automatica: true },
  { valor: 'STONE', rotulo: 'Stone', automatica: false },
  { valor: 'PAGBANK', rotulo: 'PagBank', automatica: false },
  { valor: 'CIELO', rotulo: 'Cielo', automatica: false },
  { valor: 'OUTRA', rotulo: 'Outra operadora', automatica: false },
  { valor: 'SIMULADA', rotulo: 'Simulada (para testar)', automatica: true },
];

export function rotuloOperadora(valor: string): string {
  return OPERADORAS.find((o) => o.valor === valor)?.rotulo ?? valor;
}

export interface MaquinetaDTO {
  id: number;
  nome: string;
  operadora: OperadoraMaquineta;
  integracao: IntegracaoMaquineta;
  identificador: string | null;
  garcomId: number | null;
  garcom: { id: number; nome: string } | null;
  ativa: boolean;
}

export interface MaquinetasDTO {
  vinculo: VinculoMaquineta;
  mercadoPagoTokenDefinido?: boolean;
  // Taxa de serviço das contas novas (0 = sem taxa).
  taxaServicoPercentual: number;
  // Com a chave Pix cadastrada, o Pix sem maquineta mostra o QR code.
  pixAtivo: boolean;
  // Há um serviço de nota fiscal conectado.
  notaFiscalAtiva: boolean;
  pixChave?: string | null;
  pixNome?: string | null;
  pixCidade?: string | null;
  maquinetas: MaquinetaDTO[];
}

export interface PagamentoDTO {
  id: number;
  contaId: number | null;
  mesa: { id: number; numero: number; nome: string | null };
  // Parte da conta que este pagamento quita.
  valor: number;
  // Gorjeta dada além da conta.
  gorjeta: number;
  // Quanto do valor é taxa de serviço.
  valorServico: number;
  // Pix copia e cola (só enquanto a cobrança por Pix está pendente).
  pix: string | null;
  formaPagamento: string;
  status: 'PENDENTE' | 'APROVADO' | 'RECUSADO' | 'CANCELADO';
  maquineta: { id: number; nome: string; operadora: OperadoraMaquineta; integracao: IntegracaoMaquineta } | null;
  garcom: { id: number; nome: string };
  codigoAutorizacao: string | null;
  mensagem: string | null;
  criadoEm: string;
  concluidoEm: string | null;
}

export interface DesempenhoDTO {
  dias: number;
  desde: string;
  totais: {
    contasRecebidas: number;
    valorRecebido: number;
    taxaServico: number;
    gorjetas: number;
    pedidosAtendidos: number;
    // Avaliações dos clientes no período e a média da nota do atendimento (null sem avaliações).
    avaliacoes: number;
    notaAtendimento: number | null;
  };
  garcons: {
    usuario: { id: number; nome: string; perfil: string; ativo: boolean; foto: string | null };
    pedidosAtendidos: number;
    vendasNosPedidos: number;
    contasRecebidas: number;
    valorRecebido: number;
    taxaServico: number;
    gorjetas: number;
    recebidoNaMaquineta: number;
    valorMedioPorConta: number;
    porForma: Record<string, number>;
    avaliacoes: number;
    notaAtendimento: number | null;
  }[];
}

export interface ChamadoDTO {
  mesaId: number;
  numero: number;
  nome: string | null;
  area: string | null;
  desde: string;
}

// Mesa como a limpeza e a recepção veem: sem pedidos nem valores.
export interface MesaSimplesDTO {
  id: number;
  numero: number;
  nome: string | null;
  lugares: number;
  area: { nome: string; cor: string } | null;
  situacao?: 'LIVRE' | 'OCUPADA' | 'LIMPEZA';
  desde: string;
}

// ---------- Recepção: fila de espera e reservas ----------

export interface EsperaDTO {
  id: number;
  nome: string;
  pessoas: number;
  telefone: string | null;
  observacao: string | null;
  status: 'AGUARDANDO' | 'CHAMADO' | 'ACOMODADO' | 'DESISTIU';
  mesaId: number | null;
  criadoEm: string;
  chamadoEm: string | null;
}

export interface FilaDTO {
  fila: EsperaDTO[];
  acomodadosHoje: number;
  esperaMediaMin: number | null;
}

export interface ReservaDTO {
  id: number;
  nome: string;
  pessoas: number;
  telefone: string | null;
  observacao: string | null;
  dataHora: string;
  mesaId: number | null;
  mesa: { id: number; numero: number; nome: string | null; lugares: number } | null;
  status: 'ATIVA' | 'CHEGOU' | 'CANCELADA' | 'NAO_COMPARECEU';
}

// ---------- Estoque ----------

export interface EstoqueItemDTO {
  id: number;
  nome: string;
  imagem: string | null;
  estoque: number;
  estoqueMinimo: number;
  disponivel: boolean;
  categoria: { nome: string };
  situacao: 'OK' | 'BAIXO' | 'ZERADO';
}

export interface MovimentoDTO {
  id: number;
  tipo: 'ENTRADA' | 'SAIDA' | 'AJUSTE' | 'VENDA' | 'DEVOLUCAO';
  quantidade: number;
  saldo: number;
  motivo: string | null;
  usuarioNome: string | null;
  criadoEm: string;
}

// ---------- Nota fiscal ----------

export type ProvedorFiscal = 'NENHUM' | 'WEBHOOK' | 'FOCUS_NFE' | 'WEBMANIA';

export interface FiscalConfigDTO {
  provedor: ProvedorFiscal;
  ambiente: 'HOMOLOGACAO' | 'PRODUCAO';
  cnpj: string | null;
  webhookUrl: string | null;
  emissaoAutomatica: boolean;
  ncmPadrao: string;
  cfopPadrao: string;
  csosnPadrao: string;
  classeImposto: string | null;
  credenciaisDefinidas: string[];
}

export interface NotaDTO {
  id: number;
  status: 'PROCESSANDO' | 'AUTORIZADA' | 'REJEITADA' | 'CANCELADA' | 'ERRO';
  provedor: ProvedorFiscal;
  ambiente: 'HOMOLOGACAO' | 'PRODUCAO';
  numero: string | null;
  serie: string | null;
  chave: string | null;
  urlDanfe: string | null;
  urlXml: string | null;
  mensagem: string | null;
  atualizadaEm: string;
}

export interface ContaFechadaDTO {
  id: number;
  mesa: { numero: number; nome: string | null };
  fechadaEm: string | null;
  cpfCnpjCliente: string | null;
  produtos: number;
  servico: number;
  gorjetas: number;
  total: number;
  formas: Record<string, number>;
  nota: NotaDTO | null;
}

export const STATUS_NOTA: Record<NotaDTO['status'], { rotulo: string; cor: 'azul' | 'amarelo' | 'verde' | 'cinza' | 'vermelho' }> = {
  PROCESSANDO: { rotulo: 'Em processamento', cor: 'amarelo' },
  AUTORIZADA: { rotulo: 'Autorizada', cor: 'verde' },
  REJEITADA: { rotulo: 'Rejeitada', cor: 'vermelho' },
  CANCELADA: { rotulo: 'Cancelada', cor: 'cinza' },
  ERRO: { rotulo: 'Erro', cor: 'vermelho' },
};

// CPF ou CNPJ só com dígitos -> com pontuação.
export function formatarDocumento(digitos: string | null): string {
  if (!digitos) return '';
  if (digitos.length === 11) return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (digitos.length === 14) return digitos.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return digitos;
}
