import * as webpush from "web-push";

// Prints a fresh VAPID key pair. Paste the three lines into .env (keep the private key secret).
const k = webpush.generateVAPIDKeys();
console.warn(`VAPID_PUBLIC_KEY=${k.publicKey}`);
console.warn(`VAPID_PRIVATE_KEY=${k.privateKey}`);
console.warn("VAPID_SUBJECT=mailto:you@your-company.example");
