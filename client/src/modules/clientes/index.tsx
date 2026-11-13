import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import type { RotaModulo } from '../../lib/rotas';
import { mensagemErro } from '../../lib/restaurante';
import type { ClienteDetalheDTO, ClienteDTO, FidelidadeDTO } from '../../lib/clientes';
import {
  Abas,
  Aviso,
  Botao,
  Caixa,
  Campo,
  Carregando,
  MenuAcoes,
  Modal,
  Pagina,
  Tabela,
  formatarData,
  formatarDataHora,
  formatarMoeda,
} from '../../ui';
import { Indicador } from '../pedidos/comum';
import './clientes.css';

// Telefone com DDD: (11) 99999-0000 ou (11) 9999-0000. O que não for telefone aparece como foi gravado.
function formatarTelefone(telefone: string): string {
  const digitos = telefone.replace(/\D/g, '');
  if (digitos.length === 11) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  if (digitos.length === 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  return telefone;
}

// Número digitado com ponto ou vírgula decimal, com até 4 casas. Null se não for um número válido.
function lerDecimal(texto: string): number | null {
  const limpo = texto.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,4})?$/.test(limpo)) return null;
  return Number(limpo);
}

function numeroParaCampo(valor: number, casas: number): string {
  return valor.toFixed(casas).replace('.', ',');
}

