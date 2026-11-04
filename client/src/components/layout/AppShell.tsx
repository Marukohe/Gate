import { type ReactNode, useState, useEffect } from 'react';
import { PlanPanel } from '@/components/plan/PlanPanel';
import { ChangesPanel } from '@/components/changes/ChangesPanel';
import { WorkspaceInspector } from '@/components/workspace/WorkspaceInspector';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useUIStore } from '@/stores/ui-store';

interface AppShellProps {
  mainView: ReactNode;
  onSendToChat: (text: string) => void;
  onSelectSession?: (serverId: string, sessionId: string) => void;
  inspectorWorkspaceId?: string | null;
}

export function AppShell({
  mainView, onSendToChat, onSelectSession, inspectorWorkspaceId,
}: AppShellProps) {
  const planPanelOpen = useUIStore((s) => s.planPanelOpen);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useUIStore((s) => s.setRightPanelOpen);

  // Track mobile breakpoint so Sheet drawers only open below lg
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1023px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return (
    <div className="flex h-full">
      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-hidden">
            {mainView}
          </div>
          {/* Desktop right panel — Changes (top) + Plan (bottom) */}
          {rightPanelOpen && (
            <div className="hidden w-72 shrink-0 overflow-hidden border-l lg:flex lg:flex-col">
              {inspectorWorkspaceId ? (
                <WorkspaceInspector
                  workspaceId={inspectorWorkspaceId}
                  onSendToChat={onSendToChat}
                  onSelectSession={onSelectSession}
                  onClose={() => setRightPanelOpen(false)}
                />
              ) : (
                <>
                  <div className="flex-1 overflow-hidden">
                    <ChangesPanel />
                  </div>
                  {planPanelOpen && (
                    <div className="border-t overflow-hidden" style={{ maxHeight: '40%' }}>
                      <PlanPanel onSendToChat={onSendToChat} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile right panel — bottom sheet with workspace inspector or Changes + Plan */}
      <Sheet open={rightPanelOpen && isMobile} onOpenChange={setRightPanelOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="rounded-t-2xl px-0 pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          <div className="flex justify-center pt-2 pb-1">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          <SheetHeader className="sr-only">
            <SheetTitle>Changes & Plan</SheetTitle>
          </SheetHeader>
          <div className="max-h-[60dvh] overflow-y-auto">
            {inspectorWorkspaceId ? (
              <div className="h-[60dvh]">
                <WorkspaceInspector
                  workspaceId={inspectorWorkspaceId}
                  onSendToChat={onSendToChat}
                  onSelectSession={onSelectSession}
                  onClose={() => setRightPanelOpen(false)}
                />
              </div>
            ) : (
              <>
                <ChangesPanel />
                {planPanelOpen && (
                  <div className="border-t">
                    <PlanPanel onSendToChat={onSendToChat} />
                  </div>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
