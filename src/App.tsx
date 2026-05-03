import { useState, useCallback, useMemo, useEffect } from 'react';
import Papa from 'papaparse';
import { Package, FileText, Check, Zap, Eye, Inbox, Download, Settings2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { CsvRow, ProcessedItem } from './types';
import { Header } from './components/Header';

const stringToColor = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 80%, 65%)`;
};

const getDaysWord = (days: number) => {
  const lastDigit = days % 10;
  const lastTwoDigits = days % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return 'дней';
  if (lastDigit === 1) return 'день';
  if (lastDigit >= 2 && lastDigit <= 4) return 'дня';
  return 'дней';
};

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<CsvRow[]>([]);
  const [step, setStep] = useState<'upload' | 'config' | 'results'>('upload');
  const [isHovering, setIsHovering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [region, setRegion] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [days, setDays] = useState<number | ''>('');
  
  // UI State
  const [showSufficientStock, setShowSufficientStock] = useState(false);
  const [manualOverrides, setManualOverrides] = useState<Record<string, number>>({});
  
  // Adjust Modal State
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustDays, setAdjustDays] = useState<number | ''>('');
  const [adjustMultiplier, setAdjustMultiplier] = useState<string>('1');
  
  // Available filter options based on uploaded data
  const regions = useMemo(() => Array.from(new Set(data.map(item => item['Регион']))).filter(Boolean).sort(), [data]);
  const warehouses = useMemo(() => {
    if (!region) return [];
    return Array.from(new Set(data.filter(item => item['Регион'] === region).map(item => item['Склад']))).filter(Boolean).sort();
  }, [data, region]);

  const handleFileUpload = (file: File) => {
    setFile(file);
    setError(null);
    
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          // Rule 2 & 3: Skip the first row (technical name) and use the second row as headers
          const rawRows = results.data as string[][];
          if (rawRows.length < 2) {
            throw new Error('Файл слишком короткий или имеет неверный формат.');
          }
          
          const headers = rawRows[1] as string[];
          const contentRows = rawRows.slice(2);
          
          // Map array rows to objects using headers
          const parsedData: CsvRow[] = contentRows.map(rowArray => {
            const obj: any = {};
            headers.forEach((header, index) => {
              if (header) {
                obj[header.trim()] = rowArray[index] ? rowArray[index].trim() : '';
              }
            });
            return obj as CsvRow;
          });
          
          setData(parsedData);
          setStep('config');
          
          // Auto-select region with highest demand
          const availableRegions = Array.from(new Set(parsedData.map(item => item['Регион']))).filter(Boolean);
          if (availableRegions.length > 0) {
            const regionDemand = new Map<string, number>();
            parsedData.forEach(item => {
              const r = item['Регион'];
              if (r) {
                const avgSalesStr = String(item['Общее среднее кол-во заказов, шт'] || '0').replace(/\s/g, '');
                const avgSales = parseFloat(avgSalesStr.replace(',', '.')) || 0;
                regionDemand.set(r, (regionDemand.get(r) || 0) + avgSales);
              }
            });
            
            const bestRegion = availableRegions.sort((a, b) => (regionDemand.get(b) || 0) - (regionDemand.get(a) || 0))[0];
            
            setRegion(bestRegion);
            setWarehouse('all');
          }
          
        } catch (e: any) {
          setError(e.message || 'Ошибка при разборе файла.');
          console.error(e);
        }
      },
      error: (error) => {
        setError(error.message);
      }
    });
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsHovering(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        handleFileUpload(file);
      } else {
        setError('Пожалуйста, загрузите файл формата CSV.');
      }
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  };
  
  const removeFile = () => {
    setFile(null);
    setData([]);
    setRegion('');
    setWarehouse('');
    setDays('');
    setManualOverrides({});
    setStep('upload');
  };

  // Process data based on form values and promt logic
  const processedData: ProcessedItem[] = useMemo(() => {
    if (!region || !warehouse || !days || typeof days !== 'number' || data.length === 0) return [];
    
    // 1. Filter by Region and Warehouse
    const filteredData = data.filter(item => item['Регион'] === region && (warehouse === 'all' ? true : item['Склад'] === warehouse));
    
    const grouped = new Map<string, any>();
    
    filteredData.forEach(item => {
      const sku = item['Артикул продавца'] || 'Неизвестно';
      const size = item['Размер'] || '-';
      const key = `${sku}-${size}`;
      
      const avgSalesStr = String(item['Общее среднее кол-во заказов, шт'] || '0').replace(/\s/g, '');
      const avgSales = parseFloat(avgSalesStr.replace(',', '.')) || 0;
      
      const currentStockStr = String(item['Остатки на текущий день, шт'] || '0').replace(/\s/g, '');
      const currentStock = parseInt(currentStockStr, 10) || 0;
      
      if (grouped.has(key)) {
        const existing = grouped.get(key);
        existing.avgSales += avgSales;
        existing.currentStock += currentStock;
      } else {
        grouped.set(key, {
          sku,
          size,
          avgSales,
          currentStock,
          turnover: item['Оборачиваемость текущих остатков'] || '-'
        });
      }
    });

    return Array.from(grouped.values())
      .map(item => {
        // Calculate turnover dynamically if aggregating across all warehouses
        let finalTurnover = item.turnover;
        if (warehouse === 'all') {
          if (item.avgSales > 0) {
            finalTurnover = `${Math.round(item.currentStock / item.avgSales)} д`;
          } else if (item.currentStock > 0) {
            finalTurnover = '> 1000 д';
          } else {
            finalTurnover = '0 д';
          }
        }

        // Compute toSupply and 4. Round to integer
        const rawSupply = (item.avgSales * days) - item.currentStock;
        const calculatedSupply = Math.max(Math.round(rawSupply), 0);
        
        // Use manual override if exists
        const overrideKey = `${region}-${warehouse}-${item.sku}-${item.size}`;
        const isOverridden = manualOverrides[overrideKey] !== undefined;
        const toSupply = isOverridden 
          ? manualOverrides[overrideKey] 
          : calculatedSupply;
        
        return {
          sku: item.sku,
          size: item.size,
          avgSales: item.avgSales,
          currentStock: item.currentStock,
          toSupply,
          turnover: finalTurnover,
          isOverridden
        };
      })
      // 5. Filter out items where supply <= 0 (unless toggle is on)
      .filter(item => showSufficientStock || item.toSupply > 0)
      // 6. Sort by sku and then by size
      .sort((a, b) => {
        const skuCompare = String(a.sku).localeCompare(String(b.sku), 'ru', { numeric: true });
        if (skuCompare !== 0) return skuCompare;
        return String(a.size).localeCompare(String(b.size), 'ru', { numeric: true });
      });
  }, [data, region, warehouse, days, showSufficientStock, manualOverrides]);

  const handleManualSupplyChange = (sku: string, size: string, value: string) => {
    const key = `${region}-${warehouse}-${sku}-${size}`;
    if (value === '') {
      const newOverrides = { ...manualOverrides };
      delete newOverrides[key];
      setManualOverrides(newOverrides);
    } else {
      const numValue = parseInt(value, 10);
      if (!isNaN(numValue)) {
        setManualOverrides(prev => ({
          ...prev,
          [key]: Math.max(0, numValue)
        }));
      }
    }
  };

  const skuGroupColors = useMemo(() => {
    const map: Record<string, string> = {};
    const uniqueSkus = Array.from(new Set(processedData.map(item => item.sku)));
    uniqueSkus.forEach((sku, index) => {
      map[sku] = index % 2 === 0 ? 'transparent' : 'rgba(99, 102, 241, 0.05)';
    });
    return map;
  }, [processedData]);

  const totalToSupply = useMemo(() => {
    return processedData.reduce((sum, item) => sum + item.toSupply, 0);
  }, [processedData]);

  // Set default days based on average turnover
  useEffect(() => {
    if (region && warehouse && data.length > 0) {
      const filtered = data.filter(item => item['Регион'] === region && (warehouse === 'all' ? true : item['Склад'] === warehouse));
      
      let sum = 0;
      let count = 0;
      
      filtered.forEach(item => {
        const turnoverStr = item['Оборачиваемость текущих остатков'];
        if (turnoverStr && !turnoverStr.includes('>')) {
          const daysMatch = turnoverStr.match(/(\d+)\s*д/);
          const hoursMatch = turnoverStr.match(/(\d+)\s*ч/);
          
          let itemDays = 0;
          let hasVal = false;
          
          if (daysMatch) {
            itemDays += parseInt(daysMatch[1], 10);
            hasVal = true;
          }
          if (hoursMatch) {
            itemDays += parseInt(hoursMatch[1], 10) / 24;
            hasVal = true;
          }
          
          if (!hasVal && /^\d+$/.test(turnoverStr.trim())) {
            itemDays += parseInt(turnoverStr.trim(), 10);
            hasVal = true;
          }
          
          if (hasVal) {
            sum += itemDays;
            count++;
          }
        }
      });
      
      if (count > 0) {
        setDays(Math.round(sum / count));
      } else {
        setDays('');
      }
    }
  }, [region, warehouse, data]);

  const handleRegionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newRegion = e.target.value;
    setRegion(newRegion);
    setWarehouse('all');
  };

  const exportToExcel = () => {
    if (processedData.length === 0) return;

    const exportData = processedData.map(item => ({
      'Артикул продавца': item.size && item.size !== '-' ? `${item.sku} [Размер: ${item.size}]` : item.sku,
      'Ср. продажи в день': Number(item.avgSales.toFixed(2)),
      'Текущий остаток': item.currentStock,
      'Оборачиваемость': item.turnover,
      'К ПОСТАВКЕ (шт)': item.toSupply
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    
    const cols = [
      { wch: 45 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 } 
    ];
    worksheet['!cols'] = cols;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "План поставок");

    const date = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
    const safeWarehouse = warehouse === 'all' ? 'Все_склады' : warehouse.replace(/[^a-zа-я0-9]/gi, '_');
    const safeRegion = region.replace(/[^a-zа-я0-9]/gi, '_');
    const fileName = `План_поставок_${safeRegion}_${safeWarehouse}_${date}.xlsx`;
    
    XLSX.writeFile(workbook, fileName);
  };

  const glassPanelClasses = "bg-panel backdrop-blur-[12px] border border-border-light rounded-[20px] shadow-lg transition-all duration-300 hover:border-white/10";
  const inputClasses = "w-full px-4 py-3.5 bg-black/20 border border-border-light rounded-lg text-slate-100 text-base transition-all duration-200 outline-none hover:border-white/20 focus:border-accent-primary focus:ring-[3px] focus:ring-accent-primary/20 focus:bg-black/40 disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <>
      <Header 
        fileName={file?.name} 
        rowsCount={data.length} 
        onReset={file ? removeFile : undefined} 
        totalToSupply={step === 'results' ? totalToSupply : undefined}
      />
      <div className={`${step === 'results' ? 'max-w-[1600px] h-screen flex flex-col overflow-hidden pb-6' : 'max-w-[1200px] pb-8'} mx-auto px-4 md:px-8 pt-20 w-full transition-all duration-500`}>
        {!file && (
          <div className="text-center mb-12 animate-fade-in">
            <div className="flex items-center justify-center gap-4 mb-4">
              <Package className="w-12 h-12 text-accent-primary animate-float" />
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold bg-gradient-to-br from-accent-primary to-accent-secondary text-transparent bg-clip-text tracking-tight m-0">
                Stock Flow
              </h2>
            </div>
            <p className="text-slate-400 text-lg md:text-xl font-light">
              Интеллектуальный расчет поставок на маркетплейс
            </p>
          </div>
        )}

      {/* Upload Section */}
      {!file && (
        <div 
          className={`relative px-8 py-16 text-center border-2 border-dashed flex flex-col items-center justify-center cursor-pointer max-w-[600px] mx-auto mb-8 transition-all duration-300 rounded-[20px] ${
            isHovering 
              ? 'border-accent-primary bg-accent-primary/5 shadow-[0_0_20px_rgba(99,102,241,0.4)]' 
              : 'border-accent-primary/30 bg-[#0a0a0f]/40 hover:border-accent-primary/70 hover:bg-accent-primary/5'
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsHovering(true); }}
          onDragLeave={() => setIsHovering(false)}
          onDrop={handleDrop}
        >
          <input 
            type="file" 
            accept=".csv, text/csv"
            onChange={handleFileChange} 
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          <FileText className={`w-16 h-16 mx-auto mb-4 text-accent-primary opacity-80 transition-transform duration-300 ${isHovering ? '-translate-y-2 opacity-100' : ''}`} />
          <div className="text-xl font-medium mb-2 text-slate-100">Перетащите CSV файл сюда или нажмите для выбора</div>
          <div className="text-slate-400 text-sm">Загрузите отчет выгруженный с площадки маркетплейса</div>
          {error && <div className="text-error mt-4">{error}</div>}
        </div>
      )}

      {/* Configuration Section */}
      {step === 'config' && data.length > 0 && (
        <div className={`${glassPanelClasses} mb-12 animate-fade-in`} style={{ animationDelay: '0.1s' }}>
          <h2 className="text-[1.5rem] font-semibold text-slate-100 px-6 pt-6 mt-2 mb-6">Параметры расчета</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 px-6 pb-6">
            <div className="flex flex-col text-left">
              <label className="text-[0.95rem] font-medium text-slate-400 mb-2">Регион</label>
              <select 
                value={region} 
                onChange={handleRegionChange}
                className={`${inputClasses} appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2394a3b8%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:1.2em] bg-[right_1rem_center] bg-no-repeat pr-10`}
              >
                <option value="" disabled className="bg-[#0a0a0f] text-slate-100">Выберите регион</option>
                {regions.map(r => (
                  <option key={r} value={r} className="bg-[#0a0a0f] text-slate-100">{r}</option>
                ))}
              </select>
            </div>
            
            <div className="flex flex-col text-left">
              <label className="text-[0.95rem] font-medium text-slate-400 mb-2">Склад отгрузки</label>
              <select 
                value={warehouse} 
                onChange={(e) => setWarehouse(e.target.value)} 
                disabled={!region}
                className={`${inputClasses} appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2394a3b8%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:1.2em] bg-[right_1rem_center] bg-no-repeat pr-10 disabled:opacity-50`}
              >
                <option value="" disabled className="bg-[#0a0a0f] text-slate-100">Выберите склад</option>
                <option value="all" className="bg-[#0a0a0f] text-slate-100">Все склады (по региону)</option>
                {warehouses.map(w => (
                  <option key={w} value={w} className="bg-[#0a0a0f] text-slate-100">{w}</option>
                ))}
              </select>
            </div>
            
            <div className="flex flex-col text-left md:col-span-2">
              <label className="text-[0.95rem] font-medium text-slate-400 mb-2">Количество дней для поставки</label>
              <input 
                type="number" 
                min="1" 
                max="365"
                placeholder="Например: 14"
                value={days}
                onChange={(e) => setDays(e.target.value ? parseInt(e.target.value, 10) : '')}
                className={inputClasses}
              />
              <div className="flex flex-wrap gap-2 mt-3">
                {[7, 14, 30, 60, 90].map(d => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                      days === d
                        ? 'bg-accent-primary/20 border-accent-primary text-accent-primary-light'
                        : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200'
                    }`}
                  >
                    {d} {getDaysWord(d)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          
          {/* Action Footer */}
          <div className="border-t border-border-light/50 px-6 py-5 flex justify-end bg-black/10 rounded-b-[20px]">
            <button
              onClick={() => setStep('results')}
              disabled={!region || !warehouse || !days}
              className="bg-accent-primary text-white px-8 py-3 rounded-xl font-medium enabled:hover:bg-accent-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              Готово
              <Check className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Results Section */}
      {step === 'results' && region && warehouse && days && typeof days === 'number' && (
        <div className="mt-2 animate-fade-in flex flex-col flex-1 min-h-0" style={{ animationDelay: '0.2s' }}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 shrink-0">
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  setRegion('');
                  setWarehouse('');
                  setStep('config');
                }}
                className="flex items-center justify-center w-10 h-10 bg-panel border border-border-light text-slate-300 rounded-full hover:bg-white/5 hover:text-white hover:border-white/20 transition-all shrink-0"
                title="Редактировать параметры"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <div className="flex flex-col">
                <h2 className="text-[1.5rem] font-semibold text-slate-100 m-0 leading-tight">План поставок</h2>
                <div className="text-[0.85rem] text-slate-400 font-medium flex items-center gap-2 mt-0.5">
                  <span>Расчет на {days} {getDaysWord(days)}</span>
                  {warehouse && warehouse !== 'all' ? (
                    <>
                      <span className="w-1 h-1 bg-slate-600 rounded-full"></span>
                      <span>{warehouse}</span>
                    </>
                  ) : region ? (
                    <>
                      <span className="w-1 h-1 bg-slate-600 rounded-full"></span>
                      <span>Все склады ({region})</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              <button 
                onClick={() => {
                  setRegion('');
                  setWarehouse('');
                  setStep('config');
                }}
                className="px-[1.2rem] py-[0.6rem] bg-panel border border-border-light text-slate-300 rounded-full text-[0.9rem] font-medium hover:bg-white/5 hover:text-white transition-colors"
              >
                Выбрать другой город
              </button>
              
              <button 
                className={`flex items-center gap-2 px-[1.2rem] py-[0.6rem] rounded-full text-[0.9rem] flex-none backdrop-blur-[12px] border transition-colors ${
                  showSufficientStock 
                    ? 'bg-accent-primary/15 border-accent-primary text-white' 
                    : 'bg-panel border-border-light text-slate-100 hover:bg-white/5 hover:border-white/20'
                }`}
                onClick={() => setShowSufficientStock(!showSufficientStock)}
              >
                {showSufficientStock ? <Zap className="w-[1.2em] h-[1.2em] text-accent-primary" /> : <Eye className="w-[1.2em] h-[1.2em]" />}
                {showSufficientStock ? 'Скрыть товары с достаточным остатком' : 'Показать товары с достаточным остатком (≤ 0)'}
              </button>

              <button
                onClick={() => {
                  setAdjustDays(days);
                  setAdjustMultiplier('1');
                  setShowAdjustModal(true);
                }}
                className="flex items-center gap-2 px-[1.2rem] py-[0.6rem] bg-indigo-500/20 border border-indigo-500/50 text-indigo-300 rounded-full text-[0.9rem] font-medium hover:bg-indigo-500/30 hover:border-indigo-400 hover:text-indigo-200 transition-colors"
              >
                <Settings2 className="w-[1.2em] h-[1.2em]" />
                Корректировка
              </button>

              <button
                onClick={exportToExcel}
                disabled={processedData.length === 0}
                className="flex items-center gap-2 px-[1.2rem] py-[0.6rem] bg-emerald-600/20 border border-emerald-500/50 text-emerald-400 rounded-full text-[0.9rem] font-medium hover:bg-emerald-600/30 hover:border-emerald-500 hover:text-emerald-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                <Download className="w-[1.2em] h-[1.2em]" />
                Экспорт в Excel
              </button>
            </div>
          </div>
          
          <div className={`${glassPanelClasses} p-0 flex-1 overflow-auto min-h-0 scrollbar-hide`}>
            {processedData.length > 0 ? (
                <table className="min-w-[1400px] w-full text-left border-collapse">
                  <thead>
                    <tr>
                      <th className="px-[1.5rem] py-[0.6rem] bg-[#1a1a24] font-semibold text-slate-400 text-[0.85rem] uppercase tracking-[0.05em] sticky top-0 z-20 backdrop-blur-[12px] border-b border-border-light">Артикул продавца</th>
                      <th className="px-[1.5rem] py-[0.6rem] bg-[#1a1a24] font-semibold text-slate-400 text-[0.85rem] uppercase tracking-[0.05em] sticky top-0 z-20 backdrop-blur-[12px] border-b border-border-light">Ср. продажи в день</th>
                      <th className="px-[1.5rem] py-[0.6rem] bg-[#1a1a24] font-semibold text-slate-400 text-[0.85rem] uppercase tracking-[0.05em] sticky top-0 z-20 backdrop-blur-[12px] border-b border-border-light">Текущий остаток</th>
                      <th className="px-[1.5rem] py-[0.6rem] bg-[#1a1a24] font-semibold text-slate-400 text-[0.85rem] uppercase tracking-[0.05em] sticky top-0 z-20 backdrop-blur-[12px] border-b border-border-light">Оборачиваемость</th>
                      <th className="px-[1.5rem] py-[0.6rem] bg-[#1a1a24] font-semibold text-slate-400 text-[0.85rem] uppercase tracking-[0.05em] sticky top-0 z-20 backdrop-blur-[12px] border-b border-border-light">К ПОСТАВКЕ (шт)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processedData.map((item, idx, arr) => (
                      <tr 
                        key={`${item.sku}-${item.size}-${idx}`}
                        style={{ backgroundColor: skuGroupColors[item.sku] }}
                        className={`transition-colors hover:bg-white/10 ${idx !== arr.length - 1 ? 'border-b border-border-light' : ''}`}
                      >
                        <td className="px-[1.5rem] py-[0.4rem] text-[0.95rem] text-[#e2e8f0]">
                          <div className="flex items-center gap-3">
                            <div 
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0 opacity-90" 
                              style={{ 
                                backgroundColor: stringToColor(item.sku),
                                boxShadow: `0 0 8px ${stringToColor(item.sku)}` 
                              }}
                              title={`Цветовой маркер артикула`}
                            />
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                              <span>{item.sku}</span>
                              {item.size && item.size !== '-' && (
                                <span className="px-2 py-0.5 bg-accent-primary/20 text-accent-primary-light text-[0.75rem] font-bold rounded border border-accent-primary/30 whitespace-nowrap">
                                  {item.size}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-[1.5rem] py-[0.4rem] text-[0.95rem] text-[#e2e8f0]">{item.avgSales.toFixed(2)}</td>
                        <td className="px-[1.5rem] py-[0.4rem] text-[0.95rem] text-[#e2e8f0]">{item.currentStock}</td>
                        <td className="px-[1.5rem] py-[0.4rem] text-[0.95rem] text-slate-400">{item.turnover}</td>
                        <td className="px-[1.5rem] py-[0.2rem]">
                          <div className="relative inline-block">
                            <input 
                              type="number" 
                              min="0"
                              value={item.toSupply}
                              onChange={(e) => handleManualSupplyChange(item.sku, item.size, e.target.value)}
                              className={`w-24 px-3 py-1 rounded-lg text-[1.1rem] font-bold text-center transition-all duration-200 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                                item.isOverridden
                                  ? 'bg-amber-500/10 border border-amber-500/50 hover:border-amber-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20'
                                  : 'bg-black/30 border border-border-light hover:border-white/20 focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/20'
                              }`}
                              style={{ color: item.isOverridden ? '#fbbf24' : (item.toSupply > 0 ? '#10b981' : '#94a3b8') }}
                              title={item.isOverridden ? 'Изменено вручную' : ''}
                            />
                            {item.isOverridden && (
                              <div className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-full shadow-[0_0_4px_rgba(245,158,11,0.5)] pointer-events-none"></div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

            ) : (
              <div className="px-8 py-16 text-center">
                <Inbox className="w-[3.5rem] h-[3.5rem] mx-auto mb-4 text-slate-500 opacity-50" />
                <h3 className="text-[1.5rem] font-semibold mb-2 text-slate-100">Нет товаров к отгрузке</h3>
                <p className="text-slate-400">По заданным параметрам склад имеет достаточные остатки всех товаров.</p>
              </div>
            )}
          </div>


        </div>
      )}
      </div>

      {/* Adjust Modal */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#13131a] border border-border-light rounded-[20px] p-8 shadow-2xl max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-white">Корректировка плана</h3>
              <button 
                onClick={() => setShowAdjustModal(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            
            <div className="space-y-5">
              <div>
                <label className="block text-[0.95rem] font-medium text-slate-300 mb-2">Количество дней поставок</label>
                <input 
                  type="number" 
                  min="1"
                  value={adjustDays}
                  onChange={(e) => setAdjustDays(e.target.value ? parseInt(e.target.value, 10) : '')}
                  className={inputClasses}
                />
                <div className="flex flex-wrap gap-2 mt-3">
                  {[7, 14, 30, 60, 90].map(d => (
                    <button
                      key={d}
                      onClick={() => setAdjustDays(d)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                        adjustDays === d
                          ? 'bg-accent-primary/20 border-accent-primary text-accent-primary-light'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200'
                      }`}
                    >
                      {d} {getDaysWord(d)}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-3">Изменит базовый расчет для всех товаров (кроме измененных вручную).</p>
              </div>
              
              <div>
                <label className="block text-[0.95rem] font-medium text-slate-300 mb-2">Коэффициент умножения</label>
                <input 
                  type="number" 
                  step="0.1"
                  min="0"
                  value={adjustMultiplier}
                  onChange={(e) => setAdjustMultiplier(e.target.value)}
                  className={inputClasses}
                  placeholder="Например: 1.2 для увеличения на 20%"
                />
                <p className="text-xs text-slate-500 mt-2">Все итоговые значения "К поставке" будут умножены на это число.</p>
              </div>
            </div>

            <div className="mt-8 flex justify-end gap-3">
              <button 
                onClick={() => setShowAdjustModal(false)}
                className="px-5 py-2.5 rounded-xl font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
              >
                Отмена
              </button>
              <button 
                onClick={() => {
                  let targetDays = days as number;
                  const daysChanged = adjustDays && typeof adjustDays === 'number' && adjustDays !== days;
                  
                  if (daysChanged) {
                    targetDays = adjustDays as number;
                    setDays(targetDays);
                  }

                  const mult = parseFloat(adjustMultiplier);
                  const hasMultiplier = !isNaN(mult) && mult !== 1 && mult >= 0;

                  if (hasMultiplier) {
                    const newOverrides = { ...manualOverrides };
                    processedData.forEach(item => {
                      const key = `${region}-${warehouse}-${item.sku}-${item.size}`;
                      const hasOverride = manualOverrides[key] !== undefined;
                      
                      let baseSupply = item.toSupply;
                      if (daysChanged && !hasOverride) {
                        const rawSupply = (item.avgSales * targetDays) - item.currentStock;
                        baseSupply = Math.max(Math.round(rawSupply), 0);
                      }
                      
                      const finalSupply = Math.max(Math.round(baseSupply * mult), 0);
                      newOverrides[key] = finalSupply;
                    });
                    setManualOverrides(newOverrides);
                  }
                  setShowAdjustModal(false);
                }}
                className="px-5 py-2.5 bg-accent-primary text-white rounded-xl font-medium hover:bg-accent-secondary transition-colors"
              >
                Применить
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
