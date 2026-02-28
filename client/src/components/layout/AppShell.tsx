import { type ReactNode, useCallback, useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { PlanPanel } from '@/components/plan/PlanPanel';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useUIStore } from '@/stores/ui-store';
import type { Server } from '@/stores/server-store';

interface AppShellProps {
  chatView: ReactNode;
  onAddServer: () => void;
  onEditServer: (server: Server) => void;
  onSendToChat: (text: string) => void;
}

export function AppShell({ chatView, onAddServer, onEditServer, onSendToChat }: AppShellProps) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const planPanelOpen = useUIStore((s) => s.planPanelOpen);
  const setPlanPanelOpen = useUIStore((s) => s.setPlanPanelOpen);

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
    <div className="flex h-dvh">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar onAddServer={onAddServer} onEditServer={onEditServer} />
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
            <SheetTitle className="text-base">Servers</SheetTitle>
          </SheetHeader>
          <div className="max-h-[50dvh] overflow-y-auto">
            <Sidebar onAddServer={onAddServer} onEditServer={onEditServer} onClose={closeSidebar} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden">
            {chatView}
          </div>
          {/* Desktop plan panel — inside content area so border-t aligns with ChatInput */}
          {planPanelOpen && (
            <div className="hidden w-80 border-l lg:block">
              <PlanPanel onSendToChat={onSendToChat} />
            </div>
          )}
        </div>
      </div>

      {/* Mobile plan panel drawer */}
      <Sheet open={planPanelOpen && isMobile} onOpenChange={setPlanPanelOpen}>
        <SheetContent side="right" className="w-80 p-0 lg:hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>Plan</SheetTitle>
          </SheetHeader>
          <PlanPanel onSendToChat={onSendToChat} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
