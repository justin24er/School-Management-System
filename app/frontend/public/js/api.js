/* Thin fetch wrapper: always sends cookies, centralizes 401 handling,
   never trusts anything the server didn't say (no client-side role/permission
   invention — the UI only reflects what /api/auth/me and each endpoint say). */
const API = (() => {
  async function request(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });

    if (res.status === 401) {
      window.location.href = '/index.html?sessionExpired=1';
      return new Promise(() => {}); // halt the caller; navigation is underway
    }

    let body = null;
    try { body = await res.json(); } catch (_) { /* no body */ }

    if (!res.ok) {
      const error = new Error((body && body.error) || 'Request failed.');
      error.status = res.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  return {
    get: (path) => request(path),
    post: (path, data) => request(path, { method: 'POST', body: JSON.stringify(data || {}) }),
    patch: (path, data) => request(path, { method: 'PATCH', body: JSON.stringify(data || {}) }),
  };
})();
