// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Admission buckets are filled by ordered real requests.
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

import { changePageSchema } from "@pr0/api-contract/changes";
import { z } from "zod";

import {
  selfHostingFixture,
  selfHostingPassword,
} from "./self-hosting-fixture";
import { availablePort, randomOctet } from "./test-network";

const root = path.resolve(import.meta.dir, "../../..");
const pinnedBaseImage = /^FROM (?<image>nginx:\S+@sha256:[0-9a-f]{64})$/mu;
// The edge stand-in uses the ingress's own pinned nginx, so there is one pin to update.
const nginx = z
  .string()
  .parse(
    pinnedBaseImage.exec(
      await Bun.file(
        path.join(root, "infrastructure/ingress/Dockerfile")
      ).text()
    )?.groups?.image
  );
// A 10-request minute window gives each step a minute, not the 10-second burst window.
const minuteLimit = 10;
const filled = [...Array.from({ length: minuteLimit }, () => 200), 429];
const statusOf = async (request: Promise<Response>) => {
  const response = await request;
  await response.arrayBuffer();
  return response.status;
};

// Stands in for Coolify's Traefik as the worst case: it appends the observed
// peer to any client-supplied X-Forwarded-For instead of discarding it.
const edgeConfiguration = `events {}
http {
  access_log off;
  server {
    listen 8080;
    listen [::]:8080;
    client_max_body_size 0;
    location / {
      proxy_pass http://ingress:8080;
      proxy_http_version 1.1;
      proxy_set_header Host $$http_host;
      proxy_set_header X-Forwarded-For $$proxy_add_x_forwarded_for;
      proxy_read_timeout 120s;
      proxy_buffering off;
      proxy_request_buffering off;
    }
  }
}
`;

// Runs inside a client container so its own network address is the real peer.
const clientScript = `const { url, count, headers } = JSON.parse(process.env.PR0_INGRESS_REQUEST);
const statuses = [];
for (let index = 0; index < count; index += 1) {
  const response = await fetch(url, {
    headers: JSON.parse(JSON.stringify(headers).replaceAll("{index}", String(index))),
  });
  await response.arrayBuffer();
  statuses.push(response.status);
}
console.log(JSON.stringify(statuses));`;

