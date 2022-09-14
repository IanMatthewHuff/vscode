/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { INotebookStatusBarItemList, INotebookStatusBarItemProvider } from 'vs/workbench/contrib/notebook/common/notebookCommon';

export const INotebookStatusBarService = createDecorator<INotebookStatusBarService>('notebookStatusBarService');

export interface INotebookStatusBarService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeProviders: Event<void>;
	readonly onDidChangeItems: Event<void>;

	registerStatusBarItemProvider(provider: INotebookStatusBarItemProvider): IDisposable;

	getStatusBarItemsForDocument(docUri: URI, viewType: string, token: CancellationToken): Promise<INotebookStatusBarItemList[]>;
}
