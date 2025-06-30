import * as worker from 'monaco-editor-core/esm/vs/editor/editor.worker';
import type * as monaco from 'monaco-editor-core';
import type { FileSystem, LanguageServiceEnvironment } from '@volar/language-service';
import { createTypeScriptWorkerLanguageService, type FileType } from '@volar/monaco/worker';
import { URI } from 'vscode-uri';
import { createNpmFileSystem } from './npmmirror';
import ts from 'typescript';

import {
	type VueCompilerOptions,
	getFullLanguageServicePlugins as getVueFullLanguageServicePlugins,
	createVueLanguagePlugin,
	getDefaultCompilerOptions as getVueDefaultCompilerOptions,
} from '@vue/language-service'
import { createWorkerDispatcher } from 'yon-utils';
import type { BundlerFsAccess } from '../setup-volar';

self.onmessage = () => {
	worker.initialize((ctx: monaco.worker.IWorkerContext) => {
		const npmFs = createNpmFileSystem()
		const bundlerFs = createWorkerDispatcher<BundlerFsAccess>((payload, transferable) => self.postMessage(
			{ type: '__accessBundlerFs__', payload },
			transferable,
		))
		const fs: FileSystem = {
			async stat(uri) {
				if (uri.path.startsWith('/node_modules'))
					return await npmFs.stat(uri)
				return await bundlerFs.stat(uri.path)
			},
			async readFile(uri) {
				if (uri.path.startsWith('/node_modules/'))
					return await npmFs.readFile(uri)
				return await bundlerFs.readFile(uri.path)
			},
			async readDirectory(uri) {
				if (uri.path.startsWith('/node_modules/'))
					return npmFs.readDirectory(uri)
				const ans = await bundlerFs.readDirectory(uri.path)
				if (uri.path === '/' && !ans.some(([name]) => name === 'node_modules')) {
					ans.push(['node_modules', 2 satisfies FileType.Directory])
				}
				return ans
			},
		}

		const env: LanguageServiceEnvironment = {
			fs,
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
			target: ts.ScriptTarget.ESNext,
			allowSyntheticDefaultImports: true,
		};

		const vueCompilerOptions: VueCompilerOptions = ({
			...getVueDefaultCompilerOptions(),
		})

		const service = createTypeScriptWorkerLanguageService({
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

		return service
	});
};