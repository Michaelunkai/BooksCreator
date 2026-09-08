import { isAbsolute, basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { createApp } from "../../server/app.js";

const dataDir = process.env.FOLIO_RUNTIME_TEST_DATA_DIR;
if (
  !dataDir ||
  !isAbsolute(dataDir) ||
  dirname(resolve(dataDir)) !== resolve(tmpdir()) ||
  !basename(dataDir).startsWith("folio-runtime-proof-")
) {
  throw new Error(
    "The runtime fixture requires its own explicitly named temporary directory.",
  );
}

const app = createApp({
  dataDir,
  distDir: process.env.FOLIO_RUNTIME_TEST_DIST_DIR,
  env: {},
});
const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address() as AddressInfo;
  process.send?.({ type: "ready", port: address.port, pid: process.pid });
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    process.exitCode = 0;
    process.disconnect?.();
  });
  server.closeIdleConnections();
}
process.on("message", (message) => {
  if (
    typeof message === "object" &&
    message &&
    "type" in message &&
    message.type === "stop"
  )
    stop();
});
process.on("disconnect", stop);
server.on("error", (error) => {
  process.send?.({ type: "startup-error", message: error.message });
  process.exitCode = 1;
});
