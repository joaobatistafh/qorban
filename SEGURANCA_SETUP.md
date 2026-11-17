# Qorban Controle — ativar o login (passo a passo)

Faça nesta ordem. Leva ~15 minutos.

## 1. Publicar o front-end novo
Publique este projeto (Vercel) com os arquivos novos: `auth.js`, `api/auth-solicitar-codigo.js`,
`index.html` e `app.js` atualizados. **Faça isso antes do passo 4**, senão o site antigo (sem login) para de funcionar.

## 2. Supabase → Authentication → configurações
- **Providers → Email**: deixe "Confirm email" ligado e **desligue "Allow new users to sign up"**
  (assim ninguém cria conta direto; só a rota `/api/auth-solicitar-codigo` cria, e só para e-mails cadastrados).
- **Password**: defina o tamanho mínimo em 8.
- **Email Templates → "Magic Link"**: o e-mail precisa mostrar o código. Exemplo de corpo:
  `Seu código de verificação do Qorban Controle: <b>{{ .Token }}</b>`
- **SMTP próprio** (Authentication → SMTP Settings, ex.: Resend, Brevo): o envio padrão do Supabase
  tem limite de ~2 e-mails/hora — insuficiente para a equipe.

## 3. Criar o usuário de teste
Authentication → Users → **Add user → Create new user**:
e-mail `joao@joao.com`, senha (a que enviei no chat), marcando **Auto Confirm User**.
Esse e-mail já está na tabela `admins` (passo 4) e tem acesso total.
Atenção: `joao@joao.com` provavelmente não recebe e-mail; por isso a senha dele é criada aqui e
"Esqueceu a senha" não funciona para ele. Troque a senha pelo painel quando quiser.

## 4. Rodar o SQL
SQL Editor → New query → colar `supabase_auth_setup.sql` → RUN.
Daqui em diante só usuário logado e cadastrado lê/grava dados.

## 5. Variáveis na Vercel
`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE` (já existem). Opcional: `SUPABASE_PUBLISHABLE_KEY`.

## Como funciona
- **Quem entra**: admins (tabela `admins`) e e-mails cadastrados no menu **Acessos**, exceto função **Cliente**.
- **Primeiro acesso / Esqueceu a senha**: e-mail → código → criar senha. Resposta igual exista o e-mail ou não.
- **Manter conectado**: marcado, a sessão fica no navegador e renova sozinha; desmarcado, vale só até fechar a aba.
- **Cliente**: cadastre em Acessos → "+ Cadastrar cliente" e escolha a obra. Ele cria senha normalmente,
  mas o Controle o barra; ele usará o Portal do Cliente (a construir).

## Limites conhecidos (não resolvidos nesta etapa)
1. **Permissões por página (Ver/Edit.)** escondem e travam a tela, mas o banco enxerga todos os usuários
   da equipe igualmente, porque os dados de cada obra ficam num registro só. Quem tem conhecimento técnico
   e e-mail cadastrado poderia contornar pela API.
2. **`/api/drive-file`, `/api/drive-upload-foto` e `/api/drive-rename-foto` continuam abertos** (sem login).
   As fotos do Drive podem ser lidas por quem souber o `fileId`. Precisam exigir o token do usuário.
3. O Portal do Cliente ainda precisa de rotas próprias no servidor (cliente só vê a obra dele).
