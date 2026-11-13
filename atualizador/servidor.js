// Atualizador do sistema: roda num contêiner com acesso ao Docker e à pasta do projeto.
// Verifica commits novos no GitHub e, quando mandado, copia o banco, baixa o último commit
// e reconstrói os contêineres api e web. Só a API fala com ele, pela rede interna do Compose.
// Sem dependências npm: usa só módulos do Node.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');

// Configuração
const PORTA = 4000;
const PROJETO = '/projeto';
const PASTA_BACKUPS = '/projeto/backups';
const SEGREDO = process.env.ATUALIZADOR_SEGREDO || '';
let nomeProjeto = process.env.COMPOSE_PROJECT_NAME || '';
const MSG_SEM_NOME_PROJETO = 'Não foi possível descobrir o nome do projeto no Docker. Nada foi alterado.';
const MAX_BACKUPS = 5;
const MAX_LOG = 300;
const VERIFICACAO_MINIMA_MS = 20 * 1000;
const VERIFICACAO_INTERVALO_MS = 6 * 60 * 60 * 1000;

// Estado da tarefa de atualização (em memória)
let tarefa = { estado: 'PARADA', etapa: null, iniciadaEm: null, terminadaEm: null, erro: null, de: null, para: null, log: [] };

// Estado da verificação com o GitHub (em memória)
let verificadoEm = null;
let erroVerificacao = null;
let verificando = null;
let ultimaTentativaMs = 0;

// Cache das leituras do git, para GET /estado responder na hora (no Windows o git status é lento)
let cacheGit = null;
let cacheGitEm = 0;
let lendoGit = null;
const CACHE_GIT_VALIDADE_MS = 10 * 60 * 1000;

function agora() {
  return new Date().toISOString();
}

function registrar(linha) {
  tarefa.log.push(String(linha).slice(0, 500));
  if (tarefa.log.length > MAX_LOG) {
    tarefa.log.splice(0, tarefa.log.length - MAX_LOG);
  }
}

function etapa(texto) {
  tarefa.etapa = texto;
  registrar('== ' + texto);
}

function falhar(mensagem) {
  tarefa.estado = 'FALHOU';
  tarefa.erro = mensagem;
  tarefa.terminadaEm = agora();
  registrar('ERRO: ' + mensagem);
}

// Separa a saída em linhas, mesmo quando um pedaço termina no meio de uma linha
function criarLeitorDeLinhas(aoLinha) {
  let resto = '';
  return {
    receber(pedaco) {
      if (!aoLinha) return;
      resto += pedaco;
      const partes = resto.split(/\r?\n/);
      resto = partes.pop();
      partes.forEach((linha) => {
        if (linha.trim()) aoLinha(linha);
      });
    },
    fim() {
      if (aoLinha && resto.trim()) aoLinha(resto);
      resto = '';
    },
  };
}

// Roda um comando sem shell. Nunca rejeita por código de saída; só por tempo esgotado ou erro ao iniciar.
function rodar(comando, args, { tempoMs = 60000, aoLinha } = {}) {
  return new Promise((resolve, reject) => {
    const filho = spawn(comando, args);
    const leitor = criarLeitorDeLinhas(aoLinha);
    let saida = '';
    let encerrado = false;

    filho.stdout.setEncoding('utf8');
    filho.stderr.setEncoding('utf8');
    const receber = (pedaco) => {
      saida += pedaco;
      leitor.receber(pedaco);
    };
    filho.stdout.on('data', receber);
    filho.stderr.on('data', receber);

    const timer = setTimeout(() => {
      if (encerrado) return;
      encerrado = true;
      filho.kill();
      reject(new Error('Tempo esgotado: ' + [comando, ...args].join(' ')));
    }, tempoMs);

    filho.on('error', (erro) => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(timer);
      reject(erro);
    });

    filho.on('close', (codigo) => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(timer);
      leitor.fim();
      resolve({ codigo, saida });
    });
  });
}

