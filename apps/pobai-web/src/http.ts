export async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; detail?: unknown };
    if (typeof body.error === "string") return body.error;
    if (typeof body.detail === "string") return body.detail;
  } catch {}
  return `Request failed with ${res.status}`;
}
