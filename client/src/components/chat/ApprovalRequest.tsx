import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Request } from '../../../../server/src/types';

export function ApprovalRequest({ request, onAnswer }: { request: Request; onAnswer: (value: object) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function answer(value: object) {
    setBusy(true); setError('');
    try { await onAnswer(value); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); void answer({ answers: Object.fromEntries(new FormData(event.currentTarget)) });
  }
  return <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
    <p className="text-sm font-medium">{request.title}</p>
    {request.kind === 'question' ? <form onSubmit={submit} className="mt-3 space-y-4">
      {request.questions.map((q) => <label key={q.id} className="block space-y-2 text-sm">{q.text}
        {q.options.length > 0 && <p className="text-xs text-muted-foreground">{q.options.join(' · ')}</p>}
        <Input name={q.id} aria-label={q.text} type={q.secret ? 'password' : 'text'} required disabled={busy || request.answering} />
      </label>)}
      <Button size="sm" disabled={busy || request.answering}>Send answer</Button>
    </form> : <>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">{request.detail}</pre>
      <div className="mt-3 flex flex-wrap gap-2">{request.choices.map((choice) => <Button key={choice} size="sm"
        variant={choice === 'accept' ? 'default' : 'outline'} disabled={busy || request.answering} onClick={() => void answer({ decision: choice })}>
        {request.choiceLabels?.[choice] ?? (choice === 'accept' ? 'Allow once' : choice === 'decline' ? 'Decline' : 'Cancel')}</Button>)}</div>
    </>}
    {request.answering && <p className="mt-2 text-xs text-muted-foreground">Waiting for the agent to confirm…</p>}
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </div>;
}
