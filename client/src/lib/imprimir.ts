import { horaCurta, nomeDaMesa } from './restaurante';
import type { ContaDTO, OpcaoEscolhidaDTO, PagamentoDTO, PedidoDTO } from './restaurante';

// Impressão pelo navegador, no formato de bobina (80 mm). Funciona com qualquer impressora instalada no
// computador, inclusive as térmicas de cozinha e de caixa: basta escolhê-la na janela de impressão.
// Para imprimir sem a janela aparecer, abra o navegador em modo quiosque de impressão
// (no Chrome e no Edge: opção --kiosk-printing) com a impressora térmica como padrão.

const ESTILO = `
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Courier New', ui-monospace, monospace; font-size: 12px; color: #000; }
  h1 { margin: 0 0 2px; font-size: 16px; text-align: center; }
  h2 { margin: 6px 0 2px; font-size: 22px; text-align: center; }
  p { margin: 2px 0; }
  .centro { text-align: center; }
  .linha { border-top: 1px dashed #000; margin: 6px 0; }
  .par { display: flex; justify-content: space-between; gap: 8px; }
  .par span:last-child { white-space: nowrap; }
  .item { font-size: 15px; font-weight: 700; margin: 4px 0 0; }
  .nota { margin: 0 0 2px 22px; font-size: 13px; }
  .destaque { font-size: 15px; font-weight: 700; }
  .obs { border: 1px solid #000; padding: 4px; margin: 6px 0; font-size: 13px; font-weight: 700; }
  .pequeno { font-size: 11px; }
  .opcoes { margin: 0 0 2px 22px; font-size: 13px; font-weight: 700; }
  .opcoes-leve { margin: -1px 0 3px 12px; font-size: 11px; }
`;

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function moeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dataHora(iso: string | Date): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Opções de um item em texto: "Ao ponto · + Bacon" (com "+" quando tem acréscimo).
function textoOpcoes(opcoes: OpcaoEscolhidaDTO[] | undefined): string {
  return (opcoes ?? []).map((o) => (o.precoExtra > 0 ? `+ ${o.opcao}` : o.opcao)).join(' · ');
}

// Imprime um trecho de HTML num quadro escondido (não abre janela nova, então não é bloqueado como pop-up).
export function imprimirHtml(titulo: string, corpo: string): void {
  const quadro = document.createElement('iframe');
  quadro.setAttribute('aria-hidden', 'true');
  quadro.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(quadro);
  const janela = quadro.contentWindow;
  const documento = quadro.contentDocument;
  if (!janela || !documento) {
    quadro.remove();
    return;
  }
  documento.open();
  documento.write(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(titulo)}</title><style>${ESTILO}</style></head><body>${corpo}</body></html>`,
  );
  documento.close();
  const remover = () => window.setTimeout(() => quadro.remove(), 1000);
  janela.onafterprint = remover;
  // Dá tempo de o navegador montar o quadro antes de chamar a impressão.
  window.setTimeout(() => {
    janela.focus();
    janela.print();
    // Navegadores que não avisam o fim da impressão: remove depois de um tempo.
    window.setTimeout(() => quadro.remove(), 60000);
  }, 150);
}

// Comanda da cozinha: mesa em destaque, itens grandes, observações em caixa.
// Com setorId, sai só os itens desse setor e o nome do setor aparece no cabeçalho.
export function imprimirComanda(pedido: PedidoDTO, setorId?: number | null, nomeDoSetor?: string): void {
  const doSetor =
    setorId === undefined || setorId === null ? pedido.itens : pedido.itens.filter((i) => i.setorId === setorId);
  const itens = doSetor
    .map((i) => {
      const opcoes = textoOpcoes(i.opcoes);
      return (
        `<p class="item">${i.quantidade}x ${escapar(i.nomeProduto)}</p>` +
        (opcoes ? `<p class="opcoes">${escapar(opcoes)}</p>` : '') +
        (i.observacao ? `<p class="nota">&gt; ${escapar(i.observacao)}</p>` : '')
      );
    })
    .join('');
  imprimirHtml(
    `Pedido ${pedido.id}`,
    `<h2>${escapar(nomeDaMesa(pedido.mesa))}</h2>` +
      (nomeDoSetor ? `<p class="centro destaque">Setor: ${escapar(nomeDoSetor)}</p>` : '') +
      `<p class="centro">Pedido #${pedido.id} · ${horaCurta(pedido.criadoEm)}</p>` +
      `<p class="centro pequeno">${pedido.origem === 'CLIENTE' ? 'Feito pelo cliente' : `Lançado por ${escapar(pedido.garcom?.nome ?? 'equipe')}`}` +
      `${pedido.nomeCliente ? ` · ${escapar(pedido.nomeCliente)}` : ''}</p>` +
      `<div class="linha"></div>${itens}` +
      (pedido.observacao ? `<div class="obs">OBS: ${escapar(pedido.observacao)}</div>` : '') +
      `<div class="linha"></div><p class="centro pequeno">${dataHora(new Date())}</p>`,
  );
}

