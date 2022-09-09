/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export namespace notebooks {
		export function registerNotebookStatusBarItemProvider(notebookType: string, provider: NotebookStatusBarItemProvider): Disposable;
	}
	export interface NotebookStatusBarItemProvider {
		onDidChangeStatusBarItems?: Event<void>;
		provideStatusBarItems(document: NotebookDocument, token: CancellationToken): ProviderResult<NotebookStatusBarItem | NotebookStatusBarItem[]>;
	}
	export class NotebookStatusBarItem {
		text: string;
		command?: string | Command;
		tooltip?: string;
		priority?: number;
		accessibilityInformation?: AccessibilityInformation;
		constructor(text: string);
	}
}
