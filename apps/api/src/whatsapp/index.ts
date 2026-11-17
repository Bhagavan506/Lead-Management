import type { Config } from "../config.js";
import { MockProvider } from "./mock.js";
import type { WhatsAppProvider } from "./provider.js";

/** Chosen by WHATSAPP_PROVIDER. Tests always get the mock. */
export function createProvider(config: Config): WhatsAppProvider {
  switch (config.WHATSAPP_PROVIDER) {
    case "mock":
      return new MockProvider();
    default:
      throw new Error(`Unknown WHATSAPP_PROVIDER: ${String(config.WHATSAPP_PROVIDER)}`);
  }
}
