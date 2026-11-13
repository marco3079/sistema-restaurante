import { useState } from 'react';
import { api } from '../lib/api';
import { mensagemErro } from '../lib/restaurante';
import { AreaTexto, Aviso, Botao } from '../ui';
import { Icone } from '../ui/icones';
import { textos } from './textos';
import type { Idioma, Textos } from './textos';
import './cliente.css';

// Cartão "Como foi?": o cliente avalia a comida e o atendimento da conta que acabou de fechar.
// Aparece na aba "Meus pedidos" quando a API diz que há uma conta pendente de avaliação.

export interface ContaPendente {
  contaId: number;
  fechadaEm: string;
}

const NOTAS = [1, 2, 3, 4, 5];

function Estrelas({
  rotulo,
  valor,
  aoMudar,
  t,
}: {
  rotulo: string;
  valor: number;
  aoMudar: (nota: number) => void;
  t: Textos;
}) {
  return (
    <div className="mesa-cli-avaliar-linha">
      <span className="mesa-cli-avaliar-rotulo">{rotulo}</span>
      <div className="mesa-cli-estrelas" role="group" aria-label={rotulo}>
        {NOTAS.map((nota) => (
          <button
            key={nota}
            type="button"
            className={nota <= valor ? 'mesa-cli-estrela mesa-cli-estrela-ativa' : 'mesa-cli-estrela'}
            aria-label={t.estrelaDe(nota)}
            aria-pressed={nota === valor}
            onClick={() => aoMudar(nota)}
          >
            <Icone nome="estrela" tamanho={26} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function Avaliar({
  codigo,
  idioma,
  aoEnviar,
  aoAdiar,
}: {
  codigo: string;
  idioma: Idioma;
  aoEnviar: () => void;
  aoAdiar: () => void;
}) {
  const t = textos(idioma);
  const [notaComida, setNotaComida] = useState(0);
  const [notaAtendimento, setNotaAtendimento] = useState(0);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pronto = notaComida > 0 && notaAtendimento > 0;

  async function enviar() {
    if (!pronto || enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      await api.post(`/cliente/mesas/${encodeURIComponent(codigo)}/avaliacao`, {
        notaComida,
        notaAtendimento,
        comentario: comentario.trim() || undefined,
      });
      aoEnviar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="cartao mesa-cli-avaliar" aria-label={t.comoFoi}>
      <h2 className="mesa-cli-secao-titulo">{t.comoFoi}</h2>
      <p className="mesa-cli-nota">{t.avaliacaoDescricao}</p>
      <Estrelas rotulo={t.notaComida} valor={notaComida} aoMudar={setNotaComida} t={t} />
      <Estrelas rotulo={t.notaAtendimento} valor={notaAtendimento} aoMudar={setNotaAtendimento} t={t} />
      <AreaTexto
        rotulo={t.comentario}
        valor={comentario}
        aoMudar={(v) => setComentario(v.slice(0, 500))}
        linhas={2}
      />
      <p className="mesa-cli-nota">{t.comentarioLimite}</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!pronto && <p className="mesa-cli-nota">{t.avaliacaoFaltaNota}</p>}
      <div className="mesa-cli-avaliar-acoes">
        <Botao variante="texto" aoClicar={aoAdiar}>
          {t.agoraNao}
        </Botao>
        <Botao desabilitado={!pronto || enviando} aoClicar={() => void enviar()}>
          {enviando ? t.enviandoAvaliacao : t.enviarAvaliacao}
        </Botao>
      </div>
    </section>
  );
}