function linhasDosItens(conta: ContaDTO): string {
  // Junta os itens iguais (mesmo nome, preço e opções) de todos os pedidos da conta.
  const juntos = new Map<string, { nome: string; opcoes: string; quantidade: number; total: number }>();
  for (const pedido of conta.pedidos) {
    for (const item of pedido.itens) {
      const opcoes = textoOpcoes(item.opcoes);
      const chave = `${item.nomeProduto}|${item.precoUnitario}|${opcoes}`;
      const atual = juntos.get(chave) ?? { nome: item.nomeProduto, opcoes, quantidade: 0, total: 0 };
      atual.quantidade += item.quantidade;
      atual.total += item.precoUnitario * item.quantidade;
      juntos.set(chave, atual);
    }
  }
  return [...juntos.values()]
    .map(
      (i) =>
        `<div class="par"><span>${i.quantidade}x ${escapar(i.nome)}</span><span>${moeda(i.total)}</span></div>` +
        (i.opcoes ? `<p class="opcoes-leve">${escapar(i.opcoes)}</p>` : ''),
    )
    .join('');
}

// Uma linha de desconto na soma (valor com sinal de menos).
function linhaDesconto(rotulo: string, valor: number): string {
  return `<div class="par"><span>${escapar(rotulo)}</span><span>-${moeda(valor)}</span></div>`;
}

function totaisDaConta(conta: ContaDTO): string {
  const descontos =
    (conta.descontoCupom > 0
      ? linhaDesconto(`Cupom ${conta.conta?.cupom?.codigo ?? ''}`.trim(), conta.descontoCupom)
      : '') +
    (conta.descontoPontos > 0 ? linhaDesconto('Pontos', conta.descontoPontos) : '') +
    (conta.descontoManual > 0 ? linhaDesconto('Desconto', conta.descontoManual) : '');
  return (
    `<div class="par"><span>Subtotal</span><span>${moeda(conta.subtotal)}</span></div>` +
    descontos +
    (conta.taxa > 0
      ? `<div class="par"><span>Taxa de serviço (${conta.conta?.taxaPercentual ?? 0}%)</span><span>${moeda(conta.taxa)}</span></div>`
      : '') +
    `<div class="par destaque"><span>TOTAL</span><span>${moeda(conta.total)}</span></div>`
  );
}

// Conta para o cliente conferir antes de pagar (pré-conta).
export function imprimirConta(conta: ContaDTO, restaurante: string, pessoas?: number): void {
  const dividir =
    pessoas && pessoas > 1
      ? `<div class="par"><span>Por pessoa (${pessoas})</span><span>${moeda(Math.ceil((conta.restante / pessoas) * 100) / 100)}</span></div>`
      : '';
  imprimirHtml(
    `Conta ${nomeDaMesa(conta.mesa)}`,
    `<h1>${escapar(restaurante)}</h1><p class="centro">${escapar(nomeDaMesa(conta.mesa))} · ${dataHora(new Date())}</p>` +
      `<div class="linha"></div>${linhasDosItens(conta)}<div class="linha"></div>${totaisDaConta(conta)}` +
      (conta.pago > 0
        ? `<div class="par"><span>Já pago</span><span>${moeda(conta.pago)}</span></div>` +
          `<div class="par destaque"><span>FALTA</span><span>${moeda(conta.restante)}</span></div>`
        : '') +
      dividir +
      `<div class="linha"></div><p class="centro pequeno">${conta.taxa > 0 ? 'A taxa de serviço é opcional.' : ''} Não é documento fiscal.</p>`,
  );
}

// Comprovante depois de a conta ser paga.
export function imprimirComprovante(
  conta: ContaDTO,
  pagamentos: PagamentoDTO[],
  restaurante: string,
  documento?: string | null,
): void {
  const pagos = pagamentos
    .map(
      (p) =>
        `<div class="par"><span>${escapar(p.formaPagamento)}${p.maquineta ? ` (${escapar(p.maquineta.nome)})` : ''}</span><span>${moeda(p.valor)}</span></div>` +
        (p.gorjeta > 0 ? `<div class="par pequeno"><span>&nbsp;&nbsp;Gorjeta</span><span>${moeda(p.gorjeta)}</span></div>` : '') +
        (p.codigoAutorizacao ? `<p class="pequeno">&nbsp;&nbsp;Comprovante: ${escapar(p.codigoAutorizacao)}</p>` : ''),
    )
    .join('');
  imprimirHtml(
    `Comprovante ${nomeDaMesa(conta.mesa)}`,
    `<h1>${escapar(restaurante)}</h1><p class="centro">${escapar(nomeDaMesa(conta.mesa))} · ${dataHora(new Date())}</p>` +
      `<div class="linha"></div>${linhasDosItens(conta)}<div class="linha"></div>${totaisDaConta(conta)}` +
      `<div class="linha"></div><p><strong>Pagamentos</strong></p>${pagos}` +
      (documento ? `<p class="pequeno">CPF/CNPJ: ${escapar(documento)}</p>` : '') +
      `<div class="linha"></div><p class="centro">Obrigado pela preferência!</p><p class="centro pequeno">Não é documento fiscal.</p>`,
  );
}
