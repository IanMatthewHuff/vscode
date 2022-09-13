/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { DomScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { ToggleMenuAction, ToolBar } from 'vs/base/browser/ui/toolbar/toolbar';
import { IAction, Separator, WorkbenchActionExecutedClassification, WorkbenchActionExecutedEvent } from 'vs/base/common/actions';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { MenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IMenu, IMenuService, MenuItemAction, SubmenuItemAction } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { toolbarActiveBackground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService, registerThemingParticipant, ThemeColor } from 'vs/platform/theme/common/themeService';
import { SELECT_KERNEL_ID } from 'vs/workbench/contrib/notebook/browser/controller/coreActions';
import { NOTEBOOK_EDITOR_ID, NotebookSetting, INotebookStatusBarItem } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookEditorDelegate } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookKernelActionViewItem } from 'vs/workbench/contrib/notebook/browser/viewParts/notebookKernelActionViewItem';
import { ActionViewWithLabel } from 'vs/workbench/contrib/notebook/browser/view/cellParts/cellActionView';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IWorkbenchAssignmentService } from 'vs/workbench/services/assignment/common/assignmentService';
import { NotebookOptions } from 'vs/workbench/contrib/notebook/common/notebookOptions';
import { IActionViewItemProvider } from 'vs/base/browser/ui/actionbar/actionbar';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { SimpleIconLabel } from 'vs/base/browser/ui/iconLabel/simpleIconLabel';
import { isThemeColor } from 'vs/editor/common/editorCommon';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { stripIcons } from 'vs/base/common/iconLabels';
import { toErrorMessage } from 'vs/base/common/errorMessage';

const $ = DOM.$;

interface IActionModel {
	action: IAction;
	size: number;
	visible: boolean;
	renderLabel: boolean;
}

enum RenderLabel {
	Always = 0,
	Never = 1,
	Dynamic = 2
}

type RenderLabelWithFallback = true | false | 'always' | 'never' | 'dynamic';

const ICON_ONLY_ACTION_WIDTH = 21;
const TOGGLE_MORE_ACTION_WIDTH = 21;
const ACTION_PADDING = 8;

interface IActionLayoutStrategy {
	actionProvider: IActionViewItemProvider;
	calculateActions(leftToolbarContainerMaxWidth: number): { primaryActions: IAction[]; secondaryActions: IAction[] };
}

class FixedLabelStrategy implements IActionLayoutStrategy {
	constructor(
		readonly notebookEditor: INotebookEditorDelegate,
		readonly editorToolbar: NotebookEditorToolbar,
		readonly instantiationService: IInstantiationService) {

	}

	actionProvider(action: IAction) {
		if (action.id === SELECT_KERNEL_ID) {
			// 	// this is being disposed by the consumer
			return this.instantiationService.createInstance(NotebookKernelActionViewItem, action, this.notebookEditor);
		}

		const a = this.editorToolbar.primaryActions.find(a => a.action.id === action.id);
		if (a && a.renderLabel) {
			return action instanceof MenuItemAction ? this.instantiationService.createInstance(ActionViewWithLabel, action, undefined) : undefined;
		} else {
			return action instanceof MenuItemAction ? this.instantiationService.createInstance(MenuEntryActionViewItem, action, undefined) : undefined;
		}
	}

	protected _calculateFixedActions(leftToolbarContainerMaxWidth: number) {
		const primaryActions = this.editorToolbar.primaryActions;
		const lastItemInLeft = primaryActions[primaryActions.length - 1];
		const hasToggleMoreAction = lastItemInLeft.action.id === ToggleMenuAction.ID;

		let size = 0;
		const actions: IActionModel[] = [];

		for (let i = 0; i < primaryActions.length - (hasToggleMoreAction ? 1 : 0); i++) {
			const actionModel = primaryActions[i];

			const itemSize = actionModel.size;
			if (size + itemSize <= leftToolbarContainerMaxWidth) {
				size += ACTION_PADDING + itemSize;
				actions.push(actionModel);
			} else {
				break;
			}
		}

		actions.forEach(action => action.visible = true);
		primaryActions.slice(actions.length).forEach(action => action.visible = false);

		return {
			primaryActions: actions.filter(action => (action.visible && action.action.id !== ToggleMenuAction.ID)).map(action => action.action),
			secondaryActions: [...primaryActions.slice(actions.length).filter(action => !action.visible && action.action.id !== ToggleMenuAction.ID).map(action => action.action), ...this.editorToolbar.secondaryActions]
		};
	}

