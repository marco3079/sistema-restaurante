import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { useAtualizacao } from '../../lib/useAtualizacao';
import type { RotaModulo } from '../../lib/rotas';
import { mensagemErro, nomeDaMesa } from '../../lib/restaurante';
import type { AreaDTO, MesaDTO, PlantaDTO } from '../../lib/restaurante';
import { Aviso, Botao, Caixa, Campo, Carregando, Cartao, MenuAcoes, Modal, Pagina, Selo, formatarMoeda } from '../../ui';
import { Icone } from '../../ui/icones';
import './salao.css';

type Modo = 'ver' | 'mesas' | 'areas';

interface GarcomLista {
  id: number;
  nome: string;
  ativo: boolean;
}

const MODOS: { id: Modo; rotulo: string }[] = [
  { id: 'ver', rotulo: 'Ver o salão' },
  { id: 'mesas', rotulo: 'Posicionar mesas' },
  { id: 'areas', rotulo: 'Desenhar áreas' },
];

const CORES = ['#2563eb', '#7c3aed', '#10b981', '#f59e0b', '#dc2626', '#0891b2', '#db2777', '#65a30d'];
const LADO_MAXIMO = 1600;
const LIMITE_PLANTA = 900_000;

const limitar = (valor: number) => Math.min(1, Math.max(0, valor));

// Reduz a planta no navegador até caber no limite da API e devolve o data URL com as medidas.
function reduzirPlanta(arquivo: File): Promise<{ imagem: string; largura: number; altura: number }> {
  return new Promise((resolve, reject) => {
    const endereco = URL.createObjectURL(arquivo);
    const imagem = new Image();
    imagem.onload = () => {
      URL.revokeObjectURL(endereco);
      for (const lado of [LADO_MAXIMO, 1280, 1000, 800]) {
        const escala = Math.min(1, lado / Math.max(imagem.width, imagem.height));
        const tela = document.createElement('canvas');
        tela.width = Math.max(1, Math.round(imagem.width * escala));
        tela.height = Math.max(1, Math.round(imagem.height * escala));
        const contexto = tela.getContext('2d');
        if (!contexto) break;
        contexto.fillStyle = '#ffffff';
        contexto.fillRect(0, 0, tela.width, tela.height);
        contexto.drawImage(imagem, 0, 0, tela.width, tela.height);
        for (const qualidade of [0.85, 0.7, 0.55]) {
          const url = tela.toDataURL('image/jpeg', qualidade);
          if (url.length <= LIMITE_PLANTA) {
            resolve({ imagem: url, largura: tela.width, altura: tela.height });
            return;
          }
        }
      }
      reject(new Error('A imagem da planta é grande demais. Tente uma imagem menor.'));
    };
    imagem.onerror = () => {
      URL.revokeObjectURL(endereco);
      reject(new Error('Este arquivo não é uma imagem que o navegador consiga abrir. Use JPG ou PNG.'));
    };
    imagem.src = endereco;
  });
}

// Menor área desenhada que contém o ponto (para a mesa cair na área certa ao ser posicionada).
function areaNoPonto(areas: AreaDTO[], x: number, y: number): AreaDTO | null {
  const dentro = areas.filter(
    (a) =>
      a.x !== null &&
      a.y !== null &&
      a.largura !== null &&
      a.altura !== null &&
      x >= a.x &&
      x <= a.x + a.largura &&
      y >= a.y &&
      y <= a.y + a.altura,
  );
  if (dentro.length === 0) return null;
  return dentro.reduce((menor, a) => ((a.largura ?? 1) * (a.altura ?? 1) < (menor.largura ?? 1) * (menor.altura ?? 1) ? a : menor));
}

// ---------- Cadastro da área ----------

