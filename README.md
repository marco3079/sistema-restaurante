<p align="center"><img src="client/public/logo-simbolo.svg" alt="Sistema de Restaurante" width="120"></p>

<h1 align="center">Sistema de Restaurante</h1>

<p align="center">Pedidos, mesas, cardápio e contas em um único app web, com cardápio na mesa por QR code.</p>

<p align="center">
  <img src="https://img.shields.io/badge/licen%C3%A7a-MIT-blue" alt="Licença MIT">
  <img src="https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white" alt="Docker Compose">
  <img src="https://img.shields.io/badge/Node-20-339933?logo=node.js&logoColor=white" alt="Node 20">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL 16">
</p>

<p align="center"><img src="docs/imagens/painel-claro.png" alt="Painel do gestor" width="900"></p>

## Sumário

- [Visão geral](#visão-geral)
- [Funcionalidades](#funcionalidades)
- [Telas](#telas)
- [Instalação rápida](#instalação-rápida)
- [Primeiro acesso](#primeiro-acesso)
- [Cardápio na mesa (QR code)](#cardápio-na-mesa-qr-code)
- [Dados de demonstração](#dados-de-demonstração)
- [Maquinetas](#maquinetas)
- [Configuração](#configuração)
- [Arquitetura](#arquitetura)
- [Desenvolvimento](#desenvolvimento)
- [Origem](#origem)
- [Segurança](#segurança)
- [Licença](#licença)

## Visão geral

O Sistema de Restaurante cuida do atendimento do salão: o cliente abre o cardápio no celular pelo QR code da mesa e faz o pedido; a cozinha prepara, o garçom entrega e recebe a conta, a limpeza libera a mesa e a recepção acomoda o próximo cliente. Funciona no computador e no celular.

Um único app, com uma entrada para cada pessoa:

| Quem | Entra com | O que faz |
|---|---|---|
| **Gestor** | login | Tudo: painel de vendas, cardápio, mesas, planta do salão, áreas, equipe, maquinetas, desempenho, atividades e configurações. |
| **Garçom** | login | Lança pedidos, entrega o que a cozinha deixou pronto, atende os chamados das mesas dele, recebe a conta e marca a mesa como ocupada ou liberada. |
| **Cozinha** | login | Vê a fila, inicia o preparo e marca o pedido como pronto. Marca item esgotado. |
| **Limpeza** | login | Vê as mesas que ficaram vagas e marca cada uma como limpa. |
| **Recepção** | login | Vê quais mesas estão livres, em limpeza ou ocupadas e marca a mesa como ocupada ao acomodar o cliente. |
| **Cliente** | QR code da mesa, sem login | Vê o cardápio, pede, acompanha o pedido e chama o garçom. |

## Funcionalidades

**Pedidos**

- Caminho do pedido: novo, em preparo, pronto, entregue. A cozinha inicia o preparo e marca como pronto; o garçom entrega; o gestor pode tudo. Gestor e garçom cancelam.
- Fila em três colunas, que se atualiza sozinha.
- O sino do topo avisa cada perfil do que é dele: pedido novo para a cozinha, pedido pronto e mesa chamando para o garçom, mesa vaga para a limpeza.

**Mesas e salão**

- Cada mesa está livre, ocupada ou aguardando limpeza. Ela fica ocupada quando o cliente chama o garçom ou faz um pedido, ou quando o garçom ou a recepção marca. Vai para a limpeza quando a conta é paga ou o garçom libera. Volta a ficar livre quando a limpeza marca como limpa.
- Planta do restaurante: o gestor importa a imagem da planta, arrasta as mesas para o lugar e desenha as áreas (salão, varanda...).
- Áreas com garçons responsáveis, com um ou mais garçons por área.
- Quando o cliente chama, um popup "Mesa X está chamando" aparece na tela dos garçons da área da mesa. Sem área, aparece para o garçom do pedido em aberto; sem nenhum dos dois, para todos os garçons.
- QR code de cada mesa para imprimir, com troca do código quando preciso.

**Cardápio**

- Categorias e produtos com foto, preço, descrição e disponibilidade.
- Ficha de cada prato: apresentação, ingredientes, porção, tempo de preparo, alergênicos e tabela nutricional.
- Recomendados da casa: o gestor marca os itens que aparecem em destaque. Sem nenhum marcado, aparecem os mais pedidos dos últimos 30 dias.

**Conta e maquineta**

- O garçom recebe a conta em dinheiro, Pix, débito ou crédito.
- Maquinetas cadastradas pelo gestor, que escolhe a operadora de cada uma (Mercado Pago Point, Stone, PagBank, Cielo ou outra) e como elas se ligam aos garçons: cada garçom com a sua, ou compartilhadas.
- Integração manual (qualquer operadora): o garçom passa o valor na maquineta e confirma no sistema.
- Integração automática: o sistema manda o valor para a maquineta e fecha a conta quando ela aprova. Disponível para o Mercado Pago Point e para uma maquineta simulada, de teste. Veja [Maquinetas](#maquinetas).
- Desempenho dos garçons: pedidos atendidos, contas recebidas, valor recebido (total e na maquineta) e média por conta, por período.

**Cliente na mesa**

- Cardápio por categoria, com foto e preço, e área de recomendados no topo.
- Perfil do prato ao tocar no item, com ingredientes e tabela nutricional.
- Sacola, nome e observação do pedido.
- Acompanhamento da situação de cada pedido e do total da mesa.
- Botão para chamar o garçom.

**Gestão**

- Painel com vendas do dia, pedidos, mesas ocupadas, valor médio por pedido e gráfico de vendas por mês (só o gestor vê as vendas).
- Equipe: contas de gestor, garçom, cozinha, limpeza e recepção.
- Atividades e log do sistema (quem fez o quê).
- Nome, logo, cores e envio de e-mails.

## Telas

Os dados dos prints são fictícios (dados de demonstração). As fotos dos pratos foram geradas por IA.

**Cardápio na mesa (cliente, no celular)**

<p>
  <img src="docs/imagens/cliente-cardapio.png" alt="Cardápio da mesa no celular" width="300">
  <img src="docs/imagens/cliente-pedidos.png" alt="Acompanhamento dos pedidos da mesa no celular" width="300">
</p>

**Recomendados (faixa que rola com o dedo, com o mouse ou pelas setas)**

<img src="docs/imagens/recomendados.png" alt="Área de recomendados no topo do cardápio" width="700">

**Perfil do prato (ao tocar em um item)**

<p>
  <img src="docs/imagens/cliente-prato.png" alt="Perfil do prato com foto, porção, preparo e alergênicos" width="300">
  <img src="docs/imagens/cliente-prato-nutricao.png" alt="Ingredientes e tabela nutricional do prato" width="300">
</p>

**Fila de pedidos**

<img src="docs/imagens/pedidos.png" alt="Fila de pedidos em três colunas" width="900">

**Cozinha**

<img src="docs/imagens/cozinha.png" alt="Fila da cozinha, com iniciar preparo e marcar pronto" width="900">

**Salão com a planta, as áreas e as mesas**

<img src="docs/imagens/salao.png" alt="Planta do restaurante com áreas coloridas e mesas posicionadas" width="900">

**Mesa chamando (popup na tela do garçom da área)**

<img src="docs/imagens/chamado.png" alt="Popup avisando que a mesa está chamando" width="900">

**Cobrança na maquineta**

<img src="docs/imagens/cobranca.png" alt="Conta da mesa aguardando a maquineta" width="900">

**Maquinetas e desempenho dos garçons**

<img src="docs/imagens/maquinetas.png" alt="Cadastro de maquinetas e modo de vínculo com os garçons" width="900">

<img src="docs/imagens/desempenho.png" alt="Desempenho dos garçons no período" width="900">

**Limpeza e recepção**

<img src="docs/imagens/limpeza.png" alt="Mesas aguardando limpeza" width="900">

<img src="docs/imagens/recepcao.png" alt="Mesas livres, em limpeza e ocupadas para a recepção" width="900">

**Mesas e contas**

<img src="docs/imagens/mesas.png" alt="Mesas com situação, total em aberto e chamado" width="900">

**Cardápio (gestão)**

<img src="docs/imagens/cardapio.png" alt="Produtos do cardápio com foto, preço e situação" width="900">

**Tema escuro e login**

<img src="docs/imagens/painel-escuro.png" alt="Painel do gestor no tema escuro" width="900">

<img src="docs/imagens/login.png" alt="Tela de login" width="900">

## Instalação rápida

Requisito: [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado e aberto.

**Windows (PowerShell)**

```
git clone https://github.com/marco3079/sistema-restaurante.git
cd sistema-restaurante
powershell -ExecutionPolicy Bypass -File .\instalar.ps1
```

**Linux e macOS**

```
git clone https://github.com/marco3079/sistema-restaurante.git
cd sistema-restaurante
bash instalar.sh
```

O instalador cria o arquivo `.env` com segredos aleatórios, baixa as imagens e sobe três contêineres: banco, API e site. No fim ele mostra o endereço do site (padrão `http://localhost:8091`).

O passo a passo completo, para quem nunca usou o terminal, está em [INSTALAR.md](INSTALAR.md).

## Primeiro acesso

1. Abra o endereço do site.
2. Entre com `gestor@restaurante.local` e a senha `gestor1234`.
3. Troque a senha em **Meu perfil**.
4. Cadastre, nesta ordem: categorias, produtos, mesas e a equipe (garçons, cozinha, limpeza e recepção).
5. Em **Salão**, importe a planta, posicione as mesas, crie as áreas e escolha os garçons de cada área.
6. Em **Maquinetas**, cadastre as maquinetas e escolha como elas se ligam aos garçons.
7. Em **Mesas**, abra o **QR code** de cada mesa e imprima.

## Cardápio na mesa (QR code)

Cada mesa tem um endereço próprio, `/mesa/<código>`, com um código secreto. O QR code leva a esse endereço.

- O QR code é gerado com o endereço em que o gestor está usando o sistema. Para o celular do cliente alcançar o cardápio, abra o sistema pelo endereço da rede do restaurante (por exemplo `http://192.168.0.10:8091`) ou pelo endereço público do site antes de imprimir.
- Em **Mesas**, o gestor pode **gerar novo QR code** para uma mesa. O QR code antigo para de funcionar.
- O pedido do cliente entra na fila como **Novo**. O pagamento é feito com o garçom, ao fechar a conta.
- O cardápio da mesa tem limite de pedidos por celular e por mesa em um intervalo de tempo.

## Dados de demonstração

Para começar com um cardápio de exemplo, 10 mesas e uma conta de cada perfil, instale com a opção de demonstração em um banco novo:

- Windows: `powershell -ExecutionPolicy Bypass -File .\instalar.ps1 -Demo`
- Linux e macOS: `bash instalar.sh --demo`

Os itens da demonstração vêm com foto (arquivos em `client/public/cardapio/`) e ficha completa (`server/prisma/demo-cardapio.json`). Os valores nutricionais da demonstração são estimativas: troque pelos do seu cardápio. Não há pedidos nem vendas de exemplo: o painel começa zerado. A planta, as áreas e as maquinetas o gestor cadastra (os prints deste README mostram um salão já montado). A demonstração cria uma conta de cada perfil, além do gestor (use só para teste e troque as senhas):

| Perfil | E-mail | Senha |
|---|---|---|
| Garçom | `garcom@restaurante.demo` | `garcom1234` |
| Cozinha | `cozinha@restaurante.demo` | `cozinha1234` |
| Limpeza | `limpeza@restaurante.demo` | `limpeza1234` |
| Recepção | `recepcao@restaurante.demo` | `recepcao1234` |

## Configuração

O arquivo `.env` (criado pelo instalador a partir de `.env.example`) define:

| Variável | Para que serve | Padrão |
|---|---|---|
| `POSTGRES_PASSWORD` | Senha do banco | gerada pelo instalador |
| `JWT_SECRET` | Segredo que assina os logins | gerado pelo instalador |
| `ADMIN_NOME` | Nome da conta do gestor criada na primeira subida | `Gestor` |
| `ADMIN_EMAIL` | E-mail da conta do gestor | `gestor@restaurante.local` |
| `ADMIN_SENHA` | Senha inicial do gestor (8 caracteres ou mais) | `gestor1234` |
| `SEED_DEMO` | `true` carrega os dados de demonstração | `false` |
| `WEB_PORT` | Porta do site | `8091` |
| `API_PORT` | Porta da API (só neste computador) | `3091` |
| `DB_PORT` | Porta do banco (só neste computador) | `5433` |
| `TZ` | Fuso horário do servidor (define o que é "hoje" no painel) | `America/Sao_Paulo` |

### Como conectar um e-mail

O sistema envia e-mails de recuperação de senha e de boas-vindas a novos usuários, depois que o gestor informa uma conta de e-mail em **Configurações > E-mail**: servidor de envio (SMTP), porta, usuário, senha, remetente e o endereço do site. Use **Enviar e-mail de teste** para conferir.

## Maquinetas

O gestor cadastra as maquinetas em **Maquinetas** e escolhe, para cada uma, a operadora e a integração.

- **Manual** (Mercado Pago, Stone, PagBank, Cielo ou outra): ao receber a conta, o garçom escolhe a maquineta, digita o valor nela e confirma no sistema que o pagamento foi aprovado (com o código do comprovante, se quiser). O recebimento fica registrado na maquineta e no nome do garçom.
- **Automática, Mercado Pago Point**: o sistema envia a cobrança para a maquineta pela API do Mercado Pago (Orders API) e fecha a conta quando ela aprova. O gestor informa o token de acesso (Access Token) da conta em **Maquinetas** e escolhe o terminal em "Buscar terminais". A maquineta precisa estar no modo PDV. Esta integração foi escrita seguindo a documentação do Mercado Pago, mas **ainda não foi testada com uma maquineta real**: teste com valores pequenos antes de usar no dia a dia.
- **Automática, simulada**: maquineta de teste que aprova sozinha alguns segundos depois. Serve para conhecer o fluxo sem aparelho. Com o identificador `RECUSAR`, ela recusa.
- Para Stone, PagBank e Cielo a integração automática não está disponível: use a manual.

O gestor também escolhe como as maquinetas se ligam aos garçons:

- **Cada garçom tem a sua**: cada maquineta tem um dono. O garçom só cobra na dele, e o que passa nela conta para ele no desempenho.
- **Compartilhadas**: qualquer garçom usa qualquer maquineta, e o recebimento conta para quem cobrou.

## Arquitetura

```
client/   React 18 + TypeScript + Vite (site; nginx em produção)
server/   Node.js 20 + Express + Prisma (API)
          PostgreSQL 16 (banco)
```

- O servidor carrega sozinho cada pasta de `server/src/modules/<modulo>/routes.ts`. Cada módulo exporta as rotas autenticadas (`default`) e, se tiver, as públicas (`publico`).
- O cliente junta as rotas de `client/src/modules/<modulo>/index.tsx` e monta o menu pelo perfil.
- Módulos: `auth`, `cadastros` (equipe e perfil), `cardapio`, `mesas`, `salao` (planta e áreas), `pedidos`, `pagamentos` (maquinetas, cobrança e desempenho), `cliente` (cardápio público da mesa), `painel`, `logs` e `plataforma`.

Mais detalhes em [docs/ARQUITETURA.md](docs/ARQUITETURA.md) e [docs/API.md](docs/API.md).

## Desenvolvimento

Com um PostgreSQL acessível (o do `docker compose up -d db` serve):

```
cd server
copy .env.example .env      (no Linux/macOS: cp .env.example .env)
npm install
npx prisma db push
npm run seed
npm run dev
```

```
cd client
npm install
npm run dev
```

O site de desenvolvimento abre em `http://localhost:5173` e encaminha `/api` para `http://localhost:3000`.

Verificações antes de entregar uma mudança:

```
cd server && npx tsc --noEmit
cd client && npx tsc --noEmit
cd client && npx vite build
```

## Origem

Este projeto usa a estrutura e o visual do [sistema-escolar](https://github.com/marco3079/sistema-escolar): a mesma casca (barra lateral, topo, painel, login, temas claro e escuro), a mesma biblioteca de componentes e a mesma organização em módulos. Os módulos escolares deram lugar aos do restaurante.

## Segurança

Veja [SECURITY.md](SECURITY.md). Em resumo: senhas com bcrypt, login por JWT de 12 horas, permissão por perfil em cada rota, banco e API publicados só em `127.0.0.1`, token do Mercado Pago guardado cifrado e log de atividades. O cardápio da mesa é público por natureza: quem tem o QR code pode pedir naquela mesa.

## Licença

[MIT](LICENSE).
