import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { useAtualizacao } from '../../lib/useAtualizacao';
import type { RotaModulo } from '../../lib/rotas';
import { mensagemErro, tempoDesde } from '../../lib/restaurante';
import type { MesaSimplesDTO } from '../../lib/restaurante';
import { Abas, Aviso, Botao, Campo, Carregando, Pagina, Selo } from '../../ui';
import { Indicador } from '../pedidos/comum';
import { FilaDeEspera } from './Fila';
import { Reservas } from './Reservas';

type Situacao = 'LIVRE' | 'LIMPEZA' | 'OCUPADA';

const GRUPOS: { situacao: Situacao; titulo: string; vazio: string }[] = [
  { situacao: 'LIVRE', titulo: 'Livres', vazio: 'Nenhuma mesa livre agora.' },
  { situacao: 'LIMPEZA', titulo: 'Em limpeza', vazio: 'Nenhuma mesa em limpeza.' },
  { situacao: 'OCUPADA', titulo: 'Ocupadas', vazio: 'Nenhuma mesa ocupada.' },
];

// Mesas para a recepção acomodar os clientes: livres, em limpeza e ocupadas.
// A recepção marca a mesa livre como ocupada quando leva o cliente até ela.
function MesasDaRecepcao() {
  const mesas = useDados<MesaSimplesDTO[]>('/recepcao/mesas');
  const [pessoas, setPessoas] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupando, setOcupando] = useState<number | null>(null);
  const [agora, setAgora] = useState(() => new Date());

  useAtualizacao(mesas.recarregar, 6000);
  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);

  async function ocupar(mesa: MesaSimplesDTO) {
    setErro(null);
    setAviso(null);
    setOcupando(mesa.id);
    try {
      await api.post(`/mesas/${mesa.id}/ocupar`);
      setAviso(`Mesa ${mesa.numero} marcada como ocupada.`);
      mesas.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupando(null);
    }
  }

  const lista = mesas.dados ?? [];
  const minimo = /^\d+$/.test(pessoas.trim()) ? Number(pessoas.trim()) : 0;
  const livres = lista.filter((m) => m.situacao === 'LIVRE');

  return (
    <>
      {mesas.dados && (
        <div className="resumo">
          <Indicador rotulo="Mesas livres" valor={String(livres.length)} cor="verde" icone="mesas" />
          <Indicador
            rotulo="Lugares livres"
            valor={String(livres.reduce((soma, m) => soma + m.lugares, 0))}
            cor="azul"
            icone="grupo"
          />
          <Indicador
            rotulo="Em limpeza"
            valor={String(lista.filter((m) => m.situacao === 'LIMPEZA').length)}
            cor="laranja"
            icone="relogio"
          />
          <Indicador
            rotulo="Ocupadas"
            valor={`${lista.filter((m) => m.situacao === 'OCUPADA').length}/${lista.length}`}
            cor="roxo"
            icone="pedidos"
          />
        </div>
      )}

      <div className="barra-ferramentas">
        <div className="filtros">
          <Campo rotulo="Quantas pessoas? (mostra as mesas que cabem)" tipo="number" valor={pessoas} aoMudar={setPessoas} />
        </div>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {mesas.erro && <Aviso tipo="erro">{mesas.erro}</Aviso>}
      {mesas.carregando && !mesas.dados && <Carregando />}

      {mesas.dados &&
        GRUPOS.map((grupo) => {
          const doGrupo = lista
            .filter((m) => m.situacao === grupo.situacao)
            .filter((m) => grupo.situacao !== 'LIVRE' || m.lugares >= minimo)
            .sort((a, b) => (grupo.situacao === 'LIVRE' ? a.lugares - b.lugares || a.numero - b.numero : a.numero - b.numero));
          return (
            <section key={grupo.situacao} className="recepcao-grupo" aria-label={grupo.titulo}>
              <h2 className="recepcao-titulo">
                {grupo.titulo}
                <span className="fila-contagem">{doGrupo.length}</span>
              </h2>
              {doGrupo.length === 0 && (
                <p className="fila-vazia">
                  {grupo.situacao === 'LIVRE' && minimo > 0 && livres.length > 0
                    ? `Nenhuma mesa livre para ${minimo} pessoas.`
                    : grupo.vazio}
                </p>
              )}
              <div className="mesas">
                {doGrupo.map((m) => (
                  <article
                    key={m.id}
                    className={
                      grupo.situacao === 'OCUPADA'
                        ? 'mesa mesa-ocupada'
                        : grupo.situacao === 'LIMPEZA'
                          ? 'mesa mesa-limpeza'
                          : 'mesa'
                    }
                  >
                    <div className="mesa-identidade">
                      <span className="mesa-numero">{m.numero}</span>
                      <div>
                        <span className="mesa-nome">{m.nome ?? `Mesa ${m.numero}`}</span>
                        <span className="mesa-detalhe">
                          {m.lugares} lugares{m.area ? ` · ${m.area.nome}` : ''}
                        </span>
                      </div>
                    </div>
                    <div className="mesa-linha">
                      {grupo.situacao === 'LIVRE' && <Selo cor="verde">Livre</Selo>}
                      {grupo.situacao === 'LIMPEZA' && <Selo cor="amarelo">Em limpeza</Selo>}
                      {grupo.situacao === 'OCUPADA' && <Selo cor="azul">Ocupada</Selo>}
                      {grupo.situacao !== 'LIVRE' && m.desde && (
                        <span className="mesa-detalhe">{tempoDesde(m.desde, agora)}</span>
                      )}
                    </div>
                    {grupo.situacao === 'LIVRE' && (
                      <div className="mesa-acoes">
                        <Botao desabilitado={ocupando === m.id} aoClicar={() => void ocupar(m)}>
                          {ocupando === m.id ? 'Marcando...' : 'Ocupar mesa'}
                        </Botao>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          );
        })}
    </>
  );
}

const ABAS = [
  { id: 'mesas', rotulo: 'Mesas' },
  { id: 'fila', rotulo: 'Fila de espera' },
  { id: 'reservas', rotulo: 'Reservas' },
];

// Recepção: mesas, fila de espera e reservas.
export function Recepcao() {
  const [aba, setAba] = useState('mesas');
  return (
    <Pagina titulo="Recepção">
      <Abas abas={ABAS} ativa={aba} aoMudar={setAba} />
      {aba === 'mesas' && <MesasDaRecepcao />}
      {aba === 'fila' && <FilaDeEspera />}
      {aba === 'reservas' && <Reservas />}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/recepcao/mesas',
    rotulo: 'Recepção',
    icone: 'mesas',
    perfis: ['RECEPCAO'],
    elemento: <Recepcao />,
    ordem: 10,
  },
  {
    caminho: '/gestor/recepcao',
    rotulo: 'Fila e reservas',
    icone: 'calendario',
    perfis: ['GESTOR'],
    elemento: <Recepcao />,
    ordem: 14,
  },
];
