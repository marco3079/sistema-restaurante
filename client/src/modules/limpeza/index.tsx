import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { useAtualizacao } from '../../lib/useAtualizacao';
import type { RotaModulo } from '../../lib/rotas';
import { mensagemErro, tempoDesde } from '../../lib/restaurante';
import type { MesaSimplesDTO } from '../../lib/restaurante';
import { Aviso, Botao, Carregando, Pagina, Selo } from '../../ui';
import { Indicador } from '../pedidos/comum';

// Mesas que ficaram vagas e esperam limpeza. Quem limpa marca a mesa como limpa e ela volta a ficar livre.
export function Limpeza() {
  const mesas = useDados<MesaSimplesDTO[]>('/limpeza/mesas');
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<number | null>(null);
  const [agora, setAgora] = useState(() => new Date());

  useAtualizacao(mesas.recarregar, 6000);
  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);

  async function limpa(mesa: MesaSimplesDTO) {
    setErro(null);
    setAviso(null);
    setOcupada(mesa.id);
    try {
      await api.post(`/mesas/${mesa.id}/limpa`);
      setAviso(`Mesa ${mesa.numero} limpa e liberada.`);
      mesas.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupada(null);
    }
  }

  const lista = mesas.dados ?? [];
  const maisAntiga = lista[0];

  return (
    <Pagina titulo="Mesas para limpar">
      {mesas.dados && (
        <div className="resumo">
          <Indicador rotulo="Mesas para limpar" valor={String(lista.length)} cor="laranja" icone="mesas" />
          <Indicador
            rotulo="Maior espera"
            valor={maisAntiga ? tempoDesde(maisAntiga.desde, agora).replace('há ', '') : '—'}
            cor="azul"
            icone="relogio"
          />
        </div>
      )}

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {mesas.erro && <Aviso tipo="erro">{mesas.erro}</Aviso>}
      {mesas.carregando && !mesas.dados && <Carregando />}

      {mesas.dados && lista.length === 0 && (
        <p className="tabela-vazia">Nenhuma mesa para limpar agora. Quando uma mesa ficar vaga, ela aparece aqui.</p>
      )}

      <div className="mesas">
        {lista.map((m) => (
          <article className="mesa mesa-limpeza" key={m.id}>
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
              <Selo cor="amarelo">Aguardando limpeza</Selo>
              <span className="mesa-detalhe">vaga {tempoDesde(m.desde, agora)}</span>
            </div>
            <div className="mesa-acoes">
              <Botao desabilitado={ocupada === m.id} aoClicar={() => void limpa(m)}>
                {ocupada === m.id ? 'Marcando...' : 'Mesa limpa'}
              </Botao>
            </div>
          </article>
        ))}
      </div>
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/limpeza/mesas',
    rotulo: 'Mesas para limpar',
    icone: 'mesas',
    perfis: ['LIMPEZA'],
    elemento: <Limpeza />,
    ordem: 10,
  },
];
