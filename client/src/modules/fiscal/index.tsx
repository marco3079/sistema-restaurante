import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import type { RotaModulo } from '../../lib/rotas';
import { STATUS_NOTA, formatarDocumento, mensagemErro, nomeDaMesa } from '../../lib/restaurante';
import type { ContaFechadaDTO, FiscalConfigDTO, NotaDTO, ProvedorFiscal } from '../../lib/restaurante';
import {
  Abas,
  Aviso,
  Botao,
  Caixa,
  Campo,
  Carregando,
  Cartao,
  MenuAcoes,
  Pagina,
  Selecao,
  Selo,
  Tabela,
  formatarDataHora,
  formatarMoeda,
} from '../../ui';
import type { AcaoMenu } from '../../ui';
import { Indicador } from '../pedidos/comum';

const PROVEDORES: { valor: ProvedorFiscal; rotulo: string; texto: string }[] = [
  { valor: 'NENHUM', rotulo: 'Nenhum (não emitir nota pelo sistema)', texto: '' },
  {
    valor: 'FOCUS_NFE',
    rotulo: 'Focus NFe',
    texto:
      'Informe o token da empresa (painel da Focus NFe). A empresa precisa estar cadastrada lá, com o certificado digital, o CSC e o credenciamento na Secretaria da Fazenda.',
  },
  {
    valor: 'WEBMANIA',
    rotulo: 'WebmaniaBR',
    texto:
      'Informe as quatro credenciais da empresa e a referência de uma classe de imposto criada no painel da WebmaniaBR. O CSC e a série da NFC-e são configurados lá.',
  },
  {
    valor: 'WEBHOOK',
    rotulo: 'Outro serviço, por webhook',
    texto:
      'O sistema envia cada venda em JSON para o endereço que você informar. Serve para qualquer emissor: o integrador do seu contador, uma automação ou um serviço próprio faz a emissão e devolve o resultado.',
  },
];

const CREDENCIAIS: Record<ProvedorFiscal, { campo: string; rotulo: string }[]> = {
  NENHUM: [],
  FOCUS_NFE: [{ campo: 'token', rotulo: 'Token da empresa' }],
  WEBMANIA: [
    { campo: 'consumerKey', rotulo: 'Consumer Key' },
    { campo: 'consumerSecret', rotulo: 'Consumer Secret' },
    { campo: 'accessToken', rotulo: 'Access Token' },
    { campo: 'accessTokenSecret', rotulo: 'Access Token Secret' },
  ],
  WEBHOOK: [{ campo: 'webhookToken', rotulo: 'Token enviado no cabeçalho Authorization (opcional)' }],
};

const PERIODOS = [
  { dias: 1, rotulo: 'Hoje' },
  { dias: 7, rotulo: '7 dias' },
  { dias: 31, rotulo: '31 dias' },
];

// ---------- Conexão com o emissor ----------

