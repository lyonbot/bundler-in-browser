import * as worker from 'monaco-editor-core/esm/vs/editor/editor.worker';
import type * as monaco from 'monaco-editor-core';
import type { FileSystem, LanguageServiceEnvironment } from '@volar/language-service';
import { createTypeScriptWorkerLanguageService, type FileType } from '@volar/monaco/worker';
import { URI } from 'vscode-uri';
import { createNpmFileSystem } from './npmmirror';
import ts from 'typescript';

import { createVueLanguageServicePlugins } from '@vue/language-service'
import { type VueCompilerOptions, createVueLanguagePlugin, getDefaultCompilerOptions as getVueDefaultCompilerOptions, writeGlobalTypes } from '@vue/language-core';
import { create as createTypeScriptTwoslashQueriesPlugin } from 'volar-service-typescript-twoslash-queries'
import { createVueTSPluginClient } from './vue-ts-plugin';

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
				// vue language feature needs a virtual type definition file
				// that provides type definitions like __VLS_PublicProps
				if (uri.path === vueVLSGlobalTypesFilePath)
					return {
						size: vueVLSGlobalTypesContent.length,
						ctime: 1,
						mtime: 1,
						type: 1 satisfies FileType.File
					}

				if (uri.path.startsWith('/node_modules'))
					return await npmFs.stat(uri)
				return await bundlerFs.stat(uri.path)
			},
			async readFile(uri) {
				// vue language feature needs a virtual type definition file
				// that provides type definitions like __VLS_PublicProps
				if (uri.path === vueVLSGlobalTypesFilePath)
					return vueVLSGlobalTypesContent

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
			async getConfiguration(section): Promise<any> {
				// if (section === 'css.customData') {
				// 	// https://github.com/volarjs/services/blob/f0253f4f3e3b0b0f1a453f99b354eb9feaec38cd/packages/css/index.ts#L67
				// 	// https://stackoverflow.com/questions/47607602/how-to-add-a-tailwind-css-rule-to-css-checker/61333686#61333686
				// 	return ["./path/to/some.json"] // TODO: works with the `fs` above
				// }

				// https://github.com/volarjs/services/blob/f0253f4f3e3b0b0f1a453f99b354eb9feaec38cd/packages/css/index.ts#L67
				// https://github.com/microsoft/vscode-css-languageservice/blob/f475d3faf0b9bdf437146ceb329f5c54210da028/src/services/cssValidation.ts#L31
				if (section === "css" || section === "scss") {
					return {
						lint: {
							unknownAtRules: "ignore"
						}
					}
				}
			}
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

		const vueVLSGlobalTypesFilePath = '/node_modules/.vue-global-types.d.ts'
		const vueCompilerOptions: VueCompilerOptions = ({
			...getVueDefaultCompilerOptions(),
			globalTypesPath: () => '.vue-global-types',
		})

		let vueVLSGlobalTypesContent!: string
		writeGlobalTypes(vueCompilerOptions, (_, data) => {
			vueVLSGlobalTypesContent = data
		})

		const vueTsPatch = createVueTSPluginClient(ts)

		const service = createTypeScriptWorkerLanguageService({
			workerContext: ctx,
			env,
			typescript: ts,
			compilerOptions: compilerOptions,
			uriConverter: { asFileName, asUri },

			languagePlugins: [
				createVueLanguagePlugin(
					ts,
					compilerOptions,
					vueCompilerOptions,
					asFileName,
				),
				{
					getLanguageId(scriptId) {
						if (scriptId.path.endsWith('.css')) return 'css'
						if (scriptId.path.endsWith('.scss')) return 'scss'
						if (scriptId.path.endsWith('.less')) return 'less'
					},
				}
			],
			languageServicePlugins: [
				...vueTsPatch.languageServicePlugins,
				createTypeScriptTwoslashQueriesPlugin(ts),
				...createVueLanguageServicePlugins(ts, vueTsPatch.tsPluginClientForVue),
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