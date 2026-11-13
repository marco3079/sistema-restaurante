import type { StatusPedido } from '../lib/restaurante';

// Textos fixos do cardápio da mesa (cliente), em português, inglês e espanhol.
// O que vem do servidor (nomes, descrições) já chega no idioma escolhido: aqui só entram os textos da tela.

export type Idioma = 'pt' | 'en' | 'es';

export const IDIOMAS: Idioma[] = ['pt', 'en', 'es'];

const CHAVE_IDIOMA = 'restaurante.idioma.cliente';

export interface Textos {
  mesaNumero: (numero: number, nome: string | null) => string;
  cardapio: string;
  chamarGarcom: string;
  garcomAvisado: string;
  chamarCurto: string;
  avisadoCurto: string;
  mudarParaTemaClaro: string;
  mudarParaTemaEscuro: string;
  idioma: string;
  escolherIdioma: string;
  naoEncontrada: string;
  naoEncontradaTexto: string;
  secoes: string;
  abaCardapio: string;
  abaPedidos: string;
  cardapioEmPreparo: string;
  cardapioVazio: string;
  recomendados: string;
  recomendadosCasa: string;
  maisPedidos: string;
  categorias: string;
  verDetalhes: (nome: string) => string;
  esgotado: string;
  adicionar: string;
  adicionarNome: (nome: string) => string;
  verIngredientes: string;
  tirarUm: (nome: string) => string;
  adicionarUm: (nome: string) => string;
  pedidoEnviado: (id: number) => string;
  garcomAvisadoAviso: string;
  semPedidos: string;
  semPedidosTexto: string;
  verCardapio: string;
  pedidoNumero: (id: number) => string;
  totalDoPedido: string;
  pedidos: string;
  taxaServico: (percentual: number | null | undefined) => string;
  desconto: (valor: string) => string;
  jaPago: string;
  faltaPagar: string;
  totalAteAgora: string;
  precisaAjuda: string;
  garcomJaAvisado: string;
  chameGarcomConta: string;
  verPedido: string;
  arrastarParaVerMais: string;
  itensNaBarra: (quantidade: number) => string;
  seuPedido: string;
  sacolaVazia: string;
  seuNome: string;
  observacao: string;
  pagamentoNota: string;
  enviarPedido: string;
  enviando: string;
  continuarEscolhendo: string;
  total: string;
  voltarCardapio: string;
  adicionarAoPedido: (preco: string) => string;
  adicionarSacola: (preco: string) => string;
  prontoTotal: (total: string) => string;
  naSacola: (quantidade: number) => string;
  statusRotulo: Record<StatusPedido, string>;
  statusFrase: Record<StatusPedido, string>;
  // Perfil do prato.
  porcao: string;
  preparo: string;
  tempoPreparo: (minutos: number) => string;
  alergenicos: string;
  ingredientes: string;
  tabelaNutricional: string;
  valoresPorcao: (porcao: string | null) => string;
  valoresAproximados: string;
  semFicha: string;
  fotoDe: (nome: string) => string;
  combo: string;
  promocao: string;
  comboInclui: string;
  quantidadeX: (quantidade: number, nome: string) => string;
  opcoes: string;
  regraGrupo: (minimo: number, maximo: number) => string;
  acrescimo: (valor: string) => string;
  faltaEscolher: (grupo: string) => string;
  totalDoItem: (valor: string) => string;
  // Avaliação.
  comoFoi: string;
  avaliacaoDescricao: string;
  notaComida: string;
  notaAtendimento: string;
  estrelaDe: (nota: number) => string;
  comentario: string;
  comentarioLimite: string;
  avaliacaoFaltaNota: string;
  enviarAvaliacao: string;
  enviandoAvaliacao: string;
  agoraNao: string;
  obrigadoAvaliacao: string;
}

