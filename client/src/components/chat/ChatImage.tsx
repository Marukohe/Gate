import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function ChatImage({ src, index }: { src: string; index: number }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  return <>
    <button type="button" aria-label={`Preview image ${index + 1}`} onClick={() => setOpen(true)} disabled={!src || failed}
      className="flex h-36 w-48 max-w-full items-center justify-center overflow-hidden rounded-lg border bg-background/50 focus-visible:ring-2 focus-visible:ring-ring">
      {!src || failed ? <span className="text-xs text-muted-foreground">Image unavailable</span>
        : <img src={src} alt={`Attached image ${index + 1}`} loading="lazy" onError={() => setFailed(true)} className="size-full object-contain" />}
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-4xl" aria-describedby={undefined}><DialogHeader><DialogTitle>Image {index + 1}</DialogTitle></DialogHeader>
        <img src={src} alt={`Attached image ${index + 1}, full size`} className="max-h-[75dvh] w-full object-contain" />
      </DialogContent>
    </Dialog>
  </>;
}
