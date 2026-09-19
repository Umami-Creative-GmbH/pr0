// Serve the prebuilt distribution unchanged: bundling Swagger's OpenAPI 3.1
// resolver through Turbopack currently breaks its static refract methods.
const output = new URL("../public/swagger-ui/", import.meta.url);

await Promise.all(
  ["swagger-ui-bundle.js", "swagger-ui.css"].map((asset) =>
    Bun.write(
      new URL(asset, output),
      Bun.file(new URL(import.meta.resolve(`swagger-ui-dist/${asset}`)))
    )
  )
);

await Bun.write(
  new URL("init.js", output),
  `window.addEventListener("DOMContentLoaded", () => {
  SwaggerUIBundle({ url: "/api/openapi.json", dom_id: "#swagger-ui", validatorUrl: null });
});\n`
);
