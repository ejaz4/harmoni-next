import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins/username";
import { db } from "./db";
import { getServerSettings } from "./settings";

// Harmoni accounts are username + password. better-auth's email/password flow
// still needs an email, so sign-up fills in a placeholder on a reserved TLD.
const placeholderEmail = (name: string) => `${name.toLowerCase()}@users.harmoni.invalid`;

// After the first account (which becomes admin), who can sign up is up to
// Server settings: with an invite code (sent in this header by the sign-up
// form), anyone, or no one.
export const INVITE_HEADER = "x-harmoni-invite";

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",").map((o) => o.trim()),
  emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 }, // 30 days, refreshed daily
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "user", input: false },
      superProcessing: { type: "boolean", defaultValue: false, input: false },
      autoplay: { type: "boolean", defaultValue: false, input: false },
    },
  },
  plugins: [username({ minUsernameLength: 2, maxUsernameLength: 32 }), nextCookies()],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-in/email") {
        throw new APIError("NOT_FOUND", { message: "Sign in with your username." });
      }
      if (ctx.path === "/sign-up/email") {
        const name = typeof ctx.body?.username === "string" ? ctx.body.username.trim() : "";
        if (!name) throw new APIError("BAD_REQUEST", { message: "Pick a username." });
        return { context: { body: { ...ctx.body, email: placeholderEmail(name), name: ctx.body?.name || name } } };
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          if ((await db.user.count()) === 0) return { data: { ...user, role: "admin" } };
          const settings = await getServerSettings();
          if (settings.signups === "closed") throw new APIError("FORBIDDEN", { message: `${settings.name} isn't taking new accounts right now.` });
          if (settings.maxAccounts && (await db.user.count()) >= settings.maxAccounts) {
            throw new APIError("FORBIDDEN", { message: `${settings.name} is full right now.` });
          }
          const code = ctx?.headers?.get(INVITE_HEADER)?.trim();
          if (!code) {
            if (settings.signups === "open") return { data: { ...user, role: "user" } };
            throw new APIError("FORBIDDEN", { message: "You need an invite code to join." });
          }
          // Claim the invite in one statement so a code can't be used twice.
          const claimed = await db.invite.updateMany({
            where: { code, usedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
            data: { usedAt: new Date() },
          });
          if (claimed.count === 0) throw new APIError("FORBIDDEN", { message: "That invite code isn't valid." });
          return { data: { ...user, role: "user" } };
        },
        after: async (user, ctx) => {
          const code = ctx?.headers?.get(INVITE_HEADER)?.trim();
          if (code) await db.invite.updateMany({ where: { code, usedById: null }, data: { usedById: user.id } });
        },
      },
    },
    session: {
      create: {
        // A suspended account can't sign in (suspending also ends its sessions).
        before: async (session) => {
          const user = await db.user.findUnique({ where: { id: session.userId }, select: { suspended: true } });
          if (user?.suspended) throw new APIError("FORBIDDEN", { message: "This account is suspended. Ask an admin." });
        },
      },
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;
