import { readLoginHostKind } from "../../lib/login-host-kind";
import { ForgotPasswordClient } from "./forgot-form";

export default async function ForgotPasswordPage() {
  const initialHostKind = await readLoginHostKind();
  return <ForgotPasswordClient initialHostKind={initialHostKind} />;
}
