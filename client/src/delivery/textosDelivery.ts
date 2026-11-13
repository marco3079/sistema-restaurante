import type { Idioma } from '../cliente/textos';

// Textos próprios das telas públicas do delivery (/pedir e /pedido/:codigo), em português, inglês e espanhol.
// Os textos comuns do cardápio (total, sacola, botões de envio, perfil do prato) vêm de cliente/textos.ts.

export interface TextosDelivery {
  // Pedir.
  tituloDelivery: string;
  subtituloDelivery: string;
  fechado: string;
  tipoEntrega: string;
  tipoRetirada: string;
  tempoEntrega: (minutos: number) => string;
  tempoRetirada: (minutos: number) => string;
  continuar: string;
  voltarAoCardapio: string;
  etapaDados: string;
  dadosEntrega: string;
  dadosRetirada: string;
  campoNome: string;
  campoTelefone: string;
  campoEndereco: string;
  campoComplemento: string;
  campoBairro: string;
  escolhaBairro: string;
  opcaoBairro: (nome: string, taxa: string) => string;
  campoReferencia: string;
  campoPagamentoEntrega: string;
  campoPagamentoRetirada: string;
  pagamentoDinheiro: string;
  pagamentoPix: string;
  pagamentoDebito: string;
  pagamentoCredito: string;
  campoTroco: string;
  campoObservacao: string;
  lembrarDados: string;
  resumo: string;
  subtotal: string;
  taxaEntrega: string;
  taxaEntregaGratis: string;
  descontoResumo: (valor: string) => string;
  estimativa: string;
  faltaMinimo: (valor: string) => string;
  pedidoMinimoAviso: (valor: string) => string;
  // Validação e envio.
  informeNome: string;
  informeTelefone: string;
  informeEndereco: string;
  informeBairro: string;
  informePagamento: string;
  trocoInvalido: string;
  trocoMenorQueTotal: string;
  textoMuitoLongo: (campo: string, limite: number) => string;
  erroConexao: string;
  pedidoSemItens: string;
  tentarDeNovo: string;
  observacaoLabel: string;
  // Acompanhar.
  tituloAcompanhar: string;
  naoEncontrado: string;
  naoEncontradoTexto: string;
  fazerPedido: string;
  fazerOutroPedido: string;
  copiarEndereco: string;
  enderecoCopiado: string;
  enderecoNaoCopiado: string;
  tempoEstimado: (minutos: number) => string;
  situacaoRecebido: string;
  situacaoEmPreparo: string;
  situacaoProntoEntrega: string;
  situacaoProntoRetirada: string;
  situacaoSaiu: string;
  situacaoConcluidoEntrega: string;
  situacaoConcluidoRetirada: string;
  cancelado: string;
  canceladoTexto: string;
  etapasEntrega: { recebido: string; emPreparo: string; pronto: string; saiu: string; concluido: string };
  etapasRetirada: { recebido: string; emPreparo: string; pronto: string; concluido: string };
  linhaTempo: string;
  feita: string;
  atual: string;
  futura: string;
  primeiroNome: (nome: string) => string;
  tipoDoPedido: (tipo: 'DELIVERY' | 'RETIRADA') => string;
  bairroDoPedido: (bairro: string) => string;
  trocoPara: (valor: string) => string;
  pagamento: string;
  atualizando: string;
  pedidoNumeroCodigo: (codigo: string) => string;
}

