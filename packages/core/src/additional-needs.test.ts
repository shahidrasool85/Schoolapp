import { describe, expect, it } from "vitest";
import {
  auditSafeDietaryAfter,
  auditSafeMedicationAfter,
  isDietaryRecordStatus,
  isMedicationRecordStatus,
  isMedicationRoute,
  summariseActiveDietary,
  summariseActiveMedications,
} from "./additional-needs.js";

describe("additional needs helpers", () => {
  it("accepts catalogue values", () => {
    expect(isMedicationRoute("inhaled")).toBe(true);
    expect(isMedicationRoute("intravenous")).toBe(false);
    expect(isMedicationRecordStatus("stopped")).toBe(true);
    expect(isDietaryRecordStatus("inactive")).toBe(true);
  });

  it("keeps audit payloads free of clinical text", () => {
    const med = auditSafeMedicationAfter({
      action: "updated",
      id: "11111111-1111-1111-1111-111111111111",
      studentProfileId: "22222222-2222-2222-2222-222222222222",
      status: "active",
      isPrn: true,
    });
    expect(Object.keys(med).sort()).toEqual([
      "action",
      "id",
      "isPrn",
      "parentVisible",
      "status",
      "studentProfileId",
    ]);
    expect(JSON.stringify(med)).not.toMatch(/name|dosage|note|instruction/i);
    const diet = auditSafeDietaryAfter({
      action: "stopped",
      id: "33333333-3333-3333-3333-333333333333",
      studentProfileId: "22222222-2222-2222-2222-222222222222",
      status: "inactive",
      requirementType: "allergy",
    });
    expect(JSON.stringify(diet)).not.toMatch(/peanut|avoid|instruction/i);
  });

  it("summarises active records for activity safety lists", () => {
    expect(
      summariseActiveMedications([
        { medicationName: "Cetirizine", dosage: "5mg", isPrn: false, scheduleText: "Once daily" },
        { medicationName: "Salbutamol", dosage: "2 puffs", isPrn: true, scheduleText: "for wheeze" },
      ]),
    ).toBe("Cetirizine — 5mg — Once daily; Salbutamol — 2 puffs — PRN");
    expect(
      summariseActiveDietary([{ requirement: "Nut-free diet", foodsToAvoid: "Peanuts" }]),
    ).toBe("Nut-free diet — Peanuts");
  });
});
