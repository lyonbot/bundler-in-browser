import { type FileType, type FileStat, type WorkerLanguageService } from '@volar/monaco/worker';
import { editor, languages } from 'monaco-editor-core';
import { activateMarkers, activateAutoInsertion, registerProviders } from '@volar/monaco';

import editorWorker from 'monaco-editor-core/esm/vs/editor/editor.worker?worker';
import VueWorker from './volar/vue.worker?worker';
import { getBundlerController } from '@/bundler/controller';
import { createWorkerHandler } from 'yon-utils';

export type BundlerFsAccess = {
	readDirectory: (path: string) => Promise<[string, FileType][]>;
	readFile: (path: string) => Promise<string | undefined>;
	stat: (path: string) => Promise<FileStat | undefined>;
}

(self as any).MonacoEnvironment = {
	getWorker(_: any, label: string) {
		if (label === 'vue') {
			const vueWorker = new VueWorker();

			// make files available to vue worker
			getBundlerController().then(async controller => {
				const handleBundlerFsAccess = createWorkerHandler<BundlerFsAccess>({
					readDirectory: async (fsPath) => {
						const res = await controller.api.readdir(fsPath).catch(() => []);
						return res.map(item => [
							item.name,
							item.isSymbolicLink ? 64 satisfies FileType.SymbolicLink : item.isDirectory ? 2 satisfies FileType.Directory : 1 satisfies FileType.File,
						])
					},
					readFile: async (fsPath) => {
						return await controller.api.readFile(fsPath).catch(() => undefined)
					},
					stat: async (fsPath) => {
						const res = await controller.api.stat(fsPath).catch(() => undefined)
						if (!res) return undefined
						return {
							ctime: res.ctime,
							mtime: res.mtime,
							size: res.size,
							type: res.isDirectory ? 2 satisfies FileType.Directory : 1 satisfies FileType.File,
						}
					},
				})

				vueWorker.addEventListener('message', e => {
					if (e.data?.type === '__accessBundlerFs__') handleBundlerFsAccess(e.data.payload)
				})
			})

			return vueWorker;
		}
		return new editorWorker();
	}
}

languages.onLanguage('vue', () => {
	const worker = editor.createWebWorker<WorkerLanguageService>({
		moduleId: 'vs/language/vue/vueWorker',
		label: 'vue',
	});

	const getSyncFiles = () => editor.getModels().map(model => model.uri).filter(p => p.scheme === 'file')
	const langs = ['vue', 'javascript', 'typescript'];

	activateMarkers(worker, langs, 'vue-markers-owner', getSyncFiles, editor as any);
	activateAutoInsertion(worker, langs, getSyncFiles, editor as any);
	registerProviders(worker, langs, getSyncFiles, languages as any)
});
