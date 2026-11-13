import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { lerPreco, mensagemErro, precoParaCampo } from '../../lib/restaurante';
import type { BairroDTO, ConfiguracaoDeliveryDTO } from '../../lib/delivery';
import {
  AreaTexto,
  Aviso,
  Botao,
  Caixa,
  Campo,
  Carregando,
  Cartao,
  MenuAcoes,
  Modal,
  Selo,
  Tabela,
  formatarMoeda,
} from '../../ui';
import type { AcaoMenu } from '../../ui';

// Minutos inteiros (0 ou mais). Devolve null se não for um número inteiro.
function lerMinutos(texto: string): number | null {
  const limpo = texto.trim();
  if (!/^\d{1,4}$/.test(limpo)) return null;
  return Number(limpo);
}

// ---------- Recebimento de pedidos ----------

function RecebimentoPedidos({ config, aoSalvo }: { config: ConfiguracaoDeliveryDTO; aoSalvo: () => void }) {
  const [deliveryAtivo, setDeliveryAtivo] = useState(config.deliveryAtivo);
  const [retiradaAtiva, setRetiradaAtiva] = useState(config.retiradaAtiva);
  const [pedidoMinimo, setPedidoMinimo] = useState(precoParaCampo(config.pedidoMinimo));
  const [tempoEntrega, setTempoEntrega] = useState(String(config.deliveryTempoMin));
  const [tempoRetirada, setTempoRetirada] = useState(String(config.retiradaTempoMin));
  const [aviso, setAviso] = useState(config.aviso ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(null);
    const minimo = lerPreco(pedidoMinimo);
    if (minimo === null) {
      setErro('Informe o pedido mínimo em reais (use 0 para não ter mínimo).');
      return;
    }
    const minutosEntrega = lerMinutos(tempoEntrega);
    if (minutosEntrega === null) {
      setErro('Informe o tempo de entrega em minutos.');
      return;
    }
    const minutosRetirada = lerMinutos(tempoRetirada);
    if (minutosRetirada === null) {
      setErro('Informe o tempo para retirada em minutos.');
      return;
    }
    setEnviando(true);
    try {
      await api.put('/delivery/configuracao', {
        deliveryAtivo,
        retiradaAtiva,
        pedidoMinimo: minimo,
        deliveryTempoMin: minutosEntrega,
        retiradaTempoMin: minutosRetirada,
        aviso: aviso.trim() || null,
      });
      setSucesso('Configuração gravada.');
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      <Cartao titulo="Recebimento de pedidos">
        <Caixa rotulo="Receber pedidos para entrega" marcado={deliveryAtivo} aoMudar={setDeliveryAtivo} />
        <Caixa rotulo="Receber pedidos para retirar no balcão" marcado={retiradaAtiva} aoMudar={setRetiradaAtiva} />
        <Campo rotulo="Pedido mínimo (R$)" valor={pedidoMinimo} aoMudar={setPedidoMinimo} />
        <Campo rotulo="Tempo de entrega (min)" tipo="number" valor={tempoEntrega} aoMudar={setTempoEntrega} />
        <Campo rotulo="Tempo para retirada (min)" tipo="number" valor={tempoRetirada} aoMudar={setTempoRetirada} />
        <AreaTexto rotulo="Recado no topo do cardápio (opcional)" valor={aviso} aoMudar={setAviso} linhas={3} />
        {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="pagina-acoes">
          <Botao tipo="submit" desabilitado={enviando}>
            {enviando ? 'Salvando...' : 'Salvar'}
          </Botao>
        </div>
      </Cartao>
    </form>
  );
}

// ---------- Bairros e taxas ----------

// Cadastro de um bairro novo (bairro === null) ou edição de um existente.
function FormBairro({
  bairro,
  aoFechar,
  aoSalvo,
}: {
  bairro: BairroDTO | null;
  aoFechar: () => void;
  aoSalvo: () => void;
}) {
  const [nome, setNome] = useState(bairro?.nome ?? '');
  const [taxa, setTaxa] = useState(bairro ? precoParaCampo(bairro.taxa) : '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const nomeLimpo = nome.trim();
    if (nomeLimpo.length < 1 || nomeLimpo.length > 60) {
      setErro('Informe o nome do bairro (até 60 letras).');
      return;
    }
    const valor = lerPreco(taxa);
    if (valor === null) {
      setErro('Informe a taxa de entrega em reais (use 0 para entrega grátis).');
      return;
    }
    setEnviando(true);
    try {
      if (bairro) await api.put(`/delivery/bairros/${bairro.id}`, { nome: nomeLimpo, taxa: valor });
      else await api.post('/delivery/bairros', { nome: nomeLimpo, taxa: valor });
      aoSalvo();
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={bairro ? `Editar bairro · ${bairro.nome}` : 'Novo bairro'} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
        <Campo rotulo="Taxa de entrega (R$)" valor={taxa} aoMudar={setTaxa} obrigatorio />
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

function BairrosEntrega({
  bairros,
  entregaAtiva,
  aoMudar,
}: {
  bairros: BairroDTO[];
  entregaAtiva: boolean;
  aoMudar: () => void;
}) {
  const [editando, setEditando] = useState<BairroDTO | 'novo' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const ativos = bairros.filter((b) => b.ativo).length;

  async function alternar(bairro: BairroDTO) {
    setErro(null);
    try {
      await api.put(`/delivery/bairros/${bairro.id}`, { ativo: !bairro.ativo });
      aoMudar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function excluir(bairro: BairroDTO) {
    if (!window.confirm(`Excluir o bairro "${bairro.nome}"? Esta ação não tem volta.`)) return;
    setErro(null);
    try {
      await api.del(`/delivery/bairros/${bairro.id}`);
      aoMudar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  return (
    <Cartao titulo="Bairros e taxas de entrega">
      {entregaAtiva && ativos === 0 && (
        <Aviso tipo="info">Cadastre pelo menos um bairro para receber pedidos de entrega.</Aviso>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="barra-ferramentas">
        <Botao aoClicar={() => setEditando('novo')}>Novo bairro</Botao>
      </div>
      <Tabela
        dados={bairros}
        chave={(b) => b.id}
        vazio="Nenhum bairro cadastrado."
        colunas={[
          { titulo: 'Bairro', celula: (b) => <strong>{b.nome}</strong> },
          { titulo: 'Taxa', alinhar: 'direita', celula: (b) => <span className="entrega-sem-quebra">{formatarMoeda(b.taxa)}</span> },
          {
            titulo: 'Situação',
            celula: (b) => (b.ativo ? <Selo cor="verde">Ativo</Selo> : <Selo cor="cinza">Desativado</Selo>),
          },
          {
            titulo: 'Ações',
            acoes: true,
            celula: (b) => {
              const acoes: AcaoMenu[] = [
                { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setEditando(b) },
                {
                  rotulo: b.ativo ? 'Desativar' : 'Reativar',
                  icone: b.ativo ? 'menos' : 'visto',
                  aoClicar: () => void alternar(b),
                },
                { rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => void excluir(b) },
              ];
              return <MenuAcoes rotulo={`Ações do bairro ${b.nome}`} acoes={acoes} />;
            },
          },
        ]}
      />
      {editando && (
        <FormBairro
          bairro={editando === 'novo' ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvo={aoMudar}
        />
      )}
    </Cartao>
  );
}

// ---------- Endereço para os clientes ----------

function EnderecoClientes() {
  const endereco = `${window.location.origin}/pedir`;
  const [aviso, setAviso] = useState<string | null>(null);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(endereco);
      setAviso('Endereço copiado.');
    } catch {
      setAviso(`Não foi possível copiar. Copie o endereço: ${endereco}`);
    }
  }

  return (
    <Cartao titulo="Endereço para os clientes">
      <p className="entrega-texto">
        Divulgue este endereço (ou um QR code dele) para receber pedidos. O cliente acompanha o pedido por um link
        próprio.
      </p>
      <p className="entrega-endereco">
        <code>{endereco}</code>
      </p>
      <div className="pagina-acoes">
        <Botao variante="secundario" aoClicar={() => void copiar()}>
          Copiar
        </Botao>
        <Botao variante="secundario" aoClicar={() => window.open(endereco, '_blank', 'noopener')}>
          Abrir
        </Botao>
      </div>
      {aviso && <Aviso tipo="info">{aviso}</Aviso>}
    </Cartao>
  );
}

// ---------- Tela (só gestor) ----------

export function Configuracao() {
  const config = useDados<ConfiguracaoDeliveryDTO>('/delivery/configuracao');

  return (
    <>
      {config.erro && <Aviso tipo="erro">{config.erro}</Aviso>}
      {config.carregando && !config.dados && <Carregando />}
      {config.dados && (
        <>
          <RecebimentoPedidos config={config.dados} aoSalvo={config.recarregar} />
          <BairrosEntrega
            bairros={config.dados.bairros}
            entregaAtiva={config.dados.deliveryAtivo}
            aoMudar={config.recarregar}
          />
          <EnderecoClientes />
        </>
      )}
    </>
  );
}
