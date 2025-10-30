const encoder = new TextEncoder();

const toHex = (buffer: ArrayBuffer | Uint8Array): string => {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(view)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const hasSubtle = () => typeof crypto !== "undefined" && !!crypto.subtle;

export const sha256Hex = async (input: string): Promise<string> => {
  if (hasSubtle()) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
    return toHex(digest);
  }

  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(input).digest("hex");
};

export const hmacSha256Hex = async (secret: string, payload: string): Promise<string> => {
  if (hasSubtle()) {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    return toHex(signature);
  }

  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", secret).update(payload).digest("hex");
};
