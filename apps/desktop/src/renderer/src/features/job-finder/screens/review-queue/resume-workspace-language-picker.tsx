import { useState } from "react";
import { Button } from "@renderer/components/ui/button";

const LANGUAGES = [
  "Albanian",
  "Arabic",
  "Chinese",
  "Dutch",
  "English",
  "French",
  "German",
  "Italian",
  "Japanese",
  "Korean",
  "Portuguese",
  "Spanish",
];

export function ResumeWorkspaceLanguagePicker(props: {
  language: string | null;
  writtenLanguage: string | null;
  disabled: boolean;
  onWrite: (language: string | null) => void;
}) {
  const [custom, setCustom] = useState(false);
  const [customLanguage, setCustomLanguage] = useState("");
  const choices =
    props.language && !LANGUAGES.includes(props.language)
      ? [...LANGUAGES, props.language]
      : LANGUAGES;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-2">
        Resume language
        <select
          aria-label="Resume language"
          className="h-8 rounded-(--radius-field) border border-(--field-border) bg-(--field) px-2.5 text-xs outline-none focus-visible:border-(--field-focus-border)"
          disabled={props.disabled}
          value={custom ? "custom" : (props.language ?? "")}
          onChange={(event) => {
            if (event.target.value === "custom") {
              setCustom(true);
              return;
            }
            setCustom(false);
            props.onWrite(event.target.value || null);
          }}
        >
          <option value="">
            Listing language
            {props.writtenLanguage ? ` — ${props.writtenLanguage}` : ""}
          </option>
          {choices.map((language) => (
            <option key={language} value={language}>
              {language}
            </option>
          ))}
          <option value="custom">Another language…</option>
        </select>
      </label>
      {custom ? (
        <>
          <input
            aria-label="Another resume language"
            className="h-8 rounded-(--radius-field) border border-(--field-border) bg-(--field) px-2.5 text-xs outline-none focus-visible:border-(--field-focus-border)"
            disabled={props.disabled}
            value={customLanguage}
            onChange={(event) => setCustomLanguage(event.target.value)}
            placeholder="Language name"
          />
          <Button
            disabled={props.disabled || !customLanguage.trim()}
            onClick={() => {
              props.onWrite(customLanguage.trim());
              setCustom(false);
            }}
            size="sm"
            type="button"
          >
            Write in this language
          </Button>
        </>
      ) : null}
      <span className="text-xs text-foreground-muted">
        Choosing a language translates this draft.
      </span>
    </div>
  );
}
