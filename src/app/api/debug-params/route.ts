import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { cwd } from "process";

type ParamsMap = Record<string, unknown>;

interface DebugParamsConfig {
  version: string;
  timestamp: string;
  params: ParamsMap;
}

const CONFIG_PATH = path.join(
  cwd(),
  "src",
  "lib",
  "panel-detection-config.json",
);

async function readConfig(): Promise<DebugParamsConfig> {
  try {
    const content = await fs.readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(content) as Partial<DebugParamsConfig>;
    return {
      version: parsed.version || "1.0",
      timestamp: parsed.timestamp || new Date().toISOString(),
      params:
        parsed.params && typeof parsed.params === "object" ? parsed.params : {},
    };
  } catch {
    return {
      version: "1.0",
      timestamp: new Date().toISOString(),
      params: {},
    };
  }
}

export async function GET() {
  try {
    const config = await readConfig();
    return NextResponse.json({
      success: true,
      params: config.params,
      timestamp: config.timestamp,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load debug params";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { params?: ParamsMap };
    if (!body.params || typeof body.params !== "object") {
      return NextResponse.json(
        { success: false, error: "Missing required field: params" },
        { status: 400 },
      );
    }

    const prev = await readConfig();
    const nextConfig: DebugParamsConfig = {
      version: prev.version || "1.0",
      timestamp: new Date().toISOString(),
      params: body.params,
    };

    await fs.writeFile(
      CONFIG_PATH,
      `${JSON.stringify(nextConfig, null, 2)}\n`,
      "utf-8",
    );

    return NextResponse.json({
      success: true,
      timestamp: nextConfig.timestamp,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save debug params";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
