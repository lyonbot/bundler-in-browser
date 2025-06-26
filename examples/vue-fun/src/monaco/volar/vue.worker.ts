import * as worker from 'monaco-editor-core/esm/vs/editor/editor.worker';
import type * as monaco from 'monaco-editor-core';
import type { LanguageServiceEnvironment } from '@volar/language-service';
import { createTypeScriptWorkerLanguageService } from '@volar/monaco/worker';
import { URI } from 'vscode-uri';
import { createNpmFileSystem } from './npmmirror';
import ts from 'typescript';

import {
	type VueCompilerOptions,
	getFullLanguageServicePlugins as getVueFullLanguageServicePlugins,
	createVueLanguagePlugin,
	getDefaultCompilerOptions as getVueDefaultCompilerOptions,
} from '@vue/language-service'

self.onmessage = () => {
	worker.initialize((ctx: monaco.worker.IWorkerContext) => {
		const env: LanguageServiceEnvironment = {
			fs: createNpmFileSystem(),
			workspaceFolders: [
				URI.parse('file:///'),
			],
		};

		const asFileName = (uri: URI) => uri.path
		const asUri = (fileName: string): URI => URI.file(fileName)

		const compilerOptions: ts.CompilerOptions = {
			...ts.getDefaultCompilerOptions(),
			allowJs: true,
			jsx: ts.JsxEmit.Preserve,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Node10,
		};

		const vueCompilerOptions: VueCompilerOptions = ({
			...getVueDefaultCompilerOptions()
		})

		return createTypeScriptWorkerLanguageService({
			workerContext: ctx,
			env,
			typescript: ts,
			compilerOptions: compilerOptions,
			uriConverter: { asFileName, asUri },

			// see https://github.com/vuejs/repl/blob/master/src/monaco/vue.worker.ts#L85
			languagePlugins: [
				createVueLanguagePlugin(
					ts,
					compilerOptions,
					vueCompilerOptions,
					asFileName,
				),
			],
			languageServicePlugins: [
				...getVueFullLanguageServicePlugins(ts),
			],
			setup({ project }) {
				// TODO: wtf is this?
				project.vue = { compilerOptions: vueCompilerOptions }
			},

			// languagePlugins: [
			// 	// ...
			// ],
			// languageServicePlugins: [
			// 	createCSSPlugin({}),
			// 	...createTypeScriptServicePlugin(ts),
			// ],
		});
	});
};