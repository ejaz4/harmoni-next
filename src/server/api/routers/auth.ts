import z from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { generateSecureString } from "~/libs/generateSecureString";

export const authRouter = createTRPCRouter({
  up: publicProcedure
    .input(
      z.object({
        username: z.string(),
        password: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const hash = bcrypt.hashSync(input.password, 10);

      const user = await ctx.db.user.create({
        data: {
          username: input.username,
          name: input.username,

          security: {
            create: {
              password: hash,
            },
          },
        },
      });

      if (!user) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This username already exists.",
        });
      }

      return true;
    }),

  in: publicProcedure
    .input(
      z.object({
        username: z.string(),
        password: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const security = await ctx.db.userSecurity.findFirst({
        where: {
          user: {
            username: input.username,
          },
        },
      });

      if (!security) {
        // Create an appropriate error
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Invalid username and password.",
        });
      }

      const compare = bcrypt.compareSync(input.password, security.password);

      if (!compare) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Invalid username and password.",
        });
      }

      const token = generateSecureString(256);

      const tokenCreation = await ctx.db.token.create({
        data: {
          security: {
            connect: {
              id: security.id,
            },
          },
          token,
        },
      });

      if (!tokenCreation) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create authentication token.",
        });
      }

      return { token: tokenCreation.token };
    }),
});
