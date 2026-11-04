import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/ui-store';

export type MainPage = 'overview' | 'projects' | 'sessions' | 'machines';

export function MainNavigation({ legacy, onNavigate }: {
  legacy: boolean; onNavigate: (page: MainPage) => void;
}) {
  const [hash, setHash] = useState(window.location.hash);
  const dark = useUIStore((state) => state.darkMode);
  const toggleDark = useUIStore((state) => state.toggleDarkMode);
  useEffect(() => {
    const change = () => setHash(window.location.hash);
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const kind = hash.slice(1).split('/')[0];
  const active = legacy ? 'sessions' : kind === 'project' ? 'projects'
    : ['projects', 'sessions', 'machines'].includes(kind) ? kind : 'overview';
  return <header className="gate-header">
    <button className="gate-brand" onClick={() => onNavigate('overview')} aria-label="Gate home">
      <span className="gate-mark" aria-hidden="true">g</span><span className="hidden sm:inline">Gate</span>
    </button>
    <nav aria-label="Main navigation" className="gate-navigation">
      {([['overview', 'Tasks'], ['projects', 'Projects'], ['sessions', 'Sessions'], ['machines', 'Machines']] as const)
        .map(([page, label]) => <a key={page} href={`#${page}`} aria-current={active === page ? 'page' : undefined}
          onClick={(event) => { event.preventDefault(); onNavigate(page); }}>{label}</a>)}
    </nav>
    <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" title="Toggle theme" onClick={toggleDark}>
      {dark ? <Sun /> : <Moon />}
    </Button>
  </header>;
}
