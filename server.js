// ============================================================
//  IdeaGit — Express Server
//  Serves the frontend and proxies Claude API calls.
//  The API key lives only in Heroku's environment variables.
// ============================================================

const express = require('express');
const path    = require('path');
const { initDb, saveNodes, dbConfigured } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// Idea snapshots include AI responses, so allow larger bodies than Express's 100kb default
app.use(express.json({ limit: '5mb' }));

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

// ── Save ideas + self-reports to Postgres ─────────────────────
app.post('/api/save-nodes', async (req, res) => {
  if (!dbConfigured()) {
    return res.status(503).json({ error: 'Database is not configured (DATABASE_URL is missing).' });
  }
  const { participant_id, condition, nodes } = req.body || {};
  if (typeof participant_id !== 'string' || !participant_id.trim() || participant_id.length > 100) {
    return res.status(400).json({ error: 'participant_id is required (max 100 characters).' });
  }
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > 500) {
    return res.status(400).json({ error: 'nodes must be a non-empty array (max 500).' });
  }
  if (nodes.some(n => !n || typeof n.node_id !== 'string' || !n.node_id)) {
    return res.status(400).json({ error: 'Every node needs a node_id.' });
  }
  try {
    await saveNodes(participant_id.trim(), condition, nodes);
    res.json({ ok: true, saved: nodes.length });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Landing page at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// IdeaGit conditions
[1,2,3,4].forEach(n => {
  app.get('/app'+n, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'app'+n+'.html'));
  });
});
// Legacy route
app.get('/app', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'app4.html')); });

// Fallback — redirect everything else to landing
app.get('*', (req, res) => {
  res.redirect('/');
});

initDb()
  .catch(err => console.error('Could not initialise the database:', err.message))
  .finally(() => {
    app.listen(PORT, () => console.log(`IdeaGit running on port ${PORT}`));
  });
