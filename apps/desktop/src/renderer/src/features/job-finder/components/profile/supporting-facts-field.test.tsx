// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SupportingFactsField } from "./supporting-facts-field";
afterEach(cleanup);
it("selects a named fact without asking for an internal ID", () => {
  const onChange = vi.fn();
  const fact = {
    id: "proof_internal_42",
    title: "Improved stock accuracy",
    claim: "",
    heroMetric: "",
    supportingContext: "",
    roleFamilies: "",
    projectIds: "",
    linkIds: "",
  };
  render(<SupportingFactsField facts={[fact]} value="" onChange={onChange} />);
  fireEvent.click(screen.getByRole("checkbox", { name: fact.title }));
  expect(onChange).toHaveBeenCalledWith(fact.id);
  expect(document.body.textContent).not.toContain(fact.id);
});
