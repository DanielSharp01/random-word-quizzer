import { FileNotFoundError, NotFound } from "@danielsharp/typeline-http";
import { env } from "../config/env";
import { rootRouter } from "../routers";

/** Client-side routes get the app's page; anything with a file extension is a real file. */
function pageFor(path: string) {
  if (path === "login" || path === "login/") return "login/index.html";
  return "index.html";
}

/** Serves the built frontend from the same origin as the API, so the auth cookie and relative URLs just work. */
export function frontendController() {
  const root = env.FRONTEND_DIR;
  if (!root) return;

  rootRouter.get("/", (line) =>
    line.pipe(async (_, { res }) => {
      res.header("cache-control", "no-cache");
      await res.sendFile("index.html", { root });
    }),
  );

  rootRouter.get("/*path", (line) =>
    line.pipe(async (_, { req, res }) => {
      const path = req.route?.params.path ?? "";
      // An unknown API or auth URL is a 404, not the app's page.
      if (path.startsWith("api/") || path.startsWith("auth/")) throw new NotFound();
      const isFile = /\.[^/]+$/.test(path);
      const file = isFile ? path : pageFor(path);
      if (!file) throw new NotFound();
      // Vite puts a content hash in every asset name, so those never change; pages must be revalidated.
      res.header("cache-control", path.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache");
      try {
        await res.sendFile(file, { root });
      } catch (error) {
        if (!FileNotFoundError.is(error)) throw error;
        // A missing asset may appear with the next deploy; its 404 must not be cached for a year.
        res.raw.removeHeader("cache-control");
        throw new NotFound();
      }
    }),
  );
}
