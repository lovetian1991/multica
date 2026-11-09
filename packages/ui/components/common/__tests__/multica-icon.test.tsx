import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MulticaIcon } from "../multica-icon";
import { HONGYI_LINGGONG_MARK_DATA_URI } from "../hongyi-linggong-mark";

afterEach(cleanup);

describe("custom distribution mark", () => {
  it("renders the canonical bitmap with an accessible name and fixed size", () => {
    render(<MulticaIcon title="Distribution" size={24} shape="circle" />);
    const mark = screen.getByRole("img", { name: "Distribution" });
    expect(mark).toHaveStyle({ width: "24px", height: "24px" });
    expect(mark).toHaveClass("rounded-full");
    expect(mark.querySelector("image")).toHaveAttribute("href", HONGYI_LINGGONG_MARK_DATA_URI);
  });

  it("keeps decorative launch marks hidden and preserves loading animations", () => {
    const { container } = render(<MulticaIcon mode="launch" />);
    const mark = container.querySelector("svg");
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).toHaveClass("multica-pop", "animate-pulse");
  });
});
