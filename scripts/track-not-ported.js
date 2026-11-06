// scripts/track-not-ported.js
// Preloaded into test runners to track when tests hit unported routes returning x-route-status: not-ported
const origFetch = globalThis.fetch;
if (typeof origFetch === 'function') {
  globalThis.fetch = async function (input, init) {
    const res = await origFetch.apply(this, arguments);
    const marker = res.headers ? res.headers.get('x-route-status') : null;
    if (marker === 'not-ported') {
      const url = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
      const method = (init && init.method) ? init.method.toUpperCase() : 'GET';
      // Emit clear marker line
      console.error(`[NOT_PORTED_HIT] ${method} ${url}`);
    }
    return res;
  };
}
