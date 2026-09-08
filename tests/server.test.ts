import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { request as httpRequest } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.js";
import type { AppOptions } from "../server/app.js";
import { generationPrompt } from "../server/provider.js";
import type { GenerateRequest, Workspace } from "../src/types.js";
import { illustrationSchema } from "../server/schema.js";

const timestamp = "2026-09-08T00:00:00.000Z";
function workspace(): Workspace {
  return {
    version: 1,
    activeBookId: "book-1",
    books: [
      {
        id: "book-1",
        title: "The Tide House",
        subtitle: "",
        author: "Mira",
        genre: "Literary fiction",
        language: "English",
        direction: "auto",
        voiceSample: "The kettle clicked. She counted it as an answer.",
        voiceNotes: "Restrained, precise.",
        targetWords: 50_000,
        chapters: [
          {
            id: "chapter-1",
            title: "The Key",
            content: "<p>Mira found the brass key beneath the tide clock.</p>",
            synopsis: "Mira inherits a house.",
            status: "draft",
            versions: [],
          },
        ],
        bible: [
          {
            id: "note-1",
            kind: "character",
            name: "Mira",
            details: "A locksmith who cannot swim.",
          },
        ],
        images: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}
function generation(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    book: workspace().books[0],
    chapterId: "chapter-1",
    idea: "The key opens a room beneath the sea.",
    selection: "",
    mode: "develop",
    length: 2,
    unit: "pages",
    voice: "Intimate",
    perspective: "Third person limited",
    tense: "Past",
    ...overrides,
  };
}
const providerSettings = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  textModel: "gpt-6-astra",
  imageModel: "gpt-image-2",
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfV0AAAAASUVORK5CYII=",
  "base64",
);
const resources: { server: Server; directory: string }[] = [];
async function setup(options: AppOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), "folio-server-test-"));
  const server = createApp({
    dataDir: directory,
    distDir: join(directory, "missing-dist"),
    env: {},
    ...options,
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  resources.push({ server, directory });
  const port = (server.address() as AddressInfo).port;
  async function send(
    method: string,
    path: string,
    data?: unknown,
    headers: Record<string, string> = {},
  ) {
    return new Promise<{
      status: number;
      body: any;
      raw: Buffer;
      headers: Record<string, unknown>;
    }>((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            Host: "127.0.0.1:3001",
            Origin: "http://127.0.0.1:5173",
            "Content-Type": "application/json",
            ...headers,
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            const raw = Buffer.concat(chunks);
            let body: unknown;
            try {
              body = JSON.parse(raw.toString());
            } catch {
              body = raw.toString();
            }
            resolve({
              status: response.statusCode!,
              body,
              raw,
              headers: response.headers,
            });
          });
        },
      );
      request.on("error", reject);
      request.end(data === undefined ? undefined : JSON.stringify(data));
    });
  }
  return { directory, server, port, send };
}
afterEach(async () => {
  for (const { server, directory } of resources.splice(0)) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    if (
      !resolve(directory).startsWith(
        `${resolve(tmpdir())}${process.platform === "win32" ? "\\" : "/"}`,
      ) ||
      !basename(directory).startsWith("folio-server-test-")
    )
      throw new Error("Unsafe test cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});

describe("local workspace persistence", () => {
  it("saves, reloads, and preserves the previous revision as a recoverable backup", async () => {
    const { send, directory } = await setup();
    expect((await send("GET", "/api/workspace")).body).toEqual({
      workspace: null,
      revision: 0,
    });
    const initial = workspace();
    expect(
      (await send("PUT", "/api/workspace", { workspace: initial, revision: 0 }))
        .body,
    ).toEqual({ revision: 1 });
    const updated = workspace();
    updated.books[0].title = "A Different Tide";
    expect(
      (await send("PUT", "/api/workspace", { workspace: updated, revision: 1 }))
        .body,
    ).toEqual({ revision: 2 });
    expect((await send("GET", "/api/workspace")).body).toEqual({
      workspace: updated,
      revision: 2,
    });
    expect(
      JSON.parse(
        await readFile(join(directory, "workspace.previous.json"), "utf8"),
      ),
    ).toEqual({ workspace: initial, revision: 1 });
  });
  it("serializes concurrent saves and rejects stale revisions without losing the winner", async () => {
    const { send } = await setup();
    const first = workspace();
    first.books[0].title = "First";
    const second = workspace();
    second.books[0].title = "Second";
    const results = await Promise.all([
      send("PUT", "/api/workspace", { workspace: first, revision: 0 }),
      send("PUT", "/api/workspace", { workspace: second, revision: 0 }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(results.find((result) => result.status === 409)?.body.revision).toBe(
      1,
    );
    expect((await send("GET", "/api/workspace")).body.revision).toBe(1);
  });
  it("preserves corrupt files and refuses to silently start an empty workspace", async () => {
    const { send, directory } = await setup();
    const corrupt = "{broken manuscript";
    await writeFile(join(directory, "workspace.json"), corrupt);
    expect((await send("GET", "/api/workspace")).status).toBe(503);
    expect(
      (
        await send("PUT", "/api/workspace", {
          workspace: workspace(),
          revision: 0,
        })
      ).status,
    ).toBe(503);
    expect(await readFile(join(directory, "workspace.json"), "utf8")).toBe(
      corrupt,
    );
  });
  it("requires recovery if the main file is missing but a previous backup remains", async () => {
    const { send, directory } = await setup();
    await writeFile(
      join(directory, "workspace.previous.json"),
      JSON.stringify({ workspace: workspace(), revision: 3 }),
    );
    expect((await send("GET", "/api/workspace")).status).toBe(503);
    expect(
      (
        await send("PUT", "/api/workspace", {
          workspace: workspace(),
          revision: 0,
        })
      ).status,
    ).toBe(503);
  });
  it("sanitizes manuscript and version HTML while retaining legitimate formatting and bundled illustration", async () => {
    const { send } = await setup();
    const book = workspace();
    const dangerous =
      '<p style="text-align:center;position:fixed" onclick="steal()">Safe <strong>words</strong><script>steal()</script><a href="javascript:steal()">link</a><img src="/assets/tide-illustration.png" alt="Tide" onerror="steal()"></p>';
    book.books[0].chapters[0].content = dangerous;
    book.books[0].chapters[0].versions = [
      {
        id: "v1",
        name: "Version",
        title: "",
        createdAt: timestamp,
        content: dangerous,
      },
    ];
    expect(
      (await send("PUT", "/api/workspace", { workspace: book, revision: 0 }))
        .status,
    ).toBe(200);
    const saved = (await send("GET", "/api/workspace")).body.workspace.books[0]
      .chapters[0];
    expect(saved.content).toContain("text-align:center");
    expect(saved.content).toContain("<strong>words</strong>");
    expect(saved.content).toContain("/assets/tide-illustration.png");
    expect(saved.content).not.toMatch(
      /script|onclick|onerror|javascript|position|evil/,
    );
    expect(saved.versions[0].content).toBe(saved.content);
  });
  it("rejects unsupported manuscript image sources instead of silently discarding artwork", async () => {
    const { send } = await setup();
    for (const source of [
      "https://external.test/art.png",
      "data:image/png;base64,AAAA",
    ]) {
      const book = workspace();
      book.books[0].chapters[0].content = `<p>My saved words.</p><img src="${source}">`;
      const result = await send("PUT", "/api/workspace", {
        workspace: book,
        revision: 0,
      });
      expect(result.status).toBe(400);
      expect(result.body.error).toContain("Upload the image");
    }
    expect((await send("GET", "/api/workspace")).body.revision).toBe(0);
  });
  it("keeps saving after more than one hundred chapter snapshots", async () => {
    const { send } = await setup();
    const book = workspace();
    book.books[0].chapters[0].versions = Array.from(
      { length: 101 },
      (_, index) => ({
        id: `version-${index}`,
        name: `Draft ${index}`,
        createdAt: timestamp,
        title: "The Key",
        content: "<p>Earlier words.</p>",
      }),
    );
    expect(
      (await send("PUT", "/api/workspace", { workspace: book, revision: 0 }))
        .status,
    ).toBe(200);
    expect(
      (await send("GET", "/api/workspace")).body.workspace.books[0].chapters[0]
        .versions,
    ).toHaveLength(101);
  });
  it("rejects structurally invalid workspaces before any write", async () => {
    const { send } = await setup();
    const bad = workspace();
    bad.activeBookId = "missing";
    expect(
      (await send("PUT", "/api/workspace", { workspace: bad, revision: 0 }))
        .status,
    ).toBe(400);
    expect((await send("GET", "/api/workspace")).body.revision).toBe(0);
  });
});

describe("local security and provider settings", () => {
  it("blocks hostile hosts, origins and cross-site requests before exposing data", async () => {
    const { send } = await setup({
      env: { OPENAI_API_KEY: "secret-that-must-not-leak" },
    });
    expect(
      (
        await send("GET", "/api/settings", undefined, {
          Host: "evil.test:3001",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send("GET", "/api/settings", undefined, {
          Origin: "https://evil.test",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send("GET", "/api/workspace", undefined, {
          "Sec-Fetch-Site": "cross-site",
        })
      ).status,
    ).toBe(403);
    const valid = await send("GET", "/api/settings");
    expect(valid.status).toBe(200);
    expect(valid.body.configured).toBe(true);
    expect(valid.raw.toString()).not.toContain("secret-that");
    expect(valid.headers["cache-control"]).toBe("no-store");
  });

  it("accepts the exact Vercel deployment host and HTTPS origin", async () => {
    const { send } = await setup({
      env: {
        VERCEL: "1",
        VERCEL_URL: "folio-writing-studio.vercel.app",
      },
    });
    const result = await send("GET", "/api/health", undefined, {
      Host: "folio-writing-studio.vercel.app",
      Origin: "https://folio-writing-studio.vercel.app",
    });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("ready");
  });
  it("persists model preferences but never API keys", async () => {
    const { send, directory } = await setup();
    const result = await send("POST", "/api/settings", {
      ...providerSettings,
      apiKey: "session-secret-123",
    });
    expect(result.body.configured).toBe(true);
    expect(result.raw.toString()).not.toContain("session-secret-123");
    const disk = await readFile(join(directory, "settings.json"), "utf8");
    expect(disk).not.toContain("session-secret-123");
    expect(JSON.parse(disk)).toEqual(providerSettings);
    expect(
      (await send("POST", "/api/settings", { ...providerSettings, apiKey: "" }))
        .body.configured,
    ).toBe(true);
    const freshApp = await setup({ dataDir: directory });
    expect((await freshApp.send("GET", "/api/settings")).body.configured).toBe(
      false,
    );
  });
  it("never forwards an existing provider credential to a newly selected origin", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: "Local draft." }, finish_reason: "stop" },
            ],
          }),
        ),
    );
    const { send } = await setup({
      env: { OPENAI_API_KEY: "openai-secret" },
      fetcher,
    });
    await send("POST", "/api/settings", {
      ...providerSettings,
      provider: "compatible",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "",
    });
    expect((await send("POST", "/api/generate", generation())).status).toBe(
      200,
    );
    const headers = fetcher.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(
      (
        await send("POST", "/api/settings", {
          ...providerSettings,
          provider: "compatible",
          baseUrl: "https://other-provider.test/v1",
        })
      ).body.configured,
    ).toBe(false);
    expect((await send("POST", "/api/generate", generation())).status).toBe(
      428,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not use OPENAI_API_KEY for a saved custom provider after restart", async () => {
    const { directory } = await setup();
    await writeFile(
      join(directory, "settings.json"),
      JSON.stringify({
        ...providerSettings,
        provider: "compatible",
        baseUrl: "https://other-provider.test/v1",
      }),
    );
    const reopened = await setup({
      dataDir: directory,
      env: { OPENAI_API_KEY: "openai-secret" },
    });
    expect((await reopened.send("GET", "/api/settings")).body.configured).toBe(
      false,
    );
  });
  it("recovers provider settings after a damaged file is corrected", async () => {
    const { directory, send } = await setup();
    await writeFile(join(directory, "settings.json"), "{broken");
    expect((await send("GET", "/api/settings")).status).toBe(503);
    await writeFile(
      join(directory, "settings.json"),
      JSON.stringify(providerSettings),
    );
    expect((await send("GET", "/api/settings")).status).toBe(200);
  });
  it.each([
    "http://evil.test/v1",
    "file:///etc/passwd",
    "https://name:password@api.test/v1",
    "https://api.test/v1?api_key=secret",
    "https://api.test/v1#fragment",
  ])("rejects unsafe endpoint %s", async (baseUrl) => {
    const { send } = await setup();
    expect(
      (await send("POST", "/api/settings", { ...providerSettings, baseUrl }))
        .status,
    ).toBe(400);
  });
});

describe("creative generation", () => {
  it("keeps idea-only provider prompts independent from chapter context", () => {
    const request = generation({
      idea: "A lighthouse keeper hears tomorrow's storm in an empty room.",
      mode: "summary",
      length: 28,
      unit: "words",
      summaryScope: "idea",
    });
    const prompt = generationPrompt(request, 28, true);
    expect(prompt.instructions).toContain("idea-only summary");
    expect(prompt.instructions).toContain("Stay close to the requested size");
    expect(prompt.input).toContain(
      "A lighthouse keeper hears tomorrow's storm",
    );
    expect(prompt.input).toContain("omitted for an idea-only summary");
    expect(prompt.input).not.toContain("Mara Vale");
    expect(prompt.input).not.toContain("Bellweather");
  });

  it("automatically uses the strongest available loopback model without a key", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, options) => {
      if (String(url).endsWith("/models"))
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "Qwen3.5-9B.gguf",
                meta: { n_params: 9_000_000_000 },
              },
              {
                id: "/root/models/Qwen3.8-27B.gguf",
                meta: { n_params: 27_000_000_000, n_ctx: 8_192 },
              },
            ],
          }),
        );
      expect(String(url)).toBe("http://127.0.0.1:8080/v1/chat/completions");
      const body = JSON.parse(String(options?.body));
      expect(body.model).toBe("/root/models/Qwen3.8-27B.gguf");
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: "The lantern kept watch." },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
    const { send } = await setup({
      fetcher,
      autoLocalModel: true,
      localModelBaseUrl: "http://127.0.0.1:8080/v1",
    });
    const settings = await send("GET", "/api/settings");
    expect(settings.body).toMatchObject({
      configured: false,
      localModelAvailable: true,
      localModelName: "Qwen3.8 27B",
      localModelContext: 8_192,
    });
    const result = await send("POST", "/api/generate", generation());
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      text: "The lantern kept watch.",
      source: "local-model",
      targetWords: 500,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("probes common loopback runtimes and chooses the strongest model across them", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, options) => {
      const value = String(url);
      if (value.endsWith("/models")) {
        if (value.startsWith("http://127.0.0.1:11434"))
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "qwen3.5:27b",
                  meta: { n_params: 27_000_000_000 },
                },
              ],
            }),
          );
        if (value.startsWith("http://127.0.0.1:1234"))
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "small-local-model",
                  meta: { n_params: 7_000_000_000 },
                },
              ],
            }),
          );
        return new Response(JSON.stringify({ data: [] }));
      }
      expect(value).toBe("http://127.0.0.1:11434/v1/chat/completions");
      const body = JSON.parse(String(options?.body));
      expect(body.model).toBe("qwen3.5:27b");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: "The stronger local model answered." },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
    const { send } = await setup({ fetcher, autoLocalModel: true });
    expect((await send("GET", "/api/settings")).body).toMatchObject({
      configured: false,
      localModelAvailable: true,
      localModelName: "qwen3.5:27b",
    });
    const result = await send("POST", "/api/generate", generation());
    expect(result.status).toBe(200);
    expect(result.body.source).toBe("local-model");
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith("/models")),
    ).toHaveLength(4);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("ranks local model sizes encoded in ids when runtime metadata is absent", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, options) => {
      if (String(url).endsWith("/models"))
        return new Response(
          JSON.stringify({
            data: [{ id: "qwen3.5:7b" }, { id: "qwen3.8:27b-instruct" }],
          }),
        );
      const body = JSON.parse(String(options?.body));
      expect(body.model).toBe("qwen3.8:27b-instruct");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: "The larger local model answered." },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
    const { send } = await setup({ fetcher, autoLocalModel: true });
    expect((await send("GET", "/api/settings")).body).toMatchObject({
      configured: false,
      localModelAvailable: true,
      localModelName: "qwen3.8:27b instruct",
    });
    const result = await send("POST", "/api/generate", generation());
    expect(result.status).toBe(200);
    expect(result.body.source).toBe("local-model");
  });

  it("discovers runtimes that expose a non-empty models list and name fields", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, options) => {
      if (String(url).endsWith("/models"))
        return new Response(
          JSON.stringify({
            data: [],
            models: [
              {
                name: "qwen3.8:27b-instruct",
                meta: { n_params: 27_000_000_000, n_ctx: 8_192 },
              },
            ],
          }),
        );
      const body = JSON.parse(String(options?.body));
      expect(body.model).toBe("qwen3.8:27b-instruct");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: "The named local model answered." },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
    const { send } = await setup({
      fetcher,
      autoLocalModel: true,
      localModelBaseUrl: "http://127.0.0.1:8080/v1",
    });
    expect((await send("GET", "/api/settings")).body).toMatchObject({
      configured: false,
      localModelAvailable: true,
      localModelName: "qwen3.8:27b instruct",
      localModelContext: 8_192,
    });
    const result = await send("POST", "/api/generate", generation());
    expect(result.status).toBe(200);
    expect(result.body.source).toBe("local-model");
  });

  it("ignores embedding-only local models when choosing a writing model", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, options) => {
      if (String(url).endsWith("/models"))
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "bge-m3",
                meta: { n_params: 70_000_000_000 },
              },
              {
                id: "qwen3.5:7b",
                meta: { n_params: 7_000_000_000 },
                capabilities: ["chat"],
              },
            ],
          }),
        );
      const body = JSON.parse(String(options?.body));
      expect(body.model).toBe("qwen3.5:7b");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: "The writing model answered." },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
    const { send } = await setup({ fetcher, autoLocalModel: true });
    expect((await send("GET", "/api/settings")).body).toMatchObject({
      configured: false,
      localModelAvailable: true,
      localModelName: "qwen3.5:7b",
    });
    expect((await send("POST", "/api/generate", generation())).status).toBe(
      200,
    );
  });

  it("keeps automatic local requests within the advertised context window", async () => {
    const book = workspace().books[0];
    book.voiceNotes = "voice note ".repeat(3_000);
    book.voiceSample = "voice sample ".repeat(3_000);
    book.bible[0].details = "story detail ".repeat(5_000);
    book.chapters[0].synopsis = "synopsis ".repeat(2_000);
    book.chapters[0].content = `<p>${"manuscript words ".repeat(12_000)}</p>`;
    const fetcher = vi.fn<typeof fetch>(async (url, options) => {
      if (String(url).endsWith("/models"))
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "qwen3.5:7b",
                meta: { n_params: 7_000_000_000, n_ctx: 8_192 },
              },
            ],
          }),
        );
      const body = JSON.parse(String(options?.body));
      expect(body.messages[1].content.length).toBeLessThan(20_000);
      expect(body.max_tokens).toBeLessThanOrEqual(2_850);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: "The bounded local draft answered." },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
    const { send } = await setup({
      fetcher,
      autoLocalModel: true,
      localModelBaseUrl: "http://127.0.0.1:8080/v1",
    });
    const result = await send("POST", "/api/generate", {
      ...generation({ book }),
      book,
    });
    expect(result.status).toBe(200);
  });

  it("keeps an automatic local draft near its requested size at a sentence boundary", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/models"))
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "qwen3.8:27b",
                meta: { n_params: 27_000_000_000 },
              },
            ],
          }),
        );
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "The first sentence gives the room a name and a history. The second sentence introduces a pressure that cannot be ignored by anyone who enters. The third sentence follows the character toward a difficult choice at the edge of certainty. The fourth sentence explains more than the story has earned and should be left for later. The fifth sentence adds a distant consequence, a second relationship, and a question about what the character will have to surrender before the book can reach its final page.",
              },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
    const { send } = await setup({ fetcher, autoLocalModel: true });
    const result = await send(
      "POST",
      "/api/generate",
      generation({
        mode: "summary",
        summaryScope: "book",
        length: 65,
        unit: "words",
      }),
    );
    expect(result.status).toBe(200);
    expect(result.body.source).toBe("local-model");
    expect(result.body.wordCount).toBeGreaterThanOrEqual(52);
    expect(result.body.wordCount).toBeLessThanOrEqual(78);
    expect(result.body.text).toMatch(/[.!?…]$/u);
    expect(result.body.text).not.toContain("The fifth sentence");
  });

  it("requires configuration and never fabricates a fallback draft", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { send } = await setup({ fetcher });
    const result = await send("POST", "/api/generate", generation());
    expect(result.status).toBe(428);
    expect(result.body.text).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps automatic model discovery on loopback only", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { send } = await setup({
      fetcher,
      autoLocalModel: true,
      localModelBaseUrl: "https://model.example/v1",
    });
    expect((await send("GET", "/api/settings")).body.localModelAvailable).toBe(
      false,
    );
    expect((await send("POST", "/api/generate", generation())).status).toBe(
      428,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends grounded Responses context, aggregates output text, and flags incomplete drafts", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      const sent = JSON.parse(options!.body as string);
      const supported = new Set([
        "model",
        "instructions",
        "input",
        "reasoning",
        "max_output_tokens",
        "store",
      ]);
      if (
        Object.keys(sent).some((key) => !supported.has(key)) ||
        sent.model !== "gpt-6-astra" ||
        sent.reasoning?.effort !== "low"
      ) {
        return new Response(
          JSON.stringify({
            error: { message: "Unsupported Astra request options" },
          }),
          { status: 400 },
        );
      }
      return new Response(
        JSON.stringify({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [
            { type: "reasoning", content: [] },
            {
              type: "message",
              content: [
                { type: "output_text", text: "Mira held the key." },
                { type: "output_text", text: "The sea waited." },
              ],
            },
          ],
        }),
      );
    });
    const { send } = await setup({
      env: { OPENAI_API_KEY: "private-key" },
      fetcher,
    });
    const result = await send("POST", "/api/generate", generation());
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      text: "Mira held the key.\nThe sea waited.",
      wordCount: 7,
      targetWords: 500,
      incomplete: true,
    });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(options!.body as string);
    expect(body.store).toBe(false);
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.top_logprobs).toBeUndefined();
    expect(body.logprobs).toBeUndefined();
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.input).toContain("locksmith who cannot swim");
    expect(body.input).toContain("brass key");
    expect(body.input).toContain("counted it as an answer");
    expect(body.input).not.toContain("private-key");
    expect(body.instructions).toContain("500 words");
  });
  it("supports a compatible chat endpoint and computes line targets", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: "A quiet room." }, finish_reason: "stop" },
            ],
          }),
        ),
    );
    const { send } = await setup({ fetcher });
    await send("POST", "/api/settings", {
      ...providerSettings,
      provider: "compatible",
      baseUrl: "http://localhost:11434/v1",
      textModel: "local-model",
    });
    const result = await send(
      "POST",
      "/api/generate",
      generation({ length: 4, unit: "lines" }),
    );
    expect(result.body.targetWords).toBe(48);
    expect(result.body.incomplete).toBe(false);
    expect(fetcher.mock.calls[0][0]).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
    expect(
      JSON.parse(fetcher.mock.calls[0][1]!.body as string).messages[0].role,
    ).toBe("system");
  });
  it("includes scope-specific source material for book summaries", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      const sent = JSON.parse(options!.body as string);
      expect(sent.input).toContain("summaryMaterial");
      expect(sent.input).toContain("The Key");
      expect(sent.input).toContain("Mira found the brass key");
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "A concise summary." }],
            },
          ],
        }),
      );
    });
    const { send } = await setup({
      env: { OPENAI_API_KEY: "private-key" },
      fetcher,
    });
    const result = await send(
      "POST",
      "/api/generate",
      generation({
        mode: "summary",
        summaryScope: "book",
        length: 65,
        unit: "words",
      }),
    );
    expect(result.status).toBe(200);
    expect(result.body.text).toBe("A concise summary.");
  });
  it("includes the supplied idea as the source for idea summaries", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      const sent = JSON.parse(options!.body as string);
      expect(sent.input).toContain("summaryMaterial");
      expect(sent.input).toContain("lighthouse keeper");
      expect(sent.instructions).toContain("exactly one grammatical sentence");
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "An idea summary." }],
            },
          ],
        }),
      );
    });
    const { send } = await setup({
      env: { OPENAI_API_KEY: "private-key" },
      fetcher,
    });
    const result = await send(
      "POST",
      "/api/generate",
      generation({
        mode: "summary",
        summaryScope: "idea",
        idea: "A lighthouse keeper hears tomorrow's storm in an empty room.",
        length: 28,
        unit: "words",
      }),
    );
    expect(result.status).toBe(200);
    expect(result.body.text).toBe("An idea summary.");
  });

  it("rejects an empty idea-only summary before provider work", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { send } = await setup({
      env: { OPENAI_API_KEY: "private-key" },
      fetcher,
    });
    const result = await send(
      "POST",
      "/api/generate",
      generation({
        idea: "",
        selection: "",
        mode: "summary",
        summaryScope: "idea",
        length: 28,
        unit: "words",
      }),
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toContain("idea");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 429, 500])(
    "returns useful credential-safe provider errors for HTTP %s",
    async (status) => {
      const fetcher = vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              error: { message: "private-secret-do-not-echo" },
            }),
            { status },
          ),
      );
      const { send } = await setup({
        env: { OPENAI_API_KEY: "private-key" },
        fetcher,
      });
      const result = await send("POST", "/api/generate", generation());
      expect(result.status).toBe(status === 429 ? 429 : 502);
      expect(result.body.error).toBeTruthy();
      expect(result.raw.toString()).not.toContain("private-secret");
      expect(result.body.text).toBeUndefined();
      expect(fetcher).toHaveBeenCalledTimes(1);
      if (status === 403)
        expect(result.body.error).toContain("does not have access");
    },
  );
  it("rejects empty and malformed provider outputs instead of returning success", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: [] })))
      .mockResolvedValueOnce(new Response("<html>wrong endpoint</html>"))
      .mockResolvedValueOnce(new Response("null"));
    const { send } = await setup({ env: { OPENAI_API_KEY: "key" }, fetcher });
    expect((await send("POST", "/api/generate", generation())).status).toBe(
      502,
    );
    expect((await send("POST", "/api/generate", generation())).status).toBe(
      502,
    );
    expect((await send("POST", "/api/generate", generation())).status).toBe(
      502,
    );
  });
  it("validates length and chapter ownership before provider work", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { send } = await setup({ env: { OPENAI_API_KEY: "key" }, fetcher });
    for (const data of [
      generation({ length: 21, unit: "pages" }),
      generation({ length: -1 }),
      generation({ chapterId: "foreign-chapter" }),
    ])
      expect((await send("POST", "/api/generate", data)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("aborts a timed-out generation and explains that the draft was not changed", async () => {
    let wasAborted = false;
    const fetcher = vi.fn<typeof fetch>(
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener("abort", () => {
            wasAborted = true;
            reject(options!.signal!.reason);
          });
        }),
    );
    const { send } = await setup({
      env: { OPENAI_API_KEY: "key" },
      fetcher,
      generationTimeoutMs: 20,
    });
    const result = await send("POST", "/api/generate", generation());
    expect(result.status).toBe(504);
    expect(wasAborted).toBe(true);
  });
  it("cancels provider work when the requesting client disconnects", async () => {
    let started!: () => void;
    let aborted!: () => void;
    const start = new Promise<void>((resolve) => {
      started = resolve;
    });
    const abort = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    const fetcher = vi.fn<typeof fetch>(
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener("abort", () => {
            aborted();
            reject(options!.signal!.reason);
          });
          started();
        }),
    );
    const { port } = await setup({ env: { OPENAI_API_KEY: "key" }, fetcher });
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path: "/api/generate",
      method: "POST",
      headers: { Host: "127.0.0.1:3001", "Content-Type": "application/json" },
    });
    request.on("error", () => undefined);
    request.end(JSON.stringify(generation()));
    await start;
    request.destroy();
    await abort;
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("book illustrations", () => {
  it("imports real PNG bytes, serves the exact file and blocks unexpected media paths", async () => {
    const { send } = await setup();
    const imported = await send("POST", "/api/images", {
      dataUrl: `data:image/png;base64,${png.toString("base64")}`,
    });
    expect(imported.status).toBe(201);
    expect(imported.body.url).toMatch(/^\/media\/[a-f0-9-]+\.png$/);
    const image = await send("GET", imported.body.url);
    expect(image.status).toBe(200);
    expect(image.raw.equals(png)).toBe(true);
    expect(image.headers["content-type"]).toMatch(/image\/png/);
    const removed = await send(
      "DELETE",
      imported.body.url.replace("/media/", "/api/images/"),
    );
    expect(removed.status).toBe(204);
    expect((await send("GET", imported.body.url)).status).toBe(404);
    expect((await send("GET", "/media/settings.json")).status).toBe(404);
    expect((await send("GET", "/media/%2e%2e%2fsettings.json")).status).toBe(
      404,
    );
  });
  it("rejects SVG, forged MIME types and nonimage payloads", async () => {
    const { send } = await setup();
    for (const dataUrl of [
      `data:image/svg+xml;base64,${Buffer.from('<svg onload="evil()"/>').toString("base64")}`,
      `data:image/jpeg;base64,${png.toString("base64")}`,
      `data:image/png;base64,${Buffer.from("<html>not an image</html>").toString("base64")}`,
    ])
      expect((await send("POST", "/api/images", { dataUrl })).status).toBe(400);
  });
  it("generates a grounded illustration and saves provider bytes locally", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }),
        ),
    );
    const { send } = await setup({ env: { OPENAI_API_KEY: "key" }, fetcher });
    const result = await send("POST", "/api/illustrate", {
      book: workspace().books[0],
      chapterId: "chapter-1",
      excerpt: "The room beneath the sea.",
      direction: "A brass key in the foreground",
      style: "Woodcut",
      size: "1024x1536",
    });
    expect(result.status).toBe(200);
    expect(result.body.style).toBe("Woodcut");
    expect(result.body.chapterId).toBe("chapter-1");
    expect(illustrationSchema.safeParse(result.body).success).toBe(true);
    expect((await send("GET", result.body.url)).raw.equals(png)).toBe(true);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.model).toBe("gpt-image-2");
    expect(body.output_format).toBe("png");
    expect(body.prompt).toContain("Woodcut");
    expect(body.prompt).toContain("room beneath the sea");
    expect(body.prompt).toContain("locksmith who cannot swim");
  });
  it("rejects art direction that would create an unsavable illustration before provider work", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { send } = await setup({ env: { OPENAI_API_KEY: "key" }, fetcher });
    const result = await send("POST", "/api/illustrate", {
      book: workspace().books[0],
      chapterId: "chapter-1",
      excerpt: "A house",
      direction: "x".repeat(8001),
      style: "Woodcut",
      size: "1024x1024",
    });
    expect(result.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not fetch arbitrary remote URLs returned in place of embedded image data", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ url: "http://169.254.169.254/latest/meta-data/" }],
          }),
        ),
    );
    const { send } = await setup({ env: { OPENAI_API_KEY: "key" }, fetcher });
    const result = await send("POST", "/api/illustrate", {
      book: workspace().books[0],
      chapterId: "chapter-1",
      excerpt: "A house",
      direction: "",
      style: "Watercolor",
      size: "1024x1024",
    });
    expect(result.status).toBe(502);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
