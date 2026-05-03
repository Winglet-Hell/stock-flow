export interface CsvRow {
  'Артикул продавца': string;
  'Размер': string;
  'Общее среднее кол-во заказов, шт': string;
  'Остатки на текущий день, шт': string;
  'Регион': string;
  'Склад': string;
  [key: string]: string; // Для остальных полей, которые мы игнорируем
}

export interface ProcessedItem {
  sku: string;
  size: string;
  avgSales: number;
  currentStock: number;
  toSupply: number;
  turnover: string;
  isOverridden?: boolean;
}
