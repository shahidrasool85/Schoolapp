import { readLoginHostKind } from "../../lib/login-host-kind";
import { ResetPasswordClient } from "./reset-form";

export default async function ResetPasswordPage() {
  const initialHostKind = await readLoginHostKind();
  return <ResetPasswordClient initialHostKind={initialHostKind} />;
}
