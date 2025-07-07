import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { basicOpenAIChat } from './openai-conversaion';
import { processOpenAIStream } from './openai-stream';

describe('openai', () => {
  it.skip('works', { timeout: 100e3 }, async () => {
    const abortController = new AbortController();
    onTestFinished(() => abortController.abort());

    const stream = basicOpenAIChat({
      model: 'gpt-4o',
      // model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'write a poem about cat and send to printer' }],
      tools: [{
        type: "function",
        function: {
          name: "print_poem",
          description: "Print a poem line by line.",
          parameters: {
            type: "object",
            properties: {
              lines: {
                type: "array",
                items: {
                  type: "string"
                },
              }
            },
            required: ["lines"],
          },
        }
      }],
    }, {
      // url: '',
      // apiKey: '',
      signal: abortController.signal,
    })

    const parsing = processOpenAIStream(stream, {
      onBlockComplete(block, index) {
        console.log('block', index, block);
      },
    });
    await parsing.completePromise;
  });

  it('regular', async () => {
    const content = await import('./__fixture__/regular.txt?raw').then(m => m.default);
    const stream = textToStream(content);

    const startFn = vi.fn()
    const completeFn = vi.fn()
    const parsing = processOpenAIStream(stream, {
      onBlockCreate(block, index) {
        startFn(block, index);
      },
      onBlockComplete(block, index) {
        completeFn(block, index);
      },
    });

    await parsing.completePromise;
    expect(parsing.msgBlocks).toMatchSnapshot()
    expect(startFn).toHaveBeenCalledTimes(5)
    expect(completeFn).toHaveBeenCalledTimes(5)
  })

  it('function_call', async () => {
    const content = await import('./__fixture__/function_call.txt?raw').then(m => m.default);
    const stream = textToStream(content);

    const startFn = vi.fn()
    const completeFn = vi.fn()
    const parsing = processOpenAIStream(stream, {
      onBlockCreate(block, index) {
        startFn(block, index);
      },
      onBlockComplete(block, index) {
        completeFn(block, index);
      },
    });

    await parsing.completePromise;
    expect(parsing.msgBlocks).toMatchSnapshot()
    expect(startFn).toHaveBeenCalledTimes(1)
    expect(completeFn).toHaveBeenCalledTimes(1)
  })

  /**
   * 
   * @param text text contains `data: {...}`
   */
  async function* textToStream(text: string) {
    const lines = text.split('\n')
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      if (line.endsWith('[DONE]')) break
      yield JSON.parse(line.slice(5))
    }
  }
});
