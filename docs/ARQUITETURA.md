# Arquitetura

## Contêineres

O `docker-compose.yml` sobe quatro serviços:

| Serviço | O que é | Porta no computador |
|---|---|---|
| `db` | PostgreSQL 16 | `127.0.0.1:${DB_PORT}` (padrão 5433) |
| `api` | Node.js 20 + Express + Prisma | `127.0.0.1:${API_PORT}` (padrão 3091) |
| `web` | nginx com o site React já compilado | `${WEB_PORT}` (padrão 8091) |
| `atualizador` | Node.js + git + Docker CLI; atualiza o sistema para o último commit | nenhuma (só a rede interna) |

O nginx do `web` encaminha `/api/` para o contêiner `api`. O site é o único acesso pela rede: banco e API só respondem ao próprio computador.

O `atualizador` (`atualizador/servidor.js`, sem dependências) monta a pasta do projeto e o socket do Docker. A API repassa a ele os pedidos do gestor (`/api/atualizacao`), com um segredo no cabeçalho. Para atualizar, ele consulta o GitHub (`git fetch`), copia o banco (`pg_dump` para `backups/`), aplica o commit (`git merge --ff-only`), reconstrói (`docker compose build api web`) e recria a API e depois o site (`up -d --no-deps`), sem tocar no banco. O estado do git fica em memória, porque ler o git de uma pasta do Windows de dentro do contêiner é lento.

Na subida, o contêiner `api` roda `prisma db push` (cria ou atualiza as tabelas), o seed (cria o gestor em banco vazio) e o servidor.

## Servidor (`server/`)

- `src/app.ts` monta o Express e carrega cada pasta de `src/modules/` que tenha `routes.ts`. Primeiro entram as rotas públicas de todos os módulos (`export const publico`), depois as autenticadas (`export default`), atrás do middleware `autenticar`.
- `src/lib/auth.ts`: JWT de 12 horas no cabeçalho `Authorization: Bearer`. `permitir('GESTOR')` restringe uma rota a um perfil.
- `src/lib/erros.ts`: `HttpError`, `asyncHandler`, `idParam` e `validar` (zod).
- `src/lib/log.ts`: registro de atividades. Toda requisição autenticada vira uma linha em `LogAtividade`.
- `src/lib/pedidos.ts`: regras comuns aos pedidos (criação com cópia de nome e preço, formato de resposta, código da mesa).
- `src/lib/mesas.ts`, `pagamentos.ts`, `maquinetas.ts`, `produtos.ts`: estado da mesa, ciclo da cobrança, conversa com a maquineta (simulada e Mercado Pago Point) e ficha do prato.
- `src/lib/email.ts`, `cripto.ts`, `tokens-senha.ts`, `imagem.ts`: envio de e-mail, cifra dos segredos guardados no banco (senha do SMTP e token do Mercado Pago), links de senha e validação de imagem.

### Módulos

| Módulo | Rotas principais | Quem acessa |
|---|---|---|
| `auth` | login, sair, trocar senha, esqueci a senha | público e logados |
| `cadastros` | equipe (`/usuarios`) e `/perfil` | gestor; perfil para todos |
| `cardapio` | `/categorias`, `/produtos` | leitura para todos; escrita do gestor; disponibilidade para todos |
| `mesas` | `/mesas`, conta, chamados, ocupar, liberar, limpa, novo QR code, `/limpeza/mesas`, `/recepcao/mesas` | cadastro do gestor; operação conforme o perfil |
| `salao` | `/planta`, `/areas` | leitura de gestor e garçom; escrita do gestor |
| `pagamentos` | `/maquinetas`, `/mesas/:id/conta`, `/mesas/:id/cobrar`, `/pagamentos/:id`, `/desempenho` | gestor e garçom; cadastro e desempenho só do gestor |
| `recepcao` | `/espera`, `/reservas` | gestor e recepção |
| `estoque` | `/estoque`, movimentos | gestor; a cozinha só consulta o saldo |
| `fiscal` | `/fiscal/configuracao`, `/fiscal/contas`, `/contas/:id/nota`, `/notas/:id/consultar` | gestor; o garçom emite a nota da conta |
| `pedidos` | `/pedidos`, mudança de situação | gestor, garçom e cozinha |
| `cliente` | `/cliente/mesas/:codigo` (cardápio, pedidos, chamar) | público, pelo código da mesa |
| `painel` | `/painel/resumo`, `/busca`, `/notificacoes` | gestor e garçom |
| `atualizacao` | `/atualizacao`, verificar e aplicar (ponte para o contêiner `atualizador`) | gestor |
| `logs` | atividades e log do sistema | gestor |
| `plataforma` | identidade, cores e e-mail | leitura pública da identidade; escrita do gestor |

