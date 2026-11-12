import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { horaCurta, mensagemErro, nomeDaMesa } from '../../lib/restaurante';
import type { MesaSimplesDTO, ReservaDTO } from '../../lib/restaurante';
import { Aviso, Botao, Campo, Carregando, MenuAcoes, Modal, Selecao, Selo, Tabela } from '../../ui';
import { Indicador } from '../pedidos/comum';
import { EscolherMesa } from './Fila';

const ROTULO: Record<ReservaDTO['status'], { rotulo: string; cor: 'azul' | 'verde' | 'cinza' | 'vermelho' }> = {
  ATIVA: { rotulo: 'Aguardando', cor: 'azul' },
  CHEGOU: { rotulo: 'Chegou', cor: 'verde' },
  CANCELADA: { rotulo: 'Cancelada', cor: 'cinza' },
  NAO_COMPARECEU: { rotulo: 'Não veio', cor: 'vermelho' },
};

// "2026-11-12" no fuso do navegador.
function diaLocal(data: Date): string {
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}`;
}

function FormReserva({
  reserva,
  dia,
  aoFechar,
  aoSalvo,
}: {
  reserva: ReservaDTO | null;
  dia: string;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const mesas = useDados<MesaSimplesDTO[]>('/recepcao/mesas');
  const inicial = reserva ? new Date(reserva.dataHora) : null;
  const [nome, setNome] = useState(reserva?.nome ?? '');
  const [pessoas, setPessoas] = useState(String(reserva?.pessoas ?? 2));
  const [telefone, setTelefone] = useState(reserva?.telefone ?? '');
  const [data, setData] = useState(inicial ? diaLocal(inicial) : dia);
  const [hora, setHora] = useState(inicial ? horaCurta(reserva!.dataHora) : '20:00');
  const [mesaId, setMesaId] = useState(reserva?.mesaId ? String(reserva.mesaId) : '');
  const [observacao, setObservacao] = useState(reserva?.observacao ?? '');
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
    const quando = new Date(`${data}T${hora}:00`);
    if (Number.isNaN(quando.getTime())) {
      setErro('Informe a data e a hora da reserva.');
      return;
    }
    setEnviando(true);
    try {
      const corpo = {
        nome: nome.trim(),
        pessoas: n,
        telefone: telefone.trim() || null,
        observacao: observacao.trim() || null,
        dataHora: quando.toISOString(),
        mesaId: mesaId ? Number(mesaId) : null,
      };
      if (reserva) {
        await api.put(`/reservas/${reserva.id}`, corpo);
        aoSalvo('Reserva atualizada.');
      } else {
        await api.post('/reservas', corpo);
        aoSalvo(`Reserva de ${nome.trim()} criada.`);
      }
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={reserva ? 'Editar reserva' : 'Nova reserva'} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
        <Campo rotulo="Quantas pessoas" tipo="number" valor={pessoas} aoMudar={setPessoas} obrigatorio />
        <div className="ficha-grade">
          <Campo rotulo="Data" tipo="date" valor={data} aoMudar={setData} obrigatorio />
          <Campo rotulo="Hora" tipo="time" valor={hora} aoMudar={setHora} obrigatorio />
        </div>
        <Selecao
          rotulo="Mesa (opcional)"
          valor={mesaId}
          aoMudar={setMesaId}
          vazio="Escolher na chegada"
          opcoes={(mesas.dados ?? [])
            .slice()
            .sort((a, b) => a.numero - b.numero)
            .map((m) => ({ valor: String(m.id), rotulo: `${nomeDaMesa(m)} · ${m.lugares} lugares` }))}
        />
        <Campo rotulo="Telefone (opcional)" valor={telefone} aoMudar={setTelefone} />
        <Campo rotulo="Observação (opcional)" valor={observacao} aoMudar={setObservacao} />
        <Botao tipo="submit" desabilitado={enviando}>
          Salvar
        </Botao>{' '}
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </form>
    </Modal>
  );
}

// Reservas por dia. Quando o cliente chega, a recepção escolhe a mesa e ela fica ocupada.
export function Reservas() {
  const [dia, setDia] = useState(() => diaLocal(new Date()));
  const reservas = useDados<ReservaDTO[]>(`/reservas?dia=${dia}`);
  const [form, setForm] = useState<{ reserva: ReservaDTO | null } | null>(null);
  const [chegou, setChegou] = useState<ReservaDTO | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function mudar(r: ReservaDTO, status: ReservaDTO['status'], mensagem: string) {
    setErro(null);
    setAviso(null);
    try {
      await api.put(`/reservas/${r.id}/status`, { status });
      setAviso(mensagem);
      reservas.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  const lista = reservas.dados ?? [];
  const ativas = lista.filter((r) => r.status === 'ATIVA');

  return (
    <>
      {reservas.dados && (
        <div className="resumo">
          <Indicador rotulo="Reservas aguardando" valor={String(ativas.length)} cor="azul" icone="calendario" />
          <Indicador
            rotulo="Pessoas esperadas"
            valor={String(ativas.reduce((soma, r) => soma + r.pessoas, 0))}
            cor="roxo"
            icone="grupo"
          />
          <Indicador
            rotulo="Já chegaram"
            valor={String(lista.filter((r) => r.status === 'CHEGOU').length)}
            cor="verde"
            icone="visto"
          />
        </div>
      )}

      <div className="barra-ferramentas">
        <div className="filtros">
          <Campo rotulo="Dia" tipo="date" valor={dia} aoMudar={(v) => v && setDia(v)} />
        </div>
        <Botao aoClicar={() => setForm({ reserva: null })}>Nova reserva</Botao>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {reservas.erro && <Aviso tipo="erro">{reservas.erro}</Aviso>}
      {reservas.carregando && !reservas.dados && <Carregando />}

      {reservas.dados && (
        <Tabela
          dados={lista}
          chave={(r) => r.id}
          vazio="Nenhuma reserva neste dia."
          colunas={[
            { titulo: 'Hora', celula: (r) => <strong className="sem-quebra">{horaCurta(r.dataHora)}</strong> },
            {
              titulo: 'Nome',
              celula: (r) => (
                <span className="produto-texto">
                  <span className="produto-nome">{r.nome}</span>
                  {(r.telefone || r.observacao) && (
                    <span className="produto-descricao">{[r.telefone, r.observacao].filter(Boolean).join(' · ')}</span>
                  )}
                </span>
              ),
            },
            { titulo: 'Pessoas', alinhar: 'direita', celula: (r) => String(r.pessoas) },
            { titulo: 'Mesa', celula: (r) => (r.mesa ? nomeDaMesa(r.mesa) : 'A escolher') },
            { titulo: 'Situação', celula: (r) => <Selo cor={ROTULO[r.status].cor}>{ROTULO[r.status].rotulo}</Selo> },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (r) =>
                r.status !== 'ATIVA' ? null : (
                  <MenuAcoes
                    rotulo={`Ações da reserva de ${r.nome}`}
                    acoes={[
                      { rotulo: 'Cliente chegou', icone: 'visto', aoClicar: () => setChegou(r) },
                      { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setForm({ reserva: r }) },
                      {
                        rotulo: 'Não veio',
                        icone: 'relogio',
                        aoClicar: () => void mudar(r, 'NAO_COMPARECEU', `Reserva de ${r.nome} marcada como "não veio".`),
                      },
                      {
                        rotulo: 'Cancelar reserva',
                        icone: 'fechar',
                        perigo: true,
                        aoClicar: () => {
                          if (!window.confirm(`Cancelar a reserva de ${r.nome}?`)) return;
                          void mudar(r, 'CANCELADA', `Reserva de ${r.nome} cancelada.`);
                        },
                      },
                    ]}
                  />
                ),
            },
          ]}
        />
      )}

      {form && (
        <FormReserva
          reserva={form.reserva}
          dia={dia}
          aoFechar={() => setForm(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            reservas.recarregar();
          }}
        />
      )}
      {chegou && (
        <EscolherMesa
          titulo={`Acomodar ${chegou.nome}`}
          pessoas={chegou.pessoas}
          mesaSugerida={chegou.mesaId}
          aoFechar={() => setChegou(null)}
          aoEscolher={async (mesaId) => {
            await api.put(`/reservas/${chegou.id}/status`, { status: 'CHEGOU', mesaId });
            setAviso(`${chegou.nome} chegou e foi acomodado.`);
            reservas.recarregar();
          }}
        />
      )}
    </>
  );
}
