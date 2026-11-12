# Política de segurança

## Versões com suporte

Apenas a branch `main` recebe correções de segurança.

## Como relatar uma vulnerabilidade

**Não abra issue pública para vulnerabilidades.** Relate em particular:

1. Acesse a aba **Security** do repositório: https://github.com/marco3079/sistema-restaurante/security
2. Escolha **Report a vulnerability**.
3. Descreva o problema com o máximo de detalhes que puder.

Os mantenedores respondem pelo próprio GitHub. Não há prazo garantido de resposta, pois o projeto é mantido de forma voluntária.

### O que incluir no relato

- Qual parte do sistema foi afetada (API, site, instalador, banco).
- Versão ou commit usado.
- Passos para reproduzir o problema.
- Impacto esperado (por exemplo, acesso a dados de outro usuário).
- Se possível, uma sugestão de correção.

Não envie senhas reais, tokens válidos nem dados pessoais no relato. Use dados fictícios.

## Medidas de segurança já existentes

- **Senhas** são guardadas com bcrypt (biblioteca `bcryptjs`), nunca em texto puro. A resposta da API nunca inclui o hash.
- **Login** por JWT enviado no cabeçalho `Authorization: Bearer`, com validade de 12 horas. Todas as rotas exigem login, exceto o login, o teste de saúde da API, a leitura pública de nome, logo e cores da tela de entrada as rotas de senha por e-mail e o cardápio da mesa (descrito abaixo).
- **Permissões por perfil** (GESTOR, GARCOM, COZINHA, LIMPEZA e RECEPCAO) são verificadas em cada rota.
- **Banco de dados** publicado somente em `127.0.0.1`, ou seja, acessível apenas pelo próprio computador.
- **Segredos** (senha do banco e segredo do JWT) são gerados pelo instalador de forma aleatória e gravados no arquivo `.env`, que não vai para o Git.
- **Senha do gestor**: a conta do gestor nasce com a senha padrão conhecida `gestor1234` (e-mail `gestor@restaurante.local`), definida em `ADMIN_SENHA`. **Ela precisa ser trocada no primeiro acesso em "Meu perfil"**, principalmente se o site ficar acessível na rede. O login tem limite de tentativas. Para outra senha inicial, defina `ADMIN_SENHA` com 8 caracteres ou mais antes da primeira subida.
- **Segredo JWT**: se `JWT_SECRET` estiver ausente, com menos de 16 caracteres ou com um valor de exemplo, o servidor gera um segredo aleatório a cada subida e avisa no log. Nesse caso, os logins são invalidados quando o servidor reinicia. Defina `JWT_SECRET` no `.env` (o instalador faz isso).
- **Log de atividades**: toda requisição autenticada à API é registrada com usuário, perfil, ação, módulo, caminho, status e IP. Telas abertas e entradas e saídas também são registradas. O log não guarda corpo de requisição, senha nem token, e os registros são apagados após 90 dias. Só o gestor consulta o log.
- **Token do Mercado Pago**: fica cifrado no banco com AES-256-GCM, com a mesma chave da senha do e-mail. A API nunca devolve o token: a tela só informa se há um gravado. Só o gestor grava, troca ou apaga.
- **Cobrança**: o total da conta, a taxa de serviço e o que falta pagar são sempre calculados no servidor. Uma cobrança parcial nunca passa do que falta. O garçom só cobra nas maquinetas que pode usar, e uma conta tem no máximo uma cobrança em andamento.
- **Pix**: o QR code é montado no servidor com a chave Pix cadastrada pelo gestor. O sistema não consulta o banco: a confirmação do Pix é manual, feita por quem recebe, e fica registrada no nome dessa pessoa. A chave Pix só é devolvida pela API ao gestor.
- **Credenciais do emissor de nota fiscal**: ficam cifradas no banco com AES-256-GCM, com a mesma chave da senha do e-mail. A API nunca devolve os valores: a tela só informa quais estão gravadas. Só o gestor grava ou troca.
- **Webhook fiscal**: o endereço é definido só pelo gestor, e o servidor envia para ele os dados da venda (itens, valores e o CPF/CNPJ que o cliente informou). Use um endereço `https` de um serviço em que você confia.
- **CPF/CNPJ do cliente**: guardado só quando o cliente pede na nota, na conta daquela mesa. É validado e não aparece no log de atividades.
- **Fila de espera e reservas**: guardam nome e telefone do cliente. Só o gestor e a recepção acessam.
- **Perfis de cozinha, limpeza e recepção**: recebem só o que precisam. A limpeza e a recepção não recebem pedidos, valores nem o código do QR code das mesas.
- **Cardápio da mesa**: as rotas `/api/cliente/mesas/:codigo` são públicas por natureza. O acesso é pelo código secreto da mesa, que vai no QR code; quem tem o código pode ver o cardápio, pedir e ver os pedidos em aberto daquela mesa. O preço é sempre o do servidor, só entram produtos disponíveis, e há limite de pedidos por IP e por mesa. Se um QR code vazar, o gestor gera um novo em **Mesas** e o antigo para de funcionar.
- **Senha do servidor de e-mail (SMTP)**: fica cifrada no banco com AES-256-GCM. A chave é derivada (SHA-256) do segredo efetivo do servidor, o mesmo que assina os logins. A API nunca devolve a senha: a tela só informa se há uma senha gravada. Se o `JWT_SECRET` for trocado, a senha guardada deixa de ser lida, e o envio falha pedindo que ela seja digitada de novo. Sem `JWT_SECRET` no ambiente (ou com o valor de exemplo), o servidor usa um segredo aleatório a cada subida: nesse caso a senha do e-mail precisa ser digitada de novo depois de cada reinício. O instalador sempre define o segredo.
- **Mensagens de erro do e-mail**: o erro devolvido pelo servidor de e-mail perde a senha, se ela aparecer no texto, e é cortado em 300 caracteres antes de ir para a resposta e para o histórico. O histórico de e-mails guarda destinatário, assunto e situação, sem o corpo da mensagem.
- **Tokens de senha por e-mail**: links de uso único, guardados só como SHA-256 (o token em claro não fica no banco). Validade de 1 hora para a recuperação e de 7 dias para a criação de senha no cadastro. Um novo pedido de recuperação invalida o anterior, e ao redefinir a senha os outros links da conta deixam de valer. A troca de senha e a marcação do link como usado acontecem na mesma transação, o que evita uso duplo.
- **Pedido de recuperação**: a resposta é igual para e-mail cadastrado ou não, e nada é enviado para conta inativa. O link é montado com o endereço do site gravado nas configurações, e não com o endereço de quem fez o pedido; sem esse endereço, o pedido é recusado. Limites: 3 pedidos por 15 minutos para o mesmo IP e e-mail, e 20 por 15 minutos para o mesmo IP. O link e o token nunca vão para o log de atividades.
- **Chat privado**: só participantes ativos acessam uma conversa; quem não participa recebe `404`. As respostas do chat não trazem e-mail, CPF nem telefone de outras pessoas. Cada mensagem enviada tem limite de 30 por minuto por pessoa, o que impede inundação. O log de atividades não guarda o conteúdo das mensagens, e as descrições do chat não citam pessoas nem o texto. As consultas de tempo real (sincronizar, não lidas, digitando e lida) ficam fora do log.
- **Chat sem criptografia de ponta a ponta**: as mensagens e as imagens do chat ficam no banco em texto puro (imagem em data URL). Quem tem acesso ao banco pode lê-las, e a API as devolve aos participantes da conversa. Não há criptografia de ponta a ponta. Não use o chat para dados que exijam esse nível de sigilo sem avaliar essa limitação.

