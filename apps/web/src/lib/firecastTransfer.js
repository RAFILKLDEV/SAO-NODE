import { api } from './api.js';

export const firecastProxyUrl =
  (import.meta.env.VITE_FIRECAST_PROXY_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

async function proxyJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || body?.message || `Proxy Firecast indisponível (HTTP ${response.status}).`;
    const error = new Error(message);
    error.code = body?.error?.code || body?.code;
    throw error;
  }
  return body;
}

/** Enfileira um ticket no proxy local e aguarda o recibo de aplicação no Firecast. */
export async function sendMonsterToFirecast({ campaignId, monsterId, signal, onStatus }) {
  const issued = await api(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/monsters/${encodeURIComponent(monsterId)}/firecast-transfer`, { method: 'POST' });
  onStatus?.('enviando');
  let response;
  try {
    response = await fetch(`${firecastProxyUrl}/sao-node/transfers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket: issued.ticket }),
      signal
    });
  } catch {
    const error = new Error('Proxy Firecast indisponível. Verifique se o gemini-proxy está aberto.');
    error.code = 'PROXY_UNAVAILABLE';
    throw error;
  }
  const queued = await proxyJson(response);
  const transferId = queued.transferId || queued.id;
  if (!transferId || !queued.receiptToken) throw new Error('O proxy não retornou um recibo válido.');
  onStatus?.(queued.status || 'aguardando');
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 800);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Abortado', 'AbortError')); }, { once: true });
    });
    let receiptResponse;
    try {
      receiptResponse = await fetch(`${firecastProxyUrl}/sao-node/transfers/${encodeURIComponent(transferId)}`, {
        headers: { authorization: `Bearer ${queued.receiptToken}` },
        signal
      });
    } catch {
      const error = new Error('Proxy Firecast indisponível durante a confirmação.');
      error.code = 'PROXY_UNAVAILABLE';
      throw error;
    }
    const receipt = await proxyJson(receiptResponse);
    const status = receipt.status || 'aguardando';
    onStatus?.(status);
    if (status === 'applied' || status === 'received') return receipt;
    if (['rejected', 'failed', 'expired'].includes(status)) {
      const error = new Error(receipt.message || 'O Firecast rejeitou a transferência.');
      error.code = status;
      throw error;
    }
  }
  throw new Error('O Firecast não confirmou o recebimento a tempo.');
}
