import { Package, LogOut, Calendar, Download } from 'lucide-react';
import { useMemo } from 'react';

interface HeaderProps {
  fileName?: string | null;
  rowsCount?: number;
  onReset?: () => void;
  totalToSupply?: number;
}

export function Header({ fileName, rowsCount, onReset, totalToSupply }: HeaderProps) {
  const currentDate = useMemo(() => {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).format(new Date());
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[#0a0a0f]/80 backdrop-blur-xl border-b border-white/10 px-4 md:px-8 h-16 flex items-center justify-between transition-all">
      <div className="flex items-center gap-3">
        <div className="bg-accent-primary/20 p-2 rounded-lg border border-accent-primary/30">
          <Package className="w-5 h-5 text-accent-primary" />
        </div>
        <h1 className="text-lg font-bold bg-gradient-to-r from-accent-primary to-accent-secondary text-transparent bg-clip-text hidden sm:block">
          Stock Flow
        </h1>
      </div>

      <div className="flex items-center gap-3 sm:gap-4 text-sm">
        {totalToSupply !== undefined && totalToSupply > 0 && (
          <div className="hidden lg:flex items-center px-3 py-1.5 bg-accent-primary/10 border border-accent-primary/20 rounded-full text-accent-primary font-medium">
            <Download className="w-4 h-4 mr-2" />
            <span>К отгрузке: {totalToSupply} шт.</span>
          </div>
        )}

        {onReset && fileName && (
          <button
            onClick={onReset}
            className="flex items-center gap-2 px-3 py-1.5 bg-error/10 hover:bg-error/20 border border-error/20 text-error rounded-full transition-colors font-medium text-sm ml-1"
            title="Загрузить новый отчет"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden lg:inline">Новый отчет</span>
          </button>
        )}
      </div>
    </header>
  );
}
