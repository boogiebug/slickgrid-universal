import {
  Column,
  ColumnSort,
  GridOption,
  CurrentSorter,
  SlickEventHandler,
} from '../interfaces/index';
import {
  EmitterType,
  FieldType,
  SortDirection,
  SortDirectionNumber,
  SortDirectionString,
} from '../enums/index';
import { executeBackendCallback, refreshBackendDataset } from './backend-utilities';
import { PubSubService } from '../services/pubSub.service';
import { getDescendantProperty } from './utilities';
import { sortByFieldType, sortFlatArrayWithParentChildRef } from '../sorters/sorterUtilities';

// using external non-typed js libraries
declare const Slick: any;

export class SortService {
  private _columnWithTreeView: Column | undefined;
  private _currentLocalSorters: CurrentSorter[] = [];
  private _eventHandler: SlickEventHandler;
  private _dataView: any;
  private _grid: any;
  private _isBackendGrid = false;

  constructor(private pubSubService: PubSubService) {
    this._eventHandler = new Slick.EventHandler();
  }

  /** Getter of the SlickGrid Event Handler */
  get eventHandler(): SlickEventHandler {
    return this._eventHandler;
  }

  /** Getter for the Grid Options pulled through the Grid Object */
  private get _gridOptions(): GridOption {
    return (this._grid && this._grid.getOptions) ? this._grid.getOptions() : {};
  }

  /** Getter for the Column Definitions pulled through the Grid Object */
  private get _columnDefinitions(): Column[] {
    return (this._grid && this._grid.getColumns) ? this._grid.getColumns() : [];
  }

  /**
   * Bind a backend sort (single/multi) hook to the grid
   * @param grid SlickGrid Grid object
   * @param dataView SlickGrid DataView object
   */
  bindBackendOnSort(grid: any, dataView: any) {
    this._isBackendGrid = true;
    this._grid = grid;
    this._dataView = dataView;

    // subscribe to the SlickGrid event and call the backend execution
    this._eventHandler.subscribe(grid.onSort, this.onBackendSortChanged.bind(this));
  }

  /**
   * Bind a local sort (single/multi) hook to the grid
   * @param grid SlickGrid Grid object
   * @param gridOptions Grid Options object
   * @param dataView
   */
  bindLocalOnSort(grid: any, dataView: any) {
    this._isBackendGrid = false;
    this._grid = grid;
    this._dataView = dataView;

    if (this._gridOptions && this._gridOptions.enableTreeView && this._columnDefinitions) {
      this._columnWithTreeView = this._columnDefinitions.find((col: Column) => col && col.treeView);
      if (!this._columnWithTreeView || !this._columnWithTreeView.id) {
        throw new Error('[Slickgrid-Universal] When enabling tree view, you must also provide the column definition "treeView" property with "childrenPropName" or "parentPropName" (depending if your array is hierarchical or flat) for the Tree View to work properly');
      }
      if (this._columnWithTreeView) {
        this._grid.setSortColumns([{ columnId: this._columnWithTreeView.id, sortAsc: true }]);
      }
    }

    this._eventHandler.subscribe(grid.onSort, (e: any, args: any) => {
      // multiSort and singleSort are not exactly the same, but we want to structure it the same for the (for loop) after
      // also to avoid having to rewrite the for loop in the sort, we will make the singleSort an array of 1 object
      const sortColumns = (args.multiColumnSort) ? args.sortCols : new Array({ sortAsc: args.sortAsc, sortCol: args.sortCol });

      // keep current sorters
      this._currentLocalSorters = []; // reset current local sorters
      if (Array.isArray(sortColumns)) {
        sortColumns.forEach((sortColumn: { sortCol: Column, sortAsc: number }) => {
          if (sortColumn.sortCol) {
            this._currentLocalSorters.push({
              columnId: sortColumn.sortCol.id,
              direction: sortColumn.sortAsc ? SortDirection.ASC : SortDirection.DESC
            });
          }
        });
      }

      this.onLocalSortChanged(grid, dataView, sortColumns);
      this.emitSortChanged(EmitterType.local);
    });
  }