	calculateActions(leftToolbarContainerMaxWidth: number) {
		return this._calculateFixedActions(leftToolbarContainerMaxWidth);
	}
}


class FixedLabellessStrategy extends FixedLabelStrategy {
	constructor(
		notebookEditor: INotebookEditorDelegate,
		editorToolbar: NotebookEditorToolbar,
		instantiationService: IInstantiationService) {
		super(notebookEditor, editorToolbar, instantiationService);
	}

	override actionProvider(action: IAction) {
		if (action.id === SELECT_KERNEL_ID) {
			// 	// this is being disposed by the consumer
			return this.instantiationService.createInstance(NotebookKernelActionViewItem, action, this.notebookEditor);
		}

		return action instanceof MenuItemAction ? this.instantiationService.createInstance(MenuEntryActionViewItem, action, undefined) : undefined;
	}
}

class DynamicLabelStrategy implements IActionLayoutStrategy {

	constructor(
		readonly notebookEditor: INotebookEditorDelegate,
		readonly editorToolbar: NotebookEditorToolbar,
		readonly instantiationService: IInstantiationService) {
	}

	actionProvider(action: IAction) {
		if (action.id === SELECT_KERNEL_ID) {
			// 	// this is being disposed by the consumer
			return this.instantiationService.createInstance(NotebookKernelActionViewItem, action, this.notebookEditor);
		}

		const a = this.editorToolbar.primaryActions.find(a => a.action.id === action.id);
		if (a && a.renderLabel) {
			return action instanceof MenuItemAction ? this.instantiationService.createInstance(ActionViewWithLabel, action, undefined) : undefined;
		} else {
			return action instanceof MenuItemAction ? this.instantiationService.createInstance(MenuEntryActionViewItem, action, undefined) : undefined;
		}
	}

	calculateActions(leftToolbarContainerMaxWidth: number) {
		const primaryActions = this.editorToolbar.primaryActions;
		const secondaryActions = this.editorToolbar.secondaryActions;

		const lastItemInLeft = primaryActions[primaryActions.length - 1];
		const hasToggleMoreAction = lastItemInLeft.action.id === ToggleMenuAction.ID;
		const actions = primaryActions.slice(0, primaryActions.length - (hasToggleMoreAction ? 1 : 0));

		if (actions.length === 0) {
			return {
				primaryActions: primaryActions.filter(action => (action.visible && action.action.id !== ToggleMenuAction.ID)).map(action => action.action),
				secondaryActions
			};
		}

		const totalWidthWithLabels = actions.map(action => action.size).reduce((a, b) => a + b, 0) + (actions.length - 1) * ACTION_PADDING;
		if (totalWidthWithLabels <= leftToolbarContainerMaxWidth) {
			primaryActions.forEach(action => {
				action.visible = true;
				action.renderLabel = true;
			});
			return {
				primaryActions: primaryActions.filter(action => (action.visible && action.action.id !== ToggleMenuAction.ID)).map(action => action.action),
				secondaryActions
			};
		}

		// too narrow, we need to hide some labels

		if ((actions.length * ICON_ONLY_ACTION_WIDTH + (actions.length - 1) * ACTION_PADDING) > leftToolbarContainerMaxWidth) {
			return this._calcuateWithAlllabelsHidden(actions, leftToolbarContainerMaxWidth);
		}

		const sums = [];
		let sum = 0;
		let lastActionWithLabel = -1;
		for (let i = 0; i < actions.length; i++) {
			sum += actions[i].size + ACTION_PADDING;
			sums.push(sum);

			if (actions[i].action instanceof Separator) {
				// find group separator
				const remainingItems = actions.slice(i + 1);
				const newTotalSum = sum + (remainingItems.length === 0 ? 0 : (remainingItems.length * ICON_ONLY_ACTION_WIDTH + (remainingItems.length - 1) * ACTION_PADDING));
				if (newTotalSum <= leftToolbarContainerMaxWidth) {
					lastActionWithLabel = i;
				}
			} else {
				continue;
			}
		}

		if (lastActionWithLabel < 0) {
			return this._calcuateWithAlllabelsHidden(actions, leftToolbarContainerMaxWidth);
		}

		const visibleActions = actions.slice(0, lastActionWithLabel + 1);
		visibleActions.forEach(action => { action.visible = true; action.renderLabel = true; });
		primaryActions.slice(visibleActions.length).forEach(action => { action.visible = true; action.renderLabel = false; });
		return {
			primaryActions: primaryActions.filter(action => (action.visible && action.action.id !== ToggleMenuAction.ID)).map(action => action.action),
			secondaryActions
		};
	}