// Descobre o nome do projeto Compose pelo rótulo do próprio contêiner, se a variável não veio preenchida.
// Nunca lança: se não conseguir, nomeProjeto continua vazio.
async function descobrirNomeDoProjeto() {
  if (nomeProjeto) return nomeProjeto;
  try {
    const r = await rodar('docker', [
      'inspect', '--format', '{{ index .Config.Labels "com.docker.compose.project" }}', require('os').hostname(),
    ], { tempoMs: 15000 });
    if (r.codigo === 0 && r.saida.trim()) {
      nomeProjeto = r.saida.trim();
    }
  } catch {
    // Ignora: o chamador decide o que fazer sem o nome
  }
  return nomeProjeto;
}

// Monta os argumentos do docker compose com o projeto. Nunca roda sem -p.
function argsCompose(args) {
  if (!nomeProjeto) throw new Error(MSG_SEM_NOME_PROJETO);
  return [
    'compose',
    '--project-directory', PROJETO,
    '-p', nomeProjeto,
    ...args,
  ];
}

function git(args, opcoes = {}) {
  return rodar('git', ['-C', PROJETO, '-c', 'safe.directory=' + PROJETO, '-c', 'core.fileMode=false', ...args], opcoes);
}

function compose(args, opcoes = {}) {
  return rodar('docker', argsCompose(args), opcoes);
}

// Devolve o dono da pasta do projeto para o usuário (em Windows não faz nada)
async function acertarDono(caminho) {
  try {
    const dono = fs.statSync(PROJETO);
    await rodar('chown', ['-R', `${dono.uid}:${dono.gid}`, caminho], { tempoMs: 120000 });
  } catch {
    // Ignora: em Windows não há chown
  }
}

// Leitura do estado do git
async function ramoAtual() {
  try {
    const r = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    const ramo = r.saida.trim();
    if (r.codigo !== 0 || !ramo || ramo === 'HEAD') return null;
    return ramo;
  } catch {
    return null;
  }
}

async function commitDe(ref) {
  try {
    const r = await git(['log', '-1', '--format=%H%x1f%h%x1f%s%x1f%cI', ref]);
    if (r.codigo !== 0) return null;
    const [commit, curto, mensagem, data] = r.saida.trim().split('\x1f');
    return { commit, curto, mensagem, data };
  } catch {
    return null;
  }
}

async function pendentes(ramo) {
  try {
    const r = await git(['log', '--max-count=50', '--format=%h%x1f%s%x1f%cI%x1f%an', `HEAD..origin/${ramo}`]);
    if (r.codigo !== 0) return [];
    return r.saida
      .split(/\r?\n/)
      .filter((linha) => linha.includes('\x1f'))
      .map((linha) => {
        const [curto, mensagem, data, autor] = linha.trim().split('\x1f');
        return { curto, mensagem, data, autor };
      });
  } catch {
    return [];
  }
}

async function temAlteracoesLocais() {
  try {
    const r = await git(['status', '--porcelain', '--untracked-files=no']);
    return r.codigo === 0 && r.saida.trim() !== '';
  } catch {
    return false;
  }
}

// Relê do git o que o estado precisa (uma leitura por vez). Nunca lança.
function atualizarCacheGit() {
  if (lendoGit) return lendoGit;

  lendoGit = (async () => {
    try {
      const ramo = await ramoAtual();
      const [instalada, disponivel, novos, alteracoesLocais] = await Promise.all([
        commitDe('HEAD'),
        ramo ? commitDe(`origin/${ramo}`) : null,
        ramo ? pendentes(ramo) : [],
        temAlteracoesLocais(),
      ]);
      cacheGit = { ramo, instalada, disponivel, pendentes: novos, alteracoesLocais };
      cacheGitEm = Date.now();
    } catch {
      // Mantém o cache anterior
    } finally {
      lendoGit = null;
    }
  })();

  return lendoGit;
}