  /**
   * Clear Sorting
   * - 1st, remove the SlickGrid sort icons (this setSortColumns function call really does only that)
   * - 2nd, we also need to trigger a sort change
   *   - for a backend grid, we will trigger a backend sort changed with an empty sort columns array
   *   - however for a local grid, we need to pass a sort column and so we will sort by the 1st column
   * @param trigger query event after executing clear filter?
   */
  clearSorting(triggerQueryEvent = true) {
    if (this._grid && this._gridOptions && this._dataView) {
      // remove any sort icons (this setSortColumns function call really does only that)
      this._grid.setSortColumns([]);

      // we also need to trigger a sort change
      // for a backend grid, we will trigger a backend sort changed with an empty sort columns array
      // however for a local grid, we need to pass a sort column and so we will sort by the 1st column
      if (triggerQueryEvent) {
        if (this._isBackendGrid) {
          this.onBackendSortChanged(undefined, { grid: this._grid, sortCols: [], clearSortTriggered: true });
        } else {
          if (this._columnDefinitions && Array.isArray(this._columnDefinitions) && this._columnDefinitions.length > 0) {
            const sortColFieldId = this._gridOptions && this._gridOptions.defaultColumnSortFieldId || 'id';
            const sortCol = { id: sortColFieldId, field: sortColFieldId } as Column;
            this.onLocalSortChanged(this._grid, this._dataView, new Array({ sortAsc: true, sortCol, clearSortTriggered: true }));
          }
        }
      } else if (this._isBackendGrid) {
        const backendService = this._gridOptions && this._gridOptions.backendServiceApi && this._gridOptions.backendServiceApi.service;
        if (backendService && backendService.clearSorters) {
          backendService.clearSorters();
        }
      }
    }

    // set current sorter to empty & emit a sort changed event
    this._currentLocalSorters = [];

    // emit an event when sorts are all cleared
    this.pubSubService.publish('onSortCleared', true);
  }

  /**
   * A simple function that will be called to emit a change when a sort changes.
   * Other services, like Pagination, can then subscribe to it.
   * @param sender
   */
  emitSortChanged(sender: EmitterType, currentLocalSorters?: CurrentSorter[]) {
    if (sender === EmitterType.remote && this._gridOptions && this._gridOptions.backendServiceApi) {
      let currentSorters: CurrentSorter[] = [];
      const backendService = this._gridOptions.backendServiceApi.service;
      if (backendService && backendService.getCurrentSorters) {
        currentSorters = backendService.getCurrentSorters() as CurrentSorter[];
      }
      this.pubSubService.publish('onSortChanged', currentSorters);
    } else if (sender === EmitterType.local) {
      if (currentLocalSorters) {
        this._currentLocalSorters = currentLocalSorters;
      }
      this.pubSubService.publish('onSortChanged', this.getCurrentLocalSorters());
    }
  }

  getCurrentLocalSorters(): CurrentSorter[] {
    return this._currentLocalSorters;
  }

  /**
   * Get current column sorts,
   * If a column is passed as an argument, that will be exclusion so we won't add this column to our output array since it is already in the array.
   * The usage of this method is that we want to know the sort prior to calling the next sorting command
   */
  getCurrentColumnSorts(excludedColumnId?: string) {
    // getSortColumns() only returns sortAsc & columnId, we want the entire column definition
    const oldSortColumns = this._grid && this._grid.getSortColumns();

    // get the column definition but only keep column which are not equal to our current column
    if (Array.isArray(oldSortColumns)) {
      const sortedCols = oldSortColumns.reduce((cols: ColumnSort[], col: ColumnSort) => {
        if (!excludedColumnId || col.columnId !== excludedColumnId) {
          cols.push({ sortCol: this._columnDefinitions[this._grid.getColumnIndex(col.columnId)], sortAsc: col.sortAsc });
        }
        return cols;
      }, []);

      return sortedCols;
    }
    return [];
  }

