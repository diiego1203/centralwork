# CentralWork

Cloudflare Pages usa a pasta `dist` como saída, sem comando de build. Mantenha a raiz do projeto no repositório para o Pages incluir `functions/`. O painel usa o login e o banco do Supabase.

## Mercado Livre

Configure no ambiente Production do Cloudflare Pages um segredo criptografado chamado `CW_SUPABASE_SECRET_KEY`, com uma chave do Supabase do tipo `sb_secret_…`. O banco precisa da tabela `cw_mercado_livre`, criada pela migração `cw_mercado_livre_connection`. Ela só concede leitura, inserção e atualização ao papel de serviço. O servidor cifra os tokens e as credenciais usando uma chave derivada desse segredo. Antes de trocar o segredo, é preciso planejar a migração do conteúdo cifrado ou a reconexão da loja.

No CentralWork em produção, abra **Canais de venda → Mercado Livre → Conectar ou ver loja** e copie a URL de retorno exibida para o DevCenter. Habilite PKCE. Copie o Client ID e o Client Secret do aplicativo do Mercado Livre para o painel e clique em **Autorizar loja**. Ao retornar, entre novamente e abra a loja em **Canais de venda**.

A primeira versão consulta a conta, o nível de reputação, a contagem de anúncios ativos e pedidos recentes. A fila de publicação, fotos, monitoramento de envios, faturamento, publicidade e webhooks ainda não estão ligados à conta.

## Testes

`node --test tests/*.test.js`