	private _calcuateWithAlllabelsHidden(actions: IActionModel[], leftToolbarContainerMaxWidth: number) {
		const primaryActions = this.editorToolbar.primaryActions;
		const secondaryActions = this.editorToolbar.secondaryActions;

		// all actions hidden labels
		primaryActions.forEach(action => { action.renderLabel = false; });
		let size = 0;
		const renderActions: IActionModel[] = [];

		for (let i = 0; i < actions.length; i++) {
			const actionModel = actions[i];

			if (actionModel.action.id === 'notebook.cell.insertMarkdownCellBelow') {
				renderActions.push(actionModel);
				continue;
			}

			const itemSize = ICON_ONLY_ACTION_WIDTH;
			if (size + itemSize <= leftToolbarContainerMaxWidth) {
				size += ACTION_PADDING + itemSize;
				renderActions.push(actionModel);
			} else {
				break;
			}
		}

		renderActions.forEach(action => {
			if (action.action.id === 'notebook.cell.insertMarkdownCellBelow') {
				action.visible = false;
			} else {
				action.visible = true;
			}
		});
		primaryActions.slice(renderActions.length).forEach(action => action.visible = false);

		return {
			primaryActions: renderActions.filter(action => (action.visible && action.action.id !== ToggleMenuAction.ID)).map(action => action.action),
			secondaryActions: [...primaryActions.slice(actions.length).filter(action => !action.visible && action.action.id !== ToggleMenuAction.ID).map(action => action.action), ...secondaryActions]
		};
	}

}

export class NotebookEditorToolbar extends Disposable {
	// private _editorToolbarContainer!: HTMLElement;
	private _leftToolbarScrollable!: DomScrollableElement;
	private _notebookTopLeftToolbarContainer!: HTMLElement;
	private _notebookTopRightToolbarContainer!: HTMLElement;
	private _notebookGlobalActionsMenu!: IMenu;
	private _notebookLeftToolbar!: ToolBar;
	private _primaryActions: IActionModel[];
	private _notebookTopRightStatusbarContainer!: HTMLElement;
	get primaryActions(): IActionModel[] {
		return this._primaryActions;
	}
	private _secondaryActions: IAction[];
	get secondaryActions(): IAction[] {
		return this._secondaryActions;
	}
	private _notebookRightToolbar!: ToolBar;
	private _useGlobalToolbar: boolean = false;
	private _strategy!: IActionLayoutStrategy;
	private _renderLabel: RenderLabel = RenderLabel.Always;

	private readonly _onDidChangeState = this._register(new Emitter<void>());
	onDidChangeState: Event<void> = this._onDidChangeState.event;

	get useGlobalToolbar(): boolean {
		return this._useGlobalToolbar;
	}

	private _dimension: DOM.Dimension | null = null;
	private readonly _modelDisposables = this._register(new DisposableStore());

