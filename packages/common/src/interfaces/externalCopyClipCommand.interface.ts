import type { SlickCellExternalCopyManager } from '../extensions/slickCellExternalCopyManager';
import type { CellRange, Column, ExcelCopyBufferOption } from './index';

export interface ExternalCopyClipCommand {
  activeCell: number;
  activeRow: number;
  cellExternalCopyManager: SlickCellExternalCopyManager;
  clippedRange: CellRange[];
  destH: number;
  destW: number;
  h: number;
  w: number;
  isClipboardCommand: boolean;
  maxDestX: number;
  maxDestY: number;
  oldValues: any[];
  oneCellToMultiple: boolean;
  _options: ExcelCopyBufferOption;

  execute: () => void;
  markCopySelection: (ranges: CellRange[]) => void;
  setDataItemValueForColumn: (item: any, columnDef: Column, value: any) => any | void;
  undo: () => void;
}