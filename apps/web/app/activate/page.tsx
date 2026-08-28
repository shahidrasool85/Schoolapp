import { readLoginHostKind } from "../../lib/login-host-kind";
import { ActivateClient } from "./activate-form";

export default async function ActivatePage() {
  const initialHostKind = await readLoginHostKind();
  return <ActivateClient initialHostKind={initialHostKind} />;
}