	constructor(
		readonly notebookEditor: INotebookEditorDelegate,
		readonly contextKeyService: IContextKeyService,
		readonly notebookOptions: NotebookOptions,
		readonly domNode: HTMLElement,
		@IInstantiationService readonly instantiationService: IInstantiationService,
		@IConfigurationService readonly configurationService: IConfigurationService,
		@IContextMenuService readonly contextMenuService: IContextMenuService,
		@IMenuService readonly menuService: IMenuService,
		@IEditorService private readonly editorService: IEditorService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IWorkbenchAssignmentService private readonly experimentService: IWorkbenchAssignmentService
	) {
		super();

		this._primaryActions = [];
		this._secondaryActions = [];
		this._buildBody();

		this._register(this.editorService.onDidActiveEditorChange(() => {
			if (this.editorService.activeEditorPane?.getId() === NOTEBOOK_EDITOR_ID) {
				const notebookEditor = this.editorService.activeEditorPane.getControl() as INotebookEditorDelegate;
				if (notebookEditor === this.notebookEditor) {
					// this is the active editor
					this._showNotebookActionsInEditorToolbar();
					return;
				}
			}
		}));

		// When we get a new view model register to show status items
		this._register(this.notebookEditor.onDidChangeModel(() => {
			this._modelDisposables.clear();

			if (this.notebookEditor.hasModel()) {
				this._modelDisposables.add(this.notebookEditor._getViewModel().onDidChangeStatusBarItems(() => {
					this._statusBarItemsChanged();
				}));

				this._statusBarItemsChanged();
			}
		}));

		this._registerNotebookActionsToolbar();
	}

	private _buildBody() {
		this._notebookTopLeftToolbarContainer = document.createElement('div');
		this._notebookTopLeftToolbarContainer.classList.add('notebook-toolbar-left');
		this._leftToolbarScrollable = new DomScrollableElement(this._notebookTopLeftToolbarContainer, {
			vertical: ScrollbarVisibility.Hidden,
			horizontal: ScrollbarVisibility.Auto,
			horizontalScrollbarSize: 3,
			useShadows: false,
			scrollYToX: true
		});
		this._register(this._leftToolbarScrollable);

		DOM.append(this.domNode, this._leftToolbarScrollable.getDomNode());

		// IANHU
		this._notebookTopRightStatusbarContainer = document.createElement('div');
		this._notebookTopRightStatusbarContainer.classList.add('notebook-statusbar-container');
		DOM.append(this.domNode, this._notebookTopRightStatusbarContainer);

		this._notebookTopRightToolbarContainer = document.createElement('div');
		this._notebookTopRightToolbarContainer.classList.add('notebook-toolbar-right');
		DOM.append(this.domNode, this._notebookTopRightToolbarContainer);
	}

