# MR. GREEN — Guia de Operação Diária

## Como ativar um cliente após o pagamento

Após receber a confirmação de pagamento pela PerfectPay, acesse:
👉 https://lgwqjhydasdnxxalpglm.supabase.co

1. Clique em **"Table Editor"** no menu lateral
2. Clique na tabela **"users"**
3. Clique em **"Insert row"**
4. Preencha os campos:

| Campo | O que colocar |
|-------|--------------|
| `email` | E-mail do cliente (exatamente como ele usou no pagamento) |
| `plan` | `monthly` ou `lifetime` |
| `activated_at` | Deixe em branco (ou a data de hoje) |
| `expires_at` | **Se mensal:** data de hoje + 30 dias. **Se vitalício:** deixe em branco |

5. Clique em **"Save"**

Pronto! O cliente entra no site, clica em **"Já sou assinante"**, digita o e-mail e o acesso é liberado automaticamente.

---

## Formato da data para plano mensal

Use o formato: `2026-05-30T23:59:59+00:00`

Exemplo: se ativou hoje (30/04/2026), coloque `2026-05-30T23:59:59+00:00` no campo `expires_at`.

---

## Como configurar os links da PerfectPay

Abra o arquivo `paywall.html` e localize:

```javascript
var LINKS = {
  monthly:  'https://perfectpay.com.br/pay/SEU-LINK-MENSAL',
  lifetime: 'https://perfectpay.com.br/pay/SEU-LINK-VITALICIO'
};
```

Substitua pelos links reais gerados no painel da PerfectPay.

---

## Como subir no Vercel

1. Acesse vercel.com → crie conta gratuita
2. Clique em "Add New Project" → "Upload"
3. Arraste a pasta descompactada do projeto
4. Clique em Deploy
5. Seu link estará pronto (ex: mrgreen.vercel.app)

---

## Comandos de teste (console do navegador F12)

```javascript
// Simular trial expirado (ver tela de paywall)
localStorage.setItem('mrgreen_trial', JSON.stringify({start: Date.now() - 25*3600000}));
location.reload();

// Resetar tudo (simular primeiro acesso)
localStorage.clear();
location.reload();
```
