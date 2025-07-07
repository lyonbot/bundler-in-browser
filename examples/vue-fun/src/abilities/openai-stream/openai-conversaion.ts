/**
 * this do a stream conversation with openai-compatible chat api
 * 
 * and parse stream into async JSONObject iterator
 */
export async function* basicOpenAIChat(payload: {
  model: string,
  messages: any[],
  temperature?: number,
  max_tokens?: number,
  tools?: any[],
}, opts?: {
  url?: string,
  apiKey?: string,
  headers?: any,
  signal?: AbortSignal,
}) {
  const url = opts?.url || localStorage.getItem('openai-api-url') || 'https://api.openai.com/v1/chat/completions'
  const apiKey = opts?.apiKey || localStorage.getItem('openai-api-key') || ''

  const res = await fetch(url, {
    method: 'POST',
    signal: opts?.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...opts?.headers,
    },
    body: JSON.stringify({
      temperature: 0.5,
      ...payload,
      stream: true,
    })
  })

  if (!res.ok) throw new Error('openai failed: ' + res.statusText + '\n' + (await res.text().catch(() => '')))
  if (!res.body) throw new Error('openai failed: no body')

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()

  let lines: string[] = []
  let accumulated = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    accumulated += value
    let lfPos: number
    while ((lfPos = accumulated.indexOf('\n')) !== -1) {
      const line = accumulated.slice(0, lfPos)
      accumulated = accumulated.slice(lfPos + 1)

      lines.push(line)

      if (!line.startsWith('data:')) continue
      if (line.endsWith('[DONE]')) break
      try {
        yield JSON.parse(line.slice(5))
      } catch (e) {
        console.error('bad response line from chat api', line, e)
      }
    }
  }

  console.log('lines', JSON.stringify(lines.join('\n')))
}
