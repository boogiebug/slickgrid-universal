import type { Column } from './column.interface';
import type { SlickGrid } from './slickGrid.interface';

export interface MenuCallbackArgs<T = any> {
  /** Cell or column index */
  cell?: number;

  /** Row index */
  row?: number;

  /** Reference to the grid. */
  grid: SlickGrid;

  /** Cell Column definition */
  column: Column<T>;

  /** Cell Data Context(data object) */
  dataContext?: T;
}
