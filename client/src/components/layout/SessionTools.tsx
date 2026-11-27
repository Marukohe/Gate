import { PanelRight, SquareTerminal } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type SessionToolActions = {
  filesOpen: boolean; onFiles: () => void;
  terminalOpen: boolean; onTerminal: () => void; terminalAvailable: boolean;
};

export function SessionTools({ filesOpen, onFiles, terminalOpen, onTerminal, terminalAvailable }: SessionToolActions) {
  const filesLabel = filesOpen ? 'Hide files' : 'Open files';
  const terminalLabel = terminalOpen ? 'Hide terminal' : 'Open terminal';
  return <>
    <Button size="icon-sm" variant={filesOpen ? 'secondary' : 'ghost'} aria-label={filesLabel} title={filesLabel}
      aria-controls="session-files" aria-expanded={filesOpen} onClick={onFiles}><PanelRight /></Button>
    <Button size="icon-sm" variant={terminalOpen ? 'secondary' : 'ghost'} aria-label={terminalLabel} title={terminalLabel}
      aria-controls="session-terminals" aria-expanded={terminalOpen} onClick={onTerminal} disabled={!terminalAvailable && !terminalOpen}>
      <SquareTerminal />
    </Button>
  </>;
}
