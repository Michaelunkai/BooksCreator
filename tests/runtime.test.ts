import { afterEach, expect, it } from "vitest";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { request as httpRequest } from "node:http";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Workspace } from "../src/types.js";

const projectDir = fileURLToPath(new URL("../", import.meta.url));
const fixture = fileURLToPath(
  new URL("./fixtures/runtime-server.ts", import.meta.url),
);
const directories = new Set<string>();
const processes = new Set<ChildProcess>();
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

function checkedTemporaryDirectory(directory: string): string {
  const absolute = resolve(directory);
  if (
    !isAbsolute(directory) ||
    dirname(absolute) !== resolve(tmpdir()) ||
    !basename(absolute).startsWith("folio-runtime-proof-")
  )
    throw new Error(
      "Refusing to modify a path outside this runtime test temporary directory.",
    );
  return absolute;
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) {
    processes.delete(child);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(
        new Error(`Runtime test child ${child.pid} did not shut down cleanly.`),
      );
    }, 5000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      processes.delete(child);
      if (code !== 0)
        reject(
          new Error(`Runtime test child ${child.pid} exited with ${code}.`),
        );
      else resolve();
    });
    if (child.connected) child.send({ type: "stop" });
    else child.kill();
  });
}

async function startProcess(
  directory: string,
  distDir = join(directory, "absent-dist"),
) {
  const child = spawn(process.execPath, ["--import", "tsx", fixture], {
    cwd: projectDir,
    env: {
      ...process.env,
      OPENAI_API_KEY: "",
      FOLIO_RUNTIME_TEST_DATA_DIR: checkedTemporaryDirectory(directory),
      FOLIO_RUNTIME_TEST_DIST_DIR: distDir,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  processes.add(child);
  let errors = "";
  child.stderr?.on("data", (chunk) => {
    errors = `${errors}${chunk.toString()}`.slice(-4000);
  });
  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(new Error(`Runtime process did not become ready. ${errors}`)),
      10_000,
    );
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Runtime process exited before readiness (${code}). ${errors}`,
        ),
      );
    });
    child.on("message", (message) => {
      if (typeof message !== "object" || !message || !("type" in message))
        return;
      if (
        message.type === "ready" &&
        "port" in message &&
        typeof message.port === "number"
      ) {
        clearTimeout(timeout);
        resolve(message.port);
      }
      if (message.type === "startup-error") {
        clearTimeout(timeout);
        reject(new Error(JSON.stringify(message)));
      }
    });
  });
  const send = (method: string, path: string, payload?: unknown) =>
    new Promise<{
      status: number;
      body: any;
      bytes: Buffer;
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
          },
          timeout: 10_000,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("error", reject);
          response.on("end", () => {
            const bytes = Buffer.concat(chunks);
            let body: unknown;
            try {
              body = JSON.parse(bytes.toString());
            } catch {
              body = bytes.toString();
            }
            resolve({
              status: response.statusCode!,
              body,
              bytes,
              headers: response.headers,
            });
          });
        },
      );
      request.on("error", reject);
      request.on("timeout", () =>
        request.destroy(new Error("Runtime HTTP request timed out.")),
      );
      request.end(payload === undefined ? undefined : JSON.stringify(payload));
    });
  return { child, port, send, stop: () => stopProcess(child) };
}

afterEach(async () => {
  await Promise.all([...processes].map((child) => stopProcess(child)));
  for (const directory of directories)
    await rm(checkedTemporaryDirectory(directory), {
      recursive: true,
      force: true,
    });
  directories.clear();
});

it("preserves a manuscript and full-size illustration across actual process restarts, corruption and backup recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "folio-runtime-proof-"));
  directories.add(directory);
  const sourceImage = await readFile(
    join(projectDir, "public", "assets", "tide-illustration.png"),
  );
  expect(sourceImage.byteLength).toBeGreaterThan(3_000_000);
  const expectedImageHash = hash(sourceImage);
  const initial = await startProcess(directory);
  const processIds = [initial.child.pid];
  expect((await initial.send("GET", "/api/workspace")).body).toEqual({
    workspace: null,
    revision: 0,
  });
  const uploaded = await initial.send("POST", "/api/images", {
    dataUrl: `data:image/png;base64,${sourceImage.toString("base64")}`,
  });
  expect(uploaded.status).toBe(201);
  const timestamp = "2026-09-08T00:00:00.000Z";
  const workspace: Workspace = {
    version: 1,
    activeBookId: "runtime-book",
    books: [
      {
        id: "runtime-book",
        title: "הבית שמעבר לגאות",
        subtitle: "A manuscript that survives a restart",
        author: "Mira",
        genre: "Literary fiction",
        language: "Hebrew",
        direction: "rtl",
        voiceSample: "וְהַיָּם השיב לה בלחישה.",
        voiceNotes: "Preserve the author’s restraint and Hebrew voice.",
        targetWords: 80_000,
        chapters: [
          {
            id: "runtime-chapter",
            title: "המפתח",
            content: `<p dir="rtl">מירה החזיקה את המפתח. מתחת לדלת נשם הים.</p><p>She waited until the brass grew warm.</p><img src="${uploaded.body.url}" alt="The house at the edge of the tide" />`,
            synopsis: "A locksmith returns to her family home beside the sea.",
            status: "revised",
            versions: [
              {
                id: "runtime-version",
                name: "Before the tide",
                createdAt: timestamp,
                title: "המפתח",
                content: '<p dir="rtl">מירה מצאה מפתח.</p>',
              },
            ],
          },
        ],
        bible: [
          {
            id: "runtime-character",
            kind: "character",
            name: "מירה",
            details:
              "A locksmith who cannot swim; her sister left ten years ago.",
          },
          {
            id: "runtime-place",
            kind: "place",
            name: "The Tide House",
            details: "The lowest room floods at every new moon.",
          },
        ],
        images: [
          {
            id: uploaded.body.id,
            url: uploaded.body.url,
            prompt:
              "Original literary watercolor illustration of the Tide House.",
            style: "Watercolor",
            caption: "הבית שמעבר לגאות",
            chapterId: "runtime-chapter",
            createdAt: timestamp,
          },
        ],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
  expect(
    (await initial.send("PUT", "/api/workspace", { workspace, revision: 0 }))
      .body,
  ).toEqual({ revision: 1 });
  const firstSaved = (await initial.send("GET", "/api/workspace")).body;
  workspace.books[0].chapters[0].content +=
    '<p dir="rtl">ואז נשמעה נקישה מן הצד השני.</p>';
  expect(
    (await initial.send("PUT", "/api/workspace", { workspace, revision: 1 }))
      .body,
  ).toEqual({ revision: 2 });
  const latestSaved = (await initial.send("GET", "/api/workspace")).body;
  expect(latestSaved.workspace.books[0].chapters[0].content).toContain(
    "ואז נשמעה נקישה",
  );
  await initial.stop();

  const restarted = await startProcess(directory);
  processIds.push(restarted.child.pid);
  expect(restarted.child.pid).not.toBe(initial.child.pid);
  expect((await restarted.send("GET", "/api/workspace")).body).toEqual(
    latestSaved,
  );
  const reloadedImage = await restarted.send("GET", uploaded.body.url);
  expect(reloadedImage.status).toBe(200);
  expect(reloadedImage.bytes.byteLength).toBe(sourceImage.byteLength);
  expect(hash(reloadedImage.bytes)).toBe(expectedImageHash);
  expect(reloadedImage.headers["content-type"]).toMatch(/image\/png/);
  const previousPath = join(
    checkedTemporaryDirectory(directory),
    "workspace.previous.json",
  );
  expect(JSON.parse(await readFile(previousPath, "utf8"))).toEqual(firstSaved);
  await restarted.stop();

  const workspacePath = join(
    checkedTemporaryDirectory(directory),
    "workspace.json",
  );
  const corruptBytes = "{this interrupted file cannot be parsed";
  await writeFile(workspacePath, corruptBytes);
  const corrupted = await startProcess(directory);
  processIds.push(corrupted.child.pid);
  const refusedRead = await corrupted.send("GET", "/api/workspace");
  expect(refusedRead.status).toBe(503);
  expect(refusedRead.body.error).toContain("workspace.previous.json");
  expect(
    (await corrupted.send("PUT", "/api/workspace", { workspace, revision: 0 }))
      .status,
  ).toBe(503);
  expect(await readFile(workspacePath, "utf8")).toBe(corruptBytes);
  expect(JSON.parse(await readFile(previousPath, "utf8"))).toEqual(firstSaved);
  await corrupted.stop();

  const preservedCorruptPath = join(
    checkedTemporaryDirectory(directory),
    "workspace.corrupt-preserved.json",
  );
  await copyFile(workspacePath, preservedCorruptPath);
  await copyFile(previousPath, workspacePath);
  const recovered = await startProcess(directory);
  processIds.push(recovered.child.pid);
  expect((await recovered.send("GET", "/api/workspace")).body).toEqual(
    firstSaved,
  );
  expect(hash((await recovered.send("GET", uploaded.body.url)).bytes)).toBe(
    expectedImageHash,
  );
  expect(await readFile(preservedCorruptPath, "utf8")).toBe(corruptBytes);
  expect(
    (await recovered.send("PUT", "/api/workspace", { workspace, revision: 1 }))
      .body,
  ).toEqual({ revision: 2 });
  await recovered.stop();
  expect(new Set(processIds).size).toBe(4);
  console.info(
    `Runtime proof: four separate Node processes ${processIds.join(", ")}; RTL manuscript, snapshot, story notes and illustration survived restart; corruption refused, previous revision recovered, saving resumed. Image ${sourceImage.byteLength} bytes; SHA-256 ${expectedImageHash}.`,
  );
}, 30_000);

it("serves a production distribution and SPA routes through the actual server process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "folio-runtime-proof-"));
  directories.add(directory);
  const distDir = join(checkedTemporaryDirectory(directory), "dist");
  await mkdir(join(distDir, "assets"), { recursive: true });
  const html =
    '<!doctype html><html><body><main>Folio runtime distribution proof</main><script src="/assets/app.js"></script></body></html>';
  const script = "window.folioRuntimeProof = true;";
  await writeFile(join(distDir, "index.html"), html);
  await writeFile(join(distDir, "assets", "app.js"), script);
  const running = await startProcess(directory, distDir);
  const home = await running.send("GET", "/");
  expect(home.status).toBe(200);
  expect(home.body).toBe(html);
  expect(home.headers["content-type"]).toMatch(/text\/html/);
  expect((await running.send("GET", "/book/runtime-book")).body).toBe(html);
  expect((await running.send("GET", "/assets/app.js")).body).toBe(script);
  expect((await running.send("GET", "/api/unknown")).status).toBe(404);
  expect((await running.send("GET", "/api/workspace")).body).toEqual({
    workspace: null,
    revision: 0,
  });
  await running.stop();
}, 15_000);
