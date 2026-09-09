import express from "express";
import type { Request, Response, NextFunction } from "express";
import { mkdir, readFile, stat, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Illustration, Settings } from "../src/types.js";
import { AppError, atomicWrite, WorkspaceStore } from "./storage.js";
import {
  generateSchema,
  illustrateSchema,
  localImagePattern,
  providerSchema,
  settingsInputSchema,
  workspaceSchema,
} from "./schema.js";
import {
  defaultLocalModelBaseUrl,
  defaultLocalModelBaseUrls,
  discoverStrongestLocalModel,
  generate,
  generateLocalModel,
  illustrate,
  imageExtension,
} from "./provider.js";
import type { Fetcher, LocalModelInfo, ProviderConfig } from "./provider.js";

export interface AppOptions {
  dataDir?: string;
  distDir?: string;
  fetcher?: Fetcher;
  env?: NodeJS.ProcessEnv;
  generationTimeoutMs?: number;
  /** Enable the no-setup loopback model bridge (enabled for the real server). */
  autoLocalModel?: boolean;
  localModelBaseUrl?: string;
  /** Optional additional loopback endpoints to probe for a free model. */
  localModelBaseUrls?: string[];
}
const localHosts = new Set([
  "localhost:5173",
  "127.0.0.1:5173",
  "localhost:3001",
  "127.0.0.1:3001",
]);
function normalizeConfiguredHost(value: string): string {
  try {
    return new URL(
      value.includes("://") ? value : `https://${value}`,
    ).host.toLowerCase();
  } catch {
    return "";
  }
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const dataDir = resolve(options.dataDir ?? join(process.cwd(), ".data"));
  const mediaDir = join(dataDir, "media");
  const store = new WorkspaceStore(dataDir);
  const env = options.env ?? process.env;
  const publicHosts = [
    ...(env.FOLIO_PUBLIC_HOSTS?.split(",") ?? []),
    env.VERCEL_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.VERCEL_BRANCH_URL,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeConfiguredHost)
    .filter(Boolean);
  const allowedHosts = new Set([...localHosts, ...publicHosts]);
  const allowedOrigins = new Set([
    ...[...localHosts].map((host) => `http://${host}`),
    ...publicHosts.map((host) => `https://${host}`),
  ]);
  const fetcher = options.fetcher ?? globalThis.fetch;
  const autoLocalModel =
    options.autoLocalModel ??
    (options.fetcher === undefined &&
      options.dataDir === undefined &&
      !["0", "false", "off"].includes(
        (env.FOLIO_AUTO_LOCAL_MODEL || "").trim().toLowerCase(),
      ));
  const localModelBaseUrl =
    options.localModelBaseUrl ||
    env.FOLIO_LOCAL_MODEL_URL?.trim() ||
    defaultLocalModelBaseUrl;
  const localModelBaseUrls = options.localModelBaseUrls
    ? options.localModelBaseUrls
    : options.localModelBaseUrl || env.FOLIO_LOCAL_MODEL_URL?.trim()
      ? [localModelBaseUrl]
      : defaultLocalModelBaseUrls;
  let localModelState:
    { value: LocalModelInfo | null; expiresAt: number } | undefined;
  let localModelProbe: Promise<LocalModelInfo | null> | undefined;
  let apiKey = env.OPENAI_API_KEY?.trim() || "";
  let keyOrigin = "https://api.openai.com";
  let settings: ProviderConfig = {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    textModel: "gpt-6-astra",
    imageModel: "gpt-image-2",
  };
  let settingsLoaded: Promise<void> | undefined;
  let settingsQueue: Promise<unknown> = Promise.resolve();
  const loadSettings = () =>
    (settingsLoaded ??= (async () => {
      let raw: string;
      try {
        raw = await readFile(join(dataDir, "settings.json"), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw new AppError(
          503,
          "Writing settings could not be read. Check the .data folder permissions.",
        );
      }
      try {
        settings = providerSchema.parse(JSON.parse(raw));
      } catch {
        throw new AppError(
          503,
          "The saved provider settings are unreadable. Correct .data/settings.json before using generation.",
        );
      }
    })().catch((error) => {
      settingsLoaded = undefined;
      throw error;
    }));
  const keyRequired = () =>
    settings.provider === "openai" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(settings.baseUrl).hostname,
    );
  const effectiveKey = () =>
    new URL(settings.baseUrl).origin === keyOrigin ? apiKey : "";
  const detectLocalModel = async (): Promise<LocalModelInfo | null> => {
    if (!autoLocalModel) return null;
    const now = Date.now();
    if (localModelState && localModelState.expiresAt > now)
      return localModelState.value;
    if (!localModelProbe) {
      const probe = discoverStrongestLocalModel(
        fetcher,
        localModelBaseUrls,
      ).then(
        (value) => {
          localModelState = {
            value,
            // Keep a working model visible for a little while, but retry a
            // missing/stopped server quickly so the browser path can recover.
            expiresAt: Date.now() + (value ? 30_000 : 5_000),
          };
          return value;
        },
        () => {
          localModelState = { value: null, expiresAt: Date.now() + 5_000 };
          return null;
        },
      );
      localModelProbe = probe;
      void probe.then(
        () => {
          if (localModelProbe === probe) localModelProbe = undefined;
        },
        () => {
          if (localModelProbe === probe) localModelProbe = undefined;
        },
      );
    }
    return localModelProbe;
  };
  const publicSettings = async (): Promise<Settings> => {
    const localModel = await detectLocalModel();
    return {
      ...settings,
      configured: Boolean(effectiveKey()) || !keyRequired(),
      localModelAvailable: Boolean(localModel),
      ...(localModel
        ? {
            localModelName: localModel.name,
            ...(localModel.contextLength
              ? { localModelContext: localModel.contextLength }
              : {}),
          }
        : {}),
    };
  };
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    const origin = req.get("origin");
    if (
      !allowedHosts.has((req.get("host") || "").toLowerCase()) ||
      (origin && !allowedOrigins.has(origin)) ||
      req.get("sec-fetch-site") === "cross-site"
    ) {
      res.status(403).json({
        error:
          "This local writing studio only accepts requests from its own localhost window.",
      });
      return;
    }
    next();
  });
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "25mb", strict: true }));

  app.get("/api/health", (_req, res) => {
    res.json({
      application: "folio-writing-studio",
      status: "ready",
      version: "1.0.0",
    });
  });
  app.get("/api/workspace", async (_req, res) => {
    res.json(await store.read());
  });
  app.put("/api/workspace", async (req, res) => {
    const input = z
      .object({
        workspace: workspaceSchema,
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(req.body);
    res.json(await store.save(input.workspace, input.revision));
  });
  app.get("/api/settings", async (_req, res) => {
    await loadSettings();
    res.json(await publicSettings());
  });
  app.post("/api/settings", async (req, res) => {
    const input = settingsInputSchema.parse(req.body);
    const operation = settingsQueue.then(async () => {
      await loadSettings();
      const next = providerSchema.parse(input);
      await mkdir(dataDir, { recursive: true });
      await atomicWrite(join(dataDir, "settings.json"), JSON.stringify(next));
      settings = next;
      if (input.apiKey) {
        apiKey = input.apiKey;
        keyOrigin = new URL(next.baseUrl).origin;
      }
      return publicSettings();
    });
    settingsQueue = operation.catch(() => undefined);
    res.json(await operation);
  });

  async function withModel(
    req: Request,
    res: Response,
    config: ProviderConfig,
    key: string,
    work: (
      signal: AbortSignal,
      config: ProviderConfig,
      key: string,
    ) => Promise<unknown>,
  ) {
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new AppError(
            504,
            "The provider took too long. Try a shorter request; your manuscript has not changed.",
          ),
        ),
      options.generationTimeoutMs ?? 180_000,
    );
    const disconnect = () => {
      if (!res.writableEnded)
        controller.abort(new AppError(499, "Generation was cancelled."));
    };
    req.on("aborted", disconnect);
    res.on("close", disconnect);
    try {
      const result = await work(
        controller.signal,
        { ...settings },
        effectiveKey(),
      );
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!res.destroyed) res.json(result);
    } finally {
      clearTimeout(timer);
      req.off("aborted", disconnect);
      res.off("close", disconnect);
    }
  }
  async function withProvider(
    req: Request,
    res: Response,
    work: (
      signal: AbortSignal,
      config: ProviderConfig,
      key: string,
    ) => Promise<unknown>,
  ) {
    await loadSettings();
    if (keyRequired() && !effectiveKey())
      throw new AppError(
        428,
        "No connected model is configured. Folio's free on-device writer, browser art model and offline art study are ready; add a provider in Writing settings only for hosted generation.",
      );
    return withModel(req, res, { ...settings }, effectiveKey(), work);
  }
  async function withGeneration(
    req: Request,
    res: Response,
    input: Parameters<typeof generate>[0],
  ) {
    await loadSettings();
    if (!keyRequired() || effectiveKey())
      return withModel(
        req,
        res,
        { ...settings },
        effectiveKey(),
        (signal, config, key) => generate(input, config, key, signal, fetcher),
      );
    const localModel = await detectLocalModel();
    if (!localModel)
      throw new AppError(
        428,
        "No connected model is configured. Folio's free on-device writer, browser art model and offline art study are ready; add a provider in Writing settings only for hosted generation.",
      );
    return withModel(
      req,
      res,
      {
        provider: "compatible",
        baseUrl: localModel.baseUrl,
        textModel: localModel.model,
        imageModel: "",
        disableThinking: true,
      },
      "",
      (signal) => generateLocalModel(input, localModel, signal, fetcher),
    );
  }
  app.post("/api/generate", async (req, res) => {
    const input = generateSchema.parse(req.body);
    await withGeneration(req, res, input);
  });
  async function saveImage(data: Buffer, expected?: string) {
    const extension = imageExtension(data);
    if (!extension || (expected && extension !== expected))
      throw new AppError(
        400,
        "Use a valid PNG, JPEG, or WebP image no larger than 10 MB.",
      );
    await mkdir(mediaDir, { recursive: true });
    const id = randomUUID();
    await atomicWrite(join(mediaDir, `${id}.${extension}`), data);
    return { id, url: `/media/${id}.${extension}` };
  }
  app.post("/api/illustrate", async (req, res) => {
    const input = illustrateSchema.parse(req.body);
    await withProvider(req, res, async (signal, config, key) => {
      const { data, prompt } = await illustrate(
        input,
        config,
        key,
        signal,
        fetcher,
      );
      if (signal.aborted) throw signal.reason;
      const saved = await saveImage(data);
      const image: Illustration = {
        ...saved,
        prompt,
        style: input.style,
        caption: "",
        chapterId: input.chapterId,
        createdAt: new Date().toISOString(),
        kind: "scene",
      };
      return image;
    });
  });
  app.post("/api/images", async (req, res) => {
    const { dataUrl } = z
      .object({ dataUrl: z.string().max(14_000_000) })
      .strict()
      .parse(req.body);
    const match =
      /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
        dataUrl,
      );
    if (!match)
      throw new AppError(
        400,
        "Use a PNG, JPEG, or WebP image no larger than 10 MB.",
      );
    res
      .status(201)
      .json(
        await saveImage(
          Buffer.from(match[2], "base64"),
          match[1] === "jpeg" ? "jpg" : match[1],
        ),
      );
  });
  app.delete("/api/images/:file", async (req, res) => {
    const file = req.params.file as string;
    if (!localImagePattern.test(`/media/${file}`))
      throw new AppError(404, "Image not found.");
    await unlink(join(mediaDir, file)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    res.status(204).end();
  });
  app.get("/media/:file", async (req, res) => {
    if (!localImagePattern.test(`/media/${req.params.file}`))
      throw new AppError(404, "Image not found.");
    const path = join(mediaDir, req.params.file as string);
    try {
      if (!(await stat(path)).isFile()) throw new Error("not a file");
    } catch {
      throw new AppError(404, "Image not found.");
    }
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.sendFile(path);
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Unknown writing studio API endpoint." });
  });
  const distDir = resolve(options.distDir ?? join(process.cwd(), "dist"));
  const hostedIllustration = join(
    distDir,
    "assets",
    "tide-illustration-deploy.jpg",
  );
  if (env.VERCEL && existsSync(hostedIllustration)) {
    app.get("/assets/tide-illustration.png", (_req, res) => {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.sendFile(hostedIllustration);
    });
  }
  if (existsSync(join(distDir, "index.html"))) {
    app.use(express.static(distDir, { index: false }));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(join(distDir, "index.html"));
    });
  }
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (res.headersSent || res.destroyed) return;
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: error.issues
            .slice(0, 3)
            .map(
              (issue) =>
                `${issue.path.join(".") || "Request"}: ${issue.message}`,
            )
            .join(" "),
        });
      } else if (error instanceof AppError) {
        res
          .status(error.status)
          .json({ error: error.message, ...error.details });
      } else if ((error as any)?.type === "entity.too.large") {
        res.status(413).json({
          error:
            "This request is too large. Keep images below 10 MB and the complete workspace, including chapter snapshots, below 25 MB. Export a backup before removing older snapshots or books.",
        });
      } else if (error instanceof SyntaxError && "body" in error) {
        res.status(400).json({ error: "The request contains invalid JSON." });
      } else {
        res.status(500).json({
          error:
            "The operation could not finish. Check available disk space and folder permissions. Your existing manuscript has not been reset.",
        });
      }
    },
  );
  return app;
}
