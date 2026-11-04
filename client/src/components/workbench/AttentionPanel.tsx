import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Attention } from '../../../../server/src/workbench/types';
import type { WorkbenchActions } from './use-workbench';

export function AttentionPanel({ items, mutate, busy }: WorkbenchActions & { items: Attention[] }) {
  const pending = items.filter((item) => item.state === 'pending' || item.state === 'sending');
  const history = items.filter((item) => !pending.includes(item));
  if (!items.length) return null;
  return <section className="space-y-3" aria-label="Task decisions">
    {pending.length > 0 && <h2 className="text-lg font-medium">Needs attention</h2>}
    {pending.map((item) => <Decision key={item.id} item={item} mutate={mutate} busy={busy} />)}
    {history.length > 0 && <details className="rounded-xl border p-4 text-sm">
      <summary className="cursor-pointer">Decision history ({history.length})</summary>
      <div className="mt-3 space-y-3">{history.map((item) => <div key={item.id}>
        <p className="font-medium">{item.title} · {item.state}</p>
        <p className="text-xs text-muted-foreground">{new Date(item.resolvedAt ?? item.createdAt).toLocaleString()}</p>
        {item.response && <pre className="mt-1 whitespace-pre-wrap break-words text-xs">
          {item.questions.some((question) => question.secret) ? 'Answer recorded' : JSON.stringify(item.response, null, 2)}
        </pre>}
      </div>)}</div>
    </details>}
  </section>;
}

function Decision({ item, mutate, busy }: WorkbenchActions & { item: Attention }) {
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const disabled = busy || item.state !== 'pending';
  const toolInput = item.detail.input as Record<string, unknown> | undefined;
  const command = item.detail.command ?? toolInput?.command;
  const directory = item.detail.cwd ?? toolInput?.file_path ?? toolInput?.path;
  async function respond(value: object) {
    setError('');
    try { await mutate(`/attention/${item.id}/respond`, 'POST', value); }
    catch (err) { setError((err as Error).message); }
  }
  function answer(event: FormEvent) {
    event.preventDefault();
    const answers = Object.fromEntries(item.questions.map((question) => [question.id,
      custom[question.id]?.trim() ? [...(question.multiSelect ? selected[question.id] ?? [] : []), custom[question.id].trim()]
        : selected[question.id] ?? []]));
    void respond({ answers });
  }
  return <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-medium">{item.title}</h3>
      <span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span>
    </div>
    {item.state === 'sending' && <p role="status" className="text-sm">Response saved. Waiting for the remote agent to receive it.</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {item.kind === 'question' ? <form onSubmit={answer} className="space-y-4">
      {item.questions.map((question) => <fieldset key={question.id} disabled={disabled} className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{question.text}</legend>
        {question.options.map((option) => <label key={option.label} className="flex items-start gap-2 rounded-md border p-2 text-sm">
          <input type={question.multiSelect ? 'checkbox' : 'radio'} name={`${item.id}-${question.id}`}
            checked={(selected[question.id] ?? []).includes(option.label)} className="mt-1"
            onChange={(event) => {
              if (!question.multiSelect) setCustom((old) => ({ ...old, [question.id]: '' }));
              setSelected((old) => ({ ...old, [question.id]: question.multiSelect
                ? event.target.checked ? [...(old[question.id] ?? []), option.label]
                  : (old[question.id] ?? []).filter((label) => label !== option.label) : [option.label] }));
            }} />
          <span>{option.label}{option.description && <span className="mt-1 block text-xs text-muted-foreground">{option.description}</span>}</span>
        </label>)}
        <Input aria-label={`Answer: ${question.text}`} type={question.secret ? 'password' : 'text'}
          placeholder="Write your answer" value={custom[question.id] ?? ''}
          onChange={(event) => {
            setCustom((old) => ({ ...old, [question.id]: event.target.value }));
            if (!question.multiSelect && event.target.value) setSelected((old) => ({ ...old, [question.id]: [] }));
          }} />
      </fieldset>)}
      <Button disabled={disabled}>Send answer</Button>
    </form> : <>
      {item.kind === 'approval' ? <div className="space-y-2 text-sm">
        {typeof item.detail.reason === 'string' && <p>{item.detail.reason}</p>}
        {typeof directory === 'string' && <p className="break-all text-xs text-muted-foreground">{directory}</p>}
        {(typeof command === 'string' || toolInput) && <pre
          className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 text-xs">
          {typeof command === 'string' ? command : JSON.stringify(toolInput, null, 2)}</pre>}
        {['additionalPermissions', 'networkApprovalContext'].map((key) => item.detail[key] ? <div key={key}>
          <p className="text-xs font-medium">Additional access requested</p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(item.detail[key], null, 2)}</pre>
        </div> : null)}
        <details open={!command && !toolInput}><summary className="cursor-pointer text-xs text-muted-foreground">Full request</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(item.detail, null, 2)}</pre>
        </details>
      </div> : <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 text-xs">
        {JSON.stringify(item.detail, null, 2)}</pre>}
      {item.kind === 'approval' && <div className="flex flex-wrap gap-2">{item.choices.map((choice) =>
        <Button key={choice} disabled={disabled} variant={choice === 'accept' ? 'default' : 'outline'}
          onClick={() => void respond({ decision: choice })}>{choice === 'accept' ? 'Allow once' : 'Decline'}</Button>)}</div>}
      {item.kind === 'failure' && <Button disabled={disabled} variant="outline"
        onClick={() => void respond({ decision: 'acknowledge' })}>Acknowledge failure</Button>}
      {item.kind === 'unsupported' && <p className="text-sm">Gate cannot answer this request. Stop the run before continuing in the native tool.</p>}
    </>}
  </div>;
}