const pt: TextosDelivery = {
  tituloDelivery: 'Faça seu pedido',
  subtituloDelivery: 'Peça para entrega ou retirada no balcão',
  fechado: 'No momento não estamos recebendo pedidos por aqui.',
  tipoEntrega: 'Entrega',
  tipoRetirada: 'Retirar no balcão',
  tempoEntrega: (minutos) => `Entrega em cerca de ${minutos} min`,
  tempoRetirada: (minutos) => `Pronto em cerca de ${minutos} min`,
  continuar: 'Continuar',
  voltarAoCardapio: 'Voltar ao cardápio',
  etapaDados: 'Seus dados',
  dadosEntrega: 'Dados da entrega',
  dadosRetirada: 'Dados para retirada',
  campoNome: 'Seu nome',
  campoTelefone: 'Telefone com DDD',
  campoEndereco: 'Endereço (rua e número)',
  campoComplemento: 'Complemento',
  campoBairro: 'Bairro',
  escolhaBairro: 'Escolha o bairro',
  opcaoBairro: (nome, taxa) => `${nome} — taxa ${taxa}`,
  campoReferencia: 'Ponto de referência',
  campoPagamentoEntrega: 'Forma de pagamento (na entrega)',
  campoPagamentoRetirada: 'Forma de pagamento (na retirada)',
  pagamentoDinheiro: 'Dinheiro',
  pagamentoPix: 'Pix',
  pagamentoDebito: 'Cartão de débito',
  pagamentoCredito: 'Cartão de crédito',
  campoTroco: 'Troco para (opcional)',
  campoObservacao: 'Observação (opcional): ponto da carne, sem cebola...',
  lembrarDados: 'Lembrar meus dados neste aparelho',
  resumo: 'Resumo',
  subtotal: 'Subtotal',
  taxaEntrega: 'Taxa de entrega',
  taxaEntregaGratis: 'Sem taxa',
  descontoResumo: (valor) => `Desconto − ${valor}`,
  estimativa: 'Este total é uma estimativa. Vale o total confirmado pelo restaurante.',
  faltaMinimo: (valor) => `Faltam ${valor} para o pedido mínimo`,
  pedidoMinimoAviso: (valor) => `O pedido mínimo é ${valor}.`,
  informeNome: 'Informe seu nome (pelo menos 2 letras).',
  informeTelefone: 'Informe o telefone com DDD (10 ou 11 números).',
  informeEndereco: 'Informe a rua e o número (pelo menos 5 letras).',
  informeBairro: 'Escolha o bairro para a entrega.',
  informePagamento: 'Escolha a forma de pagamento.',
  trocoInvalido: 'Digite o valor do troco com números, como 50,00.',
  trocoMenorQueTotal: 'O troco precisa ser maior que o total do pedido.',
  textoMuitoLongo: (campo, limite) => `${campo} pode ter até ${limite} letras.`,
  erroConexao: 'Não foi possível falar com o restaurante. Tente de novo.',
  pedidoSemItens: 'Sua sacola está vazia.',
  tentarDeNovo: 'Tentar de novo',
  observacaoLabel: 'Observação',
  tituloAcompanhar: 'Acompanhe seu pedido',
  naoEncontrado: 'Pedido não encontrado.',
  naoEncontradoTexto: 'Confira o código do pedido ou faça um novo pedido.',
  fazerPedido: 'Fazer um pedido',
  fazerOutroPedido: 'Fazer outro pedido',
  copiarEndereco: 'Copiar o endereço desta página',
  enderecoCopiado: 'Endereço copiado.',
  enderecoNaoCopiado: 'Não foi possível copiar. Copie o endereço da barra do navegador.',
  tempoEstimado: (minutos) => `Tempo estimado: cerca de ${minutos} min`,
  situacaoRecebido: 'Recebemos o seu pedido',
  situacaoEmPreparo: 'Seu pedido está em preparo',
  situacaoProntoEntrega: 'Seu pedido está pronto e logo sai para entrega',
  situacaoProntoRetirada: 'Seu pedido está pronto para retirar no balcão',
  situacaoSaiu: 'Seu pedido saiu para entrega',
  situacaoConcluidoEntrega: 'Pedido entregue. Obrigado!',
  situacaoConcluidoRetirada: 'Pedido retirado. Obrigado!',
  cancelado: 'Pedido cancelado',
  canceladoTexto: 'Este pedido foi cancelado. Fale com o restaurante.',
  etapasEntrega: { recebido: 'Recebido', emPreparo: 'Em preparo', pronto: 'Pronto', saiu: 'Saiu para entrega', concluido: 'Entregue' },
  etapasRetirada: { recebido: 'Recebido', emPreparo: 'Em preparo', pronto: 'Pronto para retirar', concluido: 'Retirado' },
  linhaTempo: 'Etapas do pedido',
  feita: 'Feito',
  atual: 'Agora',
  futura: 'Falta',
  primeiroNome: (nome) => `Olá, ${nome}`,
  tipoDoPedido: (tipo) => (tipo === 'DELIVERY' ? 'Entrega' : 'Retirada no balcão'),
  bairroDoPedido: (bairro) => `Bairro: ${bairro}`,
  trocoPara: (valor) => `Troco para ${valor}`,
  pagamento: 'Pagamento',
  atualizando: 'Atualiza sozinho a cada 15 segundos.',
  pedidoNumeroCodigo: (codigo) => `Pedido ${codigo}`,
};

