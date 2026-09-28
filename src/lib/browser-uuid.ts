export function createBrowserUuid() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hexBytes = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));

  return [
    hexBytes.slice(0, 4).join(""),
    hexBytes.slice(4, 6).join(""),
    hexBytes.slice(6, 8).join(""),
    hexBytes.slice(8, 10).join(""),
    hexBytes.slice(10, 16).join(""),
  ].join("-");
}
