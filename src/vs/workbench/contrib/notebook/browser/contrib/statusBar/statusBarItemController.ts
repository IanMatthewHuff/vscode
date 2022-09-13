/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout, Throttler } from 'vs/base/common/async';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { INotebookEditor, INotebookEditorContribution } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { registerNotebookContribution } from 'vs/workbench/contrib/notebook/browser/notebookEditorExtensions';
import { INotebookStatusBarItemList } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookStatusBarService } from 'vs/workbench/contrib/notebook/common/notebookStatusBarService';

export class ContributedStatusBarItemController extends Disposable implements INotebookEditorContribution {
	// IANHU: Naming?
	static id: string = 'workbench.notebook.statusBar.mainContributed';

	private readonly _updateThrottler = new Throttler();
	private _activeToken: CancellationTokenSource | undefined;
	private _currentItemLists: INotebookStatusBarItemList[] = [];

	constructor(
		private readonly _notebookEditor: INotebookEditor,
		@INotebookStatusBarService private readonly _notebookStatusBarService: INotebookStatusBarService
	) {
		super();

		this._updateEverything();
		this._register(this._notebookStatusBarService.onDidChangeProviders(this._updateEverything, this));
		this._register(this._notebookStatusBarService.onDidChangeItems(this._updateEverything, this));
		this._register(toDisposable(() => this._activeToken?.dispose(true)));
	}

	// IANHU: Too simplistic? Try for now
	private _updateEverything(): void {
		// Wait a tick to make sure that the event is fired to the EH before triggering status bar providers
		this._register(disposableTimeout(() => {
			this._updateThrottler.queue(() => this._update());
		}, 0));
	}

	private async _update(): Promise<void> {
		const vm = this._notebookEditor._getViewModel();

		if (vm) {
			const tokenSource = this._activeToken = new CancellationTokenSource();
			const statusItemLists = await this._notebookStatusBarService.getStatusBarItemsForDocument(vm.notebookDocument.uri, vm.notebookDocument.viewType, this._activeToken.token);
			if (tokenSource.token.isCancellationRequested) {
				statusItemLists.forEach(itemList => itemList.dispose && itemList.dispose());
				return;
			}
			const items = statusItemLists.map(itemList => itemList.items).flat();
			vm.setStatusBarItems(items);
			this._currentItemLists.forEach(itemList => itemList.dispose && itemList.dispose());
			this._currentItemLists = statusItemLists;
		}
	}

	override dispose(): void {
		super.dispose();
		this._activeToken?.dispose(true);
		this._currentItemLists.forEach(itemList => itemList.dispose && itemList.dispose());
	}
}

registerNotebookContribution(ContributedStatusBarItemController.id, ContributedStatusBarItemController);