// Verificação com o GitHub (git fetch)
function verificar() {
  if (verificando) return verificando;

  verificando = (async () => {
    try {
      const ramo = await ramoAtual();
      if (!ramo) {
        erroVerificacao = 'A pasta do sistema não está em um ramo do git.';
        return;
      }
      const r = await git(['fetch', '--quiet', 'origin', ramo], { tempoMs: 60000 });
      if (r.codigo === 0) {
        verificadoEm = agora();
        erroVerificacao = null;
      } else {
        erroVerificacao = 'Não foi possível consultar o GitHub: ' + r.saida.trim().slice(-300).trim();
      }
    } catch (erro) {
      erroVerificacao = erro.message;
    } finally {
      ultimaTentativaMs = Date.now();
      await acertarDono('/projeto/.git');
      await atualizarCacheGit();
      verificando = null;
    }
  })();

  return verificando;
}

// Cópia do banco antes de atualizar
function carimbo(data) {
  const p = (n) => String(n).padStart(2, '0');
  return `${data.getFullYear()}${p(data.getMonth() + 1)}${p(data.getDate())}-` +
    `${p(data.getHours())}${p(data.getMinutes())}${p(data.getSeconds())}`;
}

async function copiarBanco(curto) {
  fs.mkdirSync(PASTA_BACKUPS, { recursive: true });

  const nome = `banco_${carimbo(new Date())}_${curto || 'sem-git'}.sql.gz`;
  const arquivo = path.join(PASTA_BACKUPS, nome);
  const cancelada = 'Não foi possível copiar o banco de dados. A atualização foi cancelada e nada foi alterado.';

  // Monta os argumentos antes de criar o arquivo: sem nome do projeto, nada é gravado
  const argsDump = argsCompose(['exec', '-T', 'db', 'pg_dump', '-U', 'restaurante', '-d', 'restaurante']);

  const saida = fs.createWriteStream(arquivo);
  // Ouvinte criado antes do spawn, para não perder o evento 'finish'
  const gravado = new Promise((resolve, reject) => {
    saida.on('finish', resolve);
    saida.on('error', reject);
  });
  // Evita aviso de rejeição não tratada quando a cópia já foi cancelada por outro motivo
  gravado.catch(() => {});

  const filho = spawn('docker', argsDump);
  const gzip = zlib.createGzip();
  // Erros de stream não derrubam o processo: o WriteStream rejeita 'gravado' e a cópia falha
  gzip.on('error', (erro) => saida.destroy(erro));
  filho.stdout.on('error', () => {});
  filho.stdout.pipe(gzip).pipe(saida);

  const leitor = criarLeitorDeLinhas(registrar);
  filho.stderr.setEncoding('utf8');
  filho.stderr.on('data', (pedaco) => leitor.receber(pedaco));

  let codigo;
  try {
    codigo = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        filho.kill();
        reject(new Error(cancelada));
      }, 10 * 60 * 1000);
      filho.on('error', (erro) => {
        clearTimeout(timer);
        reject(erro);
      });
      filho.on('close', (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    leitor.fim();
    await gravado;
  } catch {
    removerArquivo(arquivo);
    throw new Error(cancelada);
  }

  const tamanho = fs.existsSync(arquivo) ? fs.statSync(arquivo).size : 0;
  if (codigo !== 0 || tamanho < 200) {
    removerArquivo(arquivo);
    throw new Error(cancelada);
  }

  registrar(`Cópia gravada em backups/${nome}`);

  // Mantém só os backups mais recentes (o nome começa pela data)
  const antigos = listarNomesBackups().sort().reverse();
  antigos.slice(MAX_BACKUPS).forEach((n) => removerArquivo(path.join(PASTA_BACKUPS, n)));

  await acertarDono(PASTA_BACKUPS);
}

function removerArquivo(caminho) {
  try {
    fs.rmSync(caminho, { force: true });
  } catch {
    // Ignora erro ao apagar
  }
}

