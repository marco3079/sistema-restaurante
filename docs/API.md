# API

Todas as rotas ficam sob `/api`. Corpo e resposta em JSON.

## Convenções

- **Autenticação**: `Authorization: Bearer <token>`, com o token devolvido pelo login (validade de 12 horas). Rotas marcadas como públicas não pedem token.
- **Erros**: `{ "erro": "mensagem", "detalhes": ... }` com o código HTTP adequado (400 dados inválidos, 401 sem login, 403 sem permissão, 404 não encontrado, 409 duplicado, 429 muitas tentativas).
- **Valores em reais**: números com duas casas (`24.9`).
- **Datas**: ISO 8601.

## Sessão

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/saude` | público | `{ "ok": true }` |
| POST | `/auth/login` | público | `{ email, senha }` → `{ token, usuario }` |
| POST | `/auth/esqueci-senha` | público | envia o link de recuperação, se o e-mail estiver ligado |
| GET | `/auth/redefinir-senha/:token` | público | confere se o link vale |
| POST | `/auth/redefinir-senha` | público | `{ token, novaSenha }` |
| POST | `/auth/sair` | logado | registra a saída |
| GET | `/auth/me` | logado | dados do usuário |
| POST | `/auth/trocar-senha` | logado | `{ senhaAtual, novaSenha }` |

## Equipe e perfil

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/usuarios?perfil=&busca=` | gestor | lista a equipe |
| POST | `/usuarios` | gestor | `{ nome, email, senha, perfil }` (`GESTOR` ou `GARCOM`) |
| PUT | `/usuarios/:id` | gestor | `{ nome?, email?, telefone?, ativo? }` |
| POST | `/usuarios/:id/redefinir-senha` | gestor | `{ novaSenha }` |
| GET | `/perfil/meu` | logado | dados da própria conta |
| PUT | `/perfil/meu` | logado | `{ telefone }` |
| GET | `/perfil/completo` | logado | conta, números e atividade recente |
| PUT | `/perfil/foto` | logado | `{ foto }` (data URL, endereço http(s) ou `null`) |

## Cardápio

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/categorias` | logado | categorias com a contagem de produtos |
| POST | `/categorias` | gestor | `{ nome, ordem?, ativa? }` |
| PUT | `/categorias/:id` | gestor | altera |
| DELETE | `/categorias/:id` | gestor | exclui (só sem produtos) |
| GET | `/produtos?categoriaId=&busca=` | logado | produtos do cardápio |
| POST | `/produtos` | gestor | `{ categoriaId, nome, descricao?, preco, imagem?, disponivel? }` mais a ficha (abaixo) |
| PUT | `/produtos/:id` | gestor | altera |
| PUT | `/produtos/:id/disponivel` | logado | `{ disponivel }` |
| DELETE | `/produtos/:id` | gestor | tira do cardápio |

Ficha do prato, aceita em `POST` e `PUT /produtos` e devolvida em todas as leituras de produto (inclusive no cardápio da mesa): `detalhes`, `ingredientes` (separados por vírgula), `porcao`, `tempoPreparoMin`, `alergenicos` e `nutricao: { kcal, carboidratosG, proteinasG, gordurasG, gordurasSaturadasG, fibrasG, sodioMg }`. Cada valor pode ser `null`; `nutricao: null` apaga a tabela.

## Mesas

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/mesas` | logado | mesas com situação, total em aberto e chamado |
| POST | `/mesas` | gestor | `{ numero, nome?, lugares? }` |
| PUT | `/mesas/:id` | gestor | `{ numero?, nome?, lugares?, ativa? }` |
| DELETE | `/mesas/:id` | gestor | exclui (só sem histórico de pedidos) |
| POST | `/mesas/:id/novo-codigo` | gestor | troca o código do QR code |
| POST | `/mesas/:id/atender-chamado` | logado | limpa o chamado |
| GET | `/mesas/:id/conta` | logado | `{ mesa, pedidos, total }` da conta aberta |
| POST | `/mesas/:id/fechar-conta` | logado | `{ formaPagamento }` (`Dinheiro`, `Pix`, `Cartão de débito` ou `Cartão de crédito`) |

## Pedidos

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/pedidos?ver=&status=&mesaId=` | logado | `ver`: `andamento` (padrão), `hoje` ou `todos` |
| POST | `/pedidos` | logado | `{ mesaId, itens: [{ produtoId, quantidade, observacao? }], nomeCliente?, observacao? }` |
| PUT | `/pedidos/:id/status` | logado | `{ status }`: `NOVO`, `EM_PREPARO`, `PRONTO`, `ENTREGUE` ou `CANCELADO` |

## Cardápio da mesa (cliente)

Rotas públicas. O `:codigo` é o segredo da mesa, o mesmo do QR code.

| Método | Rota | O que faz |
|---|---|---|
| GET | `/cliente/mesas/:codigo` | `{ mesa, categorias: [{ id, nome, produtos }], recomendados: [ids], origemRecomendados }` (`CASA` ou `MAIS_PEDIDOS`) |
| GET | `/cliente/mesas/:codigo/pedidos` | pedidos da conta aberta da mesa, total e se há chamado |
| POST | `/cliente/mesas/:codigo/pedidos` | `{ itens: [{ produtoId, quantidade }], nomeCliente?, observacao? }` |
| POST | `/cliente/mesas/:codigo/chamar` | chama o garçom |

## Painel, busca e avisos

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/painel/resumo` | logado | `{ primeiroNome, cartoes, desempenho, destaque, recentes }` |
| GET | `/busca?q=` | logado | produtos, mesas e (para o gestor) usuários |
| GET | `/notificacoes` | logado | mesas chamando, pedidos novos e pedidos prontos |

## Plataforma e logs

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/plataforma` | público | nome, slogan, logo e cores |
| GET | `/configuracoes` | gestor | configurações completas (sem a senha do e-mail) |
| PUT | `/configuracoes/identidade` | gestor | nome, slogan, logo e cores |
| PUT | `/configuracoes/email` | gestor | servidor de e-mail |
| POST | `/configuracoes/email/teste` | gestor | envia um e-mail de teste |
| GET | `/configuracoes/email/historico` | gestor | histórico de envios |
| POST | `/logs/tela` | logado | registra a tela aberta |
| GET | `/logs` | gestor | log do sistema, com filtros |
| GET | `/logs/resumo` | gestor | resumo das atividades |
| GET | `/logs/usuarios/:id/resumo` | gestor | atividade de um usuário |
