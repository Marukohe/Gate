import { type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { PlanPanel } from '@/components/plan/PlanPanel';
import { Sheet, SheetContent } from '@/components/ui/sheet';
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

  return (
    <div className="flex h-dvh">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar onAddServer={onAddServer} onEditServer={onEditServer} />
      </div>

      {/* Mobile sidebar drawer */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-64 p-0 lg:hidden">
          <Sidebar onAddServer={onAddServer} onEditServer={onEditServer} />
        </SheetContent>
      </Sheet>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden">
            {chatView}
          </div>

          {/* Desktop plan panel */}
          {planPanelOpen && (
            <div className="hidden w-80 border-l lg:block">
              <PlanPanel onSendToChat={onSendToChat} />
            </div>
          )}
        </div>
      </div>

      {/* Mobile plan panel drawer */}
      <Sheet open={planPanelOpen} onOpenChange={setPlanPanelOpen}>
        <SheetContent side="right" className="w-80 p-0 lg:hidden">
          <PlanPanel onSendToChat={onSendToChat} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