function listarNomesBackups() {
  if (!fs.existsSync(PASTA_BACKUPS)) return [];
  return fs.readdirSync(PASTA_BACKUPS).filter((n) => /^banco_.*\.sql\.gz$/.test(n));
}

function listarBackups() {
  return listarNomesBackups()
    .map((arquivo) => {
      const info = fs.statSync(path.join(PASTA_BACKUPS, arquivo));
      return { arquivo, tamanho: info.size, criadoEm: info.mtime.toISOString(), _mtime: info.mtimeMs };
    })
    .sort((a, b) => b._mtime - a._mtime)
    .map(({ arquivo, tamanho, criadoEm }) => ({ arquivo, tamanho, criadoEm }));
}

// Tarefa de atualização
async function iniciarAtualizacao(forcar) {
  // Zera a tarefa de forma síncrona, para o servidor já recusar um segundo pedido
  tarefa = { estado: 'RODANDO', etapa: null, iniciadaEm: agora(), terminadaEm: null, erro: null, de: null, para: null, log: [] };

  try {
    await descobrirNomeDoProjeto();
    if (!nomeProjeto) throw new Error(MSG_SEM_NOME_PROJETO);

    const atual = await commitDe('HEAD');
    tarefa.de = atual ? atual.curto : null;

    etapa('Consultando o GitHub');
    await verificar();
    if (erroVerificacao) throw new Error(erroVerificacao);

    const ramo = await ramoAtual();
    if (!ramo) throw new Error('A pasta do sistema não está em um ramo do git.');

    const novos = await pendentes(ramo);
    if (novos.length === 0 && !forcar) {
      tarefa.estado = 'CONCLUIDA';
      etapa('O sistema já está na última versão');
      tarefa.para = tarefa.de;
      tarefa.terminadaEm = agora();
      return;
    }

    etapa('Copiando o banco de dados');
    await copiarBanco(tarefa.de);

    if (novos.length > 0) {
      etapa('Baixando o último commit');
      const r = await git(['merge', '--ff-only', `origin/${ramo}`], { tempoMs: 120000, aoLinha: registrar });
      if (r.codigo !== 0) {
        throw new Error('Não foi possível aplicar o último commit: a pasta do sistema tem alterações que conflitam. Nada foi alterado.');
      }
      await acertarDono(PROJETO);
    }

    etapa('Reconstruindo o sistema (pode levar alguns minutos)');
    const build = await compose(['build', 'api', 'web'], { tempoMs: 25 * 60 * 1000, aoLinha: registrar });
    if (build.codigo !== 0) {
      throw new Error('A reconstrução falhou. O sistema continua rodando na versão anterior.');
    }

    etapa('Reiniciando o sistema');
    // --no-deps: só a API e o site são recriados; o banco não é tocado.
    // A API sobe primeiro e o site só depois de ela responder (--wait espera o teste de saúde).
    let subida = await compose(['up', '-d', '--no-deps', '--wait', 'api'], { tempoMs: 10 * 60 * 1000, aoLinha: registrar });
    if (subida.codigo === 0) {
      subida = await compose(['up', '-d', '--no-deps', 'web'], { tempoMs: 5 * 60 * 1000, aoLinha: registrar });
    }
    if (subida.codigo !== 0) {
      throw new Error('O sistema foi reconstruído, mas não reiniciou direito. Veja o registro.');
    }

    const fim = await commitDe('HEAD');
    tarefa.para = fim ? fim.curto : null;
    // Renova o cache antes de concluir, para a tela não mostrar novidades que já entraram
    await atualizarCacheGit();
    tarefa.estado = 'CONCLUIDA';
    etapa('Atualização concluída');
    tarefa.terminadaEm = agora();
  } catch (erro) {
    falhar(erro.message);
  } finally {
    // Só depois de gravar o estado final da tarefa
    await atualizarCacheGit();
  }
}