// Ficha do cliente: dados da lista e, para o gestor, o extrato de pontos e as últimas contas.
function FichaCliente({ cliente, gestor, aoFechar }: { cliente: ClienteDTO; gestor: boolean; aoFechar: () => void }) {
  const detalhe = useDados<ClienteDetalheDTO>(gestor ? `/clientes/${cliente.id}` : null);
  const ficha = detalhe.dados;

  return (
    <Modal aberto titulo={cliente.nome} aoFechar={aoFechar}>
      <div className="clientes-ficha">
        <p>Telefone: {formatarTelefone(cliente.telefone)}</p>
        {cliente.email && <p>E-mail: {cliente.email}</p>}
        {cliente.nascimento && <p>Nascimento: {formatarData(cliente.nascimento)}</p>}
        <p>Pontos: {cliente.pontos}</p>
        <p>Visitas: {cliente.visitas}</p>
        <p>Última visita: {cliente.ultimaVisita ? formatarData(cliente.ultimaVisita) : 'Nenhuma ainda'}</p>
        {gestor && <p>Total gasto: {formatarMoeda(cliente.totalGasto)}</p>}
        {cliente.observacao && <p>Observação: {cliente.observacao}</p>}
      </div>

      {gestor && (
        <>
          {detalhe.erro && <Aviso tipo="erro">{detalhe.erro}</Aviso>}
          {detalhe.carregando && !ficha && <Carregando />}
          {ficha && (
            <>
              <h3 className="clientes-secao">Extrato de pontos</h3>
              {ficha.movimentos.length === 0 ? (
                <p>Nenhum movimento de pontos ainda.</p>
              ) : (
                <ul className="clientes-extrato">
                  {ficha.movimentos.map((m) => (
                    <li key={m.id}>
                      <span className="clientes-extrato-texto">
                        {formatarDataHora(m.criadoEm)} · {m.motivo}
                      </span>
                      <strong className={m.pontos > 0 ? 'clientes-ganho' : 'clientes-uso'}>
                        {m.pontos > 0 ? `+${m.pontos}` : `−${Math.abs(m.pontos)}`}
                      </strong>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="clientes-secao">Últimas contas</h3>
              {ficha.contas.length === 0 ? (
                <p>Nenhuma conta fechada ainda.</p>
              ) : (
                <ul className="clientes-extrato">
                  {ficha.contas.map((c) => (
                    <li key={c.id}>
                      <span className="clientes-extrato-texto">
                        Conta #{c.id}
                        {c.fechadaEm ? ` · ${formatarDataHora(c.fechadaEm)}` : ''}
                      </span>
                      <strong>{formatarMoeda(c.total)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}

// Cadastro novo (cliente nulo) ou edição de um cliente.
function FormularioCliente({
  cliente,
  aoFechar,
  aoSalvo,
}: {
  cliente: ClienteDTO | null;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState(cliente?.nome ?? '');
  const [telefone, setTelefone] = useState(cliente ? formatarTelefone(cliente.telefone) : '');
  const [email, setEmail] = useState(cliente?.email ?? '');
  const [nascimento, setNascimento] = useState(cliente?.nascimento ?? '');
  const [observacao, setObservacao] = useState(cliente?.observacao ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const digitos = telefone.replace(/\D/g, '');
    if (digitos.length !== 10 && digitos.length !== 11) {
      setErro('Informe o telefone com DDD (10 ou 11 dígitos).');
      return;
    }
    const corpo = {
      nome: nome.trim(),
      telefone: digitos,
      email: email.trim() || null,
      nascimento: nascimento || null,
      observacao: observacao.trim() || null,
    };
    setEnviando(true);
    try {
      if (cliente) {
        await api.put(`/clientes/${cliente.id}`, corpo);
        aoSalvo(`${corpo.nome} atualizado.`);
      } else {
        await api.post('/clientes', corpo);
        aoSalvo(`${corpo.nome} cadastrado.`);
      }
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={cliente ? 'Editar cliente' : 'Novo cliente'} aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
        <Campo rotulo="Telefone (com DDD)" valor={telefone} aoMudar={setTelefone} obrigatorio />
        <Campo rotulo="E-mail" tipo="email" valor={email} aoMudar={setEmail} />
        <Campo rotulo="Nascimento" tipo="date" valor={nascimento} aoMudar={setNascimento} />
        <Campo rotulo="Observação" valor={observacao} aoMudar={setObservacao} />
        <Botao tipo="submit" desabilitado={enviando}>
          {enviando ? 'Salvando...' : 'Salvar'}
        </Botao>{' '}
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </form>
    </Modal>
  );
}

// Soma (ou tira) pontos do cliente. O saldo não pode ficar negativo.
function AjustePontos({
  cliente,
  aoFechar,
  aoSalvo,
}: {
  cliente: ClienteDTO;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [pontos, setPontos] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const quantidade = Number(pontos);
    if (pontos.trim() === '' || !Number.isInteger(quantidade) || quantidade === 0) {
      setErro('Informe uma quantidade de pontos diferente de zero. Use o sinal de menos para tirar pontos.');
      return;
    }
    if (motivo.trim() === '') {
      setErro('Informe o motivo do ajuste.');
      return;
    }
    setEnviando(true);
    try {
      const atualizado = await api.post<ClienteDTO>(`/clientes/${cliente.id}/pontos`, {
        pontos: quantidade,
        motivo: motivo.trim(),
      });
      aoSalvo(`${atualizado.nome}: saldo de ${atualizado.pontos} pontos.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={`Ajustar pontos · ${cliente.nome}`} aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        <p>Saldo atual: {cliente.pontos} pontos</p>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Pontos (use - para tirar)" tipo="number" valor={pontos} aoMudar={setPontos} obrigatorio />
        <Campo rotulo="Motivo" valor={motivo} aoMudar={setMotivo} obrigatorio />
        <Botao tipo="submit" desabilitado={enviando}>
          Lançar
        </Botao>{' '}
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </form>
    </Modal>
  );
}

// Lista de clientes com busca, indicadores e ações.
function ListaClientes({ gestor }: { gestor: boolean }) {
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<ClienteDTO | 'novo' | null>(null);
  const [ver, setVer] = useState<ClienteDTO | null>(null);
  const [ajustando, setAjustando] = useState<ClienteDTO | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const clientes = useDados<ClienteDTO[]>(`/clientes?busca=${encodeURIComponent(busca)}`);

  // A busca espera 300 ms depois da última tecla.
  useEffect(() => {
    const atraso = window.setTimeout(() => setBusca(texto.trim()), 300);
    return () => window.clearTimeout(atraso);
  }, [texto]);

  const lista = clientes.dados ?? [];

  async function excluir(cliente: ClienteDTO) {
    if (!window.confirm(`Excluir o cliente ${cliente.nome}? Os pontos dele somem e esta ação não tem volta.`)) {
      return;
    }
    setErro(null);
    setAviso(null);
    try {
      await api.del(`/clientes/${cliente.id}`);
      setAviso(`${cliente.nome} foi excluído.`);
      clientes.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  return (
    <>
      {clientes.dados && (
        <div className="resumo">
          <Indicador rotulo="Clientes" valor={String(lista.length)} cor="azul" icone="grupo" />
          <Indicador
            rotulo="Com pontos"
            valor={String(lista.filter((c) => c.pontos > 0).length)}
            cor="verde"
            icone="medalha"
          />
          <Indicador
            rotulo="Pontos em aberto"
            valor={String(lista.reduce((soma, c) => soma + c.pontos, 0))}
            cor="roxo"
            icone="estrela"
          />
        </div>
      )}

      <div className="clientes-barra">
        <div className="clientes-busca">
          <Campo rotulo="Buscar por nome ou telefone" valor={texto} aoMudar={setTexto} />
        </div>
        <Botao aoClicar={() => setEditando('novo')}>Novo cliente</Botao>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {clientes.erro && <Aviso tipo="erro">{clientes.erro}</Aviso>}
      {clientes.carregando && !clientes.dados && <Carregando />}

      {clientes.dados && (
        <Tabela
          dados={lista}
          chave={(c) => c.id}
          vazio={busca ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}
          colunas={[
            { titulo: 'Nome', celula: (c) => <strong>{c.nome}</strong> },
            { titulo: 'Telefone', celula: (c) => <span className="sem-quebra">{formatarTelefone(c.telefone)}</span> },
            { titulo: 'Pontos', alinhar: 'direita', celula: (c) => String(c.pontos) },
            { titulo: 'Visitas', alinhar: 'direita', celula: (c) => String(c.visitas) },
            { titulo: 'Última visita', celula: (c) => (c.ultimaVisita ? formatarData(c.ultimaVisita) : '—') },
            ...(gestor
              ? [
                  {
                    titulo: 'Total gasto',
                    alinhar: 'direita' as const,
                    celula: (c: ClienteDTO) => formatarMoeda(c.totalGasto),
                  },
                ]
              : []),
            {
              titulo: 'Ações',
              acoes: true,
              celula: (c: ClienteDTO) => (
                <MenuAcoes
                  rotulo={`Ações de ${c.nome}`}
                  acoes={[
                    { rotulo: 'Ver', icone: 'busca', aoClicar: () => setVer(c) },
                    { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setEditando(c) },
                    ...(gestor
                      ? [
                          { rotulo: 'Ajustar pontos', icone: 'medalha' as const, aoClicar: () => setAjustando(c) },
                          {
                            rotulo: 'Excluir',
                            icone: 'lixeira' as const,
                            perigo: true,
                            aoClicar: () => excluir(c),
                          },
                        ]
                      : []),
                  ]}
                />
              ),
            },
          ]}
        />
      )}

      {ver && <FichaCliente cliente={ver} gestor={gestor} aoFechar={() => setVer(null)} />}
      {editando !== null && (
        <FormularioCliente
          cliente={editando === 'novo' ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            clientes.recarregar();
          }}
        />
      )}
      {ajustando && (
        <AjustePontos
          cliente={ajustando}
          aoFechar={() => setAjustando(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            clientes.recarregar();
          }}
        />
      )}
    </>
  );
}

// Programa de fidelidade: ligado ou não, pontos por real e valor de cada ponto (só o gestor).
function Fidelidade() {
  const config = useDados<FidelidadeDTO>('/fidelidade/configuracao');
  const [ativa, setAtiva] = useState(false);
  const [porReal, setPorReal] = useState('');
  const [valorPonto, setValorPonto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Quando a configuração chega (ou é recarregada), preenche o formulário.
  useEffect(() => {
    if (!config.dados) return;
    setAtiva(config.dados.ativa);
    setPorReal(numeroParaCampo(config.dados.pontosPorReal, 2));
    setValorPonto(numeroParaCampo(config.dados.valorDoPonto, 4));
  }, [config.dados]);

  // Exemplo ao vivo com uma conta de R$ 100,00, do mesmo jeito que o servidor calcula.
  const pontosPorReal = lerDecimal(porReal);
  const valorDoPonto = lerDecimal(valorPonto);
  const pontosExemplo = pontosPorReal === null ? null : Math.floor(100 * pontosPorReal);
  const descontoExemplo = pontosExemplo === null || valorDoPonto === null ? null : pontosExemplo * valorDoPonto;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setAviso(null);
    if (pontosPorReal === null || pontosPorReal < 0.01 || pontosPorReal > 100) {
      setErro('Informe quantos pontos o cliente ganha por real (de 0,01 a 100).');
      return;
    }
    if (valorDoPonto === null || valorDoPonto < 0.0001 || valorDoPonto > 100) {
      setErro('Informe quanto vale cada ponto (de R$ 0,0001 a R$ 100).');
      return;
    }
    setEnviando(true);
    try {
      await api.put('/fidelidade/configuracao', { ativa, pontosPorReal, valorDoPonto });
      setAviso('Programa de fidelidade gravado.');
      config.recarregar();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={salvar} className="clientes-fidelidade">
      {config.erro && <Aviso tipo="erro">{config.erro}</Aviso>}
      {config.carregando && !config.dados && <Carregando />}
      {config.dados && (
        <>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
          <Caixa rotulo="Programa ligado" marcado={ativa} aoMudar={setAtiva} />
          <Campo rotulo="Pontos ganhos por real gasto" valor={porReal} aoMudar={setPorReal} obrigatorio />
          <Campo rotulo="Quanto vale cada ponto (R$)" valor={valorPonto} aoMudar={setValorPonto} obrigatorio />
          <p className="clientes-exemplo">
            {pontosExemplo === null || descontoExemplo === null
              ? 'Preencha os valores para ver o exemplo.'
              : `Uma conta de R$ 100,00 rende ${pontosExemplo} pontos, que valem ${formatarMoeda(descontoExemplo)} de desconto.`}
          </p>
          <p className="clientes-texto">
            Os pontos entram quando a conta é paga, para o cliente ligado à conta. O garçom liga o cliente e usa os
            pontos na tela da conta.
          </p>
          <div className="pagina-acoes">
            <Botao tipo="submit" desabilitado={enviando}>
              {enviando ? 'Salvando...' : 'Salvar'}
            </Botao>
          </div>
        </>
      )}
    </form>
  );
}

// Clientes e fidelidade. Recepção vê a lista; o gestor também vê o programa de fidelidade.
export function Clientes() {
  const { usuario } = useAuth();
  const gestor = usuario?.perfil === 'GESTOR';
  const [aba, setAba] = useState('clientes');

  return (
    <Pagina titulo="Clientes e fidelidade">
      {gestor && (
        <Abas
          abas={[
            { id: 'clientes', rotulo: 'Clientes' },
            { id: 'fidelidade', rotulo: 'Programa de fidelidade' },
          ]}
          ativa={aba}
          aoMudar={setAba}
        />
      )}
      {gestor && aba === 'fidelidade' ? <Fidelidade /> : <ListaClientes gestor={gestor} />}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/clientes',
    rotulo: 'Clientes',
    icone: 'grupo',
    perfis: ['GESTOR'],
    elemento: <Clientes />,
    ordem: 16,
    grupo: 'Atendimento',
  },
  {
    caminho: '/recepcao/clientes',
    rotulo: 'Clientes',
    icone: 'grupo',
    perfis: ['RECEPCAO'],
    elemento: <Clientes />,
    ordem: 16,
    grupo: 'Atendimento',
  },
];
