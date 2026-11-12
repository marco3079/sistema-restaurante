# Arquitetura

## Contêineres

O `docker-compose.yml` sobe três serviços:

| Serviço | O que é | Porta no computador |
|---|---|---|
| `db` | PostgreSQL 16 | `127.0.0.1:${DB_PORT}` (padrão 5433) |
| `api` | Node.js 20 + Express + Prisma | `127.0.0.1:${API_PORT}` (padrão 3091) |
| `web` | nginx com o site React já compilado | `${WEB_PORT}` (padrão 8091) |

O nginx do `web` encaminha `/api/` para o contêiner `api`. O site é o único acesso pela rede: banco e API só respondem ao próprio computador.

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
| `pagamentos` | `/maquinetas`, `/mesas/:id/cobrar`, `/pagamentos/:id`, `/desempenho` | gestor e garçom; cadastro e desempenho só do gestor |
| `pedidos` | `/pedidos`, mudança de situação | gestor, garçom e cozinha |
| `cliente` | `/cliente/mesas/:codigo` (cardápio, pedidos, chamar) | público, pelo código da mesa |
| `painel` | `/painel/resumo`, `/busca`, `/notificacoes` | gestor e garçom |
| `logs` | atividades e log do sistema | gestor |
| `plataforma` | identidade, cores e e-mail | leitura pública da identidade; escrita do gestor |

## Perfis

- `GESTOR`: tudo.
- `GARCOM`: lança pedidos, entrega (PRONTO para ENTREGUE), cancela, atende chamados, ocupa e libera mesas, recebe a conta e marca item esgotado.
- `COZINHA`: vê a fila, inicia o preparo e marca como pronto; marca item esgotado. Não vê mesas, contas nem valores do salão.
- `LIMPEZA`: vê as mesas aguardando limpeza e marca como limpa. Não vê pedidos nem valores.
- `RECEPCAO`: vê a situação das mesas (sem pedidos nem valores) e marca a mesa como ocupada.
- Cliente: não tem conta. Acessa só as rotas `/api/cliente/mesas/:codigo`, com o código secreto da mesa.

## Modelo de dados

Definido em `server/prisma/schema.prisma`.

- `Usuario`: conta da equipe, com `perfil` (`GESTOR` ou `GARCOM`).
- `Categoria` e `Produto`: o cardápio. `Produto.disponivel = false` é item esgotado; `Produto.ativo = false` é item excluído que continua no histórico. O produto também guarda a ficha do prato (apresentação, ingredientes, porção, tempo de preparo, alergênicos e tabela nutricional).
- `Mesa`: número, nome, lugares, `codigo` (segredo do QR code), `chamandoDesde` (cliente chamou o garçom), `estado` (`LIVRE`, `OCUPADA` ou `LIMPEZA`), área e posição na planta (`posX`, `posY`, de 0 a 1).
- `Area`: nome, cor, retângulo na planta e os garçons responsáveis (vários por área).
- `Planta`: a imagem da planta do restaurante (linha única).
- `Maquineta`: nome, operadora, integração (`MANUAL` ou `AUTOMATICA`), identificador e garçom dono.
- `Pagamento`: cobrança da conta de uma mesa (valor, forma, situação, maquineta, garçom que leva o crédito). Aprovado, marca os pedidos dela como pagos.
- `Pedido` e `ItemPedido`: o item guarda a cópia do nome e do preço do produto no momento do pedido.
- `LogAtividade`, `ConfiguracaoPlataforma`, `TokenSenha`, `EmailEnviado`: apoio.

## Regras de negócio

- **Situação do pedido**: `NOVO` → `EM_PREPARO` → `PRONTO` → `ENTREGUE`. `CANCELADO` sai do caminho. Pedido pago não muda mais.
- **Quem muda o pedido**: a cozinha inicia o preparo e marca como pronto; o garçom entrega o que está pronto e cancela; o gestor faz tudo.
- **Conta da mesa**: é o conjunto de pedidos da mesa ainda não pagos e não cancelados.
- **Estado da mesa**: `LIVRE` → `OCUPADA` (cliente chamou ou pediu, ou o garçom ou a recepção marcou) → `LIMPEZA` (conta paga, ou o garçom liberou a mesa sem conta) → `LIVRE` (a limpeza marcou como limpa). Mesa com conta aberta conta sempre como ocupada.
- **Responsáveis pela mesa**: os garçons da área da mesa; sem área (ou área sem garçom), o garçom do pedido em aberto mais recente; sem nenhum, ninguém. O chamado da mesa vai para os responsáveis e, se não houver, para todos os garçons.
- **Cobrança**: cria um `Pagamento` com os pedidos da conta. Em dinheiro ou sem maquineta, é aprovado na hora. Com maquineta manual, fica pendente até o garçom confirmar. Com maquineta automática, o servidor consulta a maquineta até ela aprovar, recusar ou cancelar. Aprovado: os pedidos ficam pagos e a mesa vai para a limpeza. Recusado ou cancelado: os pedidos voltam para a conta.
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
