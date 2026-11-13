import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { limparCacheConfiguracao, lerConfiguracao } from '../../lib/email';
import { ACOES, AcaoSensivel, lerRegras, MODOS, Modo } from '../../lib/autorizacao';

// Permissões do garçom para as ações sensíveis e a senha curta do gestor.
// A senha do gestor libera ações na frente do cliente; não é a senha de login.

const router = Router();
const soGestor = permitir('GESTOR');

// Só as regras gravadas (sem o padrão), filtradas pelas ações e modos conhecidos.
function regrasGravadas(bruto: unknown): Partial<Record<AcaoSensivel, Modo>> {
  const saida: Partial<Record<AcaoSensivel, Modo>> = {};
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) return saida;
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if ((ACOES as readonly string[]).includes(chave) && (MODOS as readonly string[]).includes(String(valor))) {
      saida[chave as AcaoSensivel] = valor as Modo;
    }
  }
  return saida;
}

router.get(
  '/permissoes',
  soGestor,
  asyncHandler(async (_req, res) => {
    const configuracao = await lerConfiguracao();
    res.json({
      regras: await lerRegras(),
      senhaDefinida: Boolean(configuracao.pinHash),
    });
  })
);

// Para a tela esconder o que é só do gestor. Qualquer perfil logado.
router.get(
  '/permissoes/minhas',
  asyncHandler(async (_req, res) => {
    res.json({ regras: await lerRegras() });
  })
);

const regrasSchema = z.object({
  regras: z.record(z.string(), z.enum(MODOS)),
});

router.put(
  '/permissoes',
  soGestor,
  asyncHandler(async (req, res) => {
    const dados = validar(regrasSchema, req.body);
    const novas: Partial<Record<AcaoSensivel, Modo>> = {};
    for (const [chave, modo] of Object.entries(dados.regras)) {
      if (!(ACOES as readonly string[]).includes(chave)) {
        throw new HttpError(400, 'Ação desconhecida');
      }
      novas[chave as AcaoSensivel] = modo;
    }
    const configuracao = await lerConfiguracao();
    const pedeSenha = Object.values(novas).includes('COM_SENHA');
    if (pedeSenha && !configuracao.pinHash) {
      throw new HttpError(400, 'Defina a senha do gestor primeiro');
    }
    const gravadas = { ...regrasGravadas(configuracao.regrasAcoes), ...novas };
    await prisma.configuracaoPlataforma.update({
      where: { id: 1 },
      data: { regrasAcoes: gravadas },
    });
    limparCacheConfiguracao();
    res.json({ regras: await lerRegras() });
  })
);

const senhaSchema = z.object({
  senhaAtualDaConta: z.string().min(1, 'Informe a sua senha de login'),
  senha: z
    .string()
    .regex(/^\d{4,12}$/, 'A senha do gestor deve ter de 4 a 12 números')
    .nullable(),
});

// Define ou apaga a senha do gestor. Confere a senha de login de quem está logado.
// Apagar a senha põe toda regra COM_SENHA de volta em SO_GESTOR.
router.put(
  '/permissoes/senha',
  soGestor,
  asyncHandler(async (req, res) => {
    const dados = validar(senhaSchema, req.body);
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.usuario.id },
      select: { senhaHash: true },
    });
    if (!usuario) {
      throw new HttpError(401, 'Não autenticado');
    }
    const confere = await bcrypt.compare(dados.senhaAtualDaConta, usuario.senhaHash);
    if (!confere) {
      throw new HttpError(400, 'Senha de login incorreta');
    }

    const configuracao = await lerConfiguracao();
    if (dados.senha === null) {
      const gravadas = regrasGravadas(configuracao.regrasAcoes);
      const semSenha: Partial<Record<AcaoSensivel, Modo>> = {};
      for (const [chave, modo] of Object.entries(gravadas)) {
        semSenha[chave as AcaoSensivel] = modo === 'COM_SENHA' ? 'SO_GESTOR' : modo;
      }
      await prisma.configuracaoPlataforma.update({
        where: { id: 1 },
        data: { pinHash: null, regrasAcoes: semSenha },
      });
    } else {
      const pinHash = await bcrypt.hash(dados.senha, 10);
      await prisma.configuracaoPlataforma.update({
        where: { id: 1 },
        data: { pinHash },
      });
    }
    limparCacheConfiguracao();
    res.json({ senhaDefinida: dados.senha !== null });
  })
);

export default router;
