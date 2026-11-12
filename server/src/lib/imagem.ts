import { HttpError } from './erros';

// Validação de imagem. Vazio ou null vira null. Data URL de jpeg, png ou webp com até
// 200.000 caracteres; endereço http(s) de até 500 caracteres só quando aceitaEndereco for true.

const PREFIXOS_DATA_URL = [
  'data:image/jpeg;base64,',
  'data:image/png;base64,',
  'data:image/webp;base64,',
];
const MAX_DATA_URL = 200_000;
const MAX_ENDERECO = 500;

export function validarImagem(
  valor: unknown,
  opcoes: { aceitaEndereco: boolean }
): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== 'string') {
    throw new HttpError(400, 'Imagem inválida');
  }
  const limpa = valor.trim();
  if (limpa === '') return null;

  if (limpa.startsWith('http://') || limpa.startsWith('https://')) {
    if (opcoes.aceitaEndereco && limpa.length <= MAX_ENDERECO) return limpa;
    throw new HttpError(400, 'Imagem inválida');
  }

  if (PREFIXOS_DATA_URL.some((prefixo) => limpa.startsWith(prefixo))) {
    if (limpa.length <= MAX_DATA_URL) return limpa;
    throw new HttpError(400, 'Imagem inválida');
  }

  throw new HttpError(400, 'Imagem inválida');
}