// Estado devolvido ao cliente: as partes do git vêm do cache; o resto é lido na hora
async function estado() {
  // Logo depois de subir, a primeira leitura do git pode demorar: espera no máximo 5 s por ela
  if (cacheGit === null) {
    await Promise.race([atualizarCacheGit(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
  const cache = cacheGit || { ramo: null, instalada: null, disponivel: null, pendentes: [], alteracoesLocais: false };

  return {
    ramo: cache.ramo,
    instalada: cache.instalada,
    disponivel: cache.disponivel,
    pendentes: cache.pendentes,
    alteracoesLocais: cache.alteracoesLocais,
    verificadoEm,
    erroVerificacao,
    tarefa: {
      estado: tarefa.estado,
      etapa: tarefa.etapa,
      iniciadaEm: tarefa.iniciadaEm,
      terminadaEm: tarefa.terminadaEm,
      erro: tarefa.erro,
      de: tarefa.de,
      para: tarefa.para,
      log: [...tarefa.log],
    },
    backups: listarBackups(),
  };
}

// Servidor HTTP
function json(res, codigo, corpo) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
}

function segredoValido(valor) {
  if (typeof valor !== 'string') return false;
  const a = Buffer.from(valor);
  const b = Buffer.from(SEGREDO);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Lê o corpo JSON (até 1000 bytes); vazio ou inválido vira {}
function lerCorpo(req) {
  return new Promise((resolve) => {
    const LIMITE = 1000;
    let tamanho = 0;
    let dados = '';
    req.on('data', (pedaco) => {
      tamanho += pedaco.length;
      if (tamanho <= LIMITE) dados += pedaco.toString('utf8');
    });
    req.on('end', () => {
      if (tamanho > LIMITE) return resolve({});
      try {
        const corpo = JSON.parse(dados || '{}');
        resolve(corpo && typeof corpo === 'object' ? corpo : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

const servidor = http.createServer(async (req, res) => {
  try {
    if (!SEGREDO) {
      return json(res, 503, { erro: 'Atualizador sem segredo configurado.' });
    }
    if (!segredoValido(req.headers['x-atualizador-segredo'])) {
      return json(res, 401, { erro: 'Não autorizado.' });
    }

    if (req.method === 'GET' && req.url === '/estado') {
      // Cache velho: renova em segundo plano e responde com o que já tem
      if (Date.now() - cacheGitEm > CACHE_GIT_VALIDADE_MS && tarefa.estado !== 'RODANDO') {
        atualizarCacheGit();
      }
      return json(res, 200, await estado());
    }

    if (req.method === 'POST' && req.url === '/verificar') {
      const recente = Date.now() - ultimaTentativaMs < VERIFICACAO_MINIMA_MS;
      if (tarefa.estado !== 'RODANDO' && !recente) {
        await verificar();
      }
      return json(res, 200, await estado());
    }

    if (req.method === 'POST' && req.url === '/atualizar') {
      const corpo = await lerCorpo(req);
      const forcar = corpo.forcar === true;
      if (tarefa.estado === 'RODANDO') {
        return json(res, 409, { erro: 'Já há uma atualização em andamento.' });
      }
      iniciarAtualizacao(forcar);
      return json(res, 202, await estado());
    }

    return json(res, 404, { erro: 'Rota não encontrada.' });
  } catch (erro) {
    if (!res.headersSent) {
      json(res, 500, { erro: erro.message });
    }
  }
});

process.on('unhandledRejection', (erro) => {
  console.error(erro);
});

servidor.listen(PORTA, () => {
  console.log('Atualizador ouvindo na porta 4000');
  descobrirNomeDoProjeto();
  atualizarCacheGit();
});

// Verificação automática (não roda enquanto a atualização estiver em andamento)
function verificarSeOcioso() {
  if (tarefa.estado !== 'RODANDO') verificar();
}
setTimeout(verificarSeOcioso, 15000);
setInterval(verificarSeOcioso, VERIFICACAO_INTERVALO_MS);