	private _registerNotebookActionsToolbar() {
		this._notebookGlobalActionsMenu = this._register(this.menuService.createMenu(this.notebookEditor.creationOptions.menuIds.notebookToolbar, this.contextKeyService));
		this._register(this._notebookGlobalActionsMenu);

		this._useGlobalToolbar = this.notebookOptions.getLayoutConfiguration().globalToolbar;
		this._renderLabel = this._convertConfiguration(this.configurationService.getValue<RenderLabelWithFallback>(NotebookSetting.globalToolbarShowLabel));
		this._updateStrategy();

		const context = {
			ui: true,
			notebookEditor: this.notebookEditor
		};

		const actionProvider = (action: IAction) => {
			if (action.id === SELECT_KERNEL_ID) {
				// 	// this is being disposed by the consumer
				return this.instantiationService.createInstance(NotebookKernelActionViewItem, action, this.notebookEditor);
			}

			if (this._renderLabel !== RenderLabel.Never) {
				const a = this._primaryActions.find(a => a.action.id === action.id);
				if (a && a.renderLabel) {
					return action instanceof MenuItemAction ? this.instantiationService.createInstance(ActionViewWithLabel, action, undefined) : undefined;
				} else {
					return action instanceof MenuItemAction ? this.instantiationService.createInstance(MenuEntryActionViewItem, action, undefined) : undefined;
				}
			} else {
				return action instanceof MenuItemAction ? this.instantiationService.createInstance(MenuEntryActionViewItem, action, undefined) : undefined;
			}
		};

		this._notebookLeftToolbar = new ToolBar(this._notebookTopLeftToolbarContainer, this.contextMenuService, {
			getKeyBinding: action => this.keybindingService.lookupKeybinding(action.id),
			actionViewItemProvider: (action) => {
				return this._strategy.actionProvider(action);
			},
			renderDropdownAsChildElement: true
		});
		this._register(this._notebookLeftToolbar);
		this._notebookLeftToolbar.context = context;

		this._notebookRightToolbar = new ToolBar(this._notebookTopRightToolbarContainer, this.contextMenuService, {
			getKeyBinding: action => this.keybindingService.lookupKeybinding(action.id),
			actionViewItemProvider: actionProvider,
			renderDropdownAsChildElement: true
		});
		this._register(this._notebookRightToolbar);
		this._notebookRightToolbar.context = context;

		this._showNotebookActionsInEditorToolbar();
		let dropdownIsVisible = false;
		let deferredUpdate: (() => void) | undefined;

		this._register(this._notebookGlobalActionsMenu.onDidChange(() => {
			if (dropdownIsVisible) {
				deferredUpdate = () => this._showNotebookActionsInEditorToolbar();
				return;
			}

			this._showNotebookActionsInEditorToolbar();
		}));

		this._register(this._notebookLeftToolbar.onDidChangeDropdownVisibility(visible => {
			dropdownIsVisible = visible;

			if (deferredUpdate && !visible) {
				setTimeout(() => {
					deferredUpdate?.();
				}, 0);
				deferredUpdate = undefined;
			}
		}));

		this._register(this.notebookOptions.onDidChangeOptions(e => {
			if (e.globalToolbar !== undefined) {
				this._useGlobalToolbar = this.notebookOptions.getLayoutConfiguration().globalToolbar;
				this._showNotebookActionsInEditorToolbar();
			}
		}));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(NotebookSetting.globalToolbarShowLabel)) {
				this._renderLabel = this._convertConfiguration(this.configurationService.getValue<RenderLabelWithFallback>(NotebookSetting.globalToolbarShowLabel));
				this._updateStrategy();
				const oldElement = this._notebookLeftToolbar.getElement();
				oldElement.parentElement?.removeChild(oldElement);
				this._notebookLeftToolbar.dispose();
				this._notebookLeftToolbar = new ToolBar(this._notebookTopLeftToolbarContainer, this.contextMenuService, {
					getKeyBinding: action => this.keybindingService.lookupKeybinding(action.id),
					actionViewItemProvider: actionProvider,
					renderDropdownAsChildElement: true
				});
				this._register(this._notebookLeftToolbar);
				this._notebookLeftToolbar.context = context;
				this._showNotebookActionsInEditorToolbar();
				return;
			}
		}));

		if (this.experimentService) {
			this.experimentService.getTreatment<boolean>('nbtoolbarineditor').then(treatment => {
				if (treatment === undefined) {
					return;
				}
				if (this._useGlobalToolbar !== treatment) {
					this._useGlobalToolbar = treatment;
					this._showNotebookActionsInEditorToolbar();
				}
			});
		}
	}

	private _updateStrategy() {
		switch (this._renderLabel) {
			case RenderLabel.Always:
				this._strategy = new FixedLabelStrategy(this.notebookEditor, this, this.instantiationService);
				break;
			case RenderLabel.Never:
				this._strategy = new FixedLabellessStrategy(this.notebookEditor, this, this.instantiationService);
				break;
			case RenderLabel.Dynamic:
				this._strategy = new DynamicLabelStrategy(this.notebookEditor, this, this.instantiationService);
				break;
		}
	}

	private _convertConfiguration(value: RenderLabelWithFallback): RenderLabel {
		switch (value) {
			case true:
				return RenderLabel.Always;
			case false:
				return RenderLabel.Never;
			case 'always':
				return RenderLabel.Always;
			case 'never':
				return RenderLabel.Never;
			case 'dynamic':
				return RenderLabel.Dynamic;
		}
	}

	private _showNotebookActionsInEditorToolbar() {
		// when there is no view model, just ignore.
		if (!this.notebookEditor.hasModel()) {
			return;
		}

		if (!this._useGlobalToolbar) {
			this.domNode.style.display = 'none';
		} else {
			this._setNotebookActions();
		}

		this._onDidChangeState.fire();
	}

	private _statusBarItemsChanged() {
		// when there is no view model, just ignore.
		if (!this.notebookEditor.hasModel()) {
			return;
		}

		const statusItems = this.notebookEditor._getViewModel().getStatusBarItems();


		// IANHU: Not right, should actually swap in the new elements
		this._notebookTopRightStatusbarContainer.replaceChildren();
		statusItems.forEach(statusItem => {
			// IANHU: Second param is maxItemWidth, just hardcoding for now
			const statusItemElement = this.instantiationService.createInstance(StatusBarItem, statusItem, 200);
			// const newDiv = document.createElement('div');
			// newDiv.classList.add('notebook-statusbar-item');
			// newDiv.innerText = statusItem.text;
			DOM.append(this._notebookTopRightStatusbarContainer, statusItemElement.container);
		});
	}

	private _setNotebookActions() {
		const groups = this._notebookGlobalActionsMenu.getActions({ shouldForwardArgs: true, renderShortTitle: true });
		this.domNode.style.display = 'flex';
		const primaryLeftGroups = groups.filter(group => /^navigation/.test(group[0]));
		const primaryActions: IAction[] = [];
		primaryLeftGroups.sort((a, b) => {
			if (a[0] === 'navigation') {
				return 1;
			}

			if (b[0] === 'navigation') {
				return -1;
			}

			return 0;
		}).forEach((group, index) => {
			primaryActions.push(...group[1]);
			if (index < primaryLeftGroups.length - 1) {
				primaryActions.push(new Separator());
			}
		});
		const primaryRightGroup = groups.find(group => /^status/.test(group[0]));
		const primaryRightActions = primaryRightGroup ? primaryRightGroup[1] : [];
		const secondaryActions = groups.filter(group => !/^navigation/.test(group[0]) && !/^status/.test(group[0])).reduce((prev: (MenuItemAction | SubmenuItemAction)[], curr) => { prev.push(...curr[1]); return prev; }, []);

		this._notebookLeftToolbar.setActions([], []);

		this._primaryActions.forEach(action => action.renderLabel = true);
		this._notebookLeftToolbar.setActions(primaryActions, secondaryActions);
		this._notebookRightToolbar.setActions(primaryRightActions, []);
		this._secondaryActions = secondaryActions;
		// flush to make sure it can be updated later
		this._primaryActions = [];

		if (this._dimension && this._dimension.width >= 0 && this._dimension.height >= 0) {
			this._cacheItemSizes(this._notebookLeftToolbar);
		}

		this._computeSizes();
	}

	private _cacheItemSizes(toolbar: ToolBar) {
		const actions: IActionModel[] = [];

		for (let i = 0; i < toolbar.getItemsLength(); i++) {
			const action = toolbar.getItemAction(i);
			actions.push({
				action: action,
				size: toolbar.getItemWidth(i),
				visible: true,
				renderLabel: true
			});
		}

		this._primaryActions = actions;
	}

	private _canBeVisible(width: number) {
		let w = 0;
		for (let i = 0; i < this._primaryActions.length; i++) {
			w += this._primaryActions[i].size + 8;
		}

		return w <= width;
	}

	private _computeSizes() {
		const toolbar = this._notebookLeftToolbar;
		const rightToolbar = this._notebookRightToolbar;
		if (toolbar && rightToolbar && this._dimension && this._dimension.height >= 0 && this._dimension.width >= 0) {
			// compute size only if it's visible
			if (this._primaryActions.length === 0 && toolbar.getItemsLength() !== this._primaryActions.length) {
				this._cacheItemSizes(this._notebookLeftToolbar);
			}

			if (this._primaryActions.length === 0) {
				return;
			}

			const kernelWidth = (rightToolbar.getItemsLength() ? rightToolbar.getItemWidth(0) : 0) + ACTION_PADDING;

			if (this._canBeVisible(this._dimension.width - kernelWidth - ACTION_PADDING /** left margin */)) {
				this._primaryActions.forEach(action => {
					action.visible = true;
					action.renderLabel = true;
				});
				toolbar.setActions(this._primaryActions.filter(action => action.action.id !== ToggleMenuAction.ID).map(model => model.action), this._secondaryActions);
				return;
			}

			const leftToolbarContainerMaxWidth = this._dimension.width - kernelWidth - (TOGGLE_MORE_ACTION_WIDTH + ACTION_PADDING) /** ... */ - ACTION_PADDING /** toolbar left margin */;
			const calculatedActions = this._strategy.calculateActions(leftToolbarContainerMaxWidth);
			this._notebookLeftToolbar.setActions(calculatedActions.primaryActions, calculatedActions.secondaryActions);
		}
	}

	layout(dimension: DOM.Dimension) {
		this._dimension = dimension;

		if (!this._useGlobalToolbar) {
			this.domNode.style.display = 'none';
		} else {
			this.domNode.style.display = 'flex';
		}
		this._computeSizes();
	}

	override dispose() {
		this._notebookLeftToolbar.context = undefined;
		this._notebookRightToolbar.context = undefined;
		this._notebookLeftToolbar.dispose();
		this._notebookRightToolbar.dispose();
		this._notebookLeftToolbar = null!;
		this._notebookRightToolbar = null!;

		super.dispose();
	}
}

