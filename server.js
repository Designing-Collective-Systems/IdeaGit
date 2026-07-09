// ============================================================
//  IdeaGit — Express Server
//  Serves the frontend and proxies Claude API calls.
//  The API key lives only in Heroku's environment variables.
// ============================================================

const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve static assets (CSS, JS etc) but suppress automatic index.html
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ── Proxy endpoint ────────────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':       'application/json',
        'x-api-key':          apiKey,
        'anthropic-version':  '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error?.message || 'Anthropic API error' });
    }

    res.json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// Landing page at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// The IdeaGit app
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Fallback — redirect everything else to landing
app.get('*', (req, res) => {
  res.redirect('/');
});

app.listen(PORT, () => {
  console.log(`IdeaGit running on port ${PORT}`);
});