function Conexao({ config, aoSalvo }: { config: FiscalConfigDTO; aoSalvo: () => void }) {
  const [provedor, setProvedor] = useState<string>(config.provedor);
  const [ambiente, setAmbiente] = useState<string>(config.ambiente);
  const [cnpj, setCnpj] = useState(formatarDocumento(config.cnpj));
  const [webhookUrl, setWebhookUrl] = useState(config.webhookUrl ?? '');
  const [automatica, setAutomatica] = useState(config.emissaoAutomatica);
  const [ncm, setNcm] = useState(config.ncmPadrao);
  const [cfop, setCfop] = useState(config.cfopPadrao);
  const [csosn, setCsosn] = useState(config.csosnPadrao);
  const [classe, setClasse] = useState(config.classeImposto ?? '');
  const [credenciais, setCredenciais] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const escolhido = PROVEDORES.find((p) => p.valor === provedor) ?? PROVEDORES[0];
  const campos = CREDENCIAIS[escolhido.valor];
  const mesmoServico = provedor === config.provedor;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setAviso(null);
    setEnviando(true);
    try {
      // Só vão as credenciais que a pessoa digitou; as outras continuam gravadas.
      const digitadas = Object.fromEntries(Object.entries(credenciais).filter(([, valor]) => valor.trim() !== ''));
      await api.put('/fiscal/configuracao', {
        provedor,
        ambiente,
        cnpj: cnpj.trim() || null,
        webhookUrl: webhookUrl.trim() || null,
        emissaoAutomatica: automatica,
        ncmPadrao: ncm.trim(),
        cfopPadrao: cfop.trim(),
        csosnPadrao: csosn.trim(),
        classeImposto: classe.trim() || null,
        ...(Object.keys(digitadas).length > 0 ? { credenciais: digitadas } : {}),
      });
      setCredenciais({});
      setAviso('Configuração fiscal gravada.');
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={salvar} className="formulario-cartoes">
      <Cartao titulo="Serviço emissor">
        <Selecao
          rotulo="Serviço que emite a nota fiscal (NFC-e)"
          valor={provedor}
          aoMudar={setProvedor}
          opcoes={PROVEDORES.map((p) => ({ valor: p.valor, rotulo: p.rotulo }))}
        />
        {escolhido.texto && <p className="maquinetas-texto">{escolhido.texto}</p>}
        {(provedor === 'FOCUS_NFE' || provedor === 'WEBMANIA') && (
          <Aviso tipo="info">
            Esta integração foi escrita pela documentação pública do serviço e ainda não foi testada com uma conta
            real. Comece no ambiente de homologação e confira as primeiras notas com o contador.
          </Aviso>
        )}
        {provedor !== 'NENHUM' && (
          <>
            <Selecao
              rotulo="Ambiente"
              valor={ambiente}
              aoMudar={setAmbiente}
              opcoes={[
                { valor: 'HOMOLOGACAO', rotulo: 'Homologação (testes, sem valor fiscal)' },
                { valor: 'PRODUCAO', rotulo: 'Produção (notas de verdade)' },
              ]}
            />
            <Campo rotulo="CNPJ do restaurante" valor={cnpj} aoMudar={setCnpj} />
            {provedor === 'WEBHOOK' && (
              <Campo rotulo="Endereço do webhook (https://...)" valor={webhookUrl} aoMudar={setWebhookUrl} />
            )}
            {campos.map((c) => {
              const gravada = mesmoServico && config.credenciaisDefinidas.includes(c.campo);
              return (
                <Campo
                  key={c.campo}
                  rotulo={gravada ? `${c.rotulo} (gravado; preencha só para trocar)` : c.rotulo}
                  tipo="password"
                  valor={credenciais[c.campo] ?? ''}
                  aoMudar={(valor) => setCredenciais((atual) => ({ ...atual, [c.campo]: valor }))}
                />
              );
            })}
            {provedor === 'WEBMANIA' && (
              <Campo rotulo="Referência da classe de imposto (WebmaniaBR)" valor={classe} aoMudar={setClasse} />
            )}
            <Caixa
              rotulo="Emitir a nota sozinho quando a conta for paga"
              marcado={automatica}
              aoMudar={setAutomatica}
            />
          </>
        )}
      </Cartao>

      {provedor !== 'NENHUM' && (
        <Cartao titulo="Dados fiscais padrão dos itens">
          <p className="maquinetas-texto">
            Valem para os produtos sem NCM e CFOP próprios (o gestor define os próprios no cadastro do produto). Peça
            estes códigos ao contador. A nota leva só os produtos: a taxa de serviço e a gorjeta ficam fora.
          </p>
          <div className="ficha-grade">
            <Campo rotulo="NCM (8 dígitos)" valor={ncm} aoMudar={setNcm} />
            <Campo rotulo="CFOP (4 dígitos)" valor={cfop} aoMudar={setCfop} />
            <Campo rotulo="Situação tributária (CSOSN ou CST)" valor={csosn} aoMudar={setCsosn} />
          </div>
        </Cartao>
      )}

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={enviando}>
          {enviando ? 'Salvando...' : 'Salvar'}
        </Botao>
      </div>
    </form>
  );
}

// ---------- Contas pagas e notas ----------

