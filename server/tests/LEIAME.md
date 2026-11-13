# Testes da API

Testes de ponta a ponta contra a API rodando. Usam o runner embutido do Node 20 (`node:test`), sem dependências.

## Como subir o sistema com dados de exemplo

1. No arquivo `.env` (na raiz do projeto), coloque `SEED_DEMO=true`.
2. Suba o sistema: `docker compose up -d --build`.

A API fica em `http://localhost:3091/api`.

## Como rodar

Com o sistema no ar, a partir da pasta `server`:

```
npm test
```

Ou, da raiz do projeto:

```
node --test --test-concurrency=1 server/tests/
```

Para apontar para outra API, use a variável `API_URL` (padrão `http://localhost:3091/api`). Para trocar as contas de teste, use `GESTOR_EMAIL` e `GESTOR_SENHA` (e as equivalentes `GARCOM_`, `COZINHA_`, `LIMPEZA_`, `RECEPCAO_`).

## Atenção

Os testes criam pedidos, contas e reservas de verdade no banco em que rodam. Use um banco de teste, não o do restaurante.

Cada arquivo deixa as mesas que usa livres no começo e no fim, cancela o que ficou pendente de execuções anteriores e desfaz o que ligou (controle de estoque e chave Pix).

Mesas usadas: `01` nenhuma; `02` mesas 1 e 2; `03` mesas 3 e 4; `04` mesa 5; `05` mesas 6 e 7.

Não são testadas, de propósito: a nota fiscal por webhook (precisa de um receptor externo) e a aplicação de uma atualização (reinicia o sistema).
