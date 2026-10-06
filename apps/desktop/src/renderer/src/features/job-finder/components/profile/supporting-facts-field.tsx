import type { ProofBankEntryFormEntry } from "../../lib/job-finder-types";

export function SupportingFactsField(props: {
  facts: readonly ProofBankEntryFormEntry[];
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = props.value
    .split(/[\n,]+/u)
    .map((id) => id.trim())
    .filter(Boolean);
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">Supporting facts</legend>
      {props.facts.length === 0 ? (
        <p className="text-xs text-foreground-muted">
          Add achievements in Background to support this answer.
        </p>
      ) : (
        props.facts.map((fact) => (
          <label className="flex items-start gap-2 text-sm" key={fact.id}>
            <input
              type="checkbox"
              checked={selected.includes(fact.id)}
              onChange={(event) => {
                props.onChange(
                  (event.target.checked
                    ? [...selected, fact.id]
                    : selected.filter((id) => id !== fact.id)
                  ).join("\n"),
                );
              }}
            />
            <span>{fact.title || fact.claim || "Saved achievement"}</span>
          </label>
        ))
      )}
    </fieldset>
  );
}
