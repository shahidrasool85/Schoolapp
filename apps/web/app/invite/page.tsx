import { readLoginHostKind } from "../../lib/login-host-kind";
import { InviteClient } from "./invite-form";

export default async function InvitePage() {
  const initialHostKind = await readLoginHostKind();
  return <InviteClient initialHostKind={initialHostKind} />;
}
