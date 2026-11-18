import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    JWT_EXPIRES_IN: z.string().default("8h"),
    COOKIE_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    // Comma-separated list of allowed browser origins.
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
    // Set true only when running behind a reverse proxy you control, so client IPs are read correctly.
    TRUST_PROXY: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    // Failed-login limits inside LOGIN_WINDOW_MINUTES: per IP+email, and per IP across all emails.
    LOGIN_MAX_FAILURES_PER_ACCOUNT: z.coerce.number().int().positive().default(5),
    LOGIN_MAX_FAILURES_PER_IP: z.coerce.number().int().positive().default(20),
    LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
    DEFAULT_COUNTRY_CODE: z.string().length(2).default("IN"),
    APP_TIMEZONE: z.string().default("Asia/Kolkata"),
    // How reminders are delivered: mock = record only, push = browser push notifications, meta = WhatsApp.
    WHATSAPP_PROVIDER: z.enum(["mock", "meta", "push"]).default("mock"),
    // Web Push (docs/PUSH.md). Generate with `pnpm --filter @leadbook/api push:keys`. Required for
    // WHATSAPP_PROVIDER=push; when set they also enable "lead assigned" notifications.
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().default("mailto:admin@example.com"),
    // Only used when WHATSAPP_PROVIDER=meta (see docs/WHATSAPP.md). Empty strings count as unset.
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_TEMPLATE_NAME: z.string().optional(),
    WHATSAPP_TEMPLATE_LANG: z.string().default("en"),
    WHATSAPP_APP_SECRET: z.string().optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_API_BASE: z.string().url().default("https://graph.facebook.com/v21.0"),
    // The in-process daily reminder job. Turn off when you run the job another way, and in tests.
    SCHEDULER_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
  })
  .superRefine((c, ctx) => {
    if (c.WHATSAPP_PROVIDER === "meta") {
      for (const k of [
        "WHATSAPP_PHONE_NUMBER_ID",
        "WHATSAPP_ACCESS_TOKEN",
        "WHATSAPP_TEMPLATE_NAME",
        "WHATSAPP_APP_SECRET",
        "WHATSAPP_VERIFY_TOKEN",
      ] as const)
        if (!c[k]?.trim())
          ctx.addIssue({
            code: "custom",
            path: [k],
            message: "required when WHATSAPP_PROVIDER=meta",
          });
    }
    if (c.WHATSAPP_PROVIDER === "push") {
      for (const k of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"] as const)
        if (!c[k]?.trim())
          ctx.addIssue({
            code: "custom",
            path: [k],
            message: "required when WHATSAPP_PROVIDER=push",
          });
    }
    if (c.NODE_ENV !== "production") return;
    if (!c.COOKIE_SECURE)
      ctx.addIssue({
        code: "custom",
        path: ["COOKIE_SECURE"],
        message: "must be true in production",
      });
    if (c.JWT_SECRET.startsWith("change-me"))
      ctx.addIssue({
        code: "custom",
        path: ["JWT_SECRET"],
        message: "must not be the example value",
      });
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
