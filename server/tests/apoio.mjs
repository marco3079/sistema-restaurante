// Funções comuns dos testes de API. Rodam contra um sistema já no ar (veja LEIAME.md).
// Sem dependências: só o Node 20 (fetch e node:test).

const lerEnv = (nome, padrao) => process.env[nome] || padrao;

export const BASE = lerEnv('API_URL', 'http://localhost:3091/api');

// Contas do seed de demonstração. Cada e-mail e senha pode ser trocado por variável de ambiente.
export const contas = {
  gestor: { email: lerEnv('GESTOR_EMAIL', 'gestor@restaurante.local'), senha: lerEnv('GESTOR_SENHA', 'gestor1234') },
  garcom: { email: lerEnv('GARCOM_EMAIL', 'garcom@restaurante.demo'), senha: lerEnv('GARCOM_SENHA', 'garcom1234') },
  cozinha: { email: lerEnv('COZINHA_EMAIL', 'cozinha@restaurante.demo'), senha: lerEnv('COZINHA_SENHA', 'cozinha1234') },
  limpeza: { email: lerEnv('LIMPEZA_EMAIL', 'limpeza@restaurante.demo'), senha: lerEnv('LIMPEZA_SENHA', 'limpeza1234') },
  recepcao: { email: lerEnv('RECEPCAO_EMAIL', 'recepcao@restaurante.demo'), senha: lerEnv('RECEPCAO_SENHA', 'recepcao1234') },
};

// Chama a API. Nunca lança por status HTTP; só lança se não houver conexão.
export async function chamar(metodo, caminho, token = null, corpo = undefined) {
  let resposta;
  try {
    resposta = await fetch(BASE + caminho, {
      method: metodo,
      headers: {
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  } catch (erro) {
    const motivo = erro?.cause?.code || erro?.message || 'erro desconhecido';
    throw new Error(
      `Não consegui conectar em ${BASE} (${motivo}). Suba o sistema antes: veja server/tests/LEIAME.md.`
    );
  }
  const texto = await resposta.text();
  let dados = null;
  if (texto) {
    try {
      dados = JSON.parse(texto);
    } catch {
      dados = texto;
    }
  }
  return { status: resposta.status, dados };
}

// GET que espera 200 e devolve os dados. Usado nos auxiliares (não nas asserções dos testes).
export async function obter(caminho, token = null) {
  const r = await chamar('GET', caminho, token);
  if (r.status !== 200) {
    throw new Error(`GET ${caminho} respondeu ${r.status}: ${JSON.stringify(r.dados)}`);
  }
  return r.dados;
}

const tokens = new Map();

// Faz login e guarda o token (cache por e-mail e senha, durante a execução do arquivo de teste).
export async function entrar(email, senha) {
  const chave = `${email}|${senha}`;
  if (!tokens.has(chave)) {
    const r = await chamar('POST', '/auth/login', null, { email, senha });
    if (r.status !== 200) {
      throw new Error(`Login de ${email} falhou (${r.status}): ${JSON.stringify(r.dados)}`);
    }
    tokens.set(chave, r.dados.token);
  }
  return tokens.get(chave);
}

// Dados do usuário logado (id, nome, email, perfil).
export function usuarioLogado(token) {
  return obter('/auth/me', token);
}

// Mesa pelo número, como o gestor a vê em GET /mesas.
export async function mesaPorNumero(token, numero) {
  const mesa = (await obter('/mesas', token)).find((m) => m.numero === numero);
  if (!mesa) {
    throw new Error(`Mesa ${numero} não existe no banco de testes (o seed de demonstração rodou?).`);
  }
  return mesa;
}

// Deixa a mesa LIVRE: cancela os pedidos em aberto, cancela a cobrança pendente, libera e marca limpa.
// Use o token do gestor. Confere no fim que a mesa ficou LIVRE.
export async function limparMesa(token, mesa) {
  const conta = await obter(`/mesas/${mesa.id}/conta`, token);
  if (conta.pagamentoPendente) {
    await chamar('POST', `/pagamentos/${conta.pagamentoPendente.id}/cancelar`, token, {});
  }
  const pedidos = await obter(`/pedidos?ver=todos&mesaId=${mesa.id}`, token);
  for (const pedido of pedidos) {
    if (pedido.pagoEm === null && pedido.status !== 'CANCELADO') {
      await chamar('PUT', `/pedidos/${pedido.id}/status`, token, { status: 'CANCELADO' });
    }
  }
  await chamar('POST', `/mesas/${mesa.id}/atender-chamado`, token);
  await chamar('POST', `/mesas/${mesa.id}/liberar`, token);
  await chamar('POST', `/mesas/${mesa.id}/limpa`, token);
  const atual = (await obter('/mesas', token)).find((m) => m.id === mesa.id);
  if (!atual || atual.situacao !== 'LIVRE') {
    throw new Error(
      `Não consegui deixar a mesa ${mesa.numero} livre (situação: ${atual?.situacao}). Confira o banco de testes.`
    );
  }
}

// Produto do cardápio pelo nome exato (vem do seed de demonstração).
export async function produtoPorNome(token, nome) {
  const produto = (await obter('/produtos', token)).find((p) => p.nome === nome);
  if (!produto) {
    throw new Error(`Produto "${nome}" não está no cardápio do banco de testes (o seed de demonstração rodou?).`);
  }
  return produto;
}

// Produtos que podem ser pedidos sem mexer no estoque: ativos, disponíveis e sem controle de estoque.
export async function produtosDisponiveis(token) {
  const produtos = await obter('/produtos', token);
  return produtos.filter((p) => p.disponivel && !p.controlaEstoque);
}
