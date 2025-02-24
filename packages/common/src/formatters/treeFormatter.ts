import { Constants } from '../constants';
import { type Formatter } from './../interfaces/index';
import { parseFormatterWhenExist } from './formatterUtilities';
import { sanitizeTextByAvailableSanitizer, } from '../services/domUtilities';
import { getCellValueFromQueryFieldGetter, } from '../services/utilities';

/** Formatter that must be use with a Tree Data column */
export const treeFormatter: Formatter = (row, cell, value, columnDef, dataContext, grid) => {
  const gridOptions = grid.getOptions();
  const treeDataOptions = gridOptions?.treeDataOptions;
  const indentMarginLeft = treeDataOptions?.indentMarginLeft ?? 15;
  const collapsedPropName = treeDataOptions?.collapsedPropName ?? Constants.treeDataProperties.COLLAPSED_PROP;
  const hasChildrenPropName = treeDataOptions?.hasChildrenPropName ?? Constants.treeDataProperties.HAS_CHILDREN_PROP;
  const treeLevelPropName = treeDataOptions?.levelPropName ?? Constants.treeDataProperties.TREE_LEVEL_PROP;
  let outputValue = value;

  // when a queryFieldNameGetterFn is defined, then get the value from that getter callback function
  outputValue = getCellValueFromQueryFieldGetter(columnDef, dataContext, value);

  if (outputValue === null || outputValue === undefined || dataContext === undefined) {
    return '';
  }

  if (!dataContext.hasOwnProperty(treeLevelPropName)) {
    throw new Error('[Slickgrid-Universal] You must provide valid "treeDataOptions" in your Grid Options, however it seems that we could not find any tree level info on the current item datacontext row.');
  }

  const treeLevel = dataContext?.[treeLevelPropName] ?? 0;
  const indentSpacer = `<span style="display:inline-block; width:${indentMarginLeft * treeLevel}px;"></span>`;
  const slickTreeLevelClass = `slick-tree-level-${treeLevel}`;
  let toggleClass = '';

  if (dataContext[hasChildrenPropName]) {
    toggleClass = dataContext?.[collapsedPropName] ? 'collapsed' : 'expanded'; // parent with child will have a toggle icon
  }

  if (treeDataOptions?.titleFormatter) {
    outputValue = parseFormatterWhenExist(treeDataOptions.titleFormatter, row, cell, columnDef, dataContext, grid);
  }
  const sanitizedOutputValue = sanitizeTextByAvailableSanitizer(gridOptions, outputValue, { ADD_ATTR: ['target'] });
  const spanToggleClass = `slick-group-toggle ${toggleClass}`.trim();
  const outputHtml = `${indentSpacer}<span class="${spanToggleClass}" aria-expanded="${toggleClass === 'expanded'}"></span><span class="slick-tree-title" level="${treeLevel}">${sanitizedOutputValue}</span>`;
  return { addClasses: slickTreeLevelClass, text: outputHtml };
};
