import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { useAtualizacao } from '../../lib/useAtualizacao';
import { mensagemErro, nomeDaMesa, tempoDesde } from '../../lib/restaurante';
import type { EsperaDTO, FilaDTO, MesaSimplesDTO } from '../../lib/restaurante';
import { Aviso, Botao, Campo, Carregando, Modal, Selecao, Selo } from '../../ui';
import { Indicador } from '../pedidos/comum';

// Mesas livres em que o grupo cabe, da menor para a maior.
function mesasParaOGrupo(mesas: MesaSimplesDTO[], pessoas: number): MesaSimplesDTO[] {
  return mesas
    .filter((m) => m.situacao === 'LIVRE')
    .sort((a, b) => Number(a.lugares < pessoas) - Number(b.lugares < pessoas) || a.lugares - b.lugares || a.numero - b.numero);
}

function NovaEspera({ aoFechar, aoSalvo }: { aoFechar: () => void; aoSalvo: (mensagem: string) => void }) {
  const [nome, setNome] = useState('');
  const [pessoas, setPessoas] = useState('2');
  const [telefone, setTelefone] = useState('');
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const n = Number(pessoas);
    if (!Number.isInteger(n) || n < 1) {
      setErro('Informe quantas pessoas são.');
      return;
    }
    setEnviando(true);
    try {
      await api.post('/espera', {
        nome: nome.trim(),
        pessoas: n,
        telefone: telefone.trim() || null,
        observacao: observacao.trim() || null,
      });
      aoSalvo(`${nome.trim()} entrou na fila.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo="Colocar na fila de espera" aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
        <Campo rotulo="Quantas pessoas" tipo="number" valor={pessoas} aoMudar={setPessoas} obrigatorio />
        <Campo rotulo="Telefone (opcional)" valor={telefone} aoMudar={setTelefone} />
        <Campo rotulo="Observação (opcional): cadeirinha, área externa..." valor={observacao} aoMudar={setObservacao} />
        <Botao tipo="submit" desabilitado={enviando}>
          Colocar na fila
        </Botao>{' '}
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </form>
    </Modal>
  );
}

// Escolhe a mesa para acomodar quem estava esperando (ou chegou com reserva).
export function EscolherMesa({
  titulo,
  pessoas,
  mesaSugerida,
  aoFechar,
  aoEscolher,
}: {
  titulo: string;
  pessoas: number;
  mesaSugerida?: number | null;
  aoFechar: () => void;
  aoEscolher: (mesaId: number) => Promise<void>;
}) {
  const mesas = useDados<MesaSimplesDTO[]>('/recepcao/mesas');
  const [mesaId, setMesaId] = useState(mesaSugerida ? String(mesaSugerida) : '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const livres = mesasParaOGrupo(mesas.dados ?? [], pessoas);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!mesaId) {
      setErro('Escolha a mesa.');
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      await aoEscolher(Number(mesaId));
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={titulo} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {mesas.erro && <Aviso tipo="erro">{mesas.erro}</Aviso>}
        {mesas.carregando && !mesas.dados && <Carregando />}
        {mesas.dados && livres.length === 0 && (
          <Aviso tipo="info">Nenhuma mesa livre agora. Assim que uma for limpa, ela aparece aqui.</Aviso>
        )}
        <Selecao
          rotulo={`Mesa livre (grupo de ${pessoas})`}
          valor={mesaId}
          aoMudar={setMesaId}
          obrigatorio
          opcoes={livres.map((m) => ({
            valor: String(m.id),
            rotulo: `${nomeDaMesa(m)} · ${m.lugares} lugares${m.lugares < pessoas ? ' (pequena para o grupo)' : ''}`,
          }))}
        />
        <Botao tipo="submit" desabilitado={enviando || livres.length === 0}>
          Acomodar
        </Botao>{' '}
        <Botao variante="secundario" aoClicar={aoFechar}>
          Voltar
        </Botao>
      </form>
    </Modal>
  );
}

// Fila de espera: quem chegou e aguarda mesa, por ordem de chegada.
export function FilaDeEspera() {
  const fila = useDados<FilaDTO>('/espera');
  const [novo, setNovo] = useState(false);
  const [acomodando, setAcomodando] = useState<EsperaDTO | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => new Date());

  useAtualizacao(fila.recarregar, 8000);
  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);

  async function mudar(espera: EsperaDTO, status: EsperaDTO['status'], mensagem: string) {
    setErro(null);
    setAviso(null);
    try {
      await api.put(`/espera/${espera.id}/status`, { status });
      setAviso(mensagem);
      fila.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  const lista = fila.dados?.fila ?? [];
  const pessoas = lista.reduce((soma, e) => soma + e.pessoas, 0);

  return (
    <>
      {fila.dados && (
        <div className="resumo">
          <Indicador rotulo="Grupos esperando" valor={String(lista.length)} cor="azul" icone="lista" />
          <Indicador rotulo="Pessoas esperando" valor={String(pessoas)} cor="roxo" icone="grupo" />
          <Indicador
            rotulo="Espera média de hoje"
            valor={fila.dados.esperaMediaMin === null ? '—' : `${fila.dados.esperaMediaMin} min`}
            cor="laranja"
            icone="relogio"
          />
          <Indicador rotulo="Acomodados hoje" valor={String(fila.dados.acomodadosHoje)} cor="verde" icone="visto" />
        </div>
      )}

      <div className="pagina-acoes">
        <Botao aoClicar={() => setNovo(true)}>Colocar na fila</Botao>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {fila.erro && <Aviso tipo="erro">{fila.erro}</Aviso>}
      {fila.carregando && !fila.dados && <Carregando />}
      {fila.dados && lista.length === 0 && <p className="tabela-vazia">Ninguém na fila de espera.</p>}

      <ol className="espera-lista">
        {lista.map((e, i) => (
          <li key={e.id} className={e.status === 'CHAMADO' ? 'espera-item espera-chamado' : 'espera-item'}>
            <span className="espera-posicao">{i + 1}</span>
            <div className="espera-texto">
              <strong>{e.nome}</strong>
              <span>
                {e.pessoas} {e.pessoas === 1 ? 'pessoa' : 'pessoas'} · chegou {tempoDesde(e.criadoEm, agora)}
                {e.telefone ? ` · ${e.telefone}` : ''}
              </span>
              {e.observacao && <span>{e.observacao}</span>}
            </div>
            {e.status === 'CHAMADO' && <Selo cor="amarelo">Chamado</Selo>}
            <div className="espera-acoes">
              {e.status === 'AGUARDANDO' && (
                <Botao variante="secundario" aoClicar={() => void mudar(e, 'CHAMADO', `${e.nome} foi chamado.`)}>
                  Chamar
                </Botao>
              )}
              <Botao aoClicar={() => setAcomodando(e)}>Acomodar</Botao>
              <Botao variante="texto" aoClicar={() => void mudar(e, 'DESISTIU', `${e.nome} saiu da fila.`)}>
                Desistiu
              </Botao>
            </div>
          </li>
        ))}
      </ol>

      {novo && (
        <NovaEspera
          aoFechar={() => setNovo(false)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            fila.recarregar();
          }}
        />
      )}
      {acomodando && (
        <EscolherMesa
          titulo={`Acomodar ${acomodando.nome}`}
          pessoas={acomodando.pessoas}
          aoFechar={() => setAcomodando(null)}
          aoEscolher={async (mesaId) => {
            await api.put(`/espera/${acomodando.id}/status`, { status: 'ACOMODADO', mesaId });
            setAviso(`${acomodando.nome} foi acomodado.`);
            fila.recarregar();
          }}
        />
      )}
    </>
  );
}
