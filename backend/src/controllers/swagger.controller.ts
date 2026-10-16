import { swagger } from "@danielsharp/typeline-http";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { env } from "../config/env";
import { logger } from "../providers/logger";
import { rootRouter } from "../routers";

const require = createRequire(import.meta.url);
const swaggerUiRoot = dirname(require.resolve("swagger-ui-dist/package.json"));

const swaggerInitializer = `
window.onload = function () {
  window.ui = SwaggerUIBundle({
    url: "/api/docs/openapi.yaml",
    dom_id: "#swagger-ui",
    deepLinking: true,
    presets: [
      SwaggerUIBundle.presets.apis,
      SwaggerUIStandalonePreset,
    ],
    plugins: [SwaggerUIBundle.plugins.DownloadUrl],
    layout: "StandaloneLayout",
    validatorUrl: null,
  });
};
`;

export function swaggerController() {
  const swaggerResult = swagger(rootRouter, {
    info: {
      title: "Quizzer API",
      version: "1.0.0",
    },
  });

  const document = { ...swaggerResult.document, servers: [{ url: env.API_HOST }] };

  if (swaggerResult.warnings.length > 0) {
    logger.warn("Swagger warnings:", swaggerResult.warnings);
  }

  rootRouter.get("/api/docs/openapi.yaml", (line) =>
    line.pipe((_, { res }) => {
      res.send(document);
    }),
  );

  rootRouter.get("/api/docs/swagger-initializer.js", (line) =>
    line.pipe((_, { res }) => {
      res
        .header("content-type", "application/javascript; charset=utf-8")
        .send(swaggerInitializer);
    }),
  );

  rootRouter.get("/api/docs/*asset", (line) =>
    line.pipe((_, { req, res }) => {
      const asset = req.route?.params.asset;

      if (!asset && !req.url.pathname.endsWith("/")) {
        res.status(308).header("location", `${req.url.pathname}/`).send();
        return;
      }

      return res.sendFile(asset || "index.html", { root: swaggerUiRoot });
    }),
  );
}
