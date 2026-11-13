import { useEffect, useRef, useState } from 'react';
import { rotuloAcao } from '../lib/permissoes';
import { registrarJanela } from '../lib/senhaGestor';
import type { PedidoSenha } from '../lib/senhaGestor';
import { Aviso, Botao, Campo, Modal } from '../ui';

// Janela da senha do gestor. Montada uma vez no Layout. A senha fica só no estado e some ao fechar.
export function SenhaGestor() {
  const [pedido, setPedido] = useState<PedidoSenha | null>(null);
  const [senha, setSenha] = useState('');
  const atual = useRef<PedidoSenha | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    registrarJanela((novo) => {
      // Se já havia um pedido aberto, ele termina como cancelado.
      atual.current?.responder(null);
      atual.current = novo;
      setSenha('');
      setPedido(novo);
    });
    return () => {
      registrarJanela(null);
      atual.current?.responder(null);
      atual.current = null;
    };
  }, []);

  // Foco automático no campo de senha ao abrir.
  useEffect(() => {
    if (pedido) formRef.current?.querySelector('input')?.focus();
  }, [pedido]);

  function fechar(resposta: string | null) {
    const p = atual.current;
    atual.current = null;
    setSenha('');
    setPedido(null);
    p?.responder(resposta);
  }

  return (
    <Modal aberto={pedido !== null} titulo="Senha do gestor" aoFechar={() => fechar(null)}>
      {pedido && (
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            if (senha !== '') fechar(senha);
          }}
        >
          <p>Esta ação precisa da senha do gestor: {rotuloAcao(pedido.acao)}.</p>
          {pedido.erro && <Aviso tipo="erro">{pedido.erro}</Aviso>}
          <Campo rotulo="Senha do gestor" tipo="password" valor={senha} aoMudar={setSenha} obrigatorio />
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Botao variante="texto" aoClicar={() => fechar(null)}>
              Cancelar
            </Botao>
            <Botao tipo="submit" desabilitado={senha === ''}>
              Confirmar
            </Botao>
          </div>
        </form>
      )}
    </Modal>
  );
}
