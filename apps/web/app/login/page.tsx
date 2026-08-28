import { readLoginHostKind } from "../../lib/login-host-kind";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const initialHostKind = await readLoginHostKind();
  return <LoginForm initialHostKind={initialHostKind} />;
}
