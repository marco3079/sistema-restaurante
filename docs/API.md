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
| POST | `/usuarios` | gestor | `{ nome, email, senha, perfil }` (`GESTOR`, `GARCOM`, `COZINHA`, `LIMPEZA` ou `RECEPCAO`) |
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
| PUT | `/produtos/:id/disponivel` | gestor, garçom, cozinha | `{ disponivel }` |
| DELETE | `/produtos/:id` | gestor | tira do cardápio |

Ficha do prato, aceita em `POST` e `PUT /produtos` e devolvida em todas as leituras de produto (inclusive no cardápio da mesa): `detalhes`, `ingredientes` (separados por vírgula), `porcao`, `tempoPreparoMin`, `alergenicos` e `nutricao: { kcal, carboidratosG, proteinasG, gordurasG, gordurasSaturadasG, fibrasG, sodioMg }`. Cada valor pode ser `null`; `nutricao: null` apaga a tabela.

## Mesas

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/mesas` | gestor, garçom | mesas com situação (`LIVRE`, `OCUPADA`, `LIMPEZA`), total em aberto, chamado, área, posição na planta e responsáveis |
| POST | `/mesas` | gestor | `{ numero, nome?, lugares?, areaId?, posX?, posY? }` |
| PUT | `/mesas/:id` | gestor | `{ numero?, nome?, lugares?, ativa?, areaId?, posX?, posY? }` (posição de 0 a 1; `null` tira da planta) |
| DELETE | `/mesas/:id` | gestor | exclui (só sem histórico de pedidos) |
| POST | `/mesas/:id/novo-codigo` | gestor | troca o código do QR code |
| GET | `/chamados` | logado | mesas chamando que são de quem está logado (ver "Responsáveis" na arquitetura) |
| POST | `/mesas/:id/atender-chamado` | gestor, garçom | limpa o chamado |
| POST | `/mesas/:id/ocupar` | gestor, garçom, recepção | marca a mesa como ocupada |
| POST | `/mesas/:id/liberar` | gestor, garçom | manda a mesa ocupada e sem conta para a limpeza |
| POST | `/mesas/:id/limpa` | gestor, garçom, limpeza | marca a mesa como limpa (fica livre) |
| GET | `/limpeza/mesas` | gestor, garçom, limpeza | mesas aguardando limpeza |
| GET | `/recepcao/mesas` | gestor, recepção | situação das mesas, sem pedidos nem valores |
| GET | `/mesas/:id/conta` | gestor, garçom | `{ mesa, pedidos, total, pagamentoPendente }` da conta aberta |

## Salão (planta e áreas)

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/planta` | gestor, garçom | `{ imagem, largura, altura }` ou `null` |
| PUT | `/planta` | gestor | `{ imagem (data URL jpeg, png ou webp), largura, altura }` |
| DELETE | `/planta` | gestor | remove a imagem (mesas e áreas continuam) |
| GET | `/areas` | gestor, garçom | áreas com garçons e contagem de mesas |
| POST | `/areas` | gestor | `{ nome, cor, garconsIds?, x?, y?, largura?, altura? }` (retângulo de 0 a 1) |
| PUT | `/areas/:id` | gestor | altera; `garconsIds` troca a lista de garçons |
| DELETE | `/areas/:id` | gestor | exclui (as mesas ficam sem área) |

