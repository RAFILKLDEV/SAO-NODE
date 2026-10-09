import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { emptyHistory, pushHistory, redoHistory, undoHistory } from './mapUndo.js';

export function useDraftHistory() {
  const history = useRef(emptyHistory(null));
  const [state, setState] = useState(history.current);
  const reset = useCallback(present => { history.current = emptyHistory(present); setState(history.current); }, []);
  const push = useCallback(present => { history.current = pushHistory(history.current, present); setState(history.current); }, []);
  const step = useCallback(direction => { history.current = (direction === 'undo' ? undoHistory : redoHistory)(history.current); setState(history.current); return history.current.present; }, []);
  const replace = useCallback(present => { history.current = { ...history.current, present }; setState(history.current); }, []);
  return { reset, push, step, replace, canUndo: Boolean(state.past.length), canRedo: Boolean(state.future.length) };
}

export function useMapHistory(base, query, refresh, onPingChange) {
  const scope = `${base}?${query}`;
  const stacks = useRef({ past: [], future: [] });
  const pendingRef = useRef(false);
  const [state, setState] = useState(stacks.current);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const refreshRef = useRef(refresh);
  const pingChangeRef = useRef(onPingChange);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => { pingChangeRef.current = onPingChange; }, [onPingChange]);
  useEffect(() => { stacks.current = { past: [], future: [] }; setState(stacks.current); setError(''); }, [scope]);
  const push = useCallback(edit => {
    if (!edit) return;
    stacks.current = { past: [...stacks.current.past, { kind: 'edit', ...edit }].slice(-100), future: [] };
    setState(stacks.current); setError('');
  }, []);
  const pushPing = useCallback(ping => {
    stacks.current = { past: [...stacks.current.past, { kind: 'ping', ping, label: 'Enviar ping' }].slice(-100), future: [] };
    setState(stacks.current); setError('');
  }, []);
  const step = useCallback(async direction => {
    const source = direction === 'undo' ? 'past' : 'future', target = direction === 'undo' ? 'future' : 'past';
    const entry = stacks.current[source].at(-1);
    if (!entry || pendingRef.current) return;
    pendingRef.current = true; setPending(true); setError('');
    try {
      let updated = entry;
      if (entry.kind === 'ping') {
        const endpoint = direction === 'undo' ? `pings/${entry.ping.id}` : 'pings';
        const result = await api(`${base}/${endpoint}?${query}`, { method: direction === 'undo' ? 'DELETE' : 'POST', ...(direction === 'redo' ? { body: { id: entry.ping.id, x: entry.ping.x, y: entry.ping.y, color: entry.ping.color } } : {}) });
        if (result.ping) updated = { ...entry, ping: result.ping };
        pingChangeRef.current?.({ direction, ping: updated.ping });
      } else {
        const result = await api(`${base}/edits/${entry.id}?${query}`, { method: 'POST', headers: { 'if-match': String(entry.version) }, body: { direction } });
        updated = { ...entry, ...result.edit };
      }
      stacks.current = { ...stacks.current, [source]: stacks.current[source].slice(0, -1), [target]: [...stacks.current[target], updated].slice(-100) };
      setState(stacks.current); await refreshRef.current?.();
    } catch (err) { setError(err.message); await refreshRef.current?.(); }
    finally { pendingRef.current = false; setPending(false); }
  }, [base, query]);
  return { push, pushPing, step, pending, error, canUndo: Boolean(state.past.length), canRedo: Boolean(state.future.length), undoLabel: state.past.at(-1)?.label, redoLabel: state.future.at(-1)?.label };
}
