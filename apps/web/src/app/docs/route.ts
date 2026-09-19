const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>pr0 API documentation</title>
    <link rel="stylesheet" href="/swagger-ui/swagger-ui.css" />
    <script defer src="/swagger-ui/swagger-ui-bundle.js"></script>
    <script defer src="/swagger-ui/init.js"></script>
  </head>
  <body>
    <main id="swagger-ui"></main>
  </body>
</html>`;

export const GET = () =>
  new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
