import { randomBytes } from "crypto";

export const generateSecureString = (length = 56) => {
  return Buffer.from(randomBytes(length)).toString("hex");
};
