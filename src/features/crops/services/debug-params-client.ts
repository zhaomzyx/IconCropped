import { DebugPanelParams } from "@/features/crops/types";

interface DebugParamsResponse {
  success?: boolean;
  params?: Partial<DebugPanelParams>;
}

export async function fetchProjectDebugParams(): Promise<Partial<DebugPanelParams> | null> {
  const response = await fetch("/api/debug-params", {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as DebugParamsResponse;
  if (!payload.success || !payload.params) {
    return null;
  }

  return payload.params;
}

export async function saveProjectDebugParams(
  params: DebugPanelParams,
): Promise<boolean> {
  const response = await fetch("/api/debug-params", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params }),
  });

  return response.ok;
}
