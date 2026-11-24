import type { ShellRun } from '@/stores/session-view-store';

export function ShellOutput({ run }: { run: ShellRun }) {
  const { result, error } = run;
  const status = error || result?.error ? 'Unconfirmed' : result?.timedOut ? 'Timed out'
    : result?.signal ? `Signal ${result.signal}` : result ? result.exitCode === null ? 'Exit unknown' : `Exit ${result.exitCode}` : 'Running…';
  return <details open data-message-id={run.id} className="my-3 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
    <summary className="cursor-pointer break-words font-mono">
      <span className="whitespace-pre-wrap">$ {run.command}</span><span className="ml-2 font-sans text-muted-foreground">{status}</span>
    </summary>
    <div className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono" aria-live="polite">
      {result?.stdout && <pre className="whitespace-pre-wrap break-words">{result.stdout}</pre>}
      {result?.stderr && <pre className="whitespace-pre-wrap break-words text-destructive" aria-label="Standard error">{result.stderr}</pre>}
      {result && !result.stdout && !result.stderr && <p className="text-muted-foreground">No output.</p>}
      {result?.truncated && <p className="text-muted-foreground">Output truncated after 128,000 characters.</p>}
      {result?.timedOut && <p className="text-destructive">Stopped waiting after 60 seconds and requested termination. Check before running again.</p>}
      {(error || result?.error) && <p className="text-destructive">{error || result?.error}</p>}
    </div>
  </details>;
}
