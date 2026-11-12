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
- [Configuração](#configuração)
- [Arquitetura](#arquitetura)
- [Desenvolvimento](#desenvolvimento)
- [Origem](#origem)
- [Segurança](#segurança)
- [Licença](#licença)

## Visão geral

O Sistema de Restaurante cuida do atendimento do salão: o cliente abre o cardápio no celular pelo QR code da mesa e faz o pedido; a equipe vê o pedido na fila, prepara, entrega e fecha a conta. Funciona no computador e no celular.

Um único app tem três entradas:

- **Gestor** (login): painel com vendas, pedidos, mesas, cardápio, equipe, atividades e configurações.
- **Garçom** (login): fila de pedidos, mesas e contas, e o cardápio para marcar o que esgotou.
- **Cliente** (sem login): cardápio da mesa em `/mesa/<código>`, aberto pelo QR code.

## Funcionalidades

**Gestor**

- Painel com vendas do dia, pedidos, mesas ocupadas, valor médio por pedido e gráfico de vendas por mês
- Cardápio: categorias e produtos com foto, preço, descrição e disponibilidade
- Mesas: cadastro, QR code para imprimir, troca do QR code, conta e fechamento
- Equipe: contas de gestor e garçom, redefinição de senha, ativar e desativar
- Atividades e log do sistema (quem fez o quê)
- Configurações: nome, logo, cores e envio de e-mails

**Garçom**

- Fila de pedidos em três colunas: novo, em preparo e pronto
- Lançar pedido para uma mesa
- Atender o chamado de uma mesa
- Ver a conta e receber (dinheiro, Pix, débito ou crédito)
- Marcar um item como esgotado

**Cliente na mesa**

- Cardápio por categoria, com foto e preço
- Sacola, nome e observação do pedido
- Acompanhamento da situação de cada pedido e do total da mesa
- Botão para chamar o garçom

O sino do topo avisa a equipe de pedido novo, pedido pronto e mesa chamando. As telas de pedidos e de mesas se atualizam sozinhas a cada poucos segundos.

## Telas

Os dados dos prints são fictícios (dados de demonstração). As fotos dos pratos foram geradas por IA.

**Cardápio na mesa (cliente, no celular)**

<p>
  <img src="docs/imagens/cliente-cardapio.png" alt="Cardápio da mesa no celular" width="300">
  <img src="docs/imagens/cliente-pedidos.png" alt="Acompanhamento dos pedidos da mesa no celular" width="300">
</p>

**Fila de pedidos**

<img src="docs/imagens/pedidos.png" alt="Fila de pedidos em três colunas" width="900">

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
4. Cadastre, nesta ordem: categorias, produtos, mesas e a equipe (garçons).
5. Em **Mesas**, abra o **QR code** de cada mesa e imprima.

## Cardápio na mesa (QR code)

Cada mesa tem um endereço próprio, `/mesa/<código>`, com um código secreto. O QR code leva a esse endereço.

- O QR code é gerado com o endereço em que o gestor está usando o sistema. Para o celular do cliente alcançar o cardápio, abra o sistema pelo endereço da rede do restaurante (por exemplo `http://192.168.0.10:8091`) ou pelo endereço público do site antes de imprimir.
- Em **Mesas**, o gestor pode **gerar novo QR code** para uma mesa. O QR code antigo para de funcionar.
- O pedido do cliente entra na fila como **Novo**. O pagamento é feito com o garçom, ao fechar a conta.
- O cardápio da mesa tem limite de pedidos por celular e por mesa em um intervalo de tempo.

## Dados de demonstração

Para testar com cardápio, mesas e alguns meses de pedidos fictícios, instale com a opção de demonstração em um banco novo:

- Windows: `powershell -ExecutionPolicy Bypass -File .\instalar.ps1 -Demo`
- Linux e macOS: `bash instalar.sh --demo`

Os itens da demonstração vêm com foto (arquivos em `client/public/cardapio/`). A demonstração cria dois garçons (`ana@restaurante.demo` e `bruno@restaurante.demo`, senha `garcom1234`). Use só para teste.

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

## Arquitetura

```
client/   React 18 + TypeScript + Vite (site; nginx em produção)
server/   Node.js 20 + Express + Prisma (API)
          PostgreSQL 16 (banco)
```

- O servidor carrega sozinho cada pasta de `server/src/modules/<modulo>/routes.ts`. Cada módulo exporta as rotas autenticadas (`default`) e, se tiver, as públicas (`publico`).
- O cliente junta as rotas de `client/src/modules/<modulo>/index.tsx` e monta o menu pelo perfil.
- Módulos: `auth`, `cadastros` (equipe e perfil), `cardapio`, `mesas`, `pedidos`, `cliente` (cardápio público da mesa), `painel`, `logs` e `plataforma`.

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

Veja [SECURITY.md](SECURITY.md). Em resumo: senhas com bcrypt, login por JWT de 12 horas, permissão por perfil em cada rota, banco e API publicados só em `127.0.0.1` e log de atividades. O cardápio da mesa é público por natureza: quem tem o QR code pode pedir naquela mesa.

## Licença

[MIT](LICENSE).