test("the example ingress attributes clients, enforces request bounds and keeps metrics private", async () => {
  await mkdir(path.join(root, ".scratch"), { recursive: true });
  const directory = await mkdtemp(path.join(root, ".scratch/ingress-"));
  const edgePort = await availablePort();
  const ingressSecret = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const metricsSecret = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  // Random private subnets keep concurrent disposable projects apart.
  const v4 = `10.${randomOctet()}.${randomOctet()}`;
  const edgeNet = `10.${randomOctet()}.${randomOctet()}`;
  const v6 = `fd72:3030:${randomOctet().toString(16)}${randomOctet().toString(16)}`;
  const clientAddresses = {
    "client-a": { ipv4_address: `${v4}.11` },
    "client-b": { ipv4_address: `${v4}.12` },
    "client-c": { ipv6_address: `${v6}:1::11` },
    "client-d": { ipv6_address: `${v6}:1::12` },
    "client-e": { ipv6_address: `${v6}:2::11` },
    probe: { ipv4_address: `${v4}.20` },
  };
  await Bun.write(path.join(directory, "PR0_INGRESS_SECRET"), ingressSecret);
  const overlay = path.join(directory, "ingress.json");
  const client = {
    // oxlint-disable-next-line eslint/no-template-curly-in-string -- Compose interpolates the fixture's application image.
    image: "${PR0_IMAGE}",
    entrypoint: ["sleep", "infinity"],
    init: true,
  };
  await Bun.write(
    overlay,
    JSON.stringify({
      services: {
        web: {
          environment: {
            PR0_LIMIT_AUTH_MINUTE: String(minuteLimit),
            PR0_LIMIT_AUTH_BURST: "1000",
          },
        },
        ingress: {
          image: "pr0-ingress-test",
          build: { context: path.join(root, "infrastructure/ingress") },
          environment: {
            PR0_INGRESS_SECRET_FILE: "/run/secrets/PR0_INGRESS_SECRET",
            PR0_INGRESS_TRUSTED_PROXIES: `${edgeNet}.0/24`,
            PR0_INGRESS_METRICS_ALLOW: clientAddresses.probe.ipv4_address,
          },
          secrets: ["PR0_INGRESS_SECRET"],
          networks: { default: {}, edge: {} },
        },
        edge: {
          image: nginx,
          configs: [{ source: "edge", target: "/etc/nginx/nginx.conf" }],
          ports: [`127.0.0.1:${edgePort}:8080`],
          networks: {
            edge: {},
            public: { ipv4_address: `${v4}.2`, ipv6_address: `${v6}:1::2` },
          },
          depends_on: { ingress: { condition: "service_healthy" } },
        },
        ...Object.fromEntries(
          Object.entries(clientAddresses).map(([name, address]) => [
            name,
            { ...client, networks: { public: address } },
          ])
        ),
        intruder: { ...client, networks: { default: {} } },
      },
      configs: { edge: { content: edgeConfiguration } },
      secrets: {
        PR0_INGRESS_SECRET: {
          file: path.join(directory, "PR0_INGRESS_SECRET"),
        },
      },
      networks: {
        edge: {
          internal: true,
          ipam: { config: [{ subnet: `${edgeNet}.0/24` }] },
        },
        public: {
          enable_ipv6: true,
          ipam: {
            // Dynamic addresses stay clear of the fixed ones below .128 and outside :1:/:2:.
            config: [
              { subnet: `${v4}.0/24`, ip_range: `${v4}.128/25` },
              { subnet: `${v6}::/48`, ip_range: `${v6}:ffff::/64` },
            ],
          },
        },
      },
    })
  );
  const instance = await selfHostingFixture([overlay]);
  const edge = `http://127.0.0.1:${edgePort}`;
  const statuses = z.array(z.number().int());
  const from = async (
    container: string,
    url: string,
    count: number,
    headers: Record<string, string> = {}
  ) =>
    statuses.parse(
      JSON.parse(
        await instance.compose(
          "exec",
          "-T",
          "-e",
          `PR0_INGRESS_REQUEST=${JSON.stringify({ url, count, headers })}`,
          container,
          "bun",
          "-e",
          clientScript
        )
      )
    );
  try {
    await instance.configure({
      PR0_INGRESS_SECRET: ingressSecret,
      PR0_METRICS_SECRET: metricsSecret,
    });
    await instance.compose("build", "ingress");
    const email = "ingress@example.test";
    await instance.initialize(email);
    const signup = await instance.request("/api/auth/sign-up/email", {
      email,
      password: selfHostingPassword,
    });
    expect(signup.status).toBe(202);
    const verified = await fetch(await instance.verificationLink(email), {
      redirect: "manual",
    });
    expect(verified.status).toBe(303);
    const cookie = await instance.login(email);
    await instance.compose(
      "up",
      "-d",
      "--no-build",
      "--wait",
      "ingress",
      "edge",
      "intruder",
      ...Object.keys(clientAddresses)
    );

    // The image runs as non-root and reports healthy through its own check.
    const user = await instance.compose("exec", "-T", "ingress", "id", "-u");
    expect(user.trim()).not.toBe("0");
    const listed = await instance.compose("ps", "--format", "json", "ingress");
    const [status = ""] = listed.trim().split("\n");
    const health = z.object({ Health: z.string() }).parse(JSON.parse(status));
    expect(health.Health).toBe("healthy");
    expect(await statusOf(fetch(`${edge}/api/v1/ready`))).toBe(200);

    // Forged pr0 and forwarded headers through the edge stay in the peer's bucket,
    // even when they carry the real ingress secret.
    const forged = [];
    for (let index = 0; index <= minuteLimit; index += 1) {
      const request = fetch(`${edge}/api/auth/providers`, {
        headers: {
          "X-Forwarded-For": `198.51.100.${index}`,
          "X-Real-IP": `198.51.100.${index}`,
          Forwarded: `for=198.51.100.${index}`,
          "X-Pr0-Client-IP": `198.51.100.${index}`,
          "X-Pr0-Ingress-Secret": ingressSecret,
        },
      });
      forged.push(await statusOf(request));
    }
    expect(forged).toEqual(filled);
    // A peer outside the trusted edge network cannot use forwarded headers at all.
    expect(
      await from("intruder", "http://ingress:8080/api/auth/providers", 11, {
        "X-Forwarded-For": "198.51.100.{index}",
        "X-Pr0-Client-IP": "198.51.100.{index}",
        "X-Pr0-Ingress-Secret": ingressSecret,
      })
    ).toEqual(filled);

    // Real clients get their own buckets: IPv4 /32 and IPv6 /64.
    const v4Edge = `http://${v4}.2:8080/api/auth/providers`;
    const v6Edge = `http://[${v6}:1::2]:8080/api/auth/providers`;
    expect(await from("client-a", v4Edge, 11)).toEqual(filled);
    expect(await from("client-b", v4Edge, 1)).toEqual([200]);
    expect(await from("client-c", v6Edge, 11)).toEqual(filled);
    expect(await from("client-d", v6Edge, 1)).toEqual([429]);
    expect(await from("client-e", v6Edge, 1)).toEqual([200]);

    // Metrics are reachable only from the configured probe address.
    const authorization = { Authorization: `Bearer ${metricsSecret}` };
    const metrics = `http://${v4}.2:8080/api/v1/operations/metrics`;
    expect(await from("probe", metrics, 1, authorization)).toEqual([200]);
    expect(await from("client-b", metrics, 1, authorization)).toEqual([404]);
    expect(
      await from("client-b", metrics, 1, {
        ...authorization,
        "X-Forwarded-For": clientAddresses.probe.ipv4_address,
      })
    ).toEqual([404]);
    expect(
      await from(
        "intruder",
        "http://ingress:8080/api/v1/operations/metrics",
        1,
        authorization
      )
    ).toEqual([404]);

    // Oversized and compressed bodies stop at the ingress (the route itself answers 405).
    const post = (body: Blob | string, headers: Record<string, string> = {}) =>
      statusOf(
        fetch(`${edge}/api/v1/health`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body,
        })
      );
    expect(await post("{}")).toBe(405);
    const oversized = new Blob([new Uint8Array(4 * 1024 * 1024 + 1)]);
    expect(await post(oversized)).toBe(413);
    const compressed = new Blob([Bun.gzipSync("{}")]);
    expect(await post(compressed, { "Content-Encoding": "gzip" })).toBe(415);

    // The 25-second long poll completes through both proxies.
    const poll = async (query: string) => {
      const response = await fetch(`${edge}/api/v1/sync/changes?${query}`, {
        headers: { Cookie: cookie },
      });
      expect(response.status).toBe(200);
      return changePageSchema.parse(await response.json());
    };
    const checkpoint = await poll("wait=0");
    const started = performance.now();
    const waited = await poll(
      `cursor=${encodeURIComponent(checkpoint.cursor)}`
    );
    expect(performance.now() - started).toBeGreaterThanOrEqual(24_500);
    expect(waited.changes).toEqual([]);

    // Access logs carry the path but never credentials, cookies or query strings.
    const marker = crypto.randomUUID();
    const logged = await fetch(`${edge}/api/v1/health?token=${marker}`, {
      headers: {
        Authorization: `Bearer ${marker}`,
        Cookie: `session=${marker}`,
      },
    });
    expect(logged.status).toBe(200);
    const logs = await instance.compose("logs", "--no-log-prefix", "ingress");
    expect(logs).toContain('"path":"/api/v1/health"');
    expect(logs).not.toContain(marker);
    expect(logs).not.toContain(cookie.split("=").at(-1) ?? cookie);
  } finally {
    await instance.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
}, 600_000);
