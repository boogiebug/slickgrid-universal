import type { ExcelMetadata } from './excelMetadata.interface';

export interface ExcelCellFormat {
  value: any;
  metadata: ExcelMetadata;
}
