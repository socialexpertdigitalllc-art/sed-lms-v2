import { z } from "zod";

export const usernameField = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(30)
  .regex(/^[a-zA-Z0-9._-]+$/, "Only letters, numbers, and . _ -")
  .transform((s) => s.toLowerCase());

export const createUserSchema = z.object({
  email: z.string().email(),
  username: usernameField,
  fullName: z.string().min(1),
  displayName: z.string().min(1),
  tempPassword: z.string().min(8),
  departmentIds: z.array(z.string().uuid()).min(1),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
// the form's input type (before the username lowercase transform)
export type CreateUserFormInput = z.input<typeof createUserSchema>;