  /** Load defined Sorting (sorters) into the grid */
  loadGridSorters(sorters: CurrentSorter[]): ColumnSort[] {
    this._currentLocalSorters = []; // reset current local sorters
    const sortCols: ColumnSort[] = [];

    if (Array.isArray(sorters)) {
      sorters.forEach((sorter: CurrentSorter) => {
        const gridColumn = this._columnDefinitions.find((col: Column) => col.id === sorter.columnId);
        if (gridColumn) {
          sortCols.push({
            columnId: gridColumn.id,
            sortAsc: ((sorter.direction.toUpperCase() === SortDirection.ASC) ? true : false),
            sortCol: gridColumn
          });

          // keep current sorters
          this._currentLocalSorters.push({
            columnId: gridColumn.id + '',
            direction: sorter.direction.toUpperCase() as SortDirectionString
          });
        }
      });

      if (sortCols.length > 0) {
        this.onLocalSortChanged(this._grid, this._dataView, sortCols);
        this._grid.setSortColumns(sortCols); // use this to add sort icon(s) in UI
      }

    }
    return sortCols;
  }

  dispose() {
    // unsubscribe all SlickGrid events
    if (this._eventHandler && this._eventHandler.unsubscribeAll) {
      this._eventHandler.unsubscribeAll();
    }
  }

  onBackendSortChanged(event: Event | undefined, args: { multiColumnSort?: boolean; grid: any; sortCols: ColumnSort[]; clearSortTriggered?: boolean }) {
    if (!args || !args.grid) {
      throw new Error('Something went wrong when trying to bind the "onBackendSortChanged(event, args)" function, it seems that "args" is not populated correctly');
    }
    const gridOptions: GridOption = (args.grid && args.grid.getOptions) ? args.grid.getOptions() : {};
    const backendApi = gridOptions.backendServiceApi;

    if (!backendApi || !backendApi.process || !backendApi.service) {
      throw new Error(`BackendServiceApi requires at least a "process" function and a "service" defined`);
    }

    // keep start time & end timestamps & return it after process execution
    const startTime = new Date();

    if (backendApi.preProcess) {
      backendApi.preProcess();
    }

    // query backend
    const query = backendApi.service.processOnSortChanged(event, args);
    const totalItems = gridOptions && gridOptions.pagination && gridOptions.pagination.totalItems || 0;
    executeBackendCallback(backendApi, query, args, startTime, totalItems, this.emitSortChanged.bind(this));
  }

  /** When a Sort Changes on a Local grid (JSON dataset) */
  onLocalSortChanged(grid: any, dataView: any, sortColumns: ColumnSort[], forceReSort = false) {
    const isTreeViewEnabled = this._gridOptions && this._gridOptions.enableTreeView || false;

    if (grid && dataView) {
      if (forceReSort && !isTreeViewEnabled) {
        dataView.reSort();
      }

      if (isTreeViewEnabled) {
        const treeViewOptions = this._columnWithTreeView?.treeView;
        const treeLevel = treeViewOptions?.levelPropName || '__treeLevel';
        // const columnDef = { ...this._columnWithTreeView, type: FieldType.number, queryFieldSorter: treeLevel };
        // sortColumns = this._grid.getSortColumns();
        // console.log(sortColumns[0].sortAsc)
        // sortColumns.unshift({ multiColumnSort: true, columnId: treeLevel, sortAsc: true, sortCol: columnDef });
        // this._grid.setSortColumns(sortColumns);
        // console.log(this._grid.getSortColumns())
        const sortColIndex = sortColumns.findIndex((sortCol) => sortCol.columnId === this._columnWithTreeView?.id);
        if (sortColIndex >= 0) {
          const dataset = this._dataView.getItems();
          const sortedOutputArray = sortFlatArrayWithParentChildRef(dataset, {
            parentPropName: treeViewOptions?.parentPropName || '__parentId',
            childrenPropName: treeViewOptions?.childrenPropName || 'children',
            direction: sortColumns[sortColIndex].sortAsc ? 'ASC' : 'DESC',
            identifierPropName: this._dataView.getIdPropertyName() || 'id',
            sortByFieldId: treeViewOptions?.sortByFieldId || 'id',
            sortPropFieldType: treeViewOptions?.sortPropFieldType || FieldType.number,
          });
          // console.log(sortColumns.length, sortColIndex, sortColumns.splice(sortColIndex, 1))
          sortColumns.splice(sortColIndex, 1);
          this._dataView.setItems(sortedOutputArray, this._gridOptions.datasetIdPropertyName);
        }
        // this.sortComparer([{ multiColumnSort: true, columnId: treeLevel, sortAsc: columnSortObj.sortAsc, sortCol: columnDef }], dataRow1, dataRow2);
        // const sortResult = sortByFieldType(fieldType, value1, value2, sortDirection, columnDef);
        // if (sortResult !== SortDirectionNumber.neutral) {
        //   return sortResult;
        // }
        // sortColumns.forEach((sortCol) => sortCol.multiColumnSort = true);
      }

      dataView.sort(this.sortComparers.bind(this, sortColumns));

      grid.invalidate();
      grid.render();
    }
  }

