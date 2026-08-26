import { validateUpn } from "@schoolapp/core/upn";
import { upnValidationMessage } from "@schoolapp/domain";

export function clientUpnError(value: string | null | undefined): string | null {
  return upnValidationMessage(validateUpn(value).reason);
}
