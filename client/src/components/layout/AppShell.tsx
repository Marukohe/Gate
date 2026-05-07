import { type ReactNode, useCallback, useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { PlanPanel } from '@/components/plan/PlanPanel';
import { ChangesPanel } from '@/components/changes/ChangesPanel';
import { WorkspaceInspector } from '@/components/workspace/WorkspaceInspector';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useUIStore } from '@/stores/ui-store';
import type { Server } from '@/stores/server-store';

interface AppShellProps {
  mainView: ReactNode;
  onAddServer: () => void;
  onEditServer: (server: Server) => void;
  onSendToChat: (text: string) => void;
  onOpenHome?: () => void;
  onSelectSession?: (serverId: string, sessionId: string) => void;
  onSelectWorkspace?: (id: string) => void;
  onDeleteSession?: (serverId: string, sessionId: string) => void;
  onAddWorkspace?: () => void;
  inspectorWorkspaceId?: string | null;
}

export function AppShell({
  mainView, onAddServer, onEditServer, onSendToChat, onOpenHome, onSelectSession,
  onSelectWorkspace, onDeleteSession, onAddWorkspace, inspectorWorkspaceId,
}: AppShellProps) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const planPanelOpen = useUIStore((s) => s.planPanelOpen);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useUIStore((s) => s.setRightPanelOpen);

  const closeSidebar = useCallback(() => setSidebarOpen(false), [setSidebarOpen]);

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
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar
          onAddServer={onAddServer}
          onEditServer={onEditServer}
          onOpenHome={onOpenHome}
          onSelectSession={onSelectSession}
          onSelectWorkspace={onSelectWorkspace}
          onDeleteSession={onDeleteSession}
          onAddWorkspace={onAddWorkspace}
        />
      </div>

      {/* Mobile sidebar — bottom sheet */}
      <Sheet open={sidebarOpen && isMobile} onOpenChange={setSidebarOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="rounded-t-2xl px-0 pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-2 pb-1">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          <SheetHeader className="px-4 pb-2">
            <SheetTitle className="text-base">Navigation</SheetTitle>
          </SheetHeader>
          <div className="max-h-[70dvh] overflow-y-auto">
            <Sidebar
              onAddServer={onAddServer}
              onEditServer={onEditServer}
              onOpenHome={onOpenHome}
              onSelectSession={onSelectSession}
              onSelectWorkspace={onSelectWorkspace}
              onDeleteSession={onDeleteSession}
              onAddWorkspace={onAddWorkspace}
              onClose={closeSidebar}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
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
