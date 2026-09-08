import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Workspace } from "../src/types.js";
import { envelopeSchema } from "./schema.js";

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function atomicWrite(
  path: string,
  contents: string | Buffer,
): Promise<void> {
  const staging = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(staging, "wx", 0o600);
    try {
      await file.writeFile(contents);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(staging, path);
  } finally {
    await unlink(staging).catch(() => undefined);
  }
}

export class WorkspaceStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(public readonly directory: string) {}
  async read(): Promise<{ workspace: Workspace | null; revision: number }> {
    let raw: string;
    try {
      raw = await readFile(join(this.directory, "workspace.json"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        try {
          await access(join(this.directory, "workspace.previous.json"));
        } catch (backupError) {
          if ((backupError as NodeJS.ErrnoException).code === "ENOENT")
            return { workspace: null, revision: 0 };
          throw new AppError(
            503,
            "The saved workspace could not be read. Check the .data folder permissions; your files have not been changed.",
          );
        }
        throw new AppError(
          503,
          "The main workspace file is missing, but .data/workspace.previous.json is available. Restore that backup before saving again.",
        );
      }
      throw new AppError(
        503,
        "The saved workspace could not be read. Check the .data folder permissions; your files have not been changed.",
      );
    }
    try {
      return envelopeSchema.parse(JSON.parse(raw));
    } catch {
      throw new AppError(
        503,
        "The saved workspace is damaged or uses an unsupported format. It has been preserved. Close the app and restore .data/workspace.previous.json or your exported backup before saving again.",
      );
    }
  }
  save(workspace: Workspace, revision: number): Promise<{ revision: number }> {
    const work = this.queue.then(async () => {
      const current = await this.read();
      if (revision !== current.revision)
        throw new AppError(
          409,
          "This workspace changed in another window. Reload the saved workspace before saving again.",
          { revision: current.revision },
        );
      await mkdir(this.directory, { recursive: true });
      if (current.workspace)
        await atomicWrite(
          join(this.directory, "workspace.previous.json"),
          JSON.stringify(current),
        );
      const next = { workspace, revision: current.revision + 1 };
      await atomicWrite(
        join(this.directory, "workspace.json"),
        JSON.stringify(next),
      );
      return { revision: next.revision };
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
}