## Perfis

- `GESTOR`: tudo.
- `GARCOM`: lança pedidos, entrega (PRONTO para ENTREGUE), cancela, atende chamados, ocupa e libera mesas, recebe a conta e marca item esgotado.
- `COZINHA`: vê a fila, inicia o preparo e marca como pronto; marca item esgotado. Não vê mesas, contas nem valores do salão.
- `LIMPEZA`: vê as mesas aguardando limpeza e marca como limpa. Não vê pedidos nem valores.
- `RECEPCAO`: vê a situação das mesas (sem pedidos nem valores), marca a mesa como ocupada e cuida da fila de espera e das reservas.
- Cliente: não tem conta. Acessa só as rotas `/api/cliente/mesas/:codigo`, com o código secreto da mesa.

## Modelo de dados

Definido em `server/prisma/schema.prisma`.

- `Usuario`: conta da equipe, com `perfil` (`GESTOR` ou `GARCOM`).
- `Categoria` e `Produto`: o cardápio. `Produto.disponivel = false` é item esgotado; `Produto.ativo = false` é item excluído que continua no histórico. O produto também guarda a ficha do prato (apresentação, ingredientes, porção, tempo de preparo, alergênicos e tabela nutricional).
- `Mesa`: número, nome, lugares, `codigo` (segredo do QR code), `chamandoDesde` (cliente chamou o garçom), `estado` (`LIVRE`, `OCUPADA` ou `LIMPEZA`), área e posição na planta (`posX`, `posY`, de 0 a 1).
- `Area`: nome, cor, retângulo na planta e os garçons responsáveis (vários por área).
- `Planta`: a imagem da planta do restaurante (linha única).
- `Maquineta`: nome, operadora, integração (`MANUAL` ou `AUTOMATICA`), identificador e garçom dono.
- `Conta`: a conta de uma mesa, do primeiro pedido até ser quitada (`ABERTA` ou `FECHADA`). Guarda se a taxa de serviço está valendo, o percentual e o CPF/CNPJ do cliente. Os pedidos apontam para a conta.
- `Pagamento`: uma cobrança da conta, total ou parcial (valor, gorjeta, parte que é taxa de serviço, forma, situação, maquineta, código do Pix, garçom que leva o crédito).
- `MovimentoEstoque`: entrada, saída, acerto, venda ou devolução de um produto, com o saldo depois do movimento.
- `Espera` e `Reserva`: fila de espera e reservas da recepção.
- `NotaFiscal`: a nota de uma conta fechada (serviço, situação, número, chave, endereços do DANFE e do XML, mensagem).
- `Pedido` e `ItemPedido`: o item guarda a cópia do nome e do preço do produto no momento do pedido.
- `LogAtividade`, `ConfiguracaoPlataforma`, `TokenSenha`, `EmailEnviado`: apoio.

## Regras de negócio