const pt: Textos = {
  mesaNumero: (numero, nome) => `Mesa ${numero}${nome ? ` · ${nome}` : ''}`,
  cardapio: 'Cardápio',
  chamarGarcom: 'Chamar garçom',
  garcomAvisado: 'Garçom avisado',
  chamarCurto: 'Chamar',
  avisadoCurto: 'Avisado',
  mudarParaTemaClaro: 'Mudar para o tema claro',
  mudarParaTemaEscuro: 'Mudar para o tema escuro',
  idioma: 'Idioma',
  escolherIdioma: 'Escolher idioma',
  naoEncontrada: 'Não encontramos esta mesa',
  naoEncontradaTexto: 'O QR code pode ter sido trocado. Peça ajuda ao garçom para abrir o cardápio.',
  secoes: 'Seções',
  abaCardapio: 'Cardápio',
  abaPedidos: 'Meus pedidos',
  cardapioEmPreparo: 'Cardápio em preparo',
  cardapioVazio: 'Ainda não há itens no cardápio. Chame o garçom para fazer o pedido.',
  recomendados: 'Recomendados',
  recomendadosCasa: 'Recomendados da casa',
  maisPedidos: 'Mais pedidos',
  categorias: 'Categorias',
  verDetalhes: (nome) => `Ver detalhes de ${nome}`,
  esgotado: 'Esgotado',
  adicionar: 'Adicionar',
  adicionarNome: (nome) => `Adicionar ${nome}`,
  verIngredientes: 'Ver ingredientes e tabela nutricional',
  tirarUm: (nome) => `Tirar um ${nome}`,
  adicionarUm: (nome) => `Adicionar um ${nome}`,
  pedidoEnviado: (id) => `Pedido #${id} enviado. Acompanhe por aqui.`,
  garcomAvisadoAviso: 'O garçom foi avisado e já vem até a mesa.',
  semPedidos: 'Nenhum pedido ainda',
  semPedidosTexto: 'Escolha os itens no cardápio e envie o pedido. Ele aparece aqui.',
  verCardapio: 'Ver cardápio',
  pedidoNumero: (id) => `Pedido #${id}`,
  totalDoPedido: 'Total do pedido',
  pedidos: 'Pedidos',
  taxaServico: (percentual) => `Taxa de serviço (${percentual}%, opcional)`,
  desconto: (valor) => `Desconto − ${valor}`,
  jaPago: 'Já pago',
  faltaPagar: 'Falta pagar',
  totalAteAgora: 'Total da mesa até agora',
  precisaAjuda: 'Precisa de ajuda?',
  garcomJaAvisado: 'O garçom já foi avisado e vem até a mesa.',
  chameGarcomConta: 'Chame o garçom para tirar dúvidas ou pedir a conta.',
  verPedido: 'Ver pedido',
  arrastarParaVerMais: 'Arraste para o lado para ver mais',
  itensNaBarra: (quantidade) => `${quantidade} ${quantidade === 1 ? 'item' : 'itens'}`,
  seuPedido: 'Seu pedido',
  sacolaVazia: 'Sua sacola está vazia.',
  seuNome: 'Seu nome (opcional)',
  observacao: 'Observação (opcional): ponto da carne, sem cebola...',
  pagamentoNota: 'O pagamento é feito com o garçom, ao fechar a conta.',
  enviarPedido: 'Enviar pedido',
  enviando: 'Enviando...',
  continuarEscolhendo: 'Continuar escolhendo',
  total: 'Total',
  voltarCardapio: 'Voltar ao cardápio',
  adicionarAoPedido: (preco) => `Adicionar ao pedido · ${preco}`,
  adicionarSacola: (preco) => `Adicionar à sacola · ${preco}`,
  prontoTotal: (total) => `Pronto · ${total}`,
  naSacola: (quantidade) => `${quantidade} na sacola`,
  statusRotulo: {
    NOVO: 'Novo',
    EM_PREPARO: 'Em preparo',
    PRONTO: 'Pronto',
    ENTREGUE: 'Entregue',
    CANCELADO: 'Cancelado',
  },
  statusFrase: {
    NOVO: 'Recebido pelo restaurante',
    EM_PREPARO: 'Sendo preparado',
    PRONTO: 'Pronto, a caminho da mesa',
    ENTREGUE: 'Entregue',
    CANCELADO: 'Cancelado',
  },
  porcao: 'Porção',
  preparo: 'Preparo',
  tempoPreparo: (minutos) => `cerca de ${minutos} min`,
  alergenicos: 'Alergênicos:',
  ingredientes: 'Ingredientes',
  tabelaNutricional: 'Tabela nutricional',
  valoresPorcao: (porcao) => (porcao ? `Valores da porção: ${porcao}` : 'Valores da porção'),
  valoresAproximados: 'Valores aproximados, que podem variar conforme o preparo.',
  semFicha: 'Este item ainda não tem ficha com ingredientes e tabela nutricional.',
  fotoDe: (nome) => `Foto de ${nome}`,
  combo: 'Combo',
  promocao: 'Promoção',
  comboInclui: 'Este combo inclui',
  quantidadeX: (quantidade, nome) => `${quantidade}x ${nome}`,
  opcoes: 'Opções',
  regraGrupo: (minimo, maximo) => {
    if (maximo === 1) return minimo >= 1 ? 'Escolha 1' : 'Opcional';
    if (minimo === 0) return `Escolha até ${maximo}`;
    return minimo === maximo ? `Escolha ${minimo}` : `Escolha de ${minimo} a ${maximo}`;
  },
  acrescimo: (valor) => `+ ${valor}`,
  faltaEscolher: (grupo) => `Falta escolher: ${grupo}`,
  totalDoItem: (valor) => `Total do item: ${valor}`,
  comoFoi: 'Como foi?',
  avaliacaoDescricao: 'Conte como foram a comida e o atendimento.',
  notaComida: 'Comida',
  notaAtendimento: 'Atendimento',
  estrelaDe: (nota) => `${nota} de 5`,
  comentario: 'Comentário (opcional)',
  comentarioLimite: 'Até 500 letras.',
  avaliacaoFaltaNota: 'Dê uma nota para a comida e outra para o atendimento.',
  enviarAvaliacao: 'Enviar avaliação',
  enviandoAvaliacao: 'Enviando...',
  agoraNao: 'Agora não',
  obrigadoAvaliacao: 'Obrigado pela avaliação!',
};

