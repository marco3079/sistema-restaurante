import { useState } from 'react';
import { api } from '../../lib/api';
import { ACOES, ROTULOS_ACOES, ROTULOS_MODOS } from '../../lib/permissoes';
import type { AcaoSensivel, Modo, PermissoesDTO } from '../../lib/permissoes';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Cartao, Carregando } from '../../ui';
import { mensagemErro } from '../cadastros/tipos';

// Aba Permissões de Configurações: senha curta do gestor e o que o garçom pode fazer sem ele.
export function Permissoes() {
  const { dados, carregando, erro, recarregar } = useDados<PermissoesDTO>('/permissoes');
  return (
    <>
      {carregando && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {dados && <Conteudo dados={dados} recarregar={recarregar} />}
    </>
  );
}

function Conteudo({ dados, recarregar }: { dados: PermissoesDTO; recarregar: () => void }) {
  return (
    <>
      <SenhaDoGestor senhaDefinida={dados.senhaDefinida} recarregar={recarregar} />
      <RegrasDoGarcom regras={dados.regras} senhaDefinida={dados.senhaDefinida} recarregar={recarregar} />
    </>
  );
}

function SenhaDoGestor({ senhaDefinida, recarregar }: { senhaDefinida: boolean; recarregar: () => void }) {
  const [senhaLogin, setSenhaLogin] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  async function enviar(senha: string | null, mensagem: string) {
    setErro(null);
    setSucesso(null);
    setEnviando(true);
    try {
      await api.put<{ senhaDefinida: boolean }>('/permissoes/senha', { senhaAtualDaConta: senhaLogin, senha });
      setSenhaLogin('');
      setNovaSenha('');
      setSucesso(mensagem);
      recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  function apagar() {
    if (!window.confirm('Apagar a senha do gestor? As ações que pediam a senha passam a ser só do gestor.')) return;
    void enviar(null, 'Senha apagada.');
  }

  const podeGravar = senhaLogin !== '' && novaSenha.length >= 4 && !enviando;

  return (
    <Cartao titulo="Senha do gestor">
      <p className="permissoes-texto-suave">
        É uma senha curta, só para liberar ações na frente do cliente. Não é a senha de login.
      </p>
      <p className="permissoes-situacao">
        <strong>{senhaDefinida ? 'Senha definida' : 'Sem senha'}</strong>
      </p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
      <Campo rotulo="Sua senha de login (para confirmar)" tipo="password" valor={senhaLogin} aoMudar={setSenhaLogin} />
      <Campo
        rotulo="Nova senha do gestor (4 a 12 números)"
        tipo="password"
        valor={novaSenha}
        aoMudar={(v) => setNovaSenha(v.replace(/\D/g, '').slice(0, 12))}
      />
      <div className="permissoes-acoes">
        <Botao
          desabilitado={!podeGravar}
          aoClicar={() => void enviar(novaSenha, senhaDefinida ? 'Senha trocada.' : 'Senha gravada.')}
        >
          Gravar senha
        </Botao>
        {senhaDefinida && (
          <Botao variante="perigo" desabilitado={senhaLogin === '' || enviando} aoClicar={apagar}>
            Apagar senha
          </Botao>
        )}
      </div>
    </Cartao>
  );
}

function RegrasDoGarcom({
  regras,
  senhaDefinida,
  recarregar,
}: {
  regras: Record<AcaoSensivel, Modo>;
  senhaDefinida: boolean;
  recarregar: () => void;
}) {
  const [rascunho, setRascunho] = useState<Record<AcaoSensivel, Modo>>(regras);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  async function salvar() {
    setErro(null);
    setSucesso(null);
    setEnviando(true);
    try {
      await api.put('/permissoes', { regras: rascunho });
      setSucesso('Permissões salvas.');
      recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Cartao titulo="O que o garçom pode fazer">
      <p className="permissoes-texto-suave">
        Cada ação pode ser livre para o garçom, pedir a senha do gestor ou ser só do gestor. O gestor sempre pode, sem senha.
      </p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
      {ACOES.map((acao) => (
        <label className="campo" key={acao}>
          <span className="campo-rotulo">{ROTULOS_ACOES[acao]}</span>
          <select
            className="campo-controle"
            value={rascunho[acao]}
            onChange={(e) => setRascunho((atual) => ({ ...atual, [acao]: e.target.value as Modo }))}
          >
            <option value="LIVRE">{ROTULOS_MODOS.LIVRE}</option>
            <option value="COM_SENHA" disabled={!senhaDefinida && rascunho[acao] !== 'COM_SENHA'}>
              {ROTULOS_MODOS.COM_SENHA}
            </option>
            <option value="SO_GESTOR">{ROTULOS_MODOS.SO_GESTOR}</option>
          </select>
        </label>
      ))}
      <div className="permissoes-acoes">
        <Botao desabilitado={enviando} aoClicar={() => void salvar()}>
          Salvar
        </Botao>
      </div>
    </Cartao>
  );
}