function baixarCsv(contas: ContaFechadaDTO[]) {
  const celula = (valor: string | number) => `"${String(valor).replace(/"/g, '""')}"`;
  const numero = (valor: number) => valor.toFixed(2).replace('.', ',');
  const linhas = [
    ['Conta', 'Data', 'Mesa', 'CPF/CNPJ', 'Produtos', 'Taxa de serviço', 'Gorjetas', 'Total da conta', 'Formas de pagamento', 'Nota', 'Número', 'Chave'],
    ...contas.map((c) => [
      c.id,
      c.fechadaEm ? formatarDataHora(c.fechadaEm) : '',
      c.mesa.numero,
      formatarDocumento(c.cpfCnpjCliente),
      numero(c.produtos),
      numero(c.servico),
      numero(c.gorjetas),
      numero(c.total),
      Object.entries(c.formas)
        .map(([forma, valor]) => `${forma}: ${numero(valor)}`)
        .join(' | '),
      c.nota ? STATUS_NOTA[c.nota.status].rotulo : 'Sem nota',
      c.nota?.numero ?? '',
      c.nota?.chave ?? '',
    ]),
  ];
  // O BOM no início faz o Excel abrir os acentos certo; ponto e vírgula é o separador do Excel em português.
  const texto = '﻿' + linhas.map((l) => l.map(celula).join(';')).join('\r\n');
  const endereco = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = endereco;
  link.download = `vendas-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(endereco);
}

function ContasPagas({ ativo }: { ativo: boolean }) {
  const [dias, setDias] = useState(7);
  const contas = useDados<ContaFechadaDTO[]>(`/fiscal/contas?dias=${dias}`);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<number | null>(null);

  async function executar(contaId: number, acao: () => Promise<NotaDTO>) {
    setErro(null);
    setAviso(null);
    setOcupada(contaId);
    try {
      const nota = await acao();
      const texto = `Nota da conta ${contaId}: ${STATUS_NOTA[nota.status].rotulo.toLowerCase()}${nota.mensagem ? ` (${nota.mensagem})` : ''}.`;
      if (nota.status === 'ERRO' || nota.status === 'REJEITADA') setErro(texto);
      else setAviso(texto);
      contas.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupada(null);
    }
  }

  const lista = contas.dados ?? [];
  const soma = (campo: 'produtos' | 'servico' | 'total') => lista.reduce((s, c) => s + c[campo], 0);

  function acoesDe(c: ContaFechadaDTO): AcaoMenu[] {
    const acoes: AcaoMenu[] = [];
    if (ativo && (!c.nota || c.nota.status === 'ERRO' || c.nota.status === 'REJEITADA')) {
      acoes.push({
        rotulo: c.nota ? 'Tentar emitir de novo' : 'Emitir nota',
        icone: 'documento',
        aoClicar: () => void executar(c.id, () => api.post<NotaDTO>(`/contas/${c.id}/nota`)),
      });
    }
    if (c.nota && c.nota.status === 'PROCESSANDO') {
      const nota = c.nota;
      acoes.push({
        rotulo: 'Consultar a situação',
        icone: 'relogio',
        aoClicar: () => void executar(c.id, () => api.post<NotaDTO>(`/notas/${nota.id}/consultar`)),
      });
    }
    if (c.nota?.urlDanfe) {
      const endereco = c.nota.urlDanfe;
      acoes.push({ rotulo: 'Abrir a nota', icone: 'seta-direita', aoClicar: () => window.open(endereco, '_blank', 'noopener') });
    }
    return acoes;
  }

  return (
    <>
      {contas.dados && (
        <div className="resumo">
          <Indicador rotulo="Contas pagas" valor={String(lista.length)} cor="azul" icone="pedidos" />
          <Indicador rotulo="Produtos" valor={formatarMoeda(soma('produtos'))} cor="verde" icone="cardapio" />
          <Indicador rotulo="Taxa de serviço" valor={formatarMoeda(soma('servico'))} cor="roxo" icone="estrela" />
          <Indicador
            rotulo="Notas autorizadas"
            valor={`${lista.filter((c) => c.nota?.status === 'AUTORIZADA').length}/${lista.length}`}
            cor="laranja"
            icone="documento"
          />
        </div>
      )}

      <div className="barra-ferramentas">
        <div className="segmentado" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button key={p.dias} type="button" className="segmentado-item" aria-pressed={dias === p.dias} onClick={() => setDias(p.dias)}>
              {p.rotulo}
            </button>
          ))}
        </div>
        <Botao variante="secundario" desabilitado={lista.length === 0} aoClicar={() => baixarCsv(lista)}>
          Baixar planilha para o contador
        </Botao>
      </div>

      {!ativo && (
        <Aviso tipo="info">
          Nenhum serviço emissor conectado. As contas pagas aparecem aqui e podem ser baixadas em planilha; para emitir
          a nota pelo sistema, conecte um serviço na aba "Conexão".
        </Aviso>
      )}
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {contas.erro && <Aviso tipo="erro">{contas.erro}</Aviso>}
      {contas.carregando && !contas.dados && <Carregando />}

      {contas.dados && (
        <Tabela
          dados={lista}
          chave={(c) => c.id}
          vazio="Nenhuma conta paga neste período."
          colunas={[
            { titulo: 'Quando', celula: (c) => <span className="sem-quebra">{c.fechadaEm ? formatarDataHora(c.fechadaEm) : ''}</span> },
            { titulo: 'Mesa', celula: (c) => <span className="sem-quebra">{nomeDaMesa(c.mesa)}</span> },
            { titulo: 'CPF/CNPJ', celula: (c) => formatarDocumento(c.cpfCnpjCliente) || '—' },
            { titulo: 'Produtos', alinhar: 'direita', celula: (c) => <span className="sem-quebra">{formatarMoeda(c.produtos)}</span> },
            { titulo: 'Serviço', alinhar: 'direita', celula: (c) => <span className="sem-quebra">{formatarMoeda(c.servico)}</span> },
            { titulo: 'Total', alinhar: 'direita', celula: (c) => <strong className="sem-quebra">{formatarMoeda(c.total)}</strong> },
            {
              titulo: 'Nota',
              celula: (c) =>
                ocupada === c.id ? (
                  'Enviando...'
                ) : c.nota ? (
                  <span className="produto-texto">
                    <span>
                      <Selo cor={STATUS_NOTA[c.nota.status].cor}>{STATUS_NOTA[c.nota.status].rotulo}</Selo>
                      {c.nota.numero ? ` nº ${c.nota.numero}` : ''}
                    </span>
                    {c.nota.mensagem && <span className="produto-descricao">{c.nota.mensagem}</span>}
                  </span>
                ) : (
                  <Selo cor="cinza">Sem nota</Selo>
                ),
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (c) => {
                const acoes = acoesDe(c);
                return acoes.length > 0 ? <MenuAcoes rotulo={`Ações da conta ${c.id}`} acoes={acoes} /> : null;
              },
            },
          ]}
        />
      )}
    </>
  );
}

// ---------- Tela ----------

export function NotasFiscais() {
  const config = useDados<FiscalConfigDTO>('/fiscal/configuracao');
  const [aba, setAba] = useState('contas');

  return (
    <Pagina titulo="Notas fiscais">
      {config.erro && <Aviso tipo="erro">{config.erro}</Aviso>}
      {config.carregando && !config.dados && <Carregando />}
      <Abas
        abas={[
          { id: 'contas', rotulo: 'Contas pagas e notas' },
          { id: 'conexao', rotulo: 'Conexão com o emissor' },
        ]}
        ativa={aba}
        aoMudar={setAba}
      />
      {config.dados &&
        (aba === 'contas' ? (
          <ContasPagas ativo={config.dados.provedor !== 'NENHUM'} />
        ) : (
          <Conexao key={config.dados.provedor} config={config.dados} aoSalvo={config.recarregar} />
        ))}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/notas',
    rotulo: 'Notas fiscais',
    icone: 'documento',
    perfis: ['GESTOR'],
    elemento: <NotasFiscais />,
    ordem: 31,
  },
];
