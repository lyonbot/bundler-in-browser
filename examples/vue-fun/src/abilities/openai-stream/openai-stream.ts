import { ref, reactive, type Ref, type Reactive } from 'vue';

// this file handle openai's stream output
// turn them into MsgBlock

export type OpenAIChunk = {
  id?: string | null;
  choices?: Array<{
    index: number;
    delta: {
      content?: string;
      tool_calls?: Array<{ // Add tool_calls as OpenAI now uses this
        index: number
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: FinishReason | null;
  }>;
};

export type FinishReason = 'stop' | 'length' | 'function_call' | 'tool_error';

export interface MsgBlockBase {
  type: string;
  completed: boolean;
}

export interface TextMsgBlock extends MsgBlockBase {
  type: 'text';
  content: string
}

/** not a standard openai block, just for convenience */
export interface CodeMsgBlock extends MsgBlockBase {
  type: 'code';
  content: string
  language: string
}

export interface FunctionMsgBlock extends MsgBlockBase {
  type: 'function';
  content: { index: number; id: string; function: { name: string; arguments: string } };
}

export type MsgBlock = TextMsgBlock | CodeMsgBlock | FunctionMsgBlock;

export function processOpenAIStream(
  input: AsyncIterable<OpenAIChunk>,
  hooks?: {
    onBlockCreate?: (block: MsgBlock, index: number) => void,
    onBlockComplete?: (block: MsgBlock, index: number) => void,
  }
): {
  msgBlocks: Reactive<MsgBlock[]>;
  finishReason: Ref<FinishReason | null>;
  completePromise: Promise<void>;
} {
  const msgBlocks: Reactive<MsgBlock[]> = reactive([]);
  const finishReason: Ref<FinishReason | null> = ref(null);

  const completePromise = (async () => {
    let currentBlock = null as Reactive<MsgBlock> | null;

    const sealBlock = () => {
      if (!currentBlock) return;
      currentBlock.completed = true;
      hooks?.onBlockComplete?.(currentBlock, msgBlocks.length - 1);
      currentBlock = null;
    }
    const newBlock = <T extends MsgBlock>(block: T): Reactive<T> => {
      sealBlock();
      currentBlock = reactive<T>(block);
      msgBlocks.push(currentBlock);
      hooks?.onBlockCreate?.(currentBlock, msgBlocks.length - 1);
      return currentBlock! as Reactive<T>;
    }

    const newFunctionCallBlock = (functionCall: FunctionMsgBlock['content']) => {
      newBlock({
        type: 'function',
        content: functionCall,
        completed: false,
      });
    }
    const newTextBlock = (text: string) => {
      newBlock({
        type: 'text',
        content: text,
        completed: false,
      });
    }
    const newCodeBlock = (code: string, language: string) => {
      newBlock({
        type: 'code',
        content: code,
        language,
        completed: false,
      });
    }

    // ----------------------------------------------

    /**
     * repeat this procedure till no more separated block can be found:
     * 
     * - if current is a CodeMsgBlock, try to stop it by `` ```\n `` and make a TextMsgBlock
     * - if current is a TextMsgBlock, try to start a CodeMsgBlock by `` ```language\n ``
     */
    function tryExplodeBlock() {
      while (true) {
        if (currentBlock?.type === 'code') {
          const mat = /^```+\s*\n/m.exec(currentBlock.content);
          if (!mat) break;

          const newContent = currentBlock.content.slice(mat.index + mat[0].length);
          currentBlock.content = currentBlock.content.slice(0, mat.index);
          newTextBlock(newContent);
          continue
        }

        if (currentBlock?.type === 'text') {
          const mat = /^```+([^\n]*)\n/m.exec(currentBlock.content);
          if (!mat) break;

          const language = mat[1];
          const newContent = currentBlock.content.slice(mat.index + mat[0].length);
          currentBlock.content = currentBlock.content.slice(0, mat.index);
          newCodeBlock(newContent, language);
          continue
        }

        break // not valid type to explode
      }
    }

    /**
     * before leaving "text"-based block, add an extra \n so `tryExplodeBlock` can explode it
     * 
     * then, try to explode the text-based block
     */
    function addExtraLFAndTryExplodeBlock() {
      if (!currentBlock) return;
      if (currentBlock.type === 'code' || currentBlock.type === 'text') {
        currentBlock.content += '\n';
      }
      tryExplodeBlock();
    }

    // ----------------------------------------------

    for await (const chunk of input) {
      const newFinishReason = chunk.choices?.[0]?.finish_reason;
      if (newFinishReason) finishReason.value = newFinishReason;

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      const toolCall = delta.tool_calls?.[0];
      if (toolCall) {
        if (currentBlock?.type !== 'function' || currentBlock.content.index !== toolCall.index) {
          addExtraLFAndTryExplodeBlock();
          newFunctionCallBlock({
            index: toolCall.index,
            id: toolCall.id,
            function: {
              name: '',
              arguments: '',
            }
          })
        }

        if (currentBlock?.type === 'function') {  // typescript can't infer type
          if (toolCall.id) currentBlock.content.id = toolCall.id;
          if (toolCall.function.name) currentBlock.content.function.name = toolCall.function.name;
          if (toolCall.function.arguments) currentBlock.content.function.arguments += toolCall.function.arguments; // accumulate
        }
      }

      const deltaContent = delta.content;
      if (deltaContent) {
        if (currentBlock?.type === 'text') {
          currentBlock.content += deltaContent;
        } else if (currentBlock?.type === 'code') {
          currentBlock.content += deltaContent;
        } else {
          newTextBlock(deltaContent);
        }
        tryExplodeBlock();
      }
    }

    addExtraLFAndTryExplodeBlock();
    sealBlock();
  })();

  return {
    msgBlocks,
    finishReason,
    completePromise
  };
}

export function msgBlocksToOpenAIMessages(msgBlocks: MsgBlock[]) {
  let ans = {
    role: 'assistant',
    content: '',
    tool_calls: [] as any,
  }

  for (const msgBlock of msgBlocks) {
    switch (msgBlock.type) {
      case 'text': {
        ans.content += msgBlock.content;
        break;
      }

      case 'code': {
        // FIXME: too many extra \n are made
        ans.content += '\n```' + msgBlock.language + '\n'
        ans.content += msgBlock.content;
        ans.content += '\n```\n'
        break;
      }

      case 'function': {
        ans.tool_calls.push({
          id: msgBlock.content.id,
          type: 'function',
          function: {
            name: msgBlock.content.function.name,
            arguments: msgBlock.content.function.arguments,
          }
        })
        break
      }

      default: {
        const _never: never = msgBlock;
      }
    }
  }

  if (!ans.tool_calls.length) delete ans.tool_calls;
  return ans;
}

export async function openAIMessageToMsgBlocks(message: any) {
  const msgBlocks: MsgBlock[] = [];

  if (message.content) {
    const out = processOpenAIStream(async function* () {
      yield {
        choices: [{
          index: 0,
          delta: { content: message.content },
          finish_reason: null,
        }]
      }
    }())
    await out.completePromise;
    msgBlocks.push(...out.msgBlocks);
  }

  if (message.tool_calls) {
    for (const toolCall of message.tool_calls) {
      msgBlocks.push({
        type: 'function',
        content: {
          index: toolCall.index,
          id: toolCall.id,
          function: {
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          }
        },
        completed: true,
      });
    }
  }

  return msgBlocks;
}
