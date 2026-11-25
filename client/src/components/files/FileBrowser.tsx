import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowUp, Download, ExternalLink, File, Folder, House, Link, LoaderCircle, PanelRightClose, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { sessionKey, useSessionViewStore } from '@/stores/session-view-store';
import type { DirectoryListing, FilePreview } from '../../../../server/src/types';

const initialFiles = { directory: '.', file: null as string | null };
const basename = (path: string) => path.split('/').filter(Boolean).at(-1) || '/';
const parent = (path: string) => path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
const sizeLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
type Loaded = { target: string; directory: DirectoryListing } | { target: string; preview: FilePreview };

export function FileBrowser({ serverId, threadId, open, onClose }: {
  serverId: string; threadId: string; open: boolean; onClose: () => void;
}) {
  const key = sessionKey(serverId, threadId);
  const { directory, file } = useSessionViewStore((state) => state.views[key]?.files ?? initialFiles);
  const update = useSessionViewStore((state) => state.update);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(open);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const base = `/servers/${encodeURIComponent(serverId)}/sessions/${encodeURIComponent(threadId)}`;
  const target = file ? `${base}/file?${new URLSearchParams({ path: file, view: 'preview' })}`
    : `${base}/files?${new URLSearchParams({ path: directory })}`;
  const requestKey = JSON.stringify([target, open, revision]);
  const [lastRequest, setLastRequest] = useState(requestKey);
  if (lastRequest !== requestKey) {
    setLastRequest(requestKey); setLoading(open); setError(''); setImageFailed(false);
  }
  useEffect(() => {
    if (open) closeButton.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const read = file ? api<FilePreview>(target, { signal: controller.signal }).then((preview) => ({ target, preview }))
      : api<DirectoryListing>(target, { signal: controller.signal }).then((directory) => ({ target, directory }));
    void read.then((result) => { if (!controller.signal.aborted) setLoaded(result); })
      .catch((error) => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [target, file, open, revision]);
  const listing = loaded?.target === target && 'directory' in loaded ? loaded.directory : null;
  const preview = loaded?.target === target && 'preview' in loaded ? loaded.preview : null;
  const displayedPath = listing?.path ?? directory;
  const fileUrl = file ? `/api${base}/file?${new URLSearchParams({ path: file })}` : '';
  const navigate = (path: string) => update(key, { files: { directory: path, file: null } });
  const goBack = () => navigate(directory);
  const submitPath = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const path = String(new FormData(event.currentTarget).get('path') ?? '');
    if (path) navigate(path);
  };
  return <aside id="session-files" aria-label="Session files" className="file-sidebar" hidden={!open}
    onKeyDown={(event) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose(); } }}>
    <div className="file-sidebar-header">
      <Folder className="size-4 text-muted-foreground" /><h2 className="min-w-0 flex-1 text-sm font-semibold">Files</h2>
      <Button size="icon-sm" variant="ghost" aria-label="Refresh files" title="Refresh" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
        {loading ? <LoaderCircle className="motion-safe:animate-spin" /> : <RefreshCw />}
      </Button>
      <Button ref={closeButton} size="icon-sm" variant="ghost" aria-label="Close files" title="Close files" onClick={onClose}><PanelRightClose /></Button>
    </div>
    {file ? <div className="flex min-w-0 items-center gap-1 border-b px-2 py-2">
      <Button size="icon-sm" variant="ghost" aria-label="Back to files" title="Back to files" onClick={goBack}><ArrowLeft /></Button>
      <span className="min-w-0 flex-1 truncate text-xs font-medium" title={file}>{basename(file)}</span>
      <a href={fileUrl} target="_blank" rel="noreferrer" aria-label="Open file in new tab" title="Open in new tab" className="file-action"><ExternalLink className="size-3.5" /></a>
      <a href={`${fileUrl}&download=1`} download aria-label="Download file" title="Download" className="file-action"><Download className="size-3.5" /></a>
    </div> : <form onSubmit={submitPath} className="flex items-center gap-1 border-b px-2 py-2">
      <Button type="button" size="icon-sm" variant="ghost" aria-label="Go to working directory" title="Working directory" onClick={() => navigate('.')}><House /></Button>
      <Button type="button" size="icon-sm" variant="ghost" aria-label="Parent directory" title="Parent directory" disabled={!listing || listing.path === '/'} onClick={() => navigate(parent(displayedPath))}><ArrowUp /></Button>
      <Input key={displayedPath} name="path" aria-label="Directory path" title={displayedPath} defaultValue={displayedPath} className="h-8 min-w-0 font-mono text-xs" />
    </form>}
    <div className="min-h-0 flex-1 overflow-auto" aria-busy={loading}>
      {error && <div role="alert" className="space-y-2 p-3 text-xs"><p className="break-words text-destructive">{error}</p>
        <Button size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>Retry files</Button></div>}
      {loading && !listing && !preview && <p role="status" className="p-4 text-xs text-muted-foreground">Loading files…</p>}
      {!error && !file && listing && <ul aria-label="Directory contents" className="p-2">
        {listing.entries.map((entry) => <li key={entry.name}>
          <button type="button" className="file-entry" disabled={entry.kind === 'other'}
            aria-label={`${entry.kind === 'directory' ? 'Open folder' : 'Open file'} ${entry.name}`}
            title={entry.kind === 'other' ? 'Cannot open this file type or link' : entry.name}
            onClick={() => {
              const path = `${listing.path.replace(/\/$/, '')}/${entry.name}`;
              if (entry.kind === 'directory') navigate(path);
              else update(key, { files: { directory: listing.path, file: path } });
            }}>
            {entry.kind === 'directory' ? <Folder className="size-4 shrink-0 text-muted-foreground" /> : <File className="size-4 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            {entry.symlink && <Link className="size-3 shrink-0 text-muted-foreground" aria-label="Symbolic link" />}
            {entry.kind === 'file' && <span className="shrink-0 text-[10px] text-muted-foreground">{sizeLabel(entry.size)}</span>}
          </button>
        </li>)}
        {!listing.entries.length && <li className="px-2 py-4 text-xs text-muted-foreground">This folder is empty.</li>}
        {listing.truncated && <li className="px-2 py-3 text-xs text-muted-foreground">Showing the first {listing.entries.length} entries. Enter a folder path above to browse further.</li>}
      </ul>}
      {!error && file && preview?.kind === 'text' && <pre aria-label="File content" className="min-w-full w-max p-3 font-mono text-[11px] leading-relaxed" tabIndex={0}>{preview.text}</pre>}
      {!error && file && preview?.kind === 'image' && (imageFailed ? <p role="alert" className="p-4 text-xs text-destructive">This image could not be displayed. Refresh or download it.</p>
        : <img key={`${fileUrl}:${revision}`} src={fileUrl} alt={basename(file)} onError={() => setImageFailed(true)} className="mx-auto max-w-full p-3" />)}
      {!error && file && preview?.kind === 'download' && <p className="p-4 text-xs leading-relaxed text-muted-foreground">Preview is unavailable for this file ({sizeLabel(preview.size)}). Use Download to open it locally.</p>}
    </div>
  </aside>;
}
