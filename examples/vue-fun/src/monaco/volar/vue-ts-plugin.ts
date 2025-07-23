// this is ported from old version of @vue/language-service
// https://github.com/vuejs/language-tools/blob/v2.2.12/packages/language-service/index.ts

import type { createVueLanguageServicePlugins, LanguageServiceContext, LanguageServicePlugin } from "@vue/language-service";
import { create as createTypeScriptServicePlugins } from 'volar-service-typescript'
import type { URI } from "vscode-uri";

import type { RequestContext } from "@vue/typescript-plugin/lib/requests/types";
import { createVueLanguageServiceProxy } from '@vue/typescript-plugin/lib/common';
import { collectExtractProps } from '@vue/typescript-plugin/lib/requests/collectExtractProps';
import { getComponentDirectives } from '@vue/typescript-plugin/lib/requests/getComponentDirectives';
import { getComponentEvents } from '@vue/typescript-plugin/lib/requests/getComponentEvents';
import { getComponentNames } from '@vue/typescript-plugin/lib/requests/getComponentNames';
import { getComponentProps } from '@vue/typescript-plugin/lib/requests/getComponentProps';
import { getElementNames } from '@vue/typescript-plugin/lib/requests/getElementNames';
import { getElementAttrs } from '@vue/typescript-plugin/lib/requests/getElementAttrs';
import { getImportPathForFile } from '@vue/typescript-plugin/lib/requests/getImportPathForFile';
import { getPropertiesAtLocation } from '@vue/typescript-plugin/lib/requests/getPropertiesAtLocation';

/**
 * this function do `createTypeScriptServicePlugins` and patch them,
 * and return a viable `tsPluginClientForVue` for `createVueLanguageServicePlugins()`
 */
export function createVueTSPluginClient(ts: typeof import('typescript')): {
  /** use this as 2nd param of `createVueLanguageServicePlugins` */
  tsPluginClientForVue: Parameters<typeof createVueLanguageServicePlugins>[1],
  /** use this BEFORE `...createVueLanguageServicePlugins(ts, ...)` */
  languageServicePlugins: LanguageServicePlugin[]
} {
  const plugins = [
    ...createTypeScriptServicePlugins(ts, {
      disableAutoImportCache: true, // https://github.com/vuejs/language-tools/blob/074331825a68eb595bf97a364852bce9eb1bcacb/packages/language-service/index.ts#L58C36-L58C58
    }),
  ]

  for (let i = 0; i < plugins.length; i++) {
    const plugin = plugins[i];
    if (plugin.name === 'typescript-semantic') {
      plugins[i] = {
        ...plugin,
        create(context) {
          const created = plugin.create(context);
          if (!context.project.typescript) {
            return created;
          }
          const languageService = (created.provide as import('volar-service-typescript').Provide)['typescript/languageService']();
          if (context.project.vue) {
            const proxy = createVueLanguageServiceProxy(
              ts,
              context.language,
              languageService,
              context.project.vue.compilerOptions,
              s => context.project.typescript?.uriConverter.asUri(s)
            );
            languageService.getCompletionsAtPosition = proxy.getCompletionsAtPosition;
            languageService.getCompletionEntryDetails = proxy.getCompletionEntryDetails;
            languageService.getCodeFixesAtPosition = proxy.getCodeFixesAtPosition;
            languageService.getQuickInfoAtPosition = proxy.getQuickInfoAtPosition;
          }

          languageServiceContext = context
          requestContext = {
            typescript: ts,
            language: context.language,
            languageService,
            languageServiceHost: context.project.typescript.languageServiceHost,
            isTsPlugin: false,
            asScriptId: s => context.project.typescript!.uriConverter.asUri(s),
          };
          return created;
        },
      };
      break;
    }
  }

  let languageServiceContext!: LanguageServiceContext
  let requestContext!: RequestContext<URI>
  const tsPluginClientForVue: Parameters<typeof createVueLanguageServicePlugins>[1] = {
    async collectExtractProps(...args) {
      return await collectExtractProps.apply(requestContext, args);
    },
    async getPropertiesAtLocation(...args) {
      return await getPropertiesAtLocation.apply(requestContext, args);
    },
    async getImportPathForFile(...args) {
      return await getImportPathForFile.apply(requestContext, args);
    },
    async getComponentEvents(...args) {
      return await getComponentEvents.apply(requestContext, args);
    },
    async getComponentDirectives(...args) {
      return await getComponentDirectives.apply(requestContext, args);
    },
    async getComponentNames(...args) {
      return await getComponentNames.apply(requestContext, args);
    },
    async getComponentProps(...args) {
      return await getComponentProps.apply(requestContext, args);
    },
    async getElementNames(...args) {
      return await getElementNames.apply(requestContext, args);
    },
    async getElementAttrs(...args) {
      return await getElementAttrs.apply(requestContext, args);
    },
    async getQuickInfoAtPosition(fileName, position) {
      const languageService = languageServiceContext.getLanguageService();
      const uri = languageServiceContext.project.typescript!.uriConverter.asUri(fileName);
      const sourceScript = languageServiceContext.language.scripts.get(uri);
      if (!sourceScript) {
        return;
      }
      // const document = context.documents.get(uri, sourceScript.languageId, sourceScript.snapshot);
      const hover = await languageService.getHover(uri, position);
      let text = '';
      if (typeof hover?.contents === 'string') {
        text = hover.contents;
      }
      else if (Array.isArray(hover?.contents)) {
        text = hover.contents.map(c => typeof c === 'string' ? c : c.value).join('\n');
      }
      else if (hover) {
        text = hover.contents.value;
      }
      text = text.replace(/```typescript/g, '');
      text = text.replace(/```/g, '');
      text = text.replace(/---/g, '');
      text = text.trim();
      while (true) {
        const newText = text.replace(/\n\n/g, '\n');
        if (newText === text) {
          break;
        }
        text = newText;
      }
      text = text.replace(/\n/g, ' | ');
      return text;
    },
    // FIXME: implement these
    async getEncodedSemanticClassifications(fileName, span) {
      return null
    },
    async getDocumentHighlights(fileName, position) {
      return null
    },
  };

  return {
    tsPluginClientForVue,
    languageServicePlugins: plugins,
  }
}