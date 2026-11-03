/** A model that answers a prompt with JSON that follows a schema. Only a local one exists (Ollama). */
export interface Provider {
  name: string;
  model: string;
  complete(request: { system: string; user: string; schema: object }): Promise<string>;
}

/** The server does not answer, or does not have the model: the review cannot run. */
export class Unavailable extends Error {}

/** The server answered, but not with something usable. */
export class BadAnswer extends Error {}

export interface OllamaOptions {
  host?: string;
  model: string;
  /** Context window asked of the server; Ollama's default (2 to 4 thousand tokens) would cut the prompt. */
  numCtx?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export function ollama(options: OllamaOptions): Provider {
  const host = (options.host ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
  const call = options.fetch ?? fetch;
  return {
    name: "ollama",
    model: options.model,
    async complete({ system, user, schema }) {
      let response: Response;
      try {
        response = await call(`${host}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: options.model,
            stream: false,
            format: schema,
            options: { temperature: 0, num_ctx: options.numCtx ?? 16384 },
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
        });
      } catch (e) {
        const cause = (e as { cause?: { code?: string } }).cause?.code;
        const timeout = (e as Error).name === "TimeoutError";
        throw new Unavailable(
          timeout
            ? `Ollama at ${host} did not answer in time`
            : `Ollama at ${host} is not reachable${cause ? ` (${cause})` : ""}`,
        );
      }
      if (response.status === 404)
        throw new Unavailable(`Ollama at ${host} has no model "${options.model}": ollama pull ${options.model}`);
      if (!response.ok) throw new Unavailable(`Ollama at ${host} answered ${response.status}`);
      let body: { message?: { content?: unknown } };
      try {
        body = (await response.json()) as typeof body;
      } catch {
        throw new BadAnswer("Ollama's answer is not JSON");
      }
      const content = body.message?.content;
      if (typeof content !== "string") throw new BadAnswer("Ollama's answer has no message");
      return content;
    },
  };
}
