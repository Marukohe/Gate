import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, post } from '@/lib/api';
import { useUIStore } from '@/stores/ui-store';
import App from '@/App';

export function GateAccess() {
  const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dark = useUIStore((s) => s.darkMode);

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  useEffect(() => {
    const controller = new AbortController();
    const lock = () => setState('locked');
    window.addEventListener('gate-sign-in', lock);
    void api<{ authenticated: boolean }>('/auth', { signal: controller.signal })
      .then(({ authenticated }) => { if (!controller.signal.aborted) setState(authenticated ? 'open' : 'locked'); })
      .catch(() => { if (!controller.signal.aborted) { setError('Could not reach Gate.'); lock(); } });
    return () => { controller.abort(); window.removeEventListener('gate-sign-in', lock); };
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = new FormData(event.currentTarget).get('token');
    setError(''); setBusy(true);
    try { await post('/auth', { token }); setState('open'); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  if (state === 'open') return <App onSignOut={() => {
    void api('/auth', { method: 'DELETE' }).then(() => location.reload())
      .catch((error: Error) => window.alert(error.message));
  }} />;
  return <main className="grid h-full place-items-center p-6">
    {state === 'checking' ? <p role="status" className="text-sm text-muted-foreground">Connecting to Gate…</p>
      : <form onSubmit={signIn} className="w-full max-w-sm space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="gate-brand"><span className="gate-mark" aria-hidden="true">g</span><h1>Sign in to Gate</h1></div>
        <label className="block space-y-2 text-sm">Access token
          <Input name="token" type="password" autoComplete="current-password" maxLength={512} required autoFocus />
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>}
  </main>;
}
