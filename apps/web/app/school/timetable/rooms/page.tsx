"use client";

import { FormEvent, useEffect, useState } from "react";
import { captureSubmitTarget, resetFormSafely } from "@schoolapp/domain";
import { EmptyState } from "../../../../components/ui";
import { api } from "../../../../lib/api";

type Room = {
  id: string;
  name: string;
  shortCode: string;
  building: string | null;
  locationDetail: string | null;
  capacity: number | null;
  locationType: string;
  isActive: boolean;
};

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const body = await api<{ rooms: Room[] }>("/api/v1/timetable/rooms");
    setRooms(body.rooms);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    await api("/api/v1/timetable/rooms", {
      method: "POST",
      body: JSON.stringify({
        name: String(form.get("name") ?? ""),
        shortCode: String(form.get("shortCode") ?? ""),
        building: String(form.get("building") ?? "") || undefined,
        locationDetail: String(form.get("locationDetail") ?? "") || undefined,
        capacity: form.get("capacity") ? Number(form.get("capacity")) : undefined,
        locationType: String(form.get("locationType") ?? "teaching"),
      }),
    });
    resetFormSafely(formEl);
    await load();
  }

  return (
    <>
      <h1>Rooms</h1>
      <form className="card form-grid" onSubmit={onSubmit}>
        <label>
          Name
          <input name="name" required placeholder="Science Lab" />
        </label>
        <label>
          Code
          <input name="shortCode" required placeholder="SCI" />
        </label>
        <label>
          Building
          <input name="building" placeholder="STEM block" />
        </label>
        <label>
          Detail
          <input name="locationDetail" placeholder="First floor" />
        </label>
        <label>
          Capacity
          <input name="capacity" type="number" min={1} />
        </label>
        <label>
          Type
          <select name="locationType" defaultValue="teaching">
            <option value="teaching">Teaching</option>
            <option value="non_teaching">Non-teaching</option>
          </select>
        </label>
        <div>
          <button type="submit">Add room</button>
        </div>
      </form>
      {error ? <p className="error">{error}</p> : null}
      {rooms.length === 0 ? (
        <EmptyState title="No rooms yet" description="Add teaching rooms so timetable lessons can be placed." />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Building</th>
              <th>Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => (
              <tr key={room.id}>
                <td>{room.name}</td>
                <td>{room.shortCode}</td>
                <td>{room.building ?? "—"}</td>
                <td>{room.locationType}</td>
                <td>{room.isActive ? "Active" : "Inactive"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
