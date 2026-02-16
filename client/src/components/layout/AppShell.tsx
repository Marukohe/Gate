import { type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useUIStore } from '@/stores/ui-store';

interface AppShellProps {
  chatView: ReactNode;
  planPanel: ReactNode;
  onAddServer: () => void;
}

export function AppShell({ chatView, planPanel, onAddServer }: AppShellProps) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const planPanelOpen = useUIStore((s) => s.planPanelOpen);
  const setPlanPanelOpen = useUIStore((s) => s.setPlanPanelOpen);

  return (
    <div className="flex h-dvh">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar onAddServer={onAddServer} />
      </div>

      {/* Mobile sidebar drawer */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-64 p-0 lg:hidden">
          <Sidebar onAddServer={onAddServer} />
        </SheetContent>
      </Sheet>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          {/* Chat view */}
          <div className="flex-1 overflow-hidden">
            {chatView}
          </div>

          {/* Desktop plan panel */}
          <div className="hidden w-80 border-l lg:block">
            {planPanel}
          </div>
        </div>
      </div>

      {/* Mobile plan panel drawer */}
      <Sheet open={planPanelOpen} onOpenChange={setPlanPanelOpen}>
        <SheetContent side="right" className="w-full p-0 sm:w-96 lg:hidden">
          {planPanel}
        </SheetContent>
      </Sheet>
    </div>
  );
}
