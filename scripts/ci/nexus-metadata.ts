import { appendFile } from "node:fs/promises";

import { tryRun } from "../lib/process.js";

const tag = process.env.GITHUB_REF_NAME;
if (tag === undefined || tag === "") {
  throw new Error("GITHUB_REF_NAME is not set");
}
const output = process.env.GITHUB_OUTPUT;
if (output === undefined || output === "") {
  throw new Error("GITHUB_OUTPUT is not set");
}

const headers = {
  apikey: process.env.NEXUSMODS_API_KEY ?? "",
  Accept: "application/json",
};

let modId = process.env.MOD_ID_INPUT ?? "";
if (!modId) {
  const response = await fetch("https://api.nexusmods.com/v3/games/balatro/mods/927", { headers });
  if (response.ok) {
    const data = (await response.json()) as { data?: { id?: number } };
    modId = String(data.data?.id ?? "");
  }
}

let fileId = process.env.FILE_ID_INPUT ?? "";
if (!fileId && modId) {
  const response = await fetch(`https://api.nexusmods.com/v3/mods/${modId}/files`, { headers });
  if (response.ok) {
    const data = (await response.json()) as {
      data?: {
        mod_files?: Array<{
          id: number;
          is_active?: boolean;
          versions?: Array<{ category?: string }>;
        }>;
      };
    };
    const files = data.data?.mod_files ?? [];
    const preferred =
      files.find(
        (file) => file.is_active === true || file.versions?.some((v) => v.category === "main"),
      ) ?? files[0];
    fileId = String(preferred?.id ?? "");
  }
}
if (!fileId) {
  throw new Error(
    "Could not resolve Nexus Mods file_id. Set the FILE_ID_INPUT secret or repository variable.",
  );
}

const body =
  (await tryRun("gh", ["release", "view", tag, "--json", "body", "-q", ".body"], {
    capture: true,
  })) ?? "";
const changelog = body
  .split("\n")
  .filter((line) => !/^\s*#{1,6}\s/.test(line))
  .map((line) =>
    line
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1"),
  )
  .join("\n")
  .replace(/^\n+/, "");

await appendFile(
  output,
  `version=${tag.replace(/^v/, "")}\nmod_id=${modId}\nfile_id=${fileId}\nchangelog<<__EOF__\n${changelog}\n__EOF__\n`,
);
