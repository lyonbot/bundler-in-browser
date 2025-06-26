import type { WorkerLanguageService } from '@volar/monaco/worker';
import { editor, languages, Uri } from 'monaco-editor-core';
import { activateMarkers, activateAutoInsertion, registerProviders } from '@volar/monaco';

import editorWorker from 'monaco-editor-core/esm/vs/editor/editor.worker?worker';
import vueWorker from './volar/vue.worker?worker';

(self as any).MonacoEnvironment = {
	getWorker(_: any, label: string) {
		if (label === 'vue') return new vueWorker();
		return new editorWorker();
	}
}

languages.register({ id: 'vue', extensions: ['.vue'] });

languages.onLanguage('vue', () => {
	const worker = editor.createWebWorker<WorkerLanguageService>({
		moduleId: 'vs/language/vue/vueWorker',
		label: 'vue',
	});

	// TODO: sync paths
	const getSyncFiles = () => [Uri.file('/Foo.vue'), Uri.file('/Bar.vue')];

	activateMarkers(worker, ['vue'], 'vue-markers-owner', getSyncFiles, editor as any);
	activateAutoInsertion(worker, ['vue'], getSyncFiles, editor as any);
	registerProviders(worker, ['vue'], getSyncFiles, languages as any)
});
