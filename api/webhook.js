/**
 * api/webhook.js
 * Recebe o Webhook (Postback) de vendas da PerfectPay e libera/revoga
 * automaticamente o acesso do usuário no Supabase.
 *
 * Variáveis de ambiente obrigatórias no Vercel (Settings → Environment Variables):
 *   SUPABASE_URL              = URL do seu projeto Supabase (mesma usada no front)
 *   SUPABASE_SERVICE_ROLE_KEY = a Service Role Key do Supabase (NÃO é a anon key —
 *                                pegue em Supabase → Project Settings → API → service_role)
 *                                É preciso ser a service role porque esse endpoint precisa
 *                                inserir/atualizar linhas ignorando as regras de RLS.
 *   PERFECTPAY_PUBLIC_TOKEN   = o "Public Token" mostrado na tela de configuração do
 *                                Webhook - Vendas na PerfectPay. Usado para confirmar que
 *                                a notificação realmente veio da PerfectPay.
 *
 * URL a cadastrar no campo "URL do Webhook" da PerfectPay:
 *   https://SEU-DOMINIO-NA-VERCEL/api/webhook
 */

/* Ajuste estes três blocos para bater com os nomes/códigos reais dos planos
   cadastrados na PerfectPay. Depois de fazer a primeira venda de teste, você
   pode conferir no log (Vercel → seu projeto → Deployments → Functions → Logs)
   o valor exato de plan.name / plan.code que a PerfectPay está enviando, e
   ajustar aqui se necessário. */
const PLAN_MATCHERS = [
  { key: 'monthly',   days: 30,  test: (name) => /mensal/i.test(name) },
  { key: 'quarterly', days: 90,  test: (name) => /trimestral/i.test(name) },
  { key: 'lifetime',  days: null, test: (name) => /vital[ií]cio|lifetime/i.test(name) },
];

/* Status de venda (sale_status_enum) que devem LIBERAR acesso */
const APPROVED_STATUSES = new Set([2, 8, 10]); // approved, authorized, completed

/* Status que devem REVOGAR acesso (reembolso, chargeback, cancelamento) */
const REVOKE_STATUSES = new Set([6, 7, 9]); // cancelled, refunded, charged_back

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const PUBLIC_TOKEN = process.env.PERFECTPAY_PUBLIC_TOKEN;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Supabase não configurado no servidor.');
    return res.status(500).json({ error: 'Supabase não configurado.' });
  }

  const body = req.body || {};

  /* 1 — validar que a notificação realmente veio da PerfectPay */
  if (PUBLIC_TOKEN && body.token !== PUBLIC_TOKEN) {
    console.warn('Webhook recebido com token inválido.');
    return res.status(401).json({ error: 'Token inválido.' });
  }

  const email = body?.customer?.email?.trim()?.toLowerCase();
  const name = body?.customer?.full_name || '';
  const planName = body?.plan?.name || '';
  const productName = body?.product?.name || '';
  const saleStatus = body?.sale_status_enum;

  if (!email) {
    console.warn('Webhook sem e-mail de cliente, ignorando.', body);
    return res.status(200).json({ ok: true, ignored: 'sem e-mail' });
  }

  /* 2 — identificar qual dos 3 planos foi comprado */
  const matched = PLAN_MATCHERS.find(
    (m) => m.test(planName) || m.test(productName)
  );

  if (!matched) {
    console.warn('Plano não reconhecido pelo webhook:', planName, productName);
    return res.status(200).json({ ok: true, ignored: 'plano não reconhecido', planName, productName });
  }

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    if (REVOKE_STATUSES.has(saleStatus)) {
      /* Reembolso / chargeback / cancelamento → revoga o acesso */
      await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ plan: 'revoked', expires_at: new Date().toISOString() }),
      });
      console.log(`Acesso revogado para ${email} (status ${saleStatus}).`);
      return res.status(200).json({ ok: true, action: 'revoked', email });
    }

    if (!APPROVED_STATUSES.has(saleStatus)) {
      /* pendente, em análise, etc — ainda não libera nada */
      return res.status(200).json({ ok: true, ignored: 'status ainda não aprovado', saleStatus });
    }

    /* 3 — venda aprovada: calcular expiração e liberar acesso */
    const expiresAt =
      matched.days === null
        ? null
        : new Date(Date.now() + matched.days * 24 * 3600 * 1000).toISOString();

    /* Verifica se o usuário já existe */
    const checkResp = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=email`,
      { headers }
    );
    const existing = await checkResp.json();

    if (Array.isArray(existing) && existing.length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ plan: matched.key, expires_at: expiresAt, name }),
      });
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/users`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ email, name, plan: matched.key, expires_at: expiresAt }),
      });
    }

    console.log(`Acesso liberado para ${email} — plano ${matched.key}, expira em ${expiresAt || 'nunca'}.`);
    return res.status(200).json({ ok: true, action: 'granted', email, plan: matched.key, expires_at: expiresAt });
  } catch (err) {
    console.error('Erro ao processar webhook:', err);
    return res.status(500).json({ error: 'Erro ao processar webhook.' });
  }
}
