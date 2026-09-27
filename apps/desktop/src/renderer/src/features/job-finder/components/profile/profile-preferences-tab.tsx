import type { UseFieldArrayReturn, UseFormReturn } from "react-hook-form";
import type {
  ProfileEditorValues,
  SearchPreferencesEditorValues,
} from "../../lib/profile-editor";
import { ProfilePreferencesEligibilitySection } from "./profile-preferences-eligibility-section";
import { ProfilePreferencesTargetingSection } from "./profile-preferences-sections";
import type { ProfileFieldArrayKeyName } from "./profile-field-array-types";

interface ProfilePreferencesTabProps {
  busy: boolean;
  customAnswerArray: UseFieldArrayReturn<
    ProfileEditorValues,
    "answerBank.customAnswers",
    ProfileFieldArrayKeyName
  >;
  preferencesForm: UseFormReturn<SearchPreferencesEditorValues>;
  profileForm: UseFormReturn<ProfileEditorValues>;
}

export function ProfilePreferencesTab({
  busy,
  customAnswerArray,
  preferencesForm,
  profileForm,
}: ProfilePreferencesTabProps) {
  return (
    <div className="grid gap-6">
      <ProfilePreferencesEligibilitySection
        busy={busy}
        customAnswerArray={customAnswerArray}
        profileForm={profileForm}
      />
      <ProfilePreferencesTargetingSection preferencesForm={preferencesForm} />
    </div>
  );
}
