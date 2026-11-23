// ============================================================
//  Per-tab participant session (no cookies)
//  Each browser tab gets its own random secret from /api/start and keeps it in sessionStorage,
//  which is private to that tab. A new tab starts empty, so it becomes a new participant.
//  This wrapper adds the secret to every request the page makes to /api/.
// ============================================================
(function () {
  const KEY = 'ig2_token';
  let mem = null;                                   // fallback if sessionStorage is blocked
  const get = () => { try { return sessionStorage.getItem(KEY) || mem; } catch (e) { return mem; } };
  const set = t => { mem = t; try { sessionStorage.setItem(KEY, t); } catch (e) {} };
  const clear = () => { mem = null; try { sessionStorage.removeItem(KEY); } catch (e) {} };

  const rawFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const t = get();
    if (t && url.startsWith('/api/')) {
      init = Object.assign({}, init);
      const h = new Headers(init.headers || {});
      h.set('X-Participant-Token', t);
      init.headers = h;
    }
    return rawFetch(input, init).then(res => { if (res.status === 401 && url.startsWith('/api/') && url !== '/api/start') clear(); return res; });
  };

  async function start() {
    const res = await rawFetch('/api/start', { method: 'POST' });
    if (!res.ok) throw new Error('Could not start (HTTP ' + res.status + ')');
    set((await res.json()).token);
  }
  window.igSession = {
    has: () => !!get(),
    clear,
    // Returns { consented } for this tab, creating a new participant when the tab has none (or it was removed)
    ensure() { return inflight || (inflight = run().finally(() => { inflight = null; })); },
  };
  let inflight = null;
  async function run() {
    {
      if (!get()) await start();
      let res = await window.fetch('/api/me');
      if (res.status === 401) { await start(); res = await window.fetch('/api/me'); }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }
  }
})();
