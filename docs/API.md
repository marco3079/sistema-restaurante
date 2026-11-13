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
| GET | `/atualizacao` | gestor | versão instalada, última do GitHub, commits pendentes, tarefa em andamento e cópias do banco; `{ ativo: false, motivo }` se o atualizador não responde |
| POST | `/atualizacao/verificar` | gestor | consulta o GitHub agora e devolve o mesmo estado |
| POST | `/atualizacao/aplicar` | gestor | `{ forcar? }`: copia o banco, baixa o último commit, reconstrói e reinicia a API e o site; `409` se já há uma em andamento. Com `forcar`, reconstrói mesmo sem commit novo |
| POST | `/logs/tela` | logado | registra a tela aberta |
| GET | `/logs` | gestor | log do sistema, com filtros |
| GET | `/logs/resumo` | gestor | resumo das atividades |
| GET | `/logs/usuarios/:id/resumo` | gestor | atividade de um usuário |

## Ganhos e gastos, caixa e relatórios

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET, POST, PUT, DELETE | `/financeiro/categorias` | gestor | categorias de despesa e de receita |
| GET, POST, PUT, DELETE | `/financeiro/lancamentos` | gestor | despesas e outras receitas; `POST /financeiro/lancamentos/:id/pagar` marca como pago |
| GET | `/financeiro/resumo?de&ate` | gestor | vendas, outras receitas, despesas, resultado, contas a pagar, por dia, por categoria e por forma de pagamento |
| GET | `/caixa` | gestor, garçom, recepção | caixa aberto e o último fechado |
| POST | `/caixa/abrir`, `/caixa/movimentos`, `/caixa/fechar` | gestor, garçom, recepção | troco inicial; sangria ou reforço; fechamento com o dinheiro contado |
| GET | `/caixa/historico?dias=` | gestor | caixas fechados |
| GET | `/relatorios/vendas?de&ate` | gestor | resumo, produtos, categorias, por hora, por dia da semana e por dia |

## Insumos, fichas e compras

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET, POST, PUT, DELETE | `/insumos` | gestor (a cozinha lê, sem custo) | insumos com saldo, mínimo e custo médio |
| GET, POST | `/insumos/:id/movimentos` | gestor | histórico; entrada (com custo), saída e acerto de contagem |
| GET | `/fichas` | gestor | custo, margem e CMV de cada produto |
| PUT | `/fichas/:produtoId` | gestor | troca a ficha técnica do produto |
| GET, POST, PUT, DELETE | `/fornecedores` | gestor | fornecedores |
| GET, POST, PUT | `/compras` | gestor | pedidos de compra; `/compras/:id/receber` dá entrada no estoque e lança a despesa; `/compras/:id/cancelar`; `/compras/sugestao` lista o que está no mínimo |

## Equipe: escala, ponto e rateio

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET, POST, PUT, DELETE | `/escala` | gestor | turnos; `POST /escala/copiar` copia uma semana |
| GET | `/escala/minha` | todos | os próximos turnos de quem está logado |
| GET, POST | `/ponto/meu`, `/ponto/entrada`, `/ponto/saida` | todos | o próprio ponto |
| GET, POST, PUT, DELETE | `/ponto` | gestor | ponto de todos, com totais e correções |
| GET, PUT | `/rateio/regra` | gestor | percentuais por perfil e modo de divisão |
| GET | `/rateio/simular?de&ate` | gestor | quanto cabe a cada pessoa |
| POST, GET, DELETE | `/rateio/fechar`, `/rateio/repasses` | gestor | fecha e guarda o rateio de um período |

## Cardápio: opções, promoções, cupons e idiomas

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| PUT | `/produtos/:id/opcoes` | gestor | troca os grupos de opções e adicionais do produto |
| GET, PUT | `/cardapio/idiomas` | todos leem; gestor grava | idiomas do cardápio do cliente |
| GET, POST, PUT, DELETE | `/promocoes` | gestor (o garçom lê) | preço promocional por dia e horário |
| GET, POST, PUT, DELETE | `/cupons` | gestor | cupons de desconto |

Os produtos passam a trazer `precoAtual`, `promocao`, `combo`, `comboItens`, `grupos` e `traducoes`. No pedido, cada item aceita `opcoes` (ids das opções escolhidas).

## Descontos na conta, clientes e avaliações

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| POST, DELETE | `/mesas/:id/conta/cupom` | gestor, garçom | aplica ou tira o cupom |
| PUT | `/mesas/:id/conta/cliente` | gestor, garçom, recepção | liga o cliente pelo telefone (cadastra se for novo) |
| POST, DELETE | `/mesas/:id/conta/pontos` | gestor, garçom | usa ou devolve pontos |
| PUT | `/mesas/:id/conta/desconto` | gestor (garçom conforme a permissão) | desconto em reais, com motivo |
| GET, POST, PUT, DELETE | `/clientes` | gestor, recepção (garçom lê) | clientes; `POST /clientes/:id/pontos` ajusta pontos |
| GET, PUT | `/fidelidade/configuracao` | gestor grava | pontos por real e valor do ponto |
| GET | `/avaliacoes?de&ate` | gestor | notas, médias e comentários |
| GET, POST | `/cliente/mesas/:codigo/avaliacao` | público | conta a avaliar e envio da avaliação |

## Setores e mesas

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET, POST, PUT, DELETE | `/setores` | gestor grava | setores de preparo; `PUT /setores/:id/usuarios` define quem trabalha no setor; `GET /setores/meu` |
| POST | `/mesas/:id/trocar`, `/mesas/:id/juntar`, `/mesas/:id/transferir-itens` | gestor, garçom | muda a conta de mesa, junta duas contas, move itens |

## Delivery e retirada

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/delivery/cardapio` | público | cardápio, bairros, pedido mínimo e tempos |
| POST | `/delivery/pedidos` | público | cria o pedido de entrega ou retirada; devolve o código de acompanhamento |
| GET | `/delivery/acompanhar/:codigo` | público | situação do pedido (sem telefone nem endereço) |
| GET | `/delivery/pedidos?ver=` | gestor, garçom, recepção | pedidos de delivery com a conta |
| POST | `/delivery/pedidos/:id/saiu`, `/concluir`, `/cancelar` | gestor, garçom, recepção | saiu para entrega; entregue e pago; cancelado |
| GET, PUT | `/delivery/configuracao` | gestor | liga e desliga, pedido mínimo, tempos e recado |
| POST, PUT, DELETE | `/delivery/bairros` | gestor | bairros e taxas |

## Sistema: tempo real, notificações, permissões, backup

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/eventos` | logado | fluxo de eventos (`text/event-stream`): avisa que algo mudou, sem dados |
| GET | `/cliente/mesas/:codigo/eventos` | público | o mesmo, para a tela do cliente |
| GET, PUT | `/operacao/configuracao` | gestor grava | minutos para o alerta de atraso |
| GET, POST, DELETE | `/push/chave`, `/push/inscricoes`, `/push/teste` | logado | notificações no aparelho de quem está logado |
| GET, PUT | `/permissoes`, `/permissoes/minhas`, `/permissoes/senha` | gestor (cada um lê as suas) | regras das ações sensíveis e senha do gestor |
| GET, POST, PUT, DELETE | `/backup`, `/backup/config`, `/backup/baixar`, `/backup/restaurar`, `/backup/arquivo` | gestor | backup diário, cópia manual, download e restauração |

Ação que pede a senha do gestor responde `403` com `detalhes.codigo = "SENHA_GESTOR"`; repita a requisição com o cabeçalho `x-senha-gestor`.
