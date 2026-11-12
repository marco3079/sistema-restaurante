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
- `src/lib/email.ts`, `cripto.ts`, `tokens-senha.ts`, `imagem.ts`: envio de e-mail, cifra da senha do SMTP, links de senha e validação de imagem.

### Módulos

| Módulo | Rotas principais | Quem acessa |
|---|---|---|
| `auth` | login, sair, trocar senha, esqueci a senha | público e logados |
| `cadastros` | equipe (`/usuarios`) e `/perfil` | gestor; perfil para todos |
| `cardapio` | `/categorias`, `/produtos` | leitura para todos; escrita do gestor; disponibilidade para todos |
| `mesas` | `/mesas`, conta, fechar conta, chamado, novo QR code | cadastro do gestor; operação para todos |
| `pedidos` | `/pedidos`, mudança de situação | gestor e garçom |
| `cliente` | `/cliente/mesas/:codigo` (cardápio, pedidos, chamar) | público, pelo código da mesa |
| `painel` | `/painel/resumo`, `/busca`, `/notificacoes` | gestor e garçom |
| `logs` | atividades e log do sistema | gestor |
| `plataforma` | identidade, cores e e-mail | leitura pública da identidade; escrita do gestor |

## Perfis

- `GESTOR`: tudo.
- `GARCOM`: pedidos, mesas (sem cadastrar), cardápio (só marcar disponível ou esgotado) e o próprio perfil.
- Cliente: não tem conta. Acessa só as rotas `/api/cliente/mesas/:codigo`, com o código secreto da mesa.

## Modelo de dados

Definido em `server/prisma/schema.prisma`.

- `Usuario`: conta da equipe, com `perfil` (`GESTOR` ou `GARCOM`).
- `Categoria` e `Produto`: o cardápio. `Produto.disponivel = false` é item esgotado; `Produto.ativo = false` é item excluído que continua no histórico. O produto também guarda a ficha do prato (apresentação, ingredientes, porção, tempo de preparo, alergênicos e tabela nutricional).
- `Mesa`: número, nome, lugares, `codigo` (segredo do QR code) e `chamandoDesde` (cliente chamou o garçom).
- `Pedido` e `ItemPedido`: o item guarda a cópia do nome e do preço do produto no momento do pedido.
- `LogAtividade`, `ConfiguracaoPlataforma`, `TokenSenha`, `EmailEnviado`: apoio.

## Regras de negócio

- **Situação do pedido**: `NOVO` → `EM_PREPARO` → `PRONTO` → `ENTREGUE`. `CANCELADO` sai do caminho. Pedido pago não muda mais.
- **Conta da mesa**: é o conjunto de pedidos da mesa ainda não pagos e não cancelados. A mesa está **ocupada** enquanto tiver conta aberta e **livre** quando não tiver.
- **Fechar conta**: marca todos os pedidos da conta como pagos, com a forma de pagamento, dá como entregues os que faltavam e limpa o chamado da mesa.
- **Pedido do cliente**: só aceita produto no cardápio e disponível. O preço vem sempre do servidor. Há limite de pedidos por IP e de pedidos em espera por mesa.
- **Vendas**: o painel soma os pedidos não cancelados pelo dia em que foram feitos, no fuso do servidor (`TZ`).
- **Exclusões**: produto ou categoria com pedidos antigos não é apagado, só sai do cardápio. Mesa com histórico é desativada, não excluída.

## Cliente (`client/`)

- `src/App.tsx` junta as rotas de `src/modules/*/index.tsx` (cada módulo exporta `rotas`) e protege cada uma pelo perfil. A rota pública `/mesa/:codigo` carrega `src/cliente/CardapioDaMesa.tsx` à parte.
- `src/layout/`: a casca (barra lateral, topo, busca, sino, menu do usuário), o login e o painel inicial.
- `src/ui/`: componentes (`Pagina`, `Cartao`, `Tabela`, `Modal`, `Campo`, `Selecao`, `Botao`, `Selo`, `Aviso`, `Abas`, `MenuAcoes`), ícones e o CSS base com as variáveis de cor dos temas claro e escuro.
- `src/lib/`: `api` (fetch com o token), `auth`, `plataforma` (nome, logo e cores), `tema`, `useDados` (busca com estado) e `useAtualizacao` (atualização periódica).

O menu lateral é montado a partir das rotas: a rota entra em um grupo pelo ícone dela (`src/layout/grupos.ts`).
