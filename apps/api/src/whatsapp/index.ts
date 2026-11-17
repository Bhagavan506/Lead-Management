import type { Config } from "../config.js";
import { MetaProvider } from "./meta.js";
import { MockProvider } from "./mock.js";
import type { WhatsAppProvider } from "./provider.js";

/** Chosen by WHATSAPP_PROVIDER. Tests always get the mock unless they build a MetaProvider on purpose. */
export function createProvider(config: Config, fetchImpl: typeof fetch = fetch): WhatsAppProvider {
  switch (config.WHATSAPP_PROVIDER) {
    case "mock":
      return new MockProvider();
    case "meta":
      // loadConfig has already refused to start without these.
      return new MetaProvider(
        {
          apiBase: config.WHATSAPP_API_BASE,
          phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID as string,
          accessToken: config.WHATSAPP_ACCESS_TOKEN as string,
          templateName: config.WHATSAPP_TEMPLATE_NAME as string,
          templateLang: config.WHATSAPP_TEMPLATE_LANG,
        },
        fetchImpl,
      );
    default:
      throw new Error(`Unknown WHATSAPP_PROVIDER: ${String(config.WHATSAPP_PROVIDER)}`);
  }
}
