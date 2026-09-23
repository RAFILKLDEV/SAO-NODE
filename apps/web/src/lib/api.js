let csrfToken = null;

function validationDetail(details) {
  if (Array.isArray(details?.issues) && details.issues.length) {
    return details.issues
      .slice(0, 3)
      .map((issue) => `${issue.path || 'dados'}: ${issue.message}`)
      .join('; ');
  }
  const fieldErrors = details?.fieldErrors;
  if (fieldErrors && typeof fieldErrors === 'object') {
    const messages = Object.entries(fieldErrors)
      .flatMap(([field, errors]) => (errors ?? []).map((message) => `${field}: ${message}`));
    if (messages.length) return messages.slice(0, 3).join('; ');
  }
  return details?.formErrors?.[0] ?? '';
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('json') ? await response.json() : await response.text();
  if (!response.ok) {
    const detail = validationDetail(body?.error?.details);
    const message = body?.error?.message ?? `HTTP ${response.status}`;
    const error = new Error(detail ? `${message} — ${detail}` : message);
    error.status = response.status;
    error.code = body?.error?.code;
    error.details = body?.error?.details;
    throw error;
  }
  return body;
}

export async function ensureCsrf() {
  if (csrfToken) return csrfToken;
  const response = await fetch('/api/v1/auth/csrf', { credentials: 'include' });
  const data = await parseResponse(response);
  csrfToken = data.csrfToken;
  return csrfToken;
}

export async function api(path, options = {}) {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers ?? {});
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('x-csrf-token', await ensureCsrf());
  let body = options.body;
  if (body != null && !(body instanceof FormData) && typeof body !== 'string') {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(body);
  }
  const response = await fetch(path, { ...options, method, headers, body, credentials: 'include' });
  return parseResponse(response);
}

export async function login(loginValue, password) {
  const response = await fetch('/api/v1/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: loginValue, password })
  });
  const data = await parseResponse(response);
  csrfToken = data.csrfToken;
  return data;
}

export function clearCsrf() {
  csrfToken = null;
}
