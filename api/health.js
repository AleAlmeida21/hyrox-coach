module.exports = function handler(req, res) {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  res.status(200).json({ 
    status: 'ok', 
    hasAnthropicKey: hasKey,
    keyPrefix: hasKey ? process.env.ANTHROPIC_API_KEY.substring(0, 12) + '...' : 'NOT SET',
    timestamp: new Date().toISOString()
  });
};