- **Situação do pedido**: `NOVO` → `EM_PREPARO` → `PRONTO` → `ENTREGUE`. `CANCELADO` sai do caminho. Pedido pago não muda mais.
- **Quem muda o pedido**: a cozinha inicia o preparo e marca como pronto; o garçom entrega o que está pronto e cancela; o gestor faz tudo.
- **Conta da mesa**: nasce com o primeiro pedido e junta os pedidos não cancelados da mesa até ser quitada. Total = produtos + taxa de serviço (se estiver valendo). Os valores são calculados em centavos.
- **Estado da mesa**: `LIVRE` → `OCUPADA` (cliente chamou ou pediu, ou o garçom ou a recepção marcou) → `LIMPEZA` (conta paga, ou o garçom liberou a mesa sem conta) → `LIVRE` (a limpeza marcou como limpa). Mesa com conta aberta conta sempre como ocupada.
- **Responsáveis pela mesa**: os garçons da área da mesa; sem área (ou área sem garçom), o garçom do pedido em aberto mais recente; sem nenhum, ninguém. O chamado da mesa vai para os responsáveis e, se não houver, para todos os garçons.
- **Cobrança**: cria um `Pagamento` do valor pedido (ou do que falta), nunca maior do que o que falta; o que o cliente dá a mais entra como gorjeta. Em dinheiro ou sem maquineta, é aprovado na hora. Com maquineta manual ou Pix com QR code, fica pendente até o garçom confirmar. Com maquineta automática, o servidor consulta a maquineta até ela aprovar, recusar ou cancelar. Quando os pagamentos aprovados cobrem o total, a conta fecha, os pedidos ficam pagos e a mesa vai para a limpeza. Uma conta tem no máximo uma cobrança pendente.
- **Taxa de serviço e gorjeta**: cada pagamento guarda a parte dele que é taxa de serviço (proporcional) e a gorjeta. As duas contam, no desempenho, para quem recebeu aquele pagamento.
- **Pix**: o código "copia e cola" (BR Code, com CRC16) é montado no servidor com a chave do restaurante e o valor. Não há consulta a banco: a confirmação é de quem recebe.
- **Estoque**: produto com controle baixa o saldo na mesma transação do pedido; pedido acima do saldo é recusado; saldo zero tira o item do cardápio; cancelar o pedido devolve o saldo.
- **Reservas**: a mesma mesa não aceita duas reservas ativas em horários próximos. Acomodar (fila ou reserva) exige mesa livre e a deixa ocupada.
- **Nota fiscal**: emitida por um serviço externo escolhido pelo gestor (`server/src/lib/fiscal.ts`, um adaptador por serviço). Leva só os produtos; os pagamentos são ajustados ao valor dos produtos. Com a emissão automática ligada, a nota é pedida quando a conta fecha, e uma falha na emissão não desfaz o pagamento.
- **Crédito do recebimento**: no modo "cada garçom tem a sua", conta para o dono da maquineta; no modo compartilhado (e sem maquineta), para quem cobrou.
- **Pedido do cliente**: só aceita produto no cardápio e disponível. O preço vem sempre do servidor. Há limite de pedidos por IP e de pedidos em espera por mesa.
- **Vendas**: o painel soma os pedidos não cancelados pelo dia em que foram feitos, no fuso do servidor (`TZ`).
- **Exclusões**: produto ou categoria com pedidos antigos não é apagado, só sai do cardápio. Mesa com histórico é desativada, não excluída.

## Cliente (`client/`)

- `src/App.tsx` junta as rotas de `src/modules/*/index.tsx` (cada módulo exporta `rotas`) e protege cada uma pelo perfil. A rota pública `/mesa/:codigo` carrega `src/cliente/CardapioDaMesa.tsx` à parte.
- `src/layout/`: a casca (barra lateral, topo, busca, sino, menu do usuário), o login e o painel inicial.
- `src/ui/`: componentes (`Pagina`, `Cartao`, `Tabela`, `Modal`, `Campo`, `Selecao`, `Botao`, `Selo`, `Aviso`, `Abas`, `MenuAcoes`), ícones e o CSS base com as variáveis de cor dos temas claro e escuro.
- `src/lib/`: `api` (fetch com o token), `auth`, `plataforma` (nome, logo e cores), `tema`, `useDados` (busca com estado) e `useAtualizacao` (atualização periódica).

O menu lateral é montado a partir das rotas: a rota entra em um grupo pelo ícone dela (`src/layout/grupos.ts`).