const en: Textos = {
  mesaNumero: (numero, nome) => `Table ${numero}${nome ? ` · ${nome}` : ''}`,
  cardapio: 'Menu',
  chamarGarcom: 'Call waiter',
  garcomAvisado: 'Waiter notified',
  chamarCurto: 'Call',
  avisadoCurto: 'Notified',
  mudarParaTemaClaro: 'Switch to light theme',
  mudarParaTemaEscuro: 'Switch to dark theme',
  idioma: 'Language',
  escolherIdioma: 'Choose language',
  naoEncontrada: "We couldn't find this table",
  naoEncontradaTexto: 'The QR code may have been changed. Ask the waiter to open the menu.',
  secoes: 'Sections',
  abaCardapio: 'Menu',
  abaPedidos: 'My orders',
  cardapioEmPreparo: 'Menu being prepared',
  cardapioVazio: 'There are no items on the menu yet. Call the waiter to place an order.',
  recomendados: 'Recommended',
  recomendadosCasa: 'House recommendations',
  maisPedidos: 'Most ordered',
  categorias: 'Categories',
  verDetalhes: (nome) => `See details of ${nome}`,
  esgotado: 'Sold out',
  adicionar: 'Add',
  adicionarNome: (nome) => `Add ${nome}`,
  verIngredientes: 'See ingredients and nutrition table',
  tirarUm: (nome) => `Remove one ${nome}`,
  adicionarUm: (nome) => `Add one ${nome}`,
  pedidoEnviado: (id) => `Order #${id} sent. Follow it here.`,
  garcomAvisadoAviso: 'The waiter was notified and is coming to your table.',
  semPedidos: 'No orders yet',
  semPedidosTexto: 'Choose items from the menu and send your order. It will show up here.',
  verCardapio: 'See menu',
  pedidoNumero: (id) => `Order #${id}`,
  totalDoPedido: 'Order total',
  pedidos: 'Orders',
  taxaServico: (percentual) => `Service charge (${percentual}%, optional)`,
  desconto: (valor) => `Discount − ${valor}`,
  jaPago: 'Already paid',
  faltaPagar: 'Amount due',
  totalAteAgora: 'Table total so far',
  precisaAjuda: 'Need help?',
  garcomJaAvisado: 'The waiter was already notified and is coming to your table.',
  chameGarcomConta: 'Call the waiter to ask questions or request the bill.',
  verPedido: 'View order',
  arrastarParaVerMais: 'Swipe sideways to see more',
  itensNaBarra: (quantidade) => `${quantidade} ${quantidade === 1 ? 'item' : 'items'}`,
  seuPedido: 'Your order',
  sacolaVazia: 'Your cart is empty.',
  seuNome: 'Your name (optional)',
  observacao: 'Note (optional): meat doneness, no onion...',
  pagamentoNota: 'You pay the waiter when the bill is closed.',
  enviarPedido: 'Send order',
  enviando: 'Sending...',
  continuarEscolhendo: 'Keep choosing',
  total: 'Total',
  voltarCardapio: 'Back to menu',
  adicionarAoPedido: (preco) => `Add to order · ${preco}`,
  adicionarSacola: (preco) => `Add to cart · ${preco}`,
  prontoTotal: (total) => `Done · ${total}`,
  naSacola: (quantidade) => `${quantidade} in cart`,
  statusRotulo: {
    NOVO: 'New',
    EM_PREPARO: 'Preparing',
    PRONTO: 'Ready',
    ENTREGUE: 'Delivered',
    CANCELADO: 'Cancelled',
  },
  statusFrase: {
    NOVO: 'Received by the restaurant',
    EM_PREPARO: 'Being prepared',
    PRONTO: 'Ready, on its way to the table',
    ENTREGUE: 'Delivered',
    CANCELADO: 'Cancelled',
  },
  porcao: 'Portion',
  preparo: 'Preparation',
  tempoPreparo: (minutos) => `about ${minutos} min`,
  alergenicos: 'Allergens:',
  ingredientes: 'Ingredients',
  tabelaNutricional: 'Nutrition table',
  valoresPorcao: (porcao) => (porcao ? `Portion values: ${porcao}` : 'Portion values'),
  valoresAproximados: 'Approximate values, which may vary with preparation.',
  semFicha: 'This item does not have an ingredients and nutrition sheet yet.',
  fotoDe: (nome) => `Photo of ${nome}`,
  combo: 'Combo',
  promocao: 'Promotion',
  comboInclui: 'This combo includes',
  quantidadeX: (quantidade, nome) => `${quantidade}x ${nome}`,
  opcoes: 'Options',
  regraGrupo: (minimo, maximo) => {
    if (maximo === 1) return minimo >= 1 ? 'Choose 1' : 'Optional';
    if (minimo === 0) return `Choose up to ${maximo}`;
    return minimo === maximo ? `Choose ${minimo}` : `Choose ${minimo} to ${maximo}`;
  },
  acrescimo: (valor) => `+ ${valor}`,
  faltaEscolher: (grupo) => `Still to choose: ${grupo}`,
  totalDoItem: (valor) => `Item total: ${valor}`,
  comoFoi: 'How was it?',
  avaliacaoDescricao: 'Tell us how the food and the service were.',
  notaComida: 'Food',
  notaAtendimento: 'Service',
  estrelaDe: (nota) => `${nota} of 5`,
  comentario: 'Comment (optional)',
  comentarioLimite: 'Up to 500 characters.',
  avaliacaoFaltaNota: 'Rate the food and rate the service to send.',
  enviarAvaliacao: 'Send review',
  enviandoAvaliacao: 'Sending...',
  agoraNao: 'Not now',
  obrigadoAvaliacao: 'Thank you for your review!',
};

