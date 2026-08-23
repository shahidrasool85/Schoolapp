import { headers } from "next/headers";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const host = (await headers()).get("host") ?? "localhost";
  const hostname = host.split(":")[0] ?? "localhost";
  const initialSchoolHost = hostname !== "localhost" && hostname !== "127.0.0.1";
  return <LoginForm initialSchoolHost={initialSchoolHost} />;
}
