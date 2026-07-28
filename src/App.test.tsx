import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "@/App";

describe("App", () => {
  it("shows the Flowent name", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Flowent" }),
    ).toBeInTheDocument();
  });
});
