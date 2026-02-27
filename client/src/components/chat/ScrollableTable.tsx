import { useState } from 'react';
import { WrapText, ArrowLeftRight } from 'lucide-react';

interface ScrollableTableProps {
  children: React.ReactNode;
}

export function ScrollableTable({ children }: ScrollableTableProps) {
  const [wrap, setWrap] = useState(false);

  return (
    <div className="my-3">
      <div className="flex justify-end mb-1">
        <button
          type="button"
          onClick={() => setWrap(!wrap)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {wrap
            ? <><ArrowLeftRight className="h-3 w-3" />Scroll</>
            : <><WrapText className="h-3 w-3" />Wrap</>
          }
        </button>
      </div>
      <div className={wrap ? 'table-wrap' : 'table-scroll'}>
        <table>{children}</table>
      </div>
    </div>
  );
}