function FormArea({
  area,
  garcons,
  corSugerida,
  aoFechar,
  aoSalvo,
}: {
  area: AreaDTO | null;
  garcons: GarcomLista[];
  corSugerida: string;
  aoFechar: () => void;
  aoSalvo: (mensagem: string, area: AreaDTO) => void;
}) {
  const [nome, setNome] = useState(area?.nome ?? '');
  const [cor, setCor] = useState(area?.cor ?? corSugerida);
  const [escolhidos, setEscolhidos] = useState<number[]>(area?.garcons.map((g) => g.id) ?? []);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const corpo = { nome: nome.trim(), cor, garconsIds: escolhidos };
      const salva = area
        ? await api.put<AreaDTO>(`/areas/${area.id}`, corpo)
        : await api.post<AreaDTO>('/areas', corpo);
      aoSalvo(area ? 'Área atualizada.' : `Área "${salva.nome}" criada. Agora desenhe ela na planta.`, salva);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  const ativos = garcons.filter((g) => g.ativo || escolhidos.includes(g.id));

  return (
    <Modal aberto titulo={area ? `Editar área ${area.nome}` : 'Nova área'} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome (ex.: Salão principal, Varanda)" valor={nome} aoMudar={setNome} obrigatorio />
        <fieldset className="ficha-grupo">
          <legend>Cor da área na planta</legend>
          <div className="salao-cores" role="radiogroup" aria-label="Cor da área">
            {CORES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={cor === c}
                aria-label={`Cor ${c}`}
                className={cor === c ? 'salao-cor salao-cor-ativa' : 'salao-cor'}
                style={{ background: c }}
                onClick={() => setCor(c)}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="ficha-grupo">
          <legend>Garçons responsáveis pela área (pode ser mais de um)</legend>
          {ativos.length === 0 && <p className="fila-vazia">Nenhum garçom cadastrado. Cadastre em Equipe.</p>}
          {ativos.map((g) => (
            <Caixa
              key={g.id}
              rotulo={g.ativo ? g.nome : `${g.nome} (desativado)`}
              marcado={escolhidos.includes(g.id)}
              aoMudar={(marcado) =>
                setEscolhidos((atual) => (marcado ? [...atual, g.id] : atual.filter((id) => id !== g.id)))
              }
            />
          ))}
        </fieldset>
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

// ---------- Tela ----------

export function Salao() {
  const { usuario } = useAuth();
  const gestor = usuario?.perfil === 'GESTOR';
  const planta = useDados<PlantaDTO | null>('/planta');
  const mesas = useDados<MesaDTO[]>('/mesas');
  const areas = useDados<AreaDTO[]>('/areas');
  const garcons = useDados<GarcomLista[]>(gestor ? '/usuarios?perfil=GARCOM' : null);
  const [modo, setModo] = useState<Modo>('ver');
  const [mesaEscolhida, setMesaEscolhida] = useState<number | null>(null);
  const [areaEscolhida, setAreaEscolhida] = useState<number | null>(null);
  const [form, setForm] = useState<{ area: AreaDTO | null } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Posições e retângulos ainda não gravados (enquanto arrasta).
  const [posicoes, setPosicoes] = useState<Record<number, { x: number; y: number }>>({});
  const [rascunho, setRascunho] = useState<{ x: number; y: number; largura: number; altura: number } | null>(null);
  const quadro = useRef<HTMLDivElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const arrasto = useRef<{ tipo: 'mesa'; id: number; andou: boolean } | { tipo: 'area'; x: number; y: number } | null>(null);

  // No modo de ver, o mapa acompanha a situação das mesas.
  useAtualizacao(mesas.recarregar, modo === 'ver' ? 8000 : 600000);

  // Mesa escolhida que saiu da lista deixa de estar escolhida.
  useEffect(() => {
    if (mesaEscolhida !== null && mesas.dados && !mesas.dados.some((m) => m.id === mesaEscolhida)) {
      setMesaEscolhida(null);
    }
  }, [mesas.dados, mesaEscolhida]);

  const listaMesas = (mesas.dados ?? []).filter((m) => m.ativa);
  const listaAreas = areas.dados ?? [];
  const naPlanta = listaMesas.filter((m) => m.posX !== null && m.posY !== null);
  const foraDaPlanta = listaMesas.filter((m) => m.posX === null || m.posY === null);
  const proporcao = planta.dados ? `${planta.dados.largura} / ${planta.dados.altura}` : '16 / 10';

  function pontoDoEvento(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const caixa = quadro.current?.getBoundingClientRect();
    if (!caixa || caixa.width === 0 || caixa.height === 0) return null;
    return { x: limitar((e.clientX - caixa.left) / caixa.width), y: limitar((e.clientY - caixa.top) / caixa.height) };
  }

  async function executar(acao: () => Promise<unknown>, mensagem: string | null, recarregar: (() => void)[]) {
    setErro(null);
    try {
      await acao();
      if (mensagem) setAviso(mensagem);
      recarregar.forEach((r) => r());
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  // ----- planta -----

  async function importar(e: ChangeEvent<HTMLInputElement>) {
    const escolhido = e.target.files?.[0];
    e.target.value = '';
    if (!escolhido) return;
    setErro(null);
    setAviso(null);
    setOcupado(true);
    try {
      const reduzida = await reduzirPlanta(escolhido);
      await api.put('/planta', reduzida);
      setAviso('Planta importada. Agora posicione as mesas e desenhe as áreas.');
      planta.recarregar();
      setModo('mesas');
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  // ----- mesas -----

  async function gravarPosicao(mesa: MesaDTO, x: number, y: number) {
    const area = areaNoPonto(listaAreas, x, y);
    // Dentro de uma área desenhada, a mesa passa a ser dessa área. Fora de todas, mantém a que tinha.
    const corpo = { posX: x, posY: y, ...(area ? { areaId: area.id } : {}) };
    await executar(
      () => api.put(`/mesas/${mesa.id}`, corpo),
      area && area.id !== mesa.area?.id ? `Mesa ${mesa.numero} agora é da área ${area.nome}.` : null,
      [mesas.recarregar, areas.recarregar],
    );
    setPosicoes((atual) => {
      const novo = { ...atual };
      delete novo[mesa.id];
      return novo;
    });
  }

  function aoApertarMesa(e: ReactPointerEvent<HTMLButtonElement>, mesa: MesaDTO) {
    if (modo !== 'mesas' || !gestor) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    arrasto.current = { tipo: 'mesa', id: mesa.id, andou: false };
    setMesaEscolhida(mesa.id);
  }

  function aoMoverMesa(e: ReactPointerEvent<HTMLButtonElement>, mesa: MesaDTO) {
    const a = arrasto.current;
    if (!a || a.tipo !== 'mesa' || a.id !== mesa.id) return;
    const ponto = pontoDoEvento(e);
    if (!ponto) return;
    a.andou = true;
    setPosicoes((atual) => ({ ...atual, [mesa.id]: ponto }));
  }

  function aoSoltarMesa(e: ReactPointerEvent<HTMLButtonElement>, mesa: MesaDTO) {
    const a = arrasto.current;
    arrasto.current = null;
    if (!a || a.tipo !== 'mesa' || !a.andou) return;
    const ponto = pontoDoEvento(e);
    if (ponto) void gravarPosicao(mesa, ponto.x, ponto.y);
  }

  // Com o teclado: as setas movem a mesa escolhida de 1 em 1 por cento.
  function aoTeclarMesa(e: KeyboardEvent<HTMLButtonElement>, mesa: MesaDTO) {
    if (modo !== 'mesas' || !gestor) return;
    const passos: Record<string, [number, number]> = {
      ArrowLeft: [-0.01, 0],
      ArrowRight: [0.01, 0],
      ArrowUp: [0, -0.01],
      ArrowDown: [0, 0.01],
    };
    const passo = passos[e.key];
    if (!passo || mesa.posX === null || mesa.posY === null) return;
    e.preventDefault();
    void gravarPosicao(mesa, limitar(mesa.posX + passo[0]), limitar(mesa.posY + passo[1]));
  }

  // ----- quadro: colocar mesa escolhida ou desenhar área -----

  function aoApertarQuadro(e: ReactPointerEvent<HTMLDivElement>) {
    if (!gestor) return;
    const ponto = pontoDoEvento(e);
    if (!ponto) return;
    if (modo === 'areas' && areaEscolhida !== null) {
      e.currentTarget.setPointerCapture(e.pointerId);
      arrasto.current = { tipo: 'area', x: ponto.x, y: ponto.y };
      setRascunho({ x: ponto.x, y: ponto.y, largura: 0, altura: 0 });
    } else if (modo === 'mesas' && mesaEscolhida !== null) {
      const mesa = listaMesas.find((m) => m.id === mesaEscolhida);
      // Só as mesas que ainda estão fora da planta são colocadas com um toque; as outras são arrastadas.
      if (mesa && (mesa.posX === null || mesa.posY === null)) {
        void gravarPosicao(mesa, ponto.x, ponto.y);
      }
    }
  }

  function aoMoverQuadro(e: ReactPointerEvent<HTMLDivElement>) {
    const a = arrasto.current;
    if (!a || a.tipo !== 'area') return;
    const ponto = pontoDoEvento(e);
    if (!ponto) return;
    setRascunho({
      x: Math.min(a.x, ponto.x),
      y: Math.min(a.y, ponto.y),
      largura: Math.abs(ponto.x - a.x),
      altura: Math.abs(ponto.y - a.y),
    });
  }

  function aoSoltarQuadro() {
    const a = arrasto.current;
    if (!a || a.tipo !== 'area') return;
    arrasto.current = null;
    const desenho = rascunho;
    setRascunho(null);
    if (!desenho || areaEscolhida === null) return;
    if (desenho.largura < 0.03 || desenho.altura < 0.03) {
      setErro('Área pequena demais. Arraste na planta para desenhar um retângulo maior.');
      return;
    }
    const area = listaAreas.find((x) => x.id === areaEscolhida);
    void executar(
      () => api.put(`/areas/${areaEscolhida}`, desenho),
      area ? `Área ${area.nome} desenhada na planta.` : 'Área desenhada.',
      [areas.recarregar],
    );
  }

  const carregando = (planta.carregando && planta.dados === null) || (mesas.carregando && !mesas.dados);
  const escolhida = listaMesas.find((m) => m.id === mesaEscolhida) ?? null;

  return (
    <Pagina
      titulo="Salão"
      acoes={
        gestor ? (
          <>
            <input
              ref={arquivo}
              type="file"
              accept="image/*"
              className="oculto"
              aria-label="Escolher a imagem da planta"
              onChange={importar}
            />
            <Botao variante="secundario" desabilitado={ocupado} aoClicar={() => arquivo.current?.click()}>
              {ocupado ? 'Importando...' : planta.dados ? 'Trocar planta' : 'Importar planta'}
            </Botao>{' '}
            <Botao aoClicar={() => setForm({ area: null })}>Nova área</Botao>
          </>
        ) : undefined
      }
    >
      {gestor && (
        <div className="barra-ferramentas">
          <div className="segmentado" role="group" aria-label="O que fazer na planta">
            {MODOS.map((m) => (
              <button
                key={m.id}
                type="button"
                className="segmentado-item"
                aria-pressed={modo === m.id}
                onClick={() => {
                  setModo(m.id);
                  setAviso(null);
                  setErro(null);
                }}
              >
                {m.rotulo}
              </button>
            ))}
          </div>
        </div>
      )}

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {planta.erro && <Aviso tipo="erro">{planta.erro}</Aviso>}
      {mesas.erro && <Aviso tipo="erro">{mesas.erro}</Aviso>}
      {areas.erro && <Aviso tipo="erro">{areas.erro}</Aviso>}
      {carregando && <Carregando />}

      {gestor && modo === 'mesas' && (
        <Aviso tipo="info">
          Arraste uma mesa para o lugar dela. Para colocar uma mesa que ainda está fora da planta, toque nela na lista
          abaixo e depois toque no lugar dela na planta. Com o teclado, as setas movem a mesa escolhida. A mesa que cai
          dentro de uma área desenhada passa a ser dessa área.
        </Aviso>
      )}
      {gestor && modo === 'areas' && (
        <Aviso tipo="info">
          {listaAreas.length === 0
            ? 'Crie a primeira área em "Nova área". Depois escolha a área na lista e arraste na planta para desenhar.'
            : areaEscolhida === null
              ? 'Escolha uma área na lista abaixo e arraste na planta para desenhar o espaço dela.'
              : `Arraste na planta para desenhar a área ${listaAreas.find((a) => a.id === areaEscolhida)?.nome ?? ''}.`}
        </Aviso>
      )}

      {!carregando && (
        <div className="salao-moldura">
          <div
            ref={quadro}
            className={`salao-quadro salao-modo-${modo}${planta.dados ? '' : ' salao-sem-planta'}`}
            style={{ aspectRatio: proporcao, backgroundImage: planta.dados ? `url(${planta.dados.imagem})` : undefined }}
            onPointerDown={aoApertarQuadro}
            onPointerMove={aoMoverQuadro}
            onPointerUp={aoSoltarQuadro}
          >
            {!planta.dados && (
              <p className="salao-vazio">
                {gestor
                  ? 'Sem planta ainda. Use "Importar planta" para enviar a imagem (foto ou desenho) do restaurante. Você também pode posicionar as mesas neste quadro em branco.'
                  : 'O gestor ainda não importou a planta do restaurante.'}
              </p>
            )}

            {listaAreas
              .filter((a) => a.x !== null && a.y !== null && a.largura !== null && a.altura !== null)
              .map((a) => (
                <div
                  key={a.id}
                  className={a.id === areaEscolhida && modo === 'areas' ? 'salao-area salao-area-escolhida' : 'salao-area'}
                  style={{
                    left: `${(a.x ?? 0) * 100}%`,
                    top: `${(a.y ?? 0) * 100}%`,
                    width: `${(a.largura ?? 0) * 100}%`,
                    height: `${(a.altura ?? 0) * 100}%`,
                    borderColor: a.cor,
                    background: `color-mix(in srgb, ${a.cor} 14%, transparent)`,
                  }}
                >
                  <span className="salao-area-nome" style={{ background: a.cor }}>
                    {a.nome}
                  </span>
                </div>
              ))}

            {rascunho && (
              <div
                className="salao-area salao-area-rascunho"
                style={{
                  left: `${rascunho.x * 100}%`,
                  top: `${rascunho.y * 100}%`,
                  width: `${rascunho.largura * 100}%`,
                  height: `${rascunho.altura * 100}%`,
                }}
              />
            )}

            {naPlanta.map((m) => {
              const posicao = posicoes[m.id] ?? { x: m.posX ?? 0, y: m.posY ?? 0 };
              const classes = [
                'salao-mesa',
                `salao-mesa-${m.situacao.toLowerCase()}`,
                m.chamandoDesde ? 'salao-mesa-chamando' : '',
                m.id === mesaEscolhida ? 'salao-mesa-escolhida' : '',
              ]
                .filter(Boolean)
                .join(' ');
              const situacao =
                m.situacao === 'OCUPADA' ? 'ocupada' : m.situacao === 'LIMPEZA' ? 'aguardando limpeza' : 'livre';
              return (
                <button
                  key={m.id}
                  type="button"
                  className={classes}
                  style={{
                    left: `${posicao.x * 100}%`,
                    top: `${posicao.y * 100}%`,
                    outlineColor: m.area?.cor,
                  }}
                  aria-label={`${nomeDaMesa(m)}, ${situacao}${m.chamandoDesde ? ', chamando o garçom' : ''}${m.area ? `, área ${m.area.nome}` : ''}`}
                  aria-pressed={m.id === mesaEscolhida}
                  title={`${nomeDaMesa(m)} · ${situacao}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMesaEscolhida(m.id === mesaEscolhida && modo !== 'mesas' ? null : m.id);
                  }}
                  onPointerDown={(e) => aoApertarMesa(e, m)}
                  onPointerMove={(e) => aoMoverMesa(e, m)}
                  onPointerUp={(e) => aoSoltarMesa(e, m)}
                  onKeyDown={(e) => aoTeclarMesa(e, m)}
                >
                  {m.numero}
                  {m.area && <span className="salao-mesa-area" style={{ background: m.area.cor }} aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          <ul className="salao-legenda" aria-label="Legenda">
            <li>
              <span className="salao-legenda-cor salao-mesa-livre" /> Livre
            </li>
            <li>
              <span className="salao-legenda-cor salao-mesa-ocupada" /> Ocupada
            </li>
            <li>
              <span className="salao-legenda-cor salao-mesa-limpeza" /> Aguardando limpeza
            </li>
            <li>
              <span className="salao-legenda-cor salao-mesa-chamando" /> Chamando o garçom
            </li>
          </ul>
        </div>
      )}

      {escolhida && (
        <Cartao titulo={nomeDaMesa(escolhida)}>
          <div className="salao-detalhe">
            <span>
              {escolhida.situacao === 'OCUPADA' ? (
                <Selo cor="azul">Ocupada</Selo>
              ) : escolhida.situacao === 'LIMPEZA' ? (
                <Selo cor="amarelo">Aguardando limpeza</Selo>
              ) : (
                <Selo cor="verde">Livre</Selo>
              )}{' '}
              {escolhida.chamandoDesde && <Selo cor="vermelho">Chamando</Selo>}
            </span>
            <span>{escolhida.lugares} lugares</span>
            <span>{escolhida.area ? `Área: ${escolhida.area.nome}` : 'Sem área'}</span>
            <span>
              {escolhida.responsaveis.length > 0
                ? `Responsável: ${escolhida.responsaveis.map((r) => r.nome).join(', ')}`
                : 'Sem garçom responsável (avisa todos)'}
            </span>
            {escolhida.pedidosAbertos > 0 && <span>Conta aberta: {formatarMoeda(escolhida.totalAberto)}</span>}
          </div>
          {gestor && modo === 'mesas' && escolhida.posX !== null && (
            <p>
              <Botao
                variante="texto"
                aoClicar={() =>
                  void executar(
                    () => api.put(`/mesas/${escolhida.id}`, { posX: null, posY: null }),
                    `Mesa ${escolhida.numero} tirada da planta.`,
                    [mesas.recarregar],
                  )
                }
              >
                Tirar da planta
              </Botao>
            </p>
          )}
        </Cartao>
      )}

      {gestor && modo === 'mesas' && foraDaPlanta.length > 0 && (
        <Cartao titulo="Mesas fora da planta">
          <div className="salao-bandeja" role="group" aria-label="Mesas fora da planta">
            {foraDaPlanta.map((m) => (
              <button
                key={m.id}
                type="button"
                className="salao-ficha"
                aria-pressed={m.id === mesaEscolhida}
                onClick={() => setMesaEscolhida(m.id === mesaEscolhida ? null : m.id)}
              >
                {nomeDaMesa(m)}
              </button>
            ))}
          </div>
        </Cartao>
      )}

      <Cartao titulo="Áreas do salão">
        {areas.dados && listaAreas.length === 0 && (
          <p className="fila-vazia">
            {gestor
              ? 'Nenhuma área criada. Com áreas, cada garçom recebe só os chamados das mesas da área dele.'
              : 'Nenhuma área criada.'}
          </p>
        )}
        <ul className="salao-areas">
          {listaAreas.map((a) => (
            <li key={a.id} className={a.id === areaEscolhida && modo === 'areas' ? 'salao-area-linha salao-area-linha-ativa' : 'salao-area-linha'}>
              <span className="salao-area-ponto" style={{ background: a.cor }} aria-hidden="true" />
              <div className="salao-area-texto">
                <strong>{a.nome}</strong>
                <span>
                  {a.mesas} {a.mesas === 1 ? 'mesa' : 'mesas'} ·{' '}
                  {a.garcons.length > 0 ? a.garcons.map((g) => g.nome).join(', ') : 'sem garçom responsável'}
                  {a.x === null ? ' · ainda não desenhada na planta' : ''}
                </span>
              </div>
              {gestor && modo === 'areas' && (
                <Botao
                  variante={a.id === areaEscolhida ? 'primario' : 'secundario'}
                  aoClicar={() => setAreaEscolhida(a.id === areaEscolhida ? null : a.id)}
                >
                  {a.id === areaEscolhida ? 'Desenhando' : 'Desenhar'}
                </Botao>
              )}
              {gestor && (
                <MenuAcoes
                  rotulo={`Ações da área ${a.nome}`}
                  acoes={[
                    { rotulo: 'Editar nome, cor e garçons', icone: 'lapis', aoClicar: () => setForm({ area: a }) },
                    ...(a.x !== null
                      ? [
                          {
                            rotulo: 'Apagar o desenho na planta',
                            icone: 'fechar' as const,
                            aoClicar: () =>
                              void executar(
                                () => api.put(`/areas/${a.id}`, { x: null, y: null, largura: null, altura: null }),
                                `Desenho da área ${a.nome} apagado.`,
                                [areas.recarregar],
                              ),
                          },
                        ]
                      : []),
                    {
                      rotulo: 'Excluir área',
                      icone: 'lixeira',
                      perigo: true,
                      aoClicar: () => {
                        if (!window.confirm(`Excluir a área "${a.nome}"? As mesas dela ficam sem área.`)) return;
                        if (areaEscolhida === a.id) setAreaEscolhida(null);
                        void executar(() => api.del(`/areas/${a.id}`), 'Área excluída.', [areas.recarregar, mesas.recarregar]);
                      },
                    },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
      </Cartao>

      {gestor && planta.dados && (
        <p>
          <Botao
            variante="texto"
            aoClicar={() => {
              if (!window.confirm('Remover a imagem da planta? As mesas e as áreas continuam no lugar.')) return;
              void executar(() => api.del('/planta'), 'Planta removida.', [planta.recarregar]);
            }}
          >
            <Icone nome="lixeira" tamanho={16} /> Remover a imagem da planta
          </Botao>
        </p>
      )}

      {form && (
        <FormArea
          area={form.area}
          garcons={garcons.dados ?? []}
          corSugerida={CORES[listaAreas.length % CORES.length]}
          aoFechar={() => setForm(null)}
          aoSalvo={(mensagem, area) => {
            setAviso(mensagem);
            areas.recarregar();
            mesas.recarregar();
            if (!form.area) {
              setModo('areas');
              setAreaEscolhida(area.id);
            }
          }}
        />
      )}
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/salao',
    rotulo: 'Salão',
    icone: 'grade',
    perfis: ['GESTOR'],
    elemento: <Salao />,
    ordem: 12,
  },
  {
    caminho: '/garcom/salao',
    rotulo: 'Salão',
    icone: 'grade',
    perfis: ['GARCOM'],
    elemento: <Salao />,
    ordem: 12,
  },
];
