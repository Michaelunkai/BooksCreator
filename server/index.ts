import { createApp } from "./app.js";

const app = createApp();
const server = app.listen(3001, "127.0.0.1", () => {
  console.log("Folio writing studio API is ready at http://127.0.0.1:3001");
});
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === "EADDRINUSE"
      ? "Port 3001 is already in use. Close the other Folio server and try again."
      : "Folio could not start its local server.",
  );
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.close();
  });
