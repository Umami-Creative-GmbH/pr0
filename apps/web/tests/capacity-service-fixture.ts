import assert from "node:assert/strict";
import path from "node:path";

import { z } from "zod";

import {
  capacityBytes,
  capacityNoise,
  capacityPhrase,
} from "./capacity-corpus";
import {
  selfHostingFixture,
  selfHostingPassword,
} from "./self-hosting-fixture";
import type { SelfHostingInstance } from "./self-hosting-fixture";

export type CapacityServiceInstance = Pick<
  SelfHostingInstance,
  | "origin"
  | "project"
  | "directory"
  | "request"
  | "library"
  | "login"
  | "ready"
  | "compose"
  | "cleanup"
> & { seed: () => Promise<string> };

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
export const capacityServiceFixture = async () => {
  process.env.PR0_SELF_HOST_IMAGE ??= "pr0-capacity-65";
  process.env.PR0_SELF_HOST_TOOLS_IMAGE ??= "pr0-capacity-tools-65";
  process.env.PR0_SELF_HOST_PLATFORM ??= "linux/amd64";
  const instance = await selfHostingFixture();
  const ingressSecret = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  await instance.configure({ PR0_INGRESS_SECRET: ingressSecret });
  const override = path.join(instance.directory, "compose.json");
  const configuration = z
    .looseObject({
      services: z.record(z.string(), z.record(z.string(), z.json())),
    })
    .parse(await Bun.file(override).json());
  // All resident services share the same two logical CPUs. The sum of their
  // memory limits is below 4 GiB; this does not claim a dedicated physical host.
  const memory = {
    web: "1536m",
    database: "1536m",
    mail: "128m",
    smtp: "64m",
  };
  for (const [name, limit] of Object.entries(memory)) {
    const service = configuration.services[name];
    assert.ok(service);
    service.cpuset = "0,1";
    service.mem_limit = limit;
    service.memswap_limit = limit;
  }
  const seedPath = path.join(instance.directory, "capacity-seed.sql");
  const { database } = configuration.services;
  assert.ok(database);
  const volumes = z.array(z.string()).parse(database.volumes ?? []);
  database.volumes = [
    ...volumes,
    `${seedPath.replaceAll("\\", "/")}:/capacity-seed.sql:ro`,
  ];
  await Bun.write(override, JSON.stringify(configuration));
  // Keep fixture source bounded while avoiding tiny repeated bodies that TOAST
  // would compress unrealistically. Each template supplies > 256 KiB of ASCII.
  const templates = Array.from(
    { length: 100 },
    (_, index) =>
      `(${index},${quote(Buffer.from(capacityNoise(131_072, index)).toString("hex"))})`
  );
  const prefix = `${capacityPhrase} common C++ Cafe\u0301 Straße Σίσυφος 東京 🎯 `;
  const sql = `
DO $$ BEGIN IF (SELECT count(*) FROM "user") <> 1 THEN RAISE EXCEPTION 'Requires disposable one-account fixture'; END IF; END $$;
CREATE TEMP TABLE body_template(n integer, content text);
INSERT INTO body_template VALUES ${templates.join(",")};
CREATE TEMP TABLE credential_template AS SELECT password FROM account WHERE provider_id='credential' LIMIT 1;
INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at)
 SELECT '65000000-0000-4000-8000-'||lpad(n::text,12,'0'),'Capacity '||n,'capacity-'||n||'@example.test',true,now(),now() FROM generate_series(1,999) n;
INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at)
 SELECT gen_random_uuid()::text,id,'credential',id,(SELECT password FROM credential_template),now(),now() FROM "user" WHERE id LIKE '65000000-%';
CREATE TEMP TABLE capacity_account AS
 SELECT row_number() OVER(ORDER BY email='capacity-0@example.test' DESC,id)-1 AS n,id FROM "user";
CREATE TEMP TABLE capacity_budget AS
 SELECT n,id,CASE WHEN n=0 THEN 10000 ELSE 100 END AS count,
 CASE WHEN n=0 THEN ${capacityBytes}::bigint ELSE (10737418240::bigint-${capacityBytes})/999+CASE WHEN n<=(10737418240::bigint-${capacityBytes})%999 THEN 1 ELSE 0 END END AS bytes FROM capacity_account;
INSERT INTO collection(instance_id,account_id,id,name,identity_key,revision)
 SELECT i.id,b.id,('00000000-0000-4000-8001-'||lpad(c::text,12,'0'))::uuid,'Réponses '||lpad(c::text,3,'0'),'reponses '||lpad(c::text,3,'0'),1 FROM capacity_budget b CROSS JOIN instance i CROSS JOIN LATERAL generate_series(1,CASE WHEN b.n=0 THEN 200 ELSE 1 END) c;
INSERT INTO tag(instance_id,account_id,id,name,identity_key,revision)
 SELECT i.id,b.id,('00000000-0000-4000-8002-'||lpad(t::text,12,'0'))::uuid,'Équipe '||lpad(t::text,4,'0'),'equipe '||lpad(t::text,4,'0'),1 FROM capacity_budget b CROSS JOIN instance i CROSS JOIN LATERAL generate_series(1,CASE WHEN b.n=0 THEN 1000 ELSE 1 END) t;
CREATE TEMP TABLE capacity_prompt AS
 SELECT b.*,p, 'Prompt '||lpad(p::text,5,'0')||' Café' AS title,'Résumé Straße Σίσυφος 東京'::text AS description,
 b.bytes-(SELECT sum(octet_length(name)) FROM collection WHERE account_id=b.id)-(SELECT sum(octet_length(name)) FROM tag WHERE account_id=b.id) AS prompt_bytes
 FROM capacity_budget b CROSS JOIN LATERAL generate_series(1,b.count) p;
INSERT INTO prompt(instance_id,account_id,id,title,description,content,revision,title_revision,description_revision,content_revision,created_at,modified_at,collection_id,collection_revision)
 SELECT i.id,b.id,('00000000-0000-4000-8000-'||lpad(b.p::text,12,'0'))::uuid,title,description,
 ${quote(prefix)}||left(t.content,(b.prompt_bytes/b.count+CASE WHEN b.p<=b.prompt_bytes%b.count THEN 1 ELSE 0 END-octet_length(title)-octet_length(description)-octet_length(${quote(prefix)}))::integer),
 b.p,b.p,b.p,b.p,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',('00000000-0000-4000-8001-'||lpad((CASE WHEN b.n=0 THEN (b.p-1)%200+1 ELSE 1 END)::text,12,'0'))::uuid,1
 FROM capacity_prompt b CROSS JOIN instance i JOIN body_template t ON true WHERE t.n=(b.p-1)%100;
INSERT INTO prompt_tag(instance_id,account_id,prompt_id,tag_id,add_revision)
 SELECT p.instance_id,p.account_id,p.id,t.id,p.revision FROM prompt p JOIN capacity_budget b ON b.id=p.account_id
 JOIN tag t ON t.account_id=p.account_id WHERE b.n<>0 OR (right(t.id::text,12)::integer-1)/20=(p.revision-1)%50;
INSERT INTO library_operation(instance_id,account_id,operation_id,epoch,installation_id,canonical_version,request_hash,kind,prompt_id,revision,accepted_at)
 SELECT p.instance_id,p.account_id,gen_random_uuid(),i.recovery_epoch,gen_random_uuid(),1,'capacity-fixture','prompt.create',p.id,p.revision,p.created_at FROM prompt p JOIN instance i ON i.id=p.instance_id;
INSERT INTO library_change(instance_id,account_id,revision,operation_id,kind,prompt_id,accepted_at)
 SELECT instance_id,account_id,revision,operation_id,kind,prompt_id,accepted_at FROM library_operation;
UPDATE library l SET revision=b.count,prompt_count=b.count,text_bytes=b.bytes,collection_count=CASE WHEN b.n=0 THEN 200 ELSE 1 END,tag_count=CASE WHEN b.n=0 THEN 1000 ELSE 1 END FROM capacity_budget b WHERE l.account_id=b.id;
DO $$ BEGIN
 IF (SELECT sum(octet_length(title)+octet_length(description)+octet_length(content)) FROM prompt)+(SELECT sum(octet_length(name)) FROM collection)+(SELECT sum(octet_length(name)) FROM tag)<>10737418240::bigint THEN RAISE EXCEPTION 'Wrong aggregate bytes'; END IF;
END $$;
ANALYZE;
SELECT json_build_object('accounts',(SELECT count(*) FROM "user"),'textBytes',(SELECT sum(text_bytes) FROM library),'prompts',(SELECT count(*) FROM prompt),'databaseBytes',pg_database_size(current_database()));
`;
  await Bun.write(seedPath, sql);
  return {
    ...instance,
    async login(email: string) {
      const match = /^capacity-(?<account>\d+)@example\.test$/u.exec(email);
      assert.ok(match);
      const number = Number(match.groups?.account);
      assert.ok(Number.isInteger(number) && number >= 0 && number < 1000);
      const response = await fetch(
        `${instance.origin}/api/auth/sign-in/email`,
        {
          method: "POST",
          headers: {
            Origin: instance.origin,
            "Content-Type": "application/json",
            "x-pr0-ingress-secret": ingressSecret,
            "x-pr0-client-ip": `198.18.${Math.floor(number / 250)}.${(number % 250) + 1}`,
          },
          body: JSON.stringify({ email, password: selfHostingPassword }),
        }
      );
      assert.equal(response.status, 200, await response.text());
      return response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
    },
    async seed() {
      const email = "capacity-0@example.test";
      await instance.initialize(email);
      const signup = await instance.request("/api/auth/sign-up/email", {
        email,
        password: selfHostingPassword,
      });
      assert.equal(signup.status, 202, await signup.text());
      const verification = await fetch(await instance.verificationLink(email), {
        redirect: "manual",
      });
      assert.equal(verification.status, 303);
      return await instance.compose(
        "exec",
        "-T",
        "database",
        "psql",
        "-U",
        "pr0",
        "-d",
        "pr0",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        "/capacity-seed.sql"
      );
    },
  };
};