const es: Textos = {
  mesaNumero: (numero, nome) => `Mesa ${numero}${nome ? ` · ${nome}` : ''}`,
  cardapio: 'Carta',
  chamarGarcom: 'Llamar al camarero',
  garcomAvisado: 'Camarero avisado',
  chamarCurto: 'Llamar',
  avisadoCurto: 'Avisado',
  mudarParaTemaClaro: 'Cambiar al tema claro',
  mudarParaTemaEscuro: 'Cambiar al tema oscuro',
  idioma: 'Idioma',
  escolherIdioma: 'Elegir idioma',
  naoEncontrada: 'No encontramos esta mesa',
  naoEncontradaTexto: 'Es posible que el código QR haya cambiado. Pida ayuda al camarero para abrir la carta.',
  secoes: 'Secciones',
  abaCardapio: 'Carta',
  abaPedidos: 'Mis pedidos',
  cardapioEmPreparo: 'Carta en preparación',
  cardapioVazio: 'Todavía no hay artículos en la carta. Llame al camarero para hacer el pedido.',
  recomendados: 'Recomendados',
  recomendadosCasa: 'Recomendados de la casa',
  maisPedidos: 'Más pedidos',
  categorias: 'Categorías',
  verDetalhes: (nome) => `Ver detalles de ${nome}`,
  esgotado: 'Agotado',
  adicionar: 'Añadir',
  adicionarNome: (nome) => `Añadir ${nome}`,
  verIngredientes: 'Ver ingredientes y tabla nutricional',
  tirarUm: (nome) => `Quitar uno de ${nome}`,
  adicionarUm: (nome) => `Añadir uno de ${nome}`,
  pedidoEnviado: (id) => `Pedido #${id} enviado. Sigalo por aquí.`,
  garcomAvisadoAviso: 'El camarero fue avisado y ya viene a la mesa.',
  semPedidos: 'Todavía no hay pedidos',
  semPedidosTexto: 'Elija los artículos de la carta y envíe el pedido. Aparecerá aquí.',
  verCardapio: 'Ver carta',
  pedidoNumero: (id) => `Pedido #${id}`,
  totalDoPedido: 'Total del pedido',
  pedidos: 'Pedidos',
  taxaServico: (percentual) => `Cargo por servicio (${percentual}%, opcional)`,
  desconto: (valor) => `Descuento − ${valor}`,
  jaPago: 'Ya pagado',
  faltaPagar: 'Falta pagar',
  totalAteAgora: 'Total de la mesa hasta ahora',
  precisaAjuda: '¿Necesita ayuda?',
  garcomJaAvisado: 'El camarero ya fue avisado y viene a la mesa.',
  chameGarcomConta: 'Llame al camarero para preguntar o pedir la cuenta.',
  verPedido: 'Ver pedido',
  arrastarParaVerMais: 'Desliza hacia un lado para ver más',
  itensNaBarra: (quantidade) => `${quantidade} ${quantidade === 1 ? 'artículo' : 'artículos'}`,
  seuPedido: 'Su pedido',
  sacolaVazia: 'Su bolsa está vacía.',
  seuNome: 'Su nombre (opcional)',
  observacao: 'Observación (opcional): punto de la carne, sin cebolla...',
  pagamentoNota: 'El pago se hace con el camarero, al cerrar la cuenta.',
  enviarPedido: 'Enviar pedido',
  enviando: 'Enviando...',
  continuarEscolhendo: 'Seguir eligiendo',
  total: 'Total',
  voltarCardapio: 'Volver a la carta',
  adicionarAoPedido: (preco) => `Añadir al pedido · ${preco}`,
  adicionarSacola: (preco) => `Añadir a la bolsa · ${preco}`,
  prontoTotal: (total) => `Listo · ${total}`,
  naSacola: (quantidade) => `${quantidade} en la bolsa`,
  statusRotulo: {
    NOVO: 'Nuevo',
    EM_PREPARO: 'En preparación',
    PRONTO: 'Listo',
    ENTREGUE: 'Entregado',
    CANCELADO: 'Cancelado',
  },
  statusFrase: {
    NOVO: 'Recibido por el restaurante',
    EM_PREPARO: 'Se está preparando',
    PRONTO: 'Listo, de camino a la mesa',
    ENTREGUE: 'Entregado',
    CANCELADO: 'Cancelado',
  },
  porcao: 'Porción',
  preparo: 'Preparación',
  tempoPreparo: (minutos) => `unos ${minutos} min`,
  alergenicos: 'Alérgenos:',
  ingredientes: 'Ingredientes',
  tabelaNutricional: 'Tabla nutricional',
  valoresPorcao: (porcao) => (porcao ? `Valores de la porción: ${porcao}` : 'Valores de la porción'),
  valoresAproximados: 'Valores aproximados, que pueden variar según la preparación.',
  semFicha: 'Este artículo todavía no tiene ficha con ingredientes y tabla nutricional.',
  fotoDe: (nome) => `Foto de ${nome}`,
  combo: 'Combo',
  promocao: 'Promoción',
  comboInclui: 'Este combo incluye',
  quantidadeX: (quantidade, nome) => `${quantidade}x ${nome}`,
  opcoes: 'Opciones',
  regraGrupo: (minimo, maximo) => {
    if (maximo === 1) return minimo >= 1 ? 'Elija 1' : 'Opcional';
    if (minimo === 0) return `Elija hasta ${maximo}`;
    return minimo === maximo ? `Elija ${minimo}` : `Elija de ${minimo} a ${maximo}`;
  },
  acrescimo: (valor) => `+ ${valor}`,
  faltaEscolher: (grupo) => `Falta elegir: ${grupo}`,
  totalDoItem: (valor) => `Total del artículo: ${valor}`,
  comoFoi: '¿Qué tal fue?',
  avaliacaoDescricao: 'Cuéntenos cómo fueron la comida y la atención.',
  notaComida: 'Comida',
  notaAtendimento: 'Atención',
  estrelaDe: (nota) => `${nota} de 5`,
  comentario: 'Comentario (opcional)',
  comentarioLimite: 'Hasta 500 caracteres.',
  avaliacaoFaltaNota: 'Ponga una nota a la comida y otra a la atención para enviar.',
  enviarAvaliacao: 'Enviar valoración',
  enviandoAvaliacao: 'Enviando...',
  agoraNao: 'Ahora no',
  obrigadoAvaliacao: '¡Gracias por su valoración!',
};