## Maquinetas, cobrança e desempenho

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/maquinetas` | gestor, garçom | `{ vinculo, maquinetas, taxaServicoPercentual, pixAtivo, notaFiscalAtiva }`; o garçom recebe só as maquinetas que pode usar; a chave Pix só vai para o gestor |
| PUT | `/maquinetas/configuracao` | gestor | `{ vinculo?, mercadoPagoToken?, taxaServicoPercentual? (0 a 30), pixChave?, pixNome?, pixCidade? }` (o token nunca é devolvido) |
| GET | `/maquinetas/terminais-mercado-pago` | gestor | terminais Point da conta do token |
| POST | `/maquinetas` | gestor | `{ nome, operadora, integracao, identificador?, garcomId? }` |
| PUT | `/maquinetas/:id` | gestor | altera |
| DELETE | `/maquinetas/:id` | gestor | exclui (só sem pagamentos) |
| PUT | `/mesas/:id/conta` | gestor, garçom | `{ taxaServico?, cpfCnpjCliente? }`: tira ou repõe a taxa de serviço e grava o CPF/CNPJ da nota |
| POST | `/mesas/:id/cobrar` | gestor, garçom | `{ formaPagamento, maquinetaId?, valor?, gorjeta? }`; sem `valor`, cobra o que falta. Pagamento `APROVADO` (dinheiro ou sem maquineta) ou `PENDENTE` (maquineta, ou Pix com QR code, que vem em `pix`). A conta fecha quando o total é pago |
| GET | `/pagamentos/:id` | gestor, garçom | situação do pagamento; na maquineta automática, consulta a maquineta |
| POST | `/pagamentos/:id/confirmar` | gestor, garçom | maquineta manual ou Pix com QR code: `{ codigoAutorizacao? }` aprova |
| POST | `/pagamentos/:id/cancelar` | gestor, garçom | `{ recusado? }`: desiste da cobrança; a conta volta a ficar aberta |
| GET | `/desempenho?dias=` | gestor | pedidos atendidos, contas recebidas, taxa de serviço e gorjetas por garçom no período |

## Fila de espera e reservas

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/espera` | gestor, recepção | `{ fila, esperaMediaMin, acomodadosHoje }` |
| POST | `/espera` | gestor, recepção | `{ nome, pessoas, telefone?, observacao? }` |
| PUT | `/espera/:id/status` | gestor, recepção | `{ status: CHAMADO, ACOMODADO ou DESISTIU, mesaId? }`; acomodar exige uma mesa livre, que fica ocupada |
| GET | `/reservas?dia=AAAA-MM-DD` | gestor, recepção | reservas do dia |
| POST | `/reservas` | gestor, recepção | `{ nome, pessoas, dataHora, mesaId?, telefone?, observacao? }`; recusa (`409`) a mesma mesa em horário próximo |
| PUT | `/reservas/:id` | gestor, recepção | altera a reserva |
| PUT | `/reservas/:id/status` | gestor, recepção | `{ status: CHEGOU, CANCELADA ou NAO_COMPARECEU, mesaId? }`; `CHEGOU` ocupa a mesa |

## Estoque

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/estoque` | gestor, cozinha | produtos com controle de estoque, saldo, mínimo e situação (`OK`, `BAIXO`, `ZERADO`) |
| GET | `/estoque/:id/movimentos` | gestor | histórico do item |
| POST | `/estoque/:id/movimentos` | gestor | `{ tipo: ENTRADA, SAIDA ou AJUSTE, quantidade, motivo? }`; no `AJUSTE`, a quantidade é o saldo contado |

O controle é ligado no produto (`PUT /produtos/:id` com `controlaEstoque`, `estoqueMinimo`, `ncm`, `cfop`).

## Nota fiscal

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/fiscal/configuracao` | gestor | serviço, ambiente, CNPJ, padrões fiscais e quais credenciais estão gravadas (os valores nunca são devolvidos) |
| PUT | `/fiscal/configuracao` | gestor | `{ provedor (NENHUM, WEBHOOK, FOCUS_NFE, WEBMANIA), ambiente, cnpj, webhookUrl, emissaoAutomatica, ncmPadrao, cfopPadrao, csosnPadrao, classeImposto, credenciais? }` |
| GET | `/fiscal/contas?dias=` | gestor | contas pagas no período, com valores, formas de pagamento e nota |
| POST | `/contas/:id/nota` | gestor, garçom | emite a nota da conta fechada |
| GET | `/contas/:id/nota` | gestor, garçom | nota da conta |
| POST | `/notas/:id/consultar` | gestor | consulta no serviço a nota que ficou em processamento |

## Pedidos

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/pedidos?ver=&status=&mesaId=` | gestor, garçom, cozinha | `ver`: `andamento` (padrão), `hoje` ou `todos` |
| POST | `/pedidos` | gestor, garçom | `{ mesaId, itens: [{ produtoId, quantidade, observacao? }], nomeCliente?, observacao? }` |
| PUT | `/pedidos/:id/status` | gestor, garçom, cozinha | `{ status }`. Cozinha: `EM_PREPARO` e `PRONTO`. Garçom: `ENTREGUE` (só de `PRONTO`) e `CANCELADO`. Gestor: todos |

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
