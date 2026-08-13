/**
 * api/signal.js
 * Vercel Serverless Function — Gera sinal educativo via Claude API
 *
 * Variável de ambiente obrigatória no Vercel:
 *   ANTHROPIC_API_KEY = sua chave da API da Anthropic
 *   (Vercel → projeto → Settings → Environment Variables)
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key não configurada no servidor.' });

  const { market, timeframe, strategy } = req.body || {};
  if (!market || !timeframe || !strategy) {
    return res.status(400).json({ error: 'Parâmetros incompletos.' });
  }

  const stratLabel   = strategy === 'nogale' ? 'Sem Gale' : strategy === '1gale' ? '1 Gale' : '2 Gales';
  const mktLabel     = market === 'otc' ? 'OTC' : 'Mercado Aberto';
  const tfLabel      = timeframe === 'M1' ? '1 minuto' : timeframe === 'M5' ? '5 minutos' : '15 minutos';
  const now          = new Date();
  const hh           = String(now.getHours()).padStart(2, '0');
  const mm           = String(now.getMinutes()).padStart(2, '0');
  const currentTime  = `${hh}:${mm}`;

  const ativos = market === 'otc'
    ? ['EUR/USD-OTC', 'GBP/USD-OTC', 'USD/JPY-OTC', 'AUD/USD-OTC', 'USD/CAD-OTC', 'EUR/GBP-OTC']
    : ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'EUR/GBP', 'GBP/JPY'];

  const ativoSugerido = ativos[Math.floor(Math.random() * ativos.length)];

  const prompt = `Você é um sistema educacional de sinais para opções binárias.
O usuário configurou a ferramenta com os seguintes parâmetros:
- Mercado: ${mktLabel}
- Timeframe: ${timeframe} (${tfLabel})
- Estratégia: ${stratLabel}
- Horário atual: ${currentTime}
- Ativo sugerido para análise: ${ativoSugerido}

Faça uma análise educacional técnica e retorne SOMENTE um JSON puro e válido (sem markdown, sem texto fora do JSON), com exatamente estes campos:
{
  "ativo": "${ativoSugerido}",
  "direcao": "COMPRA" ou "VENDA",
  "indicador": string (indicador técnico principal que sustenta a entrada, ex: RSI, MACD, Bollinger Bands, Estocástico, Médias Móveis),
  "horario_entrada": string (horário sugerido para entrar, próximo de ${currentTime}, formato HH:MM),
  "expiracao": "${tfLabel}",
  "justificativa": string (2 linhas técnicas explicando por que este ativo, este indicador e esta direção fazem sentido educacionalmente neste momento),
  "gale_info": string (orientação prática sobre como aplicar a estratégia ${stratLabel} nesta operação, com foco em gestão de banca)
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(502).json({ error: data.error.message });

    const text = (data.content || [])
      .map(b => b.text || '')
      .join('')
      .replace(/```json|```/g, '')
      .trim();

    const signal = JSON.parse(text);
    return res.status(200).json(signal);

  } catch (err) {
    console.error('Erro ao gerar sinal:', err);
    return res.status(500).json({ error: 'Erro ao processar sinal. Tente novamente.' });
  }
}
