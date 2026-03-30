// api/coach.js — Vercel Serverless Function
// Proxy seguro para llamadas a la API de Anthropic.
// La API key vive como variable de entorno en Vercel, nunca llega al browser.

export default async function handler(req, res) {
  // Solo POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS — permitir solo desde tu propio dominio
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { prompt, max_tokens = 1000 } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'prompt requerido' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key no configurada en Vercel' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic error:', err);
      return res.status(response.status).json({ error: 'Error de API', detail: err });
    }

    const data = await response.json();
    const text = data.content?.map(b => b.text || '').join('') || '';
    return res.status(200).json({ text });

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Error interno', detail: error.message });
  }
}
