"use client";

import { FormEvent } from "react";
import { Button, FormField, Input, Select } from "./ui";
import { PERSON_TITLES } from "@schoolapp/domain";

export type ProfileContactValues = {
  title?: string | null;
  preferredName?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressTown?: string | null;
  addressCounty?: string | null;
  addressPostcode?: string | null;
  fullName?: string | null;
};

export function ProfileDetailsForm({
  values,
  editableFields,
  includeFullName = false,
  submitLabel = "Save personal details",
  onSubmit,
}: {
  values: ProfileContactValues;
  editableFields: string[];
  includeFullName?: boolean;
  submitLabel?: string;
  onSubmit: (payload: ProfileContactValues) => Promise<void> | void;
}) {
  const canEdit = (field: string) => editableFields.includes(field);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: ProfileContactValues = {};
    if (includeFullName && canEdit("fullName")) payload.fullName = String(form.get("fullName") ?? "") || null;
    if (canEdit("title")) payload.title = String(form.get("title") ?? "") || null;
    if (canEdit("preferredName")) payload.preferredName = String(form.get("preferredName") ?? "") || null;
    if (canEdit("phone")) payload.phone = String(form.get("phone") ?? "") || null;
    if (canEdit("addressLine1")) payload.addressLine1 = String(form.get("addressLine1") ?? "") || null;
    if (canEdit("addressLine2")) payload.addressLine2 = String(form.get("addressLine2") ?? "") || null;
    if (canEdit("addressTown")) payload.addressTown = String(form.get("addressTown") ?? "") || null;
    if (canEdit("addressCounty")) payload.addressCounty = String(form.get("addressCounty") ?? "") || null;
    if (canEdit("addressPostcode")) payload.addressPostcode = String(form.get("addressPostcode") ?? "") || null;
    await onSubmit(payload);
  }

  return (
    <form className="form-grid" onSubmit={(event) => void submit(event)}>
      {includeFullName && canEdit("fullName") ? (
        <FormField label="Full / legal name">
          <Input name="fullName" defaultValue={values.fullName ?? ""} required />
        </FormField>
      ) : null}
      {canEdit("title") ? (
        <FormField label="Title">
          <Select name="title" defaultValue={values.title ?? ""}>
            <option value="">None</option>
            {PERSON_TITLES.map((title) => (
              <option key={title} value={title}>
                {title}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      {canEdit("preferredName") ? (
        <FormField label="Preferred name">
          <Input name="preferredName" defaultValue={values.preferredName ?? ""} />
        </FormField>
      ) : null}
      {canEdit("phone") ? (
        <FormField label="Phone">
          <Input name="phone" defaultValue={values.phone ?? ""} />
        </FormField>
      ) : null}
      {canEdit("addressLine1") ? (
        <FormField label="Address line 1">
          <Input name="addressLine1" defaultValue={values.addressLine1 ?? ""} />
        </FormField>
      ) : null}
      {canEdit("addressLine2") ? (
        <FormField label="Address line 2">
          <Input name="addressLine2" defaultValue={values.addressLine2 ?? ""} />
        </FormField>
      ) : null}
      {canEdit("addressTown") ? (
        <FormField label="Town / city">
          <Input name="addressTown" defaultValue={values.addressTown ?? ""} />
        </FormField>
      ) : null}
      {canEdit("addressCounty") ? (
        <FormField label="County">
          <Input name="addressCounty" defaultValue={values.addressCounty ?? ""} />
        </FormField>
      ) : null}
      {canEdit("addressPostcode") ? (
        <FormField label="Postcode">
          <Input name="addressPostcode" defaultValue={values.addressPostcode ?? ""} />
        </FormField>
      ) : null}
      <div>
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  );
}

export function ReadOnlyDl({
  items,
}: {
  items: Array<{ label: string; value?: string | null }>;
}) {
  return (
    <dl className="profile-list">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value?.trim() ? item.value : "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