const en: TextosDelivery = {
  tituloDelivery: 'Place your order',
  subtituloDelivery: 'Order for delivery or pick up at the counter',
  fechado: 'We are not taking orders here right now.',
  tipoEntrega: 'Delivery',
  tipoRetirada: 'Pick up at the counter',
  tempoEntrega: (minutos) => `Delivery in about ${minutos} min`,
  tempoRetirada: (minutos) => `Ready in about ${minutos} min`,
  continuar: 'Continue',
  voltarAoCardapio: 'Back to menu',
  etapaDados: 'Your details',
  dadosEntrega: 'Delivery details',
  dadosRetirada: 'Pick up details',
  campoNome: 'Your name',
  campoTelefone: 'Phone with area code',
  campoEndereco: 'Address (street and number)',
  campoComplemento: 'Apartment, block, etc.',
  campoBairro: 'Neighborhood',
  escolhaBairro: 'Choose the neighborhood',
  opcaoBairro: (nome, taxa) => `${nome} — fee ${taxa}`,
  campoReferencia: 'Landmark',
  campoPagamentoEntrega: 'Payment method (on delivery)',
  campoPagamentoRetirada: 'Payment method (on pick up)',
  pagamentoDinheiro: 'Cash',
  pagamentoPix: 'Pix',
  pagamentoDebito: 'Debit card',
  pagamentoCredito: 'Credit card',
  campoTroco: 'Change for (optional)',
  campoObservacao: 'Note (optional): meat doneness, no onion...',
  lembrarDados: 'Remember my details on this device',
  resumo: 'Summary',
  subtotal: 'Subtotal',
  taxaEntrega: 'Delivery fee',
  taxaEntregaGratis: 'No fee',
  descontoResumo: (valor) => `Discount − ${valor}`,
  estimativa: 'This total is an estimate. The total confirmed by the restaurant is the one that counts.',
  faltaMinimo: (valor) => `${valor} more to reach the minimum order`,
  pedidoMinimoAviso: (valor) => `The minimum order is ${valor}.`,
  informeNome: 'Enter your name (at least 2 letters).',
  informeTelefone: 'Enter the phone with area code (10 or 11 digits).',
  informeEndereco: 'Enter the street and number (at least 5 characters).',
  informeBairro: 'Choose the neighborhood for delivery.',
  informePagamento: 'Choose the payment method.',
  trocoInvalido: 'Type the change amount with numbers, like 50,00.',
  trocoMenorQueTotal: 'The change must be more than the order total.',
  textoMuitoLongo: (campo, limite) => `${campo} can have up to ${limite} characters.`,
  erroConexao: 'Could not reach the restaurant. Please try again.',
  pedidoSemItens: 'Your cart is empty.',
  tentarDeNovo: 'Try again',
  observacaoLabel: 'Note',
  tituloAcompanhar: 'Track your order',
  naoEncontrado: 'Order not found.',
  naoEncontradoTexto: 'Check the order code or place a new order.',
  fazerPedido: 'Place an order',
  fazerOutroPedido: 'Place another order',
  copiarEndereco: 'Copy this page address',
  enderecoCopiado: 'Address copied.',
  enderecoNaoCopiado: 'Could not copy. Copy the address from the browser bar.',
  tempoEstimado: (minutos) => `Estimated time: about ${minutos} min`,
  situacaoRecebido: 'We received your order',
  situacaoEmPreparo: 'Your order is being prepared',
  situacaoProntoEntrega: 'Your order is ready and will leave for delivery soon',
  situacaoProntoRetirada: 'Your order is ready to pick up at the counter',
  situacaoSaiu: 'Your order is on its way',
  situacaoConcluidoEntrega: 'Order delivered. Thank you!',
  situacaoConcluidoRetirada: 'Order picked up. Thank you!',
  cancelado: 'Order cancelled',
  canceladoTexto: 'This order was cancelled. Please contact the restaurant.',
  etapasEntrega: { recebido: 'Received', emPreparo: 'Preparing', pronto: 'Ready', saiu: 'On its way', concluido: 'Delivered' },
  etapasRetirada: { recebido: 'Received', emPreparo: 'Preparing', pronto: 'Ready to pick up', concluido: 'Picked up' },
  linhaTempo: 'Order steps',
  feita: 'Done',
  atual: 'Now',
  futura: 'Pending',
  primeiroNome: (nome) => `Hi, ${nome}`,
  tipoDoPedido: (tipo) => (tipo === 'DELIVERY' ? 'Delivery' : 'Pick up at the counter'),
  bairroDoPedido: (bairro) => `Neighborhood: ${bairro}`,
  trocoPara: (valor) => `Change for ${valor}`,
  pagamento: 'Payment',
  atualizando: 'Updates by itself every 15 seconds.',
  pedidoNumeroCodigo: (codigo) => `Order ${codigo}`,
};

