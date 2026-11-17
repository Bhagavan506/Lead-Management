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
    WHATSAPP_PROVIDER: z.enum(["mock", "meta"]).default("mock"),
  })
  .superRefine((c, ctx) => {
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
