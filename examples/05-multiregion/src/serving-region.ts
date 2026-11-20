import { METADATA_TIMEOUT_MS } from "./config.ts";
import type { Env } from "./config.ts";

const regionByAzPrefix = new Map([
  ["usw2", "us-west-2"],
  ["use1", "us-east-1"],
]);

export async function readServingRegion(
  env: Env = process.env,
  fetchMetadata: typeof fetch = fetch,
): Promise<string | null> {
  const address = env.AWS_LAMBDA_METADATA_API;
  const token = env.AWS_LAMBDA_METADATA_TOKEN;
  if (!address && !token) return null;

  try {
    if (!address || !token) throw new Error();
    const response = await fetchMetadata(
      `http://${address}/2026-01-15/metadata/execution-environment`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
        redirect: "error",
      },
    );
    if (!response.ok) throw new Error();
    const metadata = (await response.json()) as { AvailabilityZoneID?: unknown } | null;
    const azId = metadata?.AvailabilityZoneID;
    const prefix = typeof azId === "string" ? /^([a-z]+\d+)-az\d+$/.exec(azId)?.[1] : undefined;
    const region = prefix && regionByAzPrefix.get(prefix);
    if (region) return region;
  } catch {
    // A fetch error may contain metadata endpoint details.
  }

  console.warn("Could not determine the serving Region from Lambda metadata");
  return null;
}