registerThemingParticipant((theme, collector) => {
	const toolbarActiveBackgroundColor = theme.getColor(toolbarActiveBackground);
	if (toolbarActiveBackgroundColor) {
		collector.addRule(`
		.monaco-workbench .notebookOverlay .notebook-toolbar-container .monaco-action-bar:not(.vertical) .action-item.active {
			background-color: ${toolbarActiveBackgroundColor};
		}
		`);
	}
});

// IANHU: This should move out to a new file, as well as a container here
class StatusBarItem extends Disposable {
	readonly container = $('.notebook-statusbar-item');

	set maxWidth(v: number) {
		this.container.style.maxWidth = v + 'px';
	}

	private _currentItem!: INotebookStatusBarItem;
	private _itemDisposables = this._register(new DisposableStore());

	constructor(
		itemModel: INotebookStatusBarItem,
		maxWidth: number | undefined,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@ICommandService private readonly _commandService: ICommandService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IThemeService private readonly _themeService: IThemeService,
	) {
		super();

		this.updateItem(itemModel, maxWidth);
	}

	updateItem(item: INotebookStatusBarItem, maxWidth: number | undefined) {
		this._itemDisposables.clear();

		if (!this._currentItem || this._currentItem.text !== item.text) {
			new SimpleIconLabel(this.container).text = item.text.replace(/\n/g, ' ');
		}

		const resolveColor = (color: ThemeColor | string) => {
			return isThemeColor(color) ?
				(this._themeService.getColorTheme().getColor(color.id)?.toString() || '') :
				color;
		};

		this.container.style.color = item.color ? resolveColor(item.color) : '';
		this.container.style.backgroundColor = item.backgroundColor ? resolveColor(item.backgroundColor) : '';
		this.container.style.opacity = item.opacity ? item.opacity : '';

		this.container.classList.toggle('notebook-statusbar-item-show-when-active', !!item.onlyShowWhenActive);

		if (typeof maxWidth === 'number') {
			this.maxWidth = maxWidth;
		}

		let ariaLabel: string;
		let role: string | undefined;
		if (item.accessibilityInformation) {
			ariaLabel = item.accessibilityInformation.label;
			role = item.accessibilityInformation.role;
		} else {
			ariaLabel = item.text ? stripIcons(item.text).trim() : '';
		}

		this.container.setAttribute('aria-label', ariaLabel);
		this.container.setAttribute('role', role || '');
		this.container.title = item.tooltip ?? '';

		this.container.classList.toggle('notebook-statusbar-item-has-command', !!item.command);
		if (item.command) {
			this.container.tabIndex = 0;

			this._itemDisposables.add(DOM.addDisposableListener(this.container, DOM.EventType.CLICK, _e => {
				this.executeCommand();
			}));
			this._itemDisposables.add(DOM.addDisposableListener(this.container, DOM.EventType.KEY_DOWN, e => {
				const event = new StandardKeyboardEvent(e);
				if (event.equals(KeyCode.Space) || event.equals(KeyCode.Enter)) {
					this.executeCommand();
				}
			}));
		} else {
			this.container.removeAttribute('tabIndex');
		}

		this._currentItem = item;
	}

	private async executeCommand(): Promise<void> {
		const command = this._currentItem.command;
		if (!command) {
			return;
		}

		const id = typeof command === 'string' ? command : command.id;
		const args = typeof command === 'string' ? [] : command.arguments ?? [];

		// IANHU: Removed a context unshift here

		this._telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id, from: 'notebook status bar' });
		try {
			await this._commandService.executeCommand(id, ...args);
		} catch (error) {
			this._notificationService.error(toErrorMessage(error));
		}
	}
}
