import { pedirSenhaDoGestor } from './senhaGestor';

const CHAVE_TOKEN = 'restaurante.token';
const CHAVE_USUARIO = 'restaurante.usuario';

// Erro de 403 que pede a senha do gestor: vem com detalhes.codigo = 'SENHA_GESTOR' e detalhes.acao.
interface RespostaErro {
  erro?: string;
  detalhes?: { codigo?: string; acao?: string } | null;
}

function cabecalhos(temCorpo: boolean, senhaGestor?: string): HeadersInit {
  const cabecalho: Record<string, string> = {};
  if (temCorpo) cabecalho['Content-Type'] = 'application/json';
  const token = localStorage.getItem(CHAVE_TOKEN);
  if (token) cabecalho['Authorization'] = `Bearer ${token}`;
  // A senha vai só neste cabeçalho, na repetição da mesma requisição. Nunca na URL nem no navegador.
  if (senhaGestor) cabecalho['x-senha-gestor'] = senhaGestor;
  return cabecalho;
}

// senhaGestor: senha digitada na janela (só na repetição da ação). Sem ela, a requisição é a normal.
async function requisitar<T>(metodo: string, caminho: string, corpo?: unknown, senhaGestor?: string): Promise<T> {
  const temCorpo = corpo !== undefined;
  const resposta = await fetch('/api' + caminho, {
    method: metodo,
    headers: cabecalhos(temCorpo, senhaGestor),
    body: temCorpo ? JSON.stringify(corpo) : undefined,
  });

  if (resposta.status === 204) return undefined as T;

  let dados: RespostaErro | null = null;
  try {
    dados = await resposta.json();
  } catch {
    dados = null;
  }

  if (!resposta.ok) {
    if (resposta.status === 401 && caminho !== '/auth/login') {
      localStorage.removeItem(CHAVE_TOKEN);
      localStorage.removeItem(CHAVE_USUARIO);
      window.location.assign('/login');
    }
    if (resposta.status === 403 && dados?.detalhes?.codigo === 'SENHA_GESTOR') {
      // Pede a senha numa janela e repete a mesma requisição. Sem limite aqui: o servidor limita as tentativas.
      const nova = await pedirSenhaDoGestor(dados.detalhes.acao ?? '', senhaGestor ? dados.erro : undefined);
      if (nova === null) throw new Error('Ação cancelada');
      return requisitar<T>(metodo, caminho, corpo, nova);
    }
    throw new Error(dados?.erro ?? 'Erro inesperado');
  }

  return dados as T;
}

export const api = {
  get<T>(caminho: string): Promise<T> {
    return requisitar<T>('GET', caminho);
  },
  post<T>(caminho: string, corpo?: unknown): Promise<T> {
    return requisitar<T>('POST', caminho, corpo);
  },
  put<T>(caminho: string, corpo?: unknown): Promise<T> {
    return requisitar<T>('PUT', caminho, corpo);
  },
  async del(caminho: string): Promise<void> {
    await requisitar<void>('DELETE', caminho);
  },
};