const TEXTOS: Record<Idioma, Textos> = { pt, en, es };

export function textos(idioma: Idioma): Textos {
  return TEXTOS[idioma] ?? pt;
}

// "pt-BR" -> 'pt'; só devolve um idioma que o cardápio conhece.
export function normalizarIdioma(valor: string | null | undefined): Idioma | null {
  if (!valor) return null;
  const sigla = valor.trim().toLowerCase().slice(0, 2);
  return sigla === 'pt' || sigla === 'en' || sigla === 'es' ? sigla : null;
}

// Escolha salva no aparelho. Sem armazenamento (modo privado), vale só nesta visita.
export function lerIdiomaSalvo(): Idioma | null {
  try {
    return normalizarIdioma(window.localStorage.getItem(CHAVE_IDIOMA));
  } catch {
    return null;
  }
}

export function salvarIdioma(idioma: Idioma): void {
  try {
    window.localStorage.setItem(CHAVE_IDIOMA, idioma);
  } catch {
    // Sem armazenamento, a escolha vale só até recarregar a página.
  }
}

// Idioma do navegador, se ele for um dos três; senão, português.
export function idiomaDoNavegador(): Idioma {
  return normalizarIdioma(typeof navigator !== 'undefined' ? navigator.language : null) ?? 'pt';
}