const es: TextosDelivery = {
  tituloDelivery: 'Haga su pedido',
  subtituloDelivery: 'Pida para entrega o para recoger en el mostrador',
  fechado: 'En este momento no estamos recibiendo pedidos por aquí.',
  tipoEntrega: 'Entrega',
  tipoRetirada: 'Recoger en el mostrador',
  tempoEntrega: (minutos) => `Entrega en unos ${minutos} min`,
  tempoRetirada: (minutos) => `Listo en unos ${minutos} min`,
  continuar: 'Continuar',
  voltarAoCardapio: 'Volver a la carta',
  etapaDados: 'Sus datos',
  dadosEntrega: 'Datos de la entrega',
  dadosRetirada: 'Datos para recoger',
  campoNome: 'Su nombre',
  campoTelefone: 'Teléfono con código de área',
  campoEndereco: 'Dirección (calle y número)',
  campoComplemento: 'Complemento',
  campoBairro: 'Barrio',
  escolhaBairro: 'Elija el barrio',
  opcaoBairro: (nome, taxa) => `${nome} — tarifa ${taxa}`,
  campoReferencia: 'Punto de referencia',
  campoPagamentoEntrega: 'Forma de pago (en la entrega)',
  campoPagamentoRetirada: 'Forma de pago (al recoger)',
  pagamentoDinheiro: 'Efectivo',
  pagamentoPix: 'Pix',
  pagamentoDebito: 'Tarjeta de débito',
  pagamentoCredito: 'Tarjeta de crédito',
  campoTroco: 'Cambio para (opcional)',
  campoObservacao: 'Observación (opcional): punto de la carne, sin cebolla...',
  lembrarDados: 'Recordar mis datos en este aparato',
  resumo: 'Resumen',
  subtotal: 'Subtotal',
  taxaEntrega: 'Tarifa de entrega',
  taxaEntregaGratis: 'Sin tarifa',
  descontoResumo: (valor) => `Descuento − ${valor}`,
  estimativa: 'Este total es una estimación. Vale el total confirmado por el restaurante.',
  faltaMinimo: (valor) => `Faltan ${valor} para el pedido mínimo`,
  pedidoMinimoAviso: (valor) => `El pedido mínimo es ${valor}.`,
  informeNome: 'Escriba su nombre (al menos 2 letras).',
  informeTelefone: 'Escriba el teléfono con código de área (10 u 11 números).',
  informeEndereco: 'Escriba la calle y el número (al menos 5 letras).',
  informeBairro: 'Elija el barrio para la entrega.',
  informePagamento: 'Elija la forma de pago.',
  trocoInvalido: 'Escriba el cambio con números, como 50,00.',
  trocoMenorQueTotal: 'El cambio tiene que ser mayor que el total del pedido.',
  textoMuitoLongo: (campo, limite) => `${campo} puede tener hasta ${limite} letras.`,
  erroConexao: 'No fue posible hablar con el restaurante. Intente de nuevo.',
  pedidoSemItens: 'Su bolsa está vacía.',
  tentarDeNovo: 'Intentar de nuevo',
  observacaoLabel: 'Observación',
  tituloAcompanhar: 'Siga su pedido',
  naoEncontrado: 'Pedido no encontrado.',
  naoEncontradoTexto: 'Revise el código del pedido o haga un pedido nuevo.',
  fazerPedido: 'Hacer un pedido',
  fazerOutroPedido: 'Hacer otro pedido',
  copiarEndereco: 'Copiar la dirección de esta página',
  enderecoCopiado: 'Dirección copiada.',
  enderecoNaoCopiado: 'No fue posible copiar. Copie la dirección de la barra del navegador.',
  tempoEstimado: (minutos) => `Tiempo estimado: unos ${minutos} min`,
  situacaoRecebido: 'Recibimos su pedido',
  situacaoEmPreparo: 'Su pedido se está preparando',
  situacaoProntoEntrega: 'Su pedido está listo y saldrá pronto para la entrega',
  situacaoProntoRetirada: 'Su pedido está listo para recoger en el mostrador',
  situacaoSaiu: 'Su pedido salió para la entrega',
  situacaoConcluidoEntrega: 'Pedido entregado. ¡Gracias!',
  situacaoConcluidoRetirada: 'Pedido recogido. ¡Gracias!',
  cancelado: 'Pedido cancelado',
  canceladoTexto: 'Este pedido fue cancelado. Hable con el restaurante.',
  etapasEntrega: { recebido: 'Recibido', emPreparo: 'En preparación', pronto: 'Listo', saiu: 'Salió para la entrega', concluido: 'Entregado' },
  etapasRetirada: { recebido: 'Recibido', emPreparo: 'En preparación', pronto: 'Listo para recoger', concluido: 'Recogido' },
  linhaTempo: 'Etapas del pedido',
  feita: 'Hecho',
  atual: 'Ahora',
  futura: 'Falta',
  primeiroNome: (nome) => `Hola, ${nome}`,
  tipoDoPedido: (tipo) => (tipo === 'DELIVERY' ? 'Entrega' : 'Recoger en el mostrador'),
  bairroDoPedido: (bairro) => `Barrio: ${bairro}`,
  trocoPara: (valor) => `Cambio para ${valor}`,
  pagamento: 'Pago',
  atualizando: 'Se actualiza sola cada 15 segundos.',
  pedidoNumeroCodigo: (codigo) => `Pedido ${codigo}`,
};

const TEXTOS_DELIVERY: Record<Idioma, TextosDelivery> = { pt, en, es };

export function textosDelivery(idioma: Idioma): TextosDelivery {
  return TEXTOS_DELIVERY[idioma] ?? pt;
}