- **Limite de tentativas de login**: 10 falhas em 10 minutos para o mesmo endereço de IP e e-mail fazem as próximas tentativas receberem `429` (`Muitas tentativas. Aguarde alguns minutos.`). Um login bem-sucedido zera a contagem. A contagem fica na memória do servidor.
- **Limite de tamanho**: o corpo de cada requisição é limitado a 1 MB. Acima disso, a API responde `413`.
- **Validação de imagens**: foto de perfil, capa de livro, anexo de chamado e imagem de publicação só aceitam JPEG, PNG ou WebP (em data URL), com até 200.000 caracteres. Foto e capa também aceitam endereço `http(s)`, de até 500 caracteres. Qualquer outro formato é recusado com `400`.
- **API publicada só no próprio computador**: o `docker-compose.yml` publica a porta direta da API e a do banco somente em `127.0.0.1`. O site é publicado em todas as interfaces e encaminha `/api`, então a API também responde pela porta do site na rede local. Por isso, exponha só a porta do site, com HTTPS na frente.
- **Cabeçalhos de segurança no site**: o nginx envia `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` e `Referrer-Policy: strict-origin-when-cross-origin`.
- **Perfil público sem dados de contato**: o perfil público (usado pelo fórum e por outras telas) mostra nome, perfil, foto, curso, titulação, nível e medalhas. Não mostra e-mail, CPF nem telefone. O mesmo vale para os autores de chamados e de publicações.

## Recomendações antes de expor o sistema à internet

- **Use HTTPS.** Coloque um proxy reverso com certificado (por exemplo, Caddy, Nginx ou Traefik) na frente do site e da API. O projeto não traz HTTPS pronto.
- Troque todos os valores de exemplo, se algum tiver sido usado.
- Não exponha a porta do banco de dados.
- Mantenha o Docker e as imagens atualizados.

## Pontos de atenção conhecidos

- As integrações de nota fiscal com a Focus NFe e a WebmaniaBR ainda não foram testadas com contas reais. Use o ambiente de homologação antes de emitir notas de verdade.
- O token de login fica guardado no armazenamento local do navegador. Em um computador compartilhado, faça sempre o logout ao sair.
