/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { onUnexpectedExternalError } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { INotebookStatusBarService } from 'vs/workbench/contrib/notebook/common/notebookStatusBarService';
import { INotebookStatusBarItemList, INotebookStatusBarItemProvider } from 'vs/workbench/contrib/notebook/common/notebookCommon';

export class NotebookStatusBarService extends Disposable implements INotebookStatusBarService {

	readonly _serviceBrand: undefined;

	private readonly _onDidChangeProviders = this._register(new Emitter<void>());
	readonly onDidChangeProviders: Event<void> = this._onDidChangeProviders.event;

	private readonly _onDidChangeItems = this._register(new Emitter<void>());
	readonly onDidChangeItems: Event<void> = this._onDidChangeItems.event;

	private readonly _providers: INotebookStatusBarItemProvider[] = [];

	registerStatusBarItemProvider(provider: INotebookStatusBarItemProvider): IDisposable {
		this._providers.push(provider);
		let changeListener: IDisposable | undefined;
		if (provider.onDidChangeStatusBarItems) {
			changeListener = provider.onDidChangeStatusBarItems(() => this._onDidChangeItems.fire());
		}

		this._onDidChangeProviders.fire();

		return toDisposable(() => {
			changeListener?.dispose();
			const idx = this._providers.findIndex(p => p === provider);
			this._providers.splice(idx, 1);
		});
	}

	async getStatusBarItemsForDocument(docUri: URI, viewType: string, token: CancellationToken): Promise<INotebookStatusBarItemList[]> {
		const providers = this._providers.filter(p => p.viewType === viewType || p.viewType === '*');
		return await Promise.all(providers.map(async p => {
			try {
				return await p.provideStatusBarItems(docUri, token) ?? { items: [] };
			} catch (e) {
				onUnexpectedExternalError(e);
				return { items: [] };
			}
		}));
	}
}
