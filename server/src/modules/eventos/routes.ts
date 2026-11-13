import { Request, Response, Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError } from '../../lib/erros';
import { aoMudar } from '../../lib/eventos';
import type { Mudanca } from '../../lib/eventos';

// Tempo real: o servidor avisa, por fluxo aberto (text/event-stream), que algo mudou.
// O evento leva só o nome do módulo; quem recebe busca os próprios dados pela API.

const router = Router();
export default router;

export const publico = Router();

const LIMITE_CONEXOES_TOTAL = 500;
const LIMITE_PUBLICO_POR_IP = 6;
const INTERVALO_PING_MS = 25 * 1000;

// Módulos que mudam o que a tela do cliente mostra (pedidos, mesa, pagamento, etc.).
const MODULOS_DA_MESA = new Set(['pedidos', 'mesas', 'pagamentos', 'cliente', 'descontos', 'transferencias']);

let conexoesAbertas = 0;
const conexoesPublicasPorIp = new Map<string, number>();

interface OpcoesFluxo {
  publico: boolean;
  // Diz o que enviar para uma mudança (nome do módulo) ou null para não enviar.
  nomeDoEvento: (mudanca: Mudanca) => string | null;
}

// Abre o fluxo de eventos e cuida dos limites. Erros lançados aqui viram resposta JSON (ainda sem cabeçalhos enviados).
function abrirFluxo(req: Request, res: Response, opcoes: OpcoesFluxo): void {
  // Se a conexão já caiu (ex.: o cliente fechou enquanto a mesa era consultada), não registra nada.
  if (res.destroyed || res.writableEnded || req.socket.destroyed) return;

  // Limites: checados antes de qualquer contagem (lançam erro JSON, sem cabeçalhos enviados).
  if (conexoesAbertas >= LIMITE_CONEXOES_TOTAL) {
    throw new HttpError(503, 'Tempo real indisponível no momento. Tente de novo em instantes');
  }
  const ip = req.ip ?? '';
  if (opcoes.publico) {
    const abertasDoIp = conexoesPublicasPorIp.get(ip) ?? 0;
    if (abertasDoIp >= LIMITE_PUBLICO_POR_IP) {
      throw new HttpError(429, 'Muitas telas abertas. Feche algumas e tente de novo');
    }
  }

  // Tudo o que é contado ou criado abaixo é desfeito por esta limpeza, que roda uma única vez.
  let limpo = false;
  let contouTotal = false;
  let contouIp = false;
  let cancelarOuvinte: (() => void) | null = null;
  let ping: NodeJS.Timeout | null = null;

  const limpar = (): void => {
    if (limpo) return;
    limpo = true;
    if (cancelarOuvinte !== null) cancelarOuvinte();
    if (ping !== null) clearInterval(ping);
    if (contouTotal) conexoesAbertas--;
    if (contouIp) {
      const abertasDoIp = (conexoesPublicasPorIp.get(ip) ?? 1) - 1;
      if (abertasDoIp <= 0) conexoesPublicasPorIp.delete(ip);
      else conexoesPublicasPorIp.set(ip, abertasDoIp);
    }
    try {
      if (!res.writableEnded) res.end();
    } catch {
      // Conexão já fechada: nada a fazer.
    }
  };

  // Registrado ANTES de contar e de criar o intervalo. Usa 'close' da resposta: o 'close' da requisição dispara cedo em GET.
  res.on('close', limpar);

  if (opcoes.publico) {
    conexoesPublicasPorIp.set(ip, (conexoesPublicasPorIp.get(ip) ?? 0) + 1);
    contouIp = true;
  }
  conexoesAbertas++;
  contouTotal = true;

  try {
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(': ok\n\n');
  } catch {
    limpar();
    return;
  }

  cancelarOuvinte = aoMudar((mudanca) => {
    if (limpo || res.destroyed) return;
    const nome = opcoes.nomeDoEvento(mudanca);
    if (nome !== null) res.write(`data: ${JSON.stringify({ modulo: nome })}\n\n`);
  });
  ping = setInterval(() => {
    if (!limpo && !res.destroyed) res.write(': ping\n\n');
  }, INTERVALO_PING_MS);

  // Guarda: se a conexão caiu antes de o ouvinte e o intervalo existirem, desfaz agora (nunca deve acontecer, mas não vaza).
  if (limpo) {
    cancelarOuvinte();
    clearInterval(ping);
  }
}

// Equipe (qualquer perfil logado): recebe todas as mudanças, com o nome do módulo.
router.get(
  '/eventos',
  asyncHandler(async (req, res) => {
    abrirFluxo(req, res, {
      publico: false,
      nomeDoEvento: (mudanca) => mudanca.modulo,
    });
  })
);

// Cliente (sem login; pelo código da mesa): avisa sempre com 'mesa' quando mudam os módulos da mesa.
publico.get(
  '/cliente/mesas/:codigo/eventos',
  asyncHandler(async (req, res) => {
    const codigo = req.params.codigo;
    if (typeof codigo !== 'string' || !/^[A-Za-z0-9_-]{6,40}$/.test(codigo)) {
      throw new HttpError(404, 'Mesa não encontrada');
    }
    const mesa = await prisma.mesa.findUnique({ where: { codigo } });
    if (!mesa || !mesa.ativa) {
      throw new HttpError(404, 'Mesa não encontrada');
    }
    abrirFluxo(req, res, {
      publico: true,
      nomeDoEvento: (mudanca) => (MODULOS_DA_MESA.has(mudanca.modulo) ? 'mesa' : null),
    });
  })
);