  sortComparers(sortColumns: ColumnSort[], dataRow1: any, dataRow2: any): number {
    if (Array.isArray(sortColumns)) {
      for (let i = 0, l = sortColumns.length; i < l; i++) {
        const result = this.sortComparer(sortColumns[i], dataRow1, dataRow2);
        if (result !== undefined) {
          return result;
        }
      }
    }
    return SortDirectionNumber.neutral;
  }

  sortComparer(sortColumn: ColumnSort, dataRow1: any, dataRow2: any): number | undefined {
    if (sortColumn && sortColumn.sortCol) {
      const columnDef = sortColumn.sortCol;
      const sortDirection = sortColumn.sortAsc ? SortDirectionNumber.asc : SortDirectionNumber.desc;
      const sortField = columnDef.queryFieldSorter || columnDef.queryField || columnDef.field;
      const fieldType = columnDef.type || FieldType.string;
      let value1 = dataRow1[sortField];
      let value2 = dataRow2[sortField];

      // when item is a complex object (dot "." notation), we need to filter the value contained in the object tree
      if (sortField && sortField.indexOf('.') >= 0) {
        value1 = getDescendantProperty(dataRow1, sortField);
        value2 = getDescendantProperty(dataRow2, sortField);
      }

      // user could provide his own custom Sorter
      if (columnDef.sorter) {
        const customSortResult = columnDef.sorter(value1, value2, sortDirection, columnDef);
        if (customSortResult !== SortDirectionNumber.neutral) {
          return customSortResult;
        }
      } else {
        const sortResult = sortByFieldType(fieldType, value1, value2, sortDirection, columnDef);
        if (sortResult !== SortDirectionNumber.neutral) {
          return sortResult;
        }
      }
    }
    return undefined;
  }

  /**
   * Update Sorting (sorters) dynamically just by providing an array of sorter(s).
   * You can also choose emit (default) a Sort Changed event that will be picked by the Grid State Service.
   *
   * Also for backend service only, you can choose to trigger a backend query (default) or not if you wish to do it later,
   * this could be useful when using updateFilters & updateSorting and you wish to only send the backend query once.
   * @param sorters array
   * @param triggerEvent defaults to True, do we want to emit a sort changed event?
   * @param triggerBackendQuery defaults to True, which will query the backend.
   */
  updateSorting(sorters: CurrentSorter[], emitChangedEvent = true, triggerBackendQuery = true) {
    if (!this._gridOptions || !this._gridOptions.enableSorting) {
      throw new Error('[Slickgrid-Universal] in order to use "updateSorting" method, you need to have Sortable Columns defined in your grid and "enableSorting" set in your Grid Options');
    }

    if (Array.isArray(sorters)) {
      const backendApi = this._gridOptions && this._gridOptions.backendServiceApi;

      if (backendApi) {
        const backendApiService = backendApi && backendApi.service;
        if (backendApiService && backendApiService.updateSorters) {
          backendApiService.updateSorters(undefined, sorters);
          if (triggerBackendQuery) {
            refreshBackendDataset(this._gridOptions);
          }
        }
      } else {
        this.loadGridSorters(sorters);
      }

      if (emitChangedEvent) {
        const emitterType = backendApi ? EmitterType.remote : EmitterType.local;
        this.emitSortChanged(emitterType);
      }
    }
  }
}
