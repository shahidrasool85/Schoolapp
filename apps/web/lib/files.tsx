"use client";

import { useState } from "react";
import { downloadAuthenticated } from "./api";

export function FileDownloadButton({
  path,
  filename,
  label = "Download",
}: {
  path: string;
  filename: string;
  label?: string;
}) {
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="secondary"
        onClick={() =>
          downloadAuthenticated(path, filename).catch((err: Error) => setError(err.message))
        }
      >
        {label}
      </button>
      {error ? <span className="error"> {error}</span> : null}
    </>
  );
}
